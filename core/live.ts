// Pure helpers for the live components: the end of a growing log, its lines as
// a terminal shows them, and progress files read the many ways jobs write them.

/** Up to maxChars from the end of a log, starting at a line boundary. */
export function tailText(content: string, maxChars: number): { text: string; truncated: boolean } {
  if (content.length <= maxChars) return { text: content, truncated: false };
  const cut = content.slice(content.length - maxChars);
  const nl = cut.indexOf("\n");
  return { text: nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut, truncated: true };
}

export interface TailValue {
  text: string;
  /** Size of the whole file in bytes. */
  size: number;
  truncated: boolean;
}

export function isTailValue(v: unknown): v is TailValue {
  return typeof v === "object" && v !== null && typeof (v as TailValue).text === "string" && typeof (v as TailValue).size === "number";
}

/**
 * Lines as a terminal leaves them: a carriage return rewrites its line (progress
 * bars), so only what follows the last one stays. A trailing partial line counts.
 */
export function logLines(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l) => {
    const k = l.lastIndexOf("\r", l.length - 2);
    return (k >= 0 ? l.slice(k + 1) : l).replace(/\r$/, "");
  });
}

export interface ProgressTask {
  label?: string;
  done: number;
  total: number;
  /** Seconds left, an ISO time it should finish, or a phrase. */
  eta?: number | string;
  status?: string;
  unit?: string;
}

const NUM = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

function task(o: Record<string, unknown>): ProgressTask | null {
  const done = NUM(o.done ?? o.completed ?? o.current ?? o.value ?? o.processed ?? o.count);
  const total = NUM(o.total ?? o.max ?? o.of ?? o.count_total);
  const pct = NUM(o.percent ?? o.pct ?? o.progress);
  if (done == null && pct == null) return null;
  const t: ProgressTask = done != null && total != null ? { done, total } : pct != null ? { done: pct > 1 || total === 100 ? pct : pct * 100, total: 100 } : { done: done!, total: 0 };
  const label = o.label ?? o.name ?? o.title ?? o.task ?? o.step;
  if (typeof label === "string") t.label = label;
  const eta = o.eta ?? o.etaSeconds ?? o.remaining;
  if (typeof eta === "number" || typeof eta === "string") t.eta = eta;
  if (typeof o.status === "string") t.status = o.status;
  if (typeof o.unit === "string") t.unit = o.unit;
  return t;
}

/** {done, total, label?, eta?}, a list of those, {tasks: [...]}, or {percent}. */
export function readProgress(v: unknown): ProgressTask[] {
  if (Array.isArray(v)) return v.flatMap((x) => (x && typeof x === "object" ? (task(x as Record<string, unknown>) ?? []) : []));
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const nested = o.tasks ?? o.steps ?? o.jobs;
    const own = task(o);
    if (Array.isArray(nested)) return own ? [own, ...readProgress(nested)] : readProgress(nested);
    return own ? [own] : [];
  }
  const n = NUM(v);
  return n == null ? [] : [{ done: n > 1 ? n : n * 100, total: 100 }];
}

/** Seconds left from what the file said: seconds, an ISO time, or nothing. */
export function etaSeconds(eta: number | string | undefined, now: number): number | null {
  if (typeof eta === "number") return Number.isFinite(eta) ? Math.max(0, eta) : null;
  if (typeof eta === "string" && /^\d{4}-\d{2}-\d{2}T/.test(eta)) {
    const t = Date.parse(eta);
    return Number.isFinite(t) ? Math.max(0, (t - now) / 1000) : null;
  }
  return null;
}

/** "about 3 min", "about 40 s", "about 2 h 5 min". */
export function formatEta(seconds: number): string {
  if (seconds < 1) return "a moment";
  if (seconds < 60) return `about ${Math.ceil(seconds / 5) * 5} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `about ${m} min`;
  const h = Math.floor(m / 60);
  return `about ${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/**
 * Speed from samples of (time, done) a live card saw, over the last minute.
 * Returns units per second, or null until two samples differ.
 */
export function rate(samples: { at: number; done: number }[]): number | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  const first = samples.find((s) => last.at - s.at <= 60_000) ?? samples[0];
  const dt = (last.at - first.at) / 1000;
  const dd = last.done - first.done;
  return dt > 0 && dd > 0 ? dd / dt : null;
}
