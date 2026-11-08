// The public plugin data contract: any bb plugin can feed live data to Iris
// cards without Iris knowing about it.
//
// A plugin opts in by serving read-only GET routes under `iris/` with
// bb.http.route, for example `bb.http.route("GET", "/iris/status", handler, { auth: "local" })`.
// A card reads one with load("plugin:<pluginId>/<name>"), which fetches
// /api/v1/plugins/<pluginId>/http/iris/<name>?thread=<threadId> from bb's own
// page and parses the answer by its content type (JSON, JSON Lines, CSV or
// TSV, else text). Inside a live card it re-reads every 2 s like a file.
// Only the `iris/` prefix is ever read, so a plugin shares exactly what it puts there.

import { parseDataFile, type Parsed } from "./data";

export const PLUGIN_DATA_PREFIX = "plugin:";
/** The most a plugin answer may hold; larger answers are refused rather than cut. */
export const MAX_PLUGIN_DATA_BYTES = 4 * 1024 * 1024;
export const PLUGIN_DATA_TIMEOUT_MS = 10_000;

export function isPluginSource(path: string): boolean {
  return path.startsWith(PLUGIN_DATA_PREFIX);
}

export interface PluginSource {
  pluginId: string;
  /** Path below the plugin's `iris/` route prefix, "/"-separated, unencoded. */
  name: string;
  query: [string, string][];
}

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const SEGMENT = /^[A-Za-z0-9._~-]{1,100}$/;

/** Reads "plugin:<id>/<name>[?k=v&...]" or explains why it can't. */
export function parsePluginSource(spec: string): { ok: true; source: PluginSource } | { ok: false; error: string } {
  if (!isPluginSource(spec)) return { ok: false, error: "not a plugin source" };
  const rest = spec.slice(PLUGIN_DATA_PREFIX.length);
  const q = rest.indexOf("?");
  const pathPart = q >= 0 ? rest.slice(0, q) : rest;
  const queryPart = q >= 0 ? rest.slice(q + 1) : "";
  const [pluginId, ...segments] = pathPart.split("/");
  if (!pluginId || !ID.test(pluginId)) return { ok: false, error: `"${pluginId ?? ""}" is not a plugin id: write plugin:<pluginId>/<name>` };
  if (!segments.length || segments.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) {
    return { ok: false, error: "the name after the plugin id must be letters, digits, dots, dashes or underscores, separated by /" };
  }
  if (segments.length > 8) return { ok: false, error: "the name has too many parts" };
  const query: [string, string][] = [];
  if (queryPart) {
    for (const pair of queryPart.split("&")) {
      if (!pair) continue;
      const eq = pair.indexOf("=");
      const k = eq >= 0 ? pair.slice(0, eq) : pair;
      const v = eq >= 0 ? pair.slice(eq + 1) : "";
      let key: string;
      let value: string;
      try {
        key = decodeURIComponent(k.replace(/\+/g, " "));
        value = decodeURIComponent(v.replace(/\+/g, " "));
      } catch {
        return { ok: false, error: "the query has a broken escape" };
      }
      if (!/^[A-Za-z0-9_.-]{1,40}$/.test(key) || key === "thread") return { ok: false, error: `"${key}" can't be a query key` };
      if (value.length > 500) return { ok: false, error: `the value of "${key}" is too long` };
      query.push([key, value]);
    }
    if (query.length > 20) return { ok: false, error: "the query has too many keys" };
  }
  return { ok: true, source: { pluginId, name: segments.join("/"), query } };
}

/** The route a source reads, relative to bb's origin. */
export function pluginDataPath(source: PluginSource, threadId: string | null): string {
  const params = new URLSearchParams(source.query);
  if (threadId) params.set("thread", threadId);
  const qs = params.toString();
  return `/api/v1/plugins/${encodeURIComponent(source.pluginId)}/http/iris/${source.name.split("/").map(encodeURIComponent).join("/")}${qs ? `?${qs}` : ""}`;
}

/** Parses a plugin's answer by its content type, falling back to the name's extension. */
export function parsePluginAnswer(name: string, contentType: string, text: string, raw: boolean): Parsed {
  if (raw) return { ok: true, value: text };
  const type = contentType.split(";")[0].trim().toLowerCase();
  const ext = type === "application/json" || type.endsWith("+json") ? "json" : type === "application/x-ndjson" || type === "application/jsonl" ? "jsonl" : type === "text/csv" ? "csv" : type === "text/tab-separated-values" ? "tsv" : null;
  return parseDataFile(ext ? `data.${ext}` : name, text);
}

/** The body as text, or null once it passes the byte cap (the read is aborted there, never buffered whole). */
async function readCapped(res: Response, cap: number, abort: AbortController): Promise<string | null> {
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > cap) {
      abort.abort();
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(bytes);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

/** Fetches and parses a plugin source from bb's page. */
export async function loadPluginData(spec: string, threadId: string | null, raw: boolean, fetchImpl: typeof fetch = fetch, base?: string): Promise<Parsed> {
  const parsed = parsePluginSource(spec);
  if (!parsed.ok) return parsed;
  const { source } = parsed;
  const url = base ? new URL(pluginDataPath(source, threadId), base).href : pluginDataPath(source, threadId);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PLUGIN_DATA_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { method: "GET", credentials: "same-origin", headers: { accept: "application/json, text/csv;q=0.9, text/plain;q=0.8" }, signal: abort.signal });
    if (res.status === 404) return { ok: false, error: `plugin "${source.pluginId}" has no Iris data named "${source.name}" (is it installed, and does it serve iris/${source.name}?)` };
    if (!res.ok) return { ok: false, error: `plugin "${source.pluginId}" answered ${res.status}` };
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_PLUGIN_DATA_BYTES) return { ok: false, error: `plugin "${source.pluginId}" sent more than ${MAX_PLUGIN_DATA_BYTES / 1024 / 1024} MB` };
    const text = await readCapped(res, MAX_PLUGIN_DATA_BYTES, abort);
    if (text === null) return { ok: false, error: `plugin "${source.pluginId}" sent more than ${MAX_PLUGIN_DATA_BYTES / 1024 / 1024} MB` };
    return parsePluginAnswer(source.name, res.headers.get("content-type") ?? "", text, raw);
  } catch (e) {
    return { ok: false, error: abort.signal.aborted ? `plugin "${source.pluginId}" didn't answer within ${PLUGIN_DATA_TIMEOUT_MS / 1000} s` : `couldn't reach plugin "${source.pluginId}": ${e instanceof Error ? e.message : String(e)}` };
  } finally {
    clearTimeout(timer);
  }
}

