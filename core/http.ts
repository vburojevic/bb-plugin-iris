// HTTP exchanges and HAR files, read into one shape for HttpExchange and
// Waterfall. Accepts what agents have at hand: objects they write, raw text
// from `curl -i`, HAR entries from a browser, and JSON strings of any of them.

import { toText } from "./evaluate";

export type Header = [name: string, value: string];

export interface Exchange {
  method: string;
  url: string;
  status: number | null;
  statusText: string;
  reqHeaders: Header[];
  resHeaders: Header[];
  reqBody: string | null;
  resBody: string | null;
  resMime: string;
  /** Total time in ms. */
  ms: number | null;
  /** Response size in bytes, when known. */
  size: number | null;
  phases: Phase[];
  /** HTTP version, e.g. "HTTP/2". */
  version: string;
}

export type PhaseKind = "blocked" | "dns" | "connect" | "tls" | "send" | "wait" | "receive";
export interface Phase {
  kind: PhaseKind;
  ms: number;
}
export const PHASES: { kind: PhaseKind; label: string }[] = [
  { kind: "blocked", label: "Queued" },
  { kind: "dns", label: "DNS" },
  { kind: "connect", label: "Connect" },
  { kind: "tls", label: "TLS" },
  { kind: "send", label: "Send" },
  { kind: "wait", label: "Waiting" },
  { kind: "receive", label: "Download" },
];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function maybeJson(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!(t.startsWith("{") || t.startsWith("["))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

export function readHeaders(v: unknown): Header[] {
  if (Array.isArray(v)) {
    return v.flatMap((h): Header[] => {
      if (Array.isArray(h) && h.length >= 2) return [[toText(h[0]), toText(h[1])]];
      if (isObj(h) && h.name != null) return [[toText(h.name), toText(h.value ?? "")]];
      if (typeof h === "string" && h.includes(":")) return [[h.slice(0, h.indexOf(":")).trim(), h.slice(h.indexOf(":") + 1).trim()]];
      return [];
    });
  }
  if (isObj(v)) return Object.entries(v).flatMap(([k, x]): Header[] => (Array.isArray(x) ? x.map((y): Header => [k, toText(y)]) : [[k, toText(x)]]));
  if (typeof v === "string") return readHeaders(v.split(/\r?\n/).filter((l) => l.includes(":")));
  return [];
}

export const header = (hs: Header[], name: string) => hs.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

function bodyText(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (typeof v === "string") return v;
  if (isObj(v) && ("text" in v || "mimeType" in v)) {
    // HAR postData or content: {mimeType, text, encoding?}
    if (v.encoding === "base64" && typeof v.text === "string") return `(base64, ${v.text.length} characters)`;
    if (v.text != null) return toText(v.text);
    if (Array.isArray(v.params)) return v.params.map((p) => (isObj(p) ? `${toText(p.name)}=${toText(p.value ?? "")}` : "")).join("&");
    return null;
  }
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return toText(v);
  }
}

