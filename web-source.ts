// Web lookups, the I/O half: map tiles from OpenStreetMap, place search from
// Photon (Nominatim as the fallback) and photos from Wikimedia Commons. This
// server is the only part of Iris that reaches the web. Every request goes to
// an allowlisted host with Iris's User-Agent, every response is checked and
// capped, and every answer is cached in the plugin's SQLite so a card that
// redraws asks nothing twice. A setting turns all of it off.
import type Database from "better-sqlite3";
import {
  LOOKUPS_OFF,
  MAX_QUERIES,
  USER_AGENT,
  allowedHost,
  commonsSearchUrl,
  nominatimUrl,
  normalizeQuery,
  photoWidth,
  photonUrl,
  readCommons,
  readNominatim,
  readPhoton,
  tileUrl,
  webFailure,
  type GeoHit,
  type GeocodeResult,
  type Photo,
  type PhotoResult,
  type TileResult,
  type WebHost,
} from "./core/web";

/** Append-only: bb records each statement's hash. */
export const WEB_MIGRATIONS = [
  `CREATE TABLE web_cache (
    key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    body BLOB,
    meta TEXT,
    bytes INTEGER NOT NULL,
    fetched_at INTEGER NOT NULL,
    used_at INTEGER NOT NULL
  )`,
  `CREATE INDEX web_cache_used ON web_cache (used_at)`,
];

const DAY = 86_400_000;
const TTL = { tile: 7 * DAY, geo: 90 * DAY, geoMiss: DAY, photo: 30 * DAY, photoMiss: DAY };
const CACHE_LIMIT = 96 * 1024 * 1024;
const CACHE_TARGET = 64 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const LIMITS = {
  tile: 512 * 1024,
  geo: 256 * 1024,
  commons: 1024 * 1024,
  photo: 4 * 1024 * 1024,
};
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Polite use: how many requests run at once per host, the gap between them, and an hourly budget. */
const HOST_RULES: Record<WebHost, { concurrent: number; gapMs: number; perHour: number }> = {
  "tile.openstreetmap.org": { concurrent: 2, gapMs: 0, perHour: 1500 },
  "photon.komoot.io": { concurrent: 1, gapMs: 250, perHour: 400 },
  "nominatim.openstreetmap.org": { concurrent: 1, gapMs: 1100, perHour: 200 },
  "commons.wikimedia.org": { concurrent: 1, gapMs: 200, perHour: 300 },
  "upload.wikimedia.org": { concurrent: 2, gapMs: 0, perHour: 300 },
  "thumb.wikimedia.org": { concurrent: 2, gapMs: 0, perHour: 300 },
};

export class WebError extends Error {
  constructor(
    message: string,
    readonly code: "failed" | "busy" | "invalid" = "failed",
  ) {
    super(message);
  }
}

class Gate {
  private running = 0;
  private last = 0;
  private queue: (() => void)[] = [];
  private window: number[] = [];
  constructor(
    private rule: { concurrent: number; gapMs: number; perHour: number },
    private now: () => number,
  ) {}
  async run<T>(job: () => Promise<T>): Promise<T> {
    const t = this.now();
    this.window = this.window.filter((x) => t - x < 3_600_000);
    if (this.window.length >= this.rule.perHour) throw new WebError("Iris has made its hourly share of requests to this service; try again later", "busy");
    this.window.push(t);
    if (this.running >= this.rule.concurrent) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.running++;
    try {
      const wait = this.last + this.rule.gapMs - this.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = this.now();
      return await job();
    } finally {
      this.last = this.now();
      this.running--;
      this.queue.shift()?.();
    }
  }
}

export interface WebSourceOptions {
  db: Database.Database;
  enabled: () => boolean;
  fetch?: typeof fetch;
  now?: () => number;
}

interface Row {
  body: Buffer | null;
  meta: string | null;
  fetched_at: number;
  used_at: number;
}

