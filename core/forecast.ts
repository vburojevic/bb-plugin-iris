// Forecast's math: done counts over time (snapshots {t, done, total?} or a
// list of completion dates) become a recent pace, an ETA and a band around it.
// The band comes from the spread of the recent per-period rates: after t
// periods the done count is about r*t, give or take z*s*sqrt(t) (r the mean
// rate, s its spread), so the early and late ETAs solve r*t +- z*s*sqrt(t) = R.
// Views live in the "track" chunk.

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** z for an 80% band. */
const Z = 1.2816;

/** A time from a Date, ms or s since 1970, an ISO string, or a plain day (local midnight). */
export function readTime(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === "number") return Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : null;
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])).getTime();
  if (/^\d+(\.\d+)?$/.test(s)) return readTime(Number(s));
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** "7d", "6h", "45m", "2w" or a number of days, as ms. */
export function readSpan(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v * DAY : null;
  if (typeof v !== "string") return null;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hrs?|hours?|d|days?|w|weeks?)?\s*$/i.exec(v);
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] ?? "d").toLowerCase();
  const ms = u.startsWith("m") ? n * MIN : u.startsWith("h") ? n * HOUR : u.startsWith("w") ? n * 7 * DAY : n * DAY;
  return ms > 0 ? ms : null;
}

const dayKey = (t: number, timeZone?: string) => new Date(t).toLocaleDateString("en-US", { timeZone, year: "numeric", month: "numeric", day: "numeric" });

/** "3:40 PM" on the same day as `ref`, "Nov 12, 3:40 PM" within a week, else "Nov 12". */
export function formatWhen(t: number, ref: number, timeZone?: string, withTime?: boolean): string {
  const d = new Date(t);
  const time = d.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
  if (dayKey(t, timeZone) === dayKey(ref, timeZone) && withTime !== false) return time;
  const yearDiffers = new Date(t).toLocaleDateString("en-US", { timeZone, year: "numeric" }) !== new Date(ref).toLocaleDateString("en-US", { timeZone, year: "numeric" });
  const date = d.toLocaleDateString("en-US", { timeZone, month: "short", day: "numeric", ...(yearDiffers ? { year: "numeric" } : {}) });
  return (withTime ?? Math.abs(t - ref) < 7 * DAY) ? `${date}, ${time}` : date;
}

export interface ForecastPoint {
  t: number;
  done: number;
  /** Scope at this time, when known. */
  total: number | null;
}

export interface ScopeChange {
  t: number;
  from: number;
  to: number;
}

export interface ForecastModel {
  points: ForecastPoint[];
  /** Completion dates: the count steps at each one. Snapshots interpolate. */
  steps: boolean;
  asOf: number;
  start: number;
  done: number;
  total: number | null;
  remaining: number | null;
  scope: ScopeChange[];
  /** The pace: the window it was read over, the bucket, and the mean and spread per minute, hour or day. */
  window: number;
  period: number;
  periodName: "minute" | "hour" | "day";
  periods: number;
  rate: number;
  spread: number;
  /** The window in words: "the last 7 days" or "since 9:00 AM". */
  basis: string;
  /** Null without a total or a positive pace. */
  eta: { at: number; early: number; late: number } | null;
  /** When the work reached its total. */
  finishedAt: number | null;
  /** The verdict is null without a total. */
  deadline: { at: number; verdict: "on track" | "at risk" | "late" | null } | null;
}

export interface ForecastInput {
  points?: unknown;
  dates?: unknown;
  total?: unknown;
  start?: unknown;
  window?: unknown;
  deadline?: unknown;
}

function readNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Nice period for a window shorter than two days: about eight per window. */
function periodFor(window: number): { ms: number; name: "minute" | "hour" | "day" } {
  if (window >= 2 * DAY) return { ms: DAY, name: "day" };
  const steps = [MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR];
  const ms = steps.find((s) => s >= window / 8) ?? 6 * HOUR;
  return { ms, name: ms >= HOUR ? "hour" : "minute" };
}

/** The done count at time x: steps for completion dates, straight lines between snapshots. */
export function doneAt(points: ForecastPoint[], x: number, steps: boolean): number {
  if (!points.length) return 0;
  if (x < points[0].t) return steps ? Math.max(0, points[0].done - 1) : points[0].done;
  // Readings that share the first time: the last of them.
  if (x === points[0].t) return points.filter((p) => p.t === x).pop()!.done;
  for (let k = points.length - 1; k >= 0; k--) {
    const p = points[k];
    if (p.t <= x) {
      const next = points[k + 1];
      if (steps || !next || next.t === p.t) return p.done;
      return p.done + ((next.done - p.done) * (x - p.t)) / (next.t - p.t);
    }
  }
  return points[points.length - 1].done;
}

function spanWords(ms: number): string {
  const [unit, name] = ms >= 2 * DAY ? [DAY, "day"] : ms >= 2 * HOUR ? [HOUR, "hour"] : [MIN, "minute"];
  const n = Math.round(ms / (unit as number));
  return n === 1 ? `the last ${name}` : `the last ${n} ${name}s`;
}