/** A raw request or response as `curl -i` or a proxy prints it. */
export function parseRawHttp(text: string): { start: string; headers: Header[]; body: string | null } {
  const norm = text.replace(/\r\n/g, "\n");
  // curl -i after a redirect or a 100 Continue prints several heads; keep the last.
  const blocks = norm.split(/\n\n(?=HTTP\/[\d.]+ \d{3})/);
  const last = blocks[blocks.length - 1].replace(/^\s+/, "");
  const cut = last.indexOf("\n\n");
  const head = cut < 0 ? last : last.slice(0, cut);
  const body = cut < 0 ? null : last.slice(cut + 2);
  const [start, ...lines] = head.split("\n");
  return { start: start.trim(), headers: readHeaders(lines), body: body && body.length ? body : null };
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Reads a HAR timings object; -1 means "not measured". Connect includes TLS in HAR, so TLS is split out. */
export function harPhases(t: unknown): Phase[] {
  if (!isObj(t)) return [];
  const g = (k: string) => {
    const n = num(t[k]);
    return n !== null && n > 0 ? n : 0;
  };
  const tls = g("ssl") || g("tls");
  const connect = Math.max(0, g("connect") - tls);
  const raw: Phase[] = [
    { kind: "blocked", ms: g("blocked") + g("queued") },
    { kind: "dns", ms: g("dns") },
    { kind: "connect", ms: connect },
    { kind: "tls", ms: tls },
    { kind: "send", ms: g("send") },
    { kind: "wait", ms: g("wait") || g("ttfb") },
    { kind: "receive", ms: g("receive") || g("download") },
  ];
  return raw.filter((p) => p.ms > 0);
}

/** Reads a request/response pair, a HAR entry, or raw HTTP text into one exchange. */
export function normalizeExchange(input: { request?: unknown; response?: unknown; entry?: unknown; ms?: unknown; timings?: unknown }): { exchange: Exchange; problems: string[] } {
  const problems: string[] = [];
  const entry = maybeJson(input.entry);
  let req = maybeJson(input.request);
  let res = maybeJson(input.response);
  let timings = input.timings;
  let ms = num(input.ms);
  if (isObj(entry)) {
    req ??= entry.request;
    res ??= entry.response;
    timings ??= entry.timings;
    ms ??= num(entry.time);
  }
  const ex: Exchange = { method: "GET", url: "", status: null, statusText: "", reqHeaders: [], resHeaders: [], reqBody: null, resBody: null, resMime: "", ms, size: null, phases: [], version: "" };
  if (typeof req === "string") {
    const raw = parseRawHttp(req);
    const m = /^([A-Z]+)\s+(\S+)(?:\s+(HTTP\/[\d.]+))?/.exec(raw.start);
    if (m) {
      ex.method = m[1];
      const host = header(raw.headers, "host");
      ex.url = /^https?:/.test(m[2]) || !host ? m[2] : `https://${host}${m[2]}`;
      ex.version = m[3] ?? "";
      ex.reqHeaders = raw.headers;
      ex.reqBody = raw.body;
    } else if (/^https?:\/\//.test(req.trim()) || req.trim().startsWith("/")) ex.url = req.trim();
    else problems.push("request text should start with a line like GET /path HTTP/1.1, or be a URL");
  } else if (isObj(req)) {
    ex.method = toText(req.method ?? "GET").toUpperCase();
    ex.url = toText(req.url ?? req.path ?? "");
    if (isObj(req.query) || Array.isArray(req.query)) {
      const q = readHeaders(req.query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
      if (q && !ex.url.includes("?")) ex.url += `?${q}`;
    }
    ex.reqHeaders = readHeaders(req.headers);
    ex.reqBody = bodyText(req.body ?? req.postData ?? req.data ?? req.json);
    ex.version = req.httpVersion ? toText(req.httpVersion) : "";
  } else if (req != null) problems.push("request takes {method, url, headers?, body?}, raw HTTP text or a URL");

  if (typeof res === "string") {
    const raw = parseRawHttp(res);
    const m = /^(HTTP\/[\d.]+)\s+(\d{3})\s*(.*)$/.exec(raw.start);
    if (m) {
      ex.version ||= m[1];
      ex.status = Number(m[2]);
      ex.statusText = m[3];
      ex.resHeaders = raw.headers;
      ex.resBody = raw.body;
    } else ex.resBody = res;
  } else if (isObj(res)) {
    ex.status = num(res.status ?? res.statusCode ?? res.code);
    ex.statusText = toText(res.statusText ?? res.statusMessage ?? "");
    ex.resHeaders = readHeaders(res.headers);
    ex.resBody = bodyText(res.body ?? res.content ?? res.data ?? res.json);
    if (isObj(res.content)) ex.resMime = toText(res.content.mimeType ?? "");
    ex.size = num(res.bodySize) ?? num(isObj(res.content) ? res.content.size : null);
    if (ex.size !== null && ex.size < 0) ex.size = null;
    ex.version ||= res.httpVersion ? toText(res.httpVersion) : "";
  } else if (res != null) problems.push("response takes {status, headers?, body?} or raw HTTP text");

  ex.resMime ||= header(ex.resHeaders, "content-type") ?? "";
  if (ex.size === null && ex.resBody != null) ex.size = byteLength(ex.resBody);
  ex.phases = harPhases(timings);
  if (ex.ms === null && ex.phases.length) ex.ms = ex.phases.reduce((a, p) => a + p.ms, 0);
  if (ex.status !== null && !ex.statusText) ex.statusText = STATUS_TEXT[ex.status] ?? "";
  if (!ex.url && !ex.status) problems.push("needs a request with a url or a response with a status");
  return { exchange: ex, problems };
}

function byteLength(s: string): number {
  let n = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? (k++, 4) : 3;
  }
  return n;
}

export const STATUS_TEXT: Record<number, string> = {
  200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 206: "Partial Content",
  301: "Moved Permanently", 302: "Found", 304: "Not Modified", 307: "Temporary Redirect", 308: "Permanent Redirect",
  400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 409: "Conflict", 410: "Gone", 413: "Payload Too Large", 415: "Unsupported Media Type", 422: "Unprocessable Content", 429: "Too Many Requests",
  500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
};

export type StatusTone = "good" | "info" | "warn" | "bad" | "neutral";
export function statusTone(status: number | null): StatusTone {
  if (status === null || status === 0) return "neutral";
  if (status < 300) return "good";
  if (status < 400) return "info";
  if (status < 500) return "warn";
  return "bad";
}

/** Body as a value to show: parsed JSON when it is JSON, else the text. */
export function readBody(text: string | null, mime: string): { json: unknown; text: string | null; kind: "json" | "text" | "empty" } {
  if (text == null || text === "") return { json: undefined, text: null, kind: "empty" };
  const t = text.trim();
  if (/json/i.test(mime) || t.startsWith("{") || t.startsWith("[")) {
    try {
      return { json: JSON.parse(t), text, kind: "json" };
    } catch {
      // Not JSON after all; show the text.
    }
  }
  return { json: undefined, text, kind: "text" };
}

const SECRET = /(auth|token|secret|cookie|session|passw|api-?key|apikey|private-?key|signature|credential)/i;
export const isSecretHeader = (name: string) => SECRET.test(name);
const SECRET_PARAM = /^(key|sig|code|pass(word)?)$|(token|secret|session|passw|api_?key|apikey|signature|credential)/i;

/** The URL with secret-looking query values masked: ?api_key=•••. */
export function maskUrl(url: string): string {
  const q = url.indexOf("?");
  if (q < 0) return url;
  const hash = url.indexOf("#", q);
  const query = url.slice(q + 1, hash < 0 ? undefined : hash);
  const masked = query
    .split("&")
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq < 0) return part;
      let name = part.slice(0, eq);
      try {
        name = decodeURIComponent(name);
      } catch {
        // Keep the raw name.
      }
      return SECRET_PARAM.test(name) ? `${part.slice(0, eq)}=${"•".repeat(8)}` : part;
    })
    .join("&");
  return url.slice(0, q + 1) + masked + (hash < 0 ? "" : url.slice(hash));
}