export function createWebSource(opts: WebSourceOptions) {
  const { db, enabled } = opts;
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  const gates = new Map<WebHost, Gate>();
  const inflight = new Map<string, Promise<unknown>>();
  const getRow = db.prepare<[string], Row>("SELECT body, meta, fetched_at, used_at FROM web_cache WHERE key = ?");
  const touch = db.prepare<[number, string]>("UPDATE web_cache SET used_at = ? WHERE key = ?");
  const putRow = db.prepare<[string, string, Buffer | null, string | null, number, number, number]>(
    "INSERT OR REPLACE INTO web_cache (key, kind, body, meta, bytes, fetched_at, used_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const total = db.prepare<[], { n: number | null }>("SELECT SUM(bytes) AS n FROM web_cache");
  const oldest = db.prepare<[], { key: string; bytes: number }>("SELECT key, bytes FROM web_cache ORDER BY used_at ASC LIMIT 200");
  const drop = db.prepare<[string]>("DELETE FROM web_cache WHERE key = ?");
  let writes = 0;

  function cached(key: string, ttl: (row: Row) => number): Row | null {
    const row = getRow.get(key);
    if (!row) return null;
    if (now() - row.fetched_at > ttl(row)) return null;
    // Recency only orders pruning, so a hit writes at most once an hour.
    if (now() - row.used_at > 3_600_000) touch.run(now(), key);
    return row;
  }

  function store(key: string, kind: string, body: Buffer | null, meta: unknown) {
    const m = meta === undefined ? null : JSON.stringify(meta);
    const bytes = (body?.length ?? 0) + (m?.length ?? 0) + key.length;
    putRow.run(key, kind, body, m, bytes, now(), now());
    if (++writes % 50 === 0) prune();
  }

  /** Keeps the cache under its limit by dropping what was used longest ago. */
  function prune() {
    let size = total.get()?.n ?? 0;
    if (size <= CACHE_LIMIT) return;
    db.transaction(() => {
      while (size > CACHE_TARGET) {
        const rows = oldest.all();
        if (!rows.length) break;
        for (const r of rows) {
          drop.run(r.key);
          size -= r.bytes;
          if (size <= CACHE_TARGET) break;
        }
      }
    })();
  }

  function once<T>(key: string, job: () => Promise<T>): Promise<T> {
    const hit = inflight.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const p = job().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  /** The only way out to the web: allowlisted host, no redirects, checked type, capped size. */
  async function get(url: string, accept: string[], maxBytes: number): Promise<{ body: Buffer; type: string }> {
    const host = allowedHost(url);
    if (!host) throw new WebError("not an allowed host", "invalid");
    let gate = gates.get(host);
    if (!gate) gates.set(host, (gate = new Gate(HOST_RULES[host], now)));
    return gate.run(async () => {
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      let res: Response;
      try {
        res = await doFetch(url, { headers: { "user-agent": USER_AGENT, accept: accept.join(", ") }, redirect: "manual", signal });
      } catch (cause) {
        throw new WebError(signal.aborted ? `${host} did not answer in time` : `${host} could not be reached`);
      }
      if (res.status >= 300 && res.status < 400) throw new WebError(`${host} redirected; Iris does not follow redirects`);
      if (res.status === 429) throw new WebError(`${host} asked Iris to slow down`, "busy");
      if (!res.ok) throw new WebError(`${host} answered ${res.status}`);
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!accept.includes(type)) throw new WebError(`${host} sent ${type || "an unknown type"}`);
      const declared = Number(res.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) throw new WebError(`${host} sent more than ${Math.round(maxBytes / 1024)} KB`);
      const body = await readCapped(res, maxBytes, host);
      return { body, type };
    });
  }

  async function getJson(url: string, maxBytes: number): Promise<unknown> {
    const { body } = await get(url, ["application/json", "application/geo+json"], maxBytes);
    try {
      return JSON.parse(body.toString("utf8"));
    } catch {
      throw new WebError(`${allowedHost(url)} sent unreadable JSON`);
    }
  }

  const failed = (cause: unknown) =>
    cause instanceof WebError ? webFailure(cause.code, cause.message) : webFailure("failed", cause instanceof Error ? cause.message : String(cause));

  async function tile(z: number, x: number, y: number): Promise<TileResult> {
    if (!enabled()) return webFailure("off", LOOKUPS_OFF);
    const url = tileUrl(z, x, y);
    if (!url) return webFailure("invalid", "not a tile");
    const key = `tile:${z}/${x}/${y}`;
    const row = cached(key, () => TTL.tile);
    if (row?.body) return { ok: true, dataUrl: `data:image/png;base64,${row.body.toString("base64")}` };
    try {
      const body = await once(key, async () => {
        const { body } = await get(url, ["image/png"], LIMITS.tile);
        store(key, "tile", body, undefined);
        return body;
      });
      return { ok: true, dataUrl: `data:image/png;base64,${body.toString("base64")}` };
    } catch (cause) {
      return failed(cause);
    }
  }

  async function lookupPlace(q: string): Promise<GeoHit | null> {
    const key = `geo:${q}`;
    const row = cached(key, (r) => (r.meta === "null" ? TTL.geoMiss : TTL.geo));
    if (row) return row.meta ? (JSON.parse(row.meta) as GeoHit | null) : null;
    return once(key, async () => {
      let hit: GeoHit | null = null;
      let answered = false;
      let lastError: unknown = null;
      for (const [build, read] of [
        [photonUrl, readPhoton],
        [nominatimUrl, readNominatim],
      ] as const) {
        try {
          hit = read(await getJson(build(q), LIMITS.geo));
          answered = true;
          if (hit) break;
        } catch (cause) {
          lastError = cause;
        }
      }
      if (!answered) throw lastError ?? new WebError("place search failed");
      store(key, "geo", null, hit);
      return hit;
    });
  }

  async function geocode(queries: string[]): Promise<GeocodeResult> {
    if (!enabled()) return webFailure("off", LOOKUPS_OFF);
    if (queries.length > MAX_QUERIES) return webFailure("invalid", `at most ${MAX_QUERIES} places per card`);
    const normal = queries.map(normalizeQuery);
    let errors = 0;
    let lastError: unknown = null;
    const unique = [...new Set(normal.filter((q): q is string => q !== null))];
    const found = new Map<string, GeoHit | null>();
    // One at a time: the providers ask for it, and the cache makes repeats free.
    for (const q of unique) {
      try {
        found.set(q, await lookupPlace(q));
      } catch (cause) {
        errors++;
        lastError = cause;
        found.set(q, null);
      }
    }
    if (unique.length && errors === unique.length) return failed(lastError);
    return { ok: true, results: normal.map((q) => (q ? (found.get(q) ?? null) : null)) };
  }

  async function photo(query: string, requestedWidth: number | undefined): Promise<PhotoResult> {
    if (!enabled()) return webFailure("off", LOOKUPS_OFF);
    const q = normalizeQuery(query);
    if (!q) return webFailure("invalid", "describe the photo in at most 200 characters");
    const width = photoWidth(requestedWidth);
    const key = `photo:${width}:${q}`;
    const row = cached(key, (r) => (r.meta === "null" ? TTL.photoMiss : TTL.photo));
    if (row) {
      const meta = row.meta ? (JSON.parse(row.meta) as (Omit<Photo, "dataUrl"> & { type: string }) | null) : null;
      if (!meta || !row.body) return webFailure("not_found", `Wikimedia Commons has no photo for "${query.trim()}"`);
      const { type, ...rest } = meta;
      return { ok: true, photo: { ...rest, dataUrl: `data:${type};base64,${row.body.toString("base64")}` } };
    }
    try {
      return await once(key, async (): Promise<PhotoResult> => {
        const pick = readCommons(await getJson(commonsSearchUrl(q, width), LIMITS.commons));
        if (!pick) {
          store(key, "photo", null, null);
          return webFailure("not_found", `Wikimedia Commons has no photo for "${query.trim()}"`);
        }
        const { body, type } = await get(pick.thumb, PHOTO_TYPES, LIMITS.photo);
        const { thumb: _thumb, mime: _mime, ...credit } = pick;
        store(key, "photo", body, { ...credit, type });
        return { ok: true, photo: { ...credit, dataUrl: `data:${type};base64,${body.toString("base64")}` } };
      });
    } catch (cause) {
      return failed(cause);
    }
  }

  return { tile, geocode, photo };
}

async function readCapped(res: Response, maxBytes: number, host: string): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new WebError(`${host} sent more than ${Math.round(maxBytes / 1024)} KB`);
    }
    parts.push(value);
  }
  return Buffer.concat(parts);
}