export function forecast(input: ForecastInput, now = Date.now(), timeZone?: string): { model: ForecastModel | null; problems: string[] } {
  const problems: string[] = [];
  let points: ForecastPoint[] = [];
  let steps = false;
  const total = readNumber(input.total);
  if (input.total != null && total == null) problems.push(`total "${String(input.total)}" is not a number`);
  if (input.points != null) {
    if (!Array.isArray(input.points)) problems.push("points must be a list of {t, done, total?}");
    else
      input.points.forEach((p, k) => {
        const r = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
        const t = readTime(r.t ?? r.time ?? r.date ?? r.at);
        const done = readNumber(r.done ?? r.completed ?? r.value);
        const tot = readNumber(r.total ?? r.scope);
        if (t == null || done == null) problems.push(`point ${k + 1} needs a time (t) and done`);
        else points.push({ t, done, total: tot });
      });
    points.sort((a, b) => a.t - b.t);
  } else if (input.dates != null) {
    if (!Array.isArray(input.dates)) problems.push("dates must be a list of completion dates");
    else {
      steps = true;
      const ts: number[] = [];
      input.dates.forEach((d, k) => {
        const t = readTime(d && typeof d === "object" && !(d instanceof Date) ? ((d as Record<string, unknown>).t ?? (d as Record<string, unknown>).date ?? (d as Record<string, unknown>).at) : d);
        if (t == null) problems.push(`date ${k + 1} "${String(d)}" is not a date`);
        else ts.push(t);
      });
      ts.sort((a, b) => a - b);
      points = ts.map((t, k) => ({ t, done: k + 1, total: null }));
    }
  } else problems.push("needs points ({t, done}) or dates (one per finished item)");

  const start = input.start != null ? readTime(input.start) : null;
  if (input.start != null && start == null) problems.push(`start "${String(input.start)}" is not a time`);
  if (start != null && (!points.length || start < points[0].t)) points.unshift({ t: start, done: 0, total: points[0]?.total ?? null });
  const deadlineAt = input.deadline != null ? readTime(input.deadline) : null;
  if (input.deadline != null && deadlineAt == null) problems.push(`deadline "${String(input.deadline)}" is not a date`);
  const windowAsked = input.window != null ? readSpan(input.window) : null;
  if (input.window != null && windowAsked == null) problems.push(`window "${String(input.window)}" is not a span (7, "7d", "6h", "45m")`);
  if (!points.length) {
    if (!problems.length) problems.push(steps ? "dates is empty: no finished items yet" : "points is empty");
    return { model: null, problems };
  }

  // Snapshots are as of their last reading; completion dates are as of now.
  const last = points[points.length - 1];
  const asOf = steps ? Math.max(now, last.t) : last.t;
  const first = points[0].t;
  const scope: ScopeChange[] = [];
  let scopeNow = total;
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    if (p.total == null) continue;
    const prev = points.slice(0, k).reverse().find((q) => q.total != null);
    if (prev && prev.total !== p.total) scope.push({ t: p.t, from: prev.total!, to: p.total });
    scopeNow = p.total;
  }
  if (total != null && points.every((p) => p.total == null)) scopeNow = total;
  else if (total != null && scopeNow !== total) {
    scope.push({ t: asOf, from: scopeNow!, to: total });
    scopeNow = total;
  }
  const done = doneAt(points, asOf, steps);
  const remaining = scopeNow != null ? Math.max(0, scopeNow - done) : null;

  const span = Math.max(asOf - first, 0);
  let window = windowAsked ?? (span >= 2 * DAY ? Math.min(7 * DAY, span) : span);
  window = Math.min(window, span);
  const period = periodFor(window);
  const periods = Math.max(1, Math.round(window / period.ms));
  // Increments per period, newest last.
  const incs: number[] = [];
  for (let i = periods; i >= 1; i--) {
    const a = asOf - i * (window / periods);
    const b = asOf - (i - 1) * (window / periods);
    // A completion right at the window's start counts in it.
    incs.push(doneAt(points, b, steps) - doneAt(points, steps && i === periods ? a - 1 : a, steps));
  }
  // The band works in buckets (the variance adds up per bucket); words read per minute, hour or day.
  const bucket = window / periods;
  const perBucket = window > 0 ? incs.reduce((s, x) => s + x, 0) / incs.length : 0;
  const spreadBucket = incs.length > 1 ? Math.sqrt(incs.reduce((s, x) => s + (x - perBucket) ** 2, 0) / (incs.length - 1)) : 0;
  // Slow paces read in a longer unit: "6 an hour", not "0 a minute"; "0.8 a day", not "0 an hour".
  let periodName = period.name;
  if (periodName === "minute" && bucket > 0 && (perBucket * MIN) / bucket < 1) periodName = "hour";
  if (periodName === "hour" && bucket > 0 && (perBucket * HOUR) / bucket < 0.1) periodName = "day";
  const unitMs = periodName === "day" ? DAY : periodName === "hour" ? HOUR : MIN;
  const rate = bucket > 0 ? (perBucket * unitMs) / bucket : 0;
  const spread = bucket > 0 ? (spreadBucket * unitMs) / bucket : 0;
  const basis = windowAsked != null || span >= 2 * DAY ? spanWords(window) : `since ${formatWhen(first, asOf, timeZone)}`;

  let finishedAt: number | null = null;
  if (scopeNow != null && remaining === 0) {
    // The start of the last run of readings at or past the scope (scope can grow after a first finish).
    let k = points.length - 1;
    while (k > 0 && points[k - 1].done >= scopeNow) k--;
    finishedAt = points[k].t;
  }

  let eta: ForecastModel["eta"] = null;
  if (remaining != null && remaining > 0 && perBucket > 0) {
    const R = remaining;
    const zs = Z * spreadBucket;
    const root = Math.sqrt(zs * zs + 4 * perBucket * R);
    const late = ((zs + root) / (2 * perBucket)) ** 2;
    const early = ((-zs + root) / (2 * perBucket)) ** 2;
    eta = { at: asOf + (R / perBucket) * bucket, early: asOf + early * bucket, late: asOf + late * bucket };
  }
  let deadline: ForecastModel["deadline"] = null;
  if (deadlineAt != null) {
    // A plain day means the end of that day.
    const at = typeof input.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.deadline.trim()) ? deadlineAt + DAY - 1 : deadlineAt;
    const verdict =
      remaining == null ? null : finishedAt != null ? (finishedAt <= at ? "on track" : "late") : !eta ? (asOf > at ? "late" : "at risk") : eta.late <= at ? "on track" : eta.early > at ? "late" : "at risk";
    deadline = { at, verdict };
  }
  return {
    model: { points, steps, asOf, start: first, done, total: scopeNow, remaining, scope, window, period: bucket, periodName, periods, rate, spread, basis, eta, finishedAt, deadline },
    problems,
  };
}