export function mask(value: string): string {
  const m = /^(Bearer|Basic|Token|Digest)\s+/i.exec(value);
  return `${m ? m[0] : ""}${"•".repeat(8)}`;
}

/** A curl command that repeats the request; secret headers stay masked unless reveal is set. */
export function toCurl(ex: Exchange, reveal = false): string {
  const q = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  const parts = ["curl"];
  // curl sends GET, or POST once there is a body; say the method only when it differs.
  if (ex.method !== (ex.reqBody ? "POST" : "GET")) parts.push(`-X ${/^[A-Z]+$/.test(ex.method) ? ex.method : q(ex.method)}`);
  parts.push(q(reveal ? ex.url || "/" : maskUrl(ex.url || "/")));
  for (const [k, v] of ex.reqHeaders) {
    if (k.startsWith(":") || /^(content-length|host)$/i.test(k)) continue;
    parts.push(`-H ${q(`${k}: ${!reveal && isSecretHeader(k) ? mask(v) : v}`)}`);
  }
  if (ex.reqBody) parts.push(`--data-raw ${q(ex.reqBody)}`);
  return parts.join(" \\\n  ");
}

// ---------- HAR files ----------

export type ResourceType = "document" | "fetch" | "script" | "style" | "image" | "font" | "media" | "other";
export const RESOURCE_TYPES: { id: ResourceType; label: string }[] = [
  { id: "document", label: "Doc" },
  { id: "fetch", label: "Fetch/XHR" },
  { id: "script", label: "JS" },
  { id: "style", label: "CSS" },
  { id: "image", label: "Img" },
  { id: "font", label: "Font" },
  { id: "media", label: "Media" },
  { id: "other", label: "Other" },
];

export interface WaterfallRow {
  id: number;
  url: string;
  name: string;
  host: string;
  method: string;
  status: number | null;
  type: ResourceType;
  /** ms from the first request. */
  start: number;
  ms: number;
  phases: Phase[];
  size: number | null;
  entry: unknown;
}

export interface WaterfallData {
  rows: WaterfallRow[];
  /** Page events, ms from the first request. */
  marks: { label: string; at: number }[];
  total: number;
  bytes: number;
}

export function resourceType(mime: string, url: string, hint?: unknown): ResourceType {
  const h = typeof hint === "string" ? hint.toLowerCase() : "";
  if (h === "xhr" || h === "fetch") return "fetch";
  if (h === "document" || h === "script" || h === "image" || h === "font" || h === "media") return h;
  if (h === "stylesheet") return "style";
  const m = mime.toLowerCase();
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (m.includes("html")) return "document";
  if (m.includes("javascript") || m.includes("ecmascript") || /\.(m?js|jsx)$/.test(path)) return "script";
  if (m.includes("css") || path.endsWith(".css")) return "style";
  if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|svg|ico)$/.test(path)) return "image";
  if (m.includes("font") || /\.(woff2?|ttf|otf)$/.test(path)) return "font";
  if (m.startsWith("video/") || m.startsWith("audio/")) return "media";
  if (m.includes("json") || m.includes("xml") || m.includes("text/plain") || m.includes("protobuf") || m.includes("event-stream")) return "fetch";
  return "other";
}