export interface FeedReport {
  ok: boolean;
  /** One line per finding, in order: what answered, its type and size, then its fields. */
  lines: string[];
}

/** A value's shape in a few words: "number", "list of 12", "object". */
function shapeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `list of ${v.length}`;
  if (typeof v === "object") return `object (${Object.keys(v as object).length} fields)`;
  if (typeof v === "string") return v.length > 40 ? `text (${v.length} chars)` : `text ${JSON.stringify(v)}`;
  return `${typeof v} ${JSON.stringify(v)}`;
}

/** The fields a card can read: an object's keys, or the keys a list's rows share (from the first 50). */
export function describeFields(value: unknown, depth = 0): string[] {
  const pad = "  ".repeat(depth + 1);
  if (Array.isArray(value)) {
    const rows = value.slice(0, 50).filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && !Array.isArray(r));
    if (!rows.length) return value.length ? [`${pad}items: ${shapeOf(value[0])}`] : [];
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].slice(0, 30);
    return keys.map((k) => {
      const seen = rows.filter((r) => k in r).length;
      return `${pad}${k}: ${shapeOf(rows.find((r) => k in r)?.[k])}${seen < rows.length ? ` (in ${seen} of ${rows.length} rows)` : ""}`;
    });
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 30)
      .flatMap(([k, v]) => [`${pad}${k}: ${shapeOf(v)}`, ...(depth < 1 && v && typeof v === "object" ? describeFields(v, depth + 1) : [])]);
  }
  return [];
}

/**
 * Checks a plugin source the way a card reads it: the route answers, with a type Iris parses, under
 * the size cap and in time, and says what fields the card can use.
 */
export async function checkFeed(spec: string, threadId: string | null, base: string, fetchImpl: typeof fetch = fetch): Promise<FeedReport> {
  const full = isPluginSource(spec) ? spec : `${PLUGIN_DATA_PREFIX}${spec}`;
  const parsed = parsePluginSource(full);
  if (!parsed.ok) return { ok: false, lines: [`Error: ${parsed.error}`] };
  const { source } = parsed;
  const route = pluginDataPath(source, threadId);
  const lines = [`${full}`, `GET ${route}`];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), PLUGIN_DATA_TIMEOUT_MS);
  const started = Date.now();
  try {
    const res = await fetchImpl(new URL(route, base).href, { method: "GET", headers: { accept: "application/json, text/csv;q=0.9, text/plain;q=0.8" }, signal: abort.signal });
    const ms = Date.now() - started;
    if (res.status === 404) return { ok: false, lines: [...lines, `Error: 404 in ${ms} ms. Plugin "${source.pluginId}" isn't installed or doesn't serve iris/${source.name} (bb.http.route("GET", "/iris/${source.name}", handler, { auth: "local" }))`] };
    if (!res.ok) return { ok: false, lines: [...lines, `Error: answered ${res.status} in ${ms} ms; a card shows that as an error`] };
    const type = res.headers.get("content-type") ?? "";
    const text = await readCapped(res, MAX_PLUGIN_DATA_BYTES, abort);
    const total = Date.now() - started;
    if (text === null) return { ok: false, lines: [...lines, `Error: the answer is over ${MAX_PLUGIN_DATA_BYTES / 1024 / 1024} MB, so cards refuse it`] };
    const bytes = new TextEncoder().encode(text).byteLength;
    const kind = type.split(";")[0].trim().toLowerCase() || "no content-type";
    lines.push(`200 in ${total} ms, ${kind}, ${bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024)} KB`}${total > 2000 ? "; slow: live cards read it every 10 s and wait for it" : ""}`);
    const issues: string[] = [];
    if (!type) issues.push("Warning: no content-type; Iris guesses from the name's extension. Send application/json, application/x-ndjson, text/csv or text/tab-separated-values");
    const cache = res.headers.get("cache-control") ?? "";
    if (!/no-store|no-cache|max-age=0/.test(cache)) issues.push(`Warning: cache-control is ${cache ? `"${cache}"` : "unset"}; send no-store so live cards see fresh data`);
    const data = parsePluginAnswer(source.name, type, text, false);
    if (!data.ok) return { ok: false, lines: [...lines, ...issues, `Error: ${data.error}`] };
    lines.push(...issues, `Value: ${shapeOf(data.value)}`, ...describeFields(data.value));
    lines.push(`Use it: <let feed={load("${full}")} />, or inside <Card state="live"> to re-read it every 10 s.`);
    return { ok: true, lines };
  } catch (e) {
    return { ok: false, lines: [...lines, abort.signal.aborted ? `Error: no answer within ${PLUGIN_DATA_TIMEOUT_MS / 1000} s; a card gives up there` : `Error: couldn't reach bb: ${e instanceof Error ? e.message : String(e)}`] };
  } finally {
    clearTimeout(timer);
  }
}