function count(n: number): string {
  const r = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return r.toLocaleString("en-US");
}

const over = (m: ForecastModel) => (m.basis.startsWith("since") ? m.basis : `over ${m.basis}`);
/** "the last 7 days'" and "the last day's". */
const possessive = (basis: string) => (basis.endsWith("s") ? `${basis}'` : `${basis}'s`);

/** The pace as words: "3.2 a day". */
export function paceWords(m: ForecastModel): string {
  return `${count(m.rate)} ${m.periodName === "day" ? "a day" : m.periodName === "hour" ? "an hour" : "a minute"}`;
}

/** The forecast in one or two plain sentences. */
export function forecastWords(m: ForecastModel, unit = "", timeZone?: string): string {
  const u = unit ? ` ${unit}` : "";
  // Daily paces read in dates; shorter ones in times (with the day when it differs).
  const when = (t: number) => formatWhen(t, m.asOf, timeZone, m.periodName === "day" ? false : undefined);
  let s: string;
  if (m.total != null && m.remaining === 0) s = `Done${m.finishedAt != null ? ` ${when(m.finishedAt)}` : ""}: ${count(m.done)} of ${count(m.total)}${u}.`;
  else if (m.window <= 0) s = `${count(m.done)}${u} done so far; one more reading gives a pace.`;
  else if (m.rate <= 0) s = `No progress ${over(m)}, so no ETA yet${m.total != null ? ` (${count(m.done)} of ${count(m.total)}${u} done)` : ""}.`;
  else if (m.total == null) s = `${count(m.done)}${u} done, ${paceWords(m)} ${over(m)}. Add a total for an ETA.`;
  else {
    const e = m.eta!;
    const pace = m.basis.startsWith("since") ? `At the pace ${m.basis}` : `At ${possessive(m.basis)} pace`;
    const a = when(e.early);
    const b = when(e.late);
    const range = a === b ? "" : `, between ${a} and ${b}`;
    s = `${pace} (${paceWords(m)}), done ${when(e.at)}${range}.`;
  }
  if (m.deadline?.verdict && !(m.remaining === 0 && m.deadline.verdict === "on track")) {
    const d = formatWhen(m.deadline.at, m.asOf, timeZone, false);
    s += m.deadline.verdict === "on track" ? ` On track for ${d}.` : m.deadline.verdict === "at risk" ? ` ${d} is at risk.` : ` Late for ${d}.`;
  }
  if (m.scope.length) {
    const net = m.scope.reduce((s2, c) => s2 + (c.to - c.from), 0);
    s += ` Scope ${net >= 0 ? "grew" : "shrank"} by ${count(Math.abs(net))}${m.scope.length > 1 ? ` in ${m.scope.length} changes` : ""}.`;
  }
  return s;
}

/** Done gained `ms` after asOf at the recent pace: the middle and the 80% band. */
export function projection(m: ForecastModel, ms: number): { mid: number; lo: number; hi: number } {
  const unitMs = m.periodName === "day" ? DAY : m.periodName === "hour" ? HOUR : MIN;
  const k = Math.max(0, ms) / (m.period || 1);
  const perBucket = (m.rate * m.period) / unitMs;
  const dev = Z * ((m.spread * m.period) / unitMs) * Math.sqrt(k);
  const mid = perBucket * k;
  return { mid, lo: Math.max(0, mid - dev), hi: mid + dev };
}