function splitUrl(url: string): { name: string; host: string } {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return { name: (seg || u.host) + (u.search.length > 1 ? maskUrl(u.search) : ""), host: u.host };
  } catch {
    return { name: url.split("/").filter(Boolean).pop() ?? url, host: "" };
  }
}

/** Reads a HAR (or a list of {url, start, ms, ...}) into rows on one time axis. */
export function normalizeWaterfall(input: unknown): { data: WaterfallData; problems: string[] } {
  const problems: string[] = [];
  const v = maybeJson(input);
  let entries: unknown[] = [];
  let pages: unknown[] = [];
  if (Array.isArray(v)) entries = v;
  else if (isObj(v)) {
    const log = isObj(v.log) ? v.log : v;
    entries = Array.isArray(log.entries) ? log.entries : [];
    pages = Array.isArray(log.pages) ? log.pages : [];
  }
  if (!entries.length && v != null) problems.push(typeof v === "string" ? "har is text that isn't HAR JSON" : "has no entries; pass a HAR ({log: {entries}}) or a list of {url, start, ms}");

  type Pre = Omit<WaterfallRow, "start"> & { t0: number };
  const pre: Pre[] = [];
  entries.forEach((e, id) => {
    if (!isObj(e)) return;
    const req = isObj(e.request) ? e.request : e;
    const res = isObj(e.response) ? e.response : e;
    const url = toText(req.url ?? e.url ?? e.name ?? "");
    const started = e.startedDateTime ?? e.startTime ?? e.started;
    let t0 = num(e.start) ?? num(e.startTime);
    if (t0 === null && typeof started === "string") {
      const t = Date.parse(started);
      t0 = Number.isNaN(t) ? null : t;
    }
    const phases = harPhases(e.timings ?? e.phases);
    const ms = num(e.time) ?? num(e.ms) ?? num(e.duration) ?? phases.reduce((a, p) => a + p.ms, 0);
    const content = isObj(res.content) ? res.content : null;
    const mime = toText(content?.mimeType ?? header(readHeaders(res.headers), "content-type") ?? e.mime ?? "");
    let size = num(e._transferSize) ?? num(res._transferSize) ?? num(res.bodySize) ?? num(content?.size) ?? num(e.size);
    if (size !== null && size < 0) size = num(content?.size);
    const status = num(res.status ?? e.status);
    const { name, host } = splitUrl(url);
    pre.push({
      id,
      url,
      name,
      host,
      method: toText(req.method ?? e.method ?? "GET").toUpperCase(),
      status: status === 0 ? null : status,
      type: resourceType(mime, url, e._resourceType ?? e.type ?? e.initiatorType),
      ms: Math.max(0, ms),
      phases: phases.length ? phases : [{ kind: "wait", ms: Math.max(0, ms) }],
      size: size !== null && size >= 0 ? size : null,
      entry: e,
      t0: t0 ?? NaN,
    });
  });
  const known = pre.map((r) => r.t0).filter((t) => Number.isFinite(t));
  const origin = known.length ? Math.min(...known) : 0;
  const rows: WaterfallRow[] = pre.map(({ t0, ...r }) => ({ ...r, start: Number.isFinite(t0) ? t0 - origin : 0 }));
  rows.sort((a, b) => a.start - b.start || a.id - b.id);

  const marks: { label: string; at: number }[] = [];
  const page = pages.find(isObj);
  if (page && isObj(page.pageTimings)) {
    const ps = typeof page.startedDateTime === "string" ? Date.parse(page.startedDateTime) : NaN;
    const offset = Number.isFinite(ps) && known.length ? ps - origin : 0;
    const dcl = num(page.pageTimings.onContentLoad);
    const load = num(page.pageTimings.onLoad);
    if (dcl !== null && dcl >= 0) marks.push({ label: "DOMContentLoaded", at: offset + dcl });
    if (load !== null && load >= 0) marks.push({ label: "Load", at: offset + load });
  }
  const total = Math.max(0, ...rows.map((r) => r.start + r.ms), ...marks.map((m) => m.at));
  const bytes = rows.reduce((a, r) => a + (r.size ?? 0), 0);
  return { data: { rows, marks, total, bytes }, problems };
}

/** Round tick steps for a time axis of `total` ms across about `count` ticks. */
export function ticks(total: number, count = 5): number[] {
  if (!(total > 1e-6) || !Number.isFinite(total)) return [0];
  const raw = total / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  if (!(step > 0) || !Number.isFinite(step)) return [0];
  const out: number[] = [];
  for (let t = 0; t <= total + step * 0.01; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
