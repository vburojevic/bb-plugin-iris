// Time tools: time zones (offsets and wall clocks through Intl, no tz data of
// our own), a cron reader (five fields, plain words, next runs in a zone) and
// business days between two dates. Pure functions; the views live in the
// "tools" chunk and checks call these directly.

// ---------- zones ----------

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The zone this machine is in ("local" resolves to it). */
export function localZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function zoneName(tz: string): string {
  const t = tz.trim();
  if (!t || t.toLowerCase() === "local") return localZone();
  if (/^(utc|gmt|z)$/i.test(t)) return "UTC";
  // "UTC+2", "GMT-05:30" read as fixed offsets.
  const m = /^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(t);
  if (m) return `${m[1]}${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
  return t;
}

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", weekday: "short" });
    formatters.set(tz, f);
  }
  return f;
}

/** The IANA name (or fixed offset) a zone string means, or null when Intl doesn't know it. */
export function resolveZone(tz: unknown): string | null {
  if (typeof tz !== "string") return null;
  const name = zoneName(tz);
  try {
    formatter(name);
    return name;
  } catch {
    return null;
  }
}

export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** What a clock in `tz` shows at instant `ms`. */
export function wallClock(tz: string, ms: number): WallClock {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  return { year: Number(out.year), month: Number(out.month), day: Number(out.day), hour: Number(out.hour) % 24, minute: Number(out.minute), weekday: WEEKDAY_INDEX[out.weekday] ?? 0 };
}

/** Minutes `tz` is ahead of UTC at instant `ms`. */
export function zoneOffset(tz: string, ms: number): number {
  const c = wallClock(tz, ms);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute);
  return Math.round((asUtc - Math.floor(ms / 60000) * 60000) / 60000);
}

/** The instant a clock in `tz` reads `minutes` past midnight on `date` (YYYY-MM-DD). */
export function zonedInstant(date: string, minutes: number, tz: string): number {
  const d = parseDay(date);
  if (!d) throw new Error(`"${date}" is not a date (use YYYY-MM-DD)`);
  const naive = Date.UTC(d.y, d.m - 1, d.d) + minutes * 60000;
  let guess = naive - zoneOffset(tz, naive) * 60000;
  guess = naive - zoneOffset(tz, guess) * 60000;
  return guess;
}

export function offsetLabel(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "-";
  const a = Math.abs(minutes);
  return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, "0")}` : ""}`;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const clockText = (h: number, m: number) => `${pad2(h)}:${pad2(m)}`;

/** Today's date (YYYY-MM-DD) in a zone. */
export function todayIn(tz: string, now: number): string {
  const c = wallClock(tz, now);
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}

// ---------- the zone planner ----------

export interface ZoneRow {
  label: string;
  tz: string;
  note?: string;
  /** Working hours in local time, [start, end) in hours. */
  work: [number, number];
}

export interface ZoneModel {
  rows: ZoneRow[];
  problems: string[];
}

/** Reads "09:30", 9.5 or 9 as hours. */
export function readHour(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v >= 0 && v <= 24 ? v : null;
  if (typeof v !== "string") return null;
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(v);
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2] ?? 0) / 60;
  return h >= 0 && h <= 24 ? h : null;
}

function readWork(v: unknown, fallback: [number, number]): [number, number] | null {
  if (v == null) return fallback;
  if (Array.isArray(v) && v.length === 2) {
    const a = readHour(v[0]);
    const b = readHour(v[1]);
    if (a != null && b != null && a !== b) return [a, b];
  }
  return null;
}

/** Rows from zones written as names, {label, tz} objects or [label, tz] pairs. */
export function normalizeZones(v: unknown, hours?: unknown): ZoneModel {
  const problems: string[] = [];
  const base = readWork(hours, [9, 17]);
  if (!base) problems.push(`hours needs [start, end], e.g. [9, 17] or ["08:30", "17:00"]`);
  const fallback = base ?? [9, 17];
  if (!Array.isArray(v) || !v.length) return { rows: [], problems: [...problems, "zones needs a list of time zones, e.g. [\"Europe/Zagreb\", \"America/New_York\"]"] };
  const rows: ZoneRow[] = [];
  v.forEach((item, k) => {
    const o: Record<string, unknown> | null = typeof item === "string" ? { tz: item } : Array.isArray(item) ? { label: item[0], tz: item[1] } : item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    const raw = o ? (o.tz ?? o.zone ?? o.timeZone) : undefined;
    const tz = resolveZone(raw);
    if (!tz) {
      problems.push(`zone ${k + 1}: "${String(raw ?? "")}" is not a time zone (use an IANA name like "Asia/Tokyo", "UTC+2" or "local")`);
      return;
    }
    const work = readWork(o?.hours, fallback);
    if (!work) problems.push(`zone ${k + 1}: hours needs [start, end]`);
    const label = typeof o?.label === "string" && o.label ? o.label : typeof o?.name === "string" && o.name ? (o.name as string) : cityOf(tz);
    rows.push({ label, tz, note: typeof o?.note === "string" ? o.note : undefined, work: work ?? fallback });
  });
  return { rows, problems };
}

function cityOf(tz: string): string {
  const last = tz.split("/").pop() ?? tz;
  return last.replace(/_/g, " ");
}

export function isWorking(row: ZoneRow, c: WallClock): boolean {
  if (c.weekday === 0 || c.weekday === 6) return false;
  const h = c.hour + c.minute / 60;
  const [a, b] = row.work;
  return a < b ? h >= a && h < b : h >= a || h < b;
}

/** Whether every minute of [start, start + duration) is inside the row's working hours (checked every 15 min). */
export function slotInHours(row: ZoneRow, start: number, durationMin: number): boolean {
  for (let t = 0; t < Math.max(1, durationMin); t += 15) if (!isWorking(row, wallClock(row.tz, start + t * 60000))) return false;
  return isWorking(row, wallClock(row.tz, start + Math.max(0, durationMin - 1) * 60000));
}

/** The earliest slot start (minutes into the reference day, on a `step` grid) that keeps the most rows in working hours. */
export function bestSlot(rows: ZoneRow[], dayStart: number, durationMin: number, step: number): number {
  // When nobody works that day (a weekend), start at the first row's working hours.
  const fallback = Math.min(24 * 60 - durationMin, Math.round((rows[0]?.work[0] ?? 9) * 60));
  let best = fallback;
  let bestCount = 0;
  for (let m = 0; m + durationMin <= 24 * 60; m += step) {
    const count = rows.filter((r) => slotInHours(r, dayStart + m * 60000, durationMin)).length;
    if (count > bestCount) {
      best = m;
      bestCount = count;
    }
  }
  return best;
}

// ---------- cron ----------

export interface CronField {
  values: number[];
  star: boolean;
  /** "*\/n" written over the whole range, when n divides it evenly. */
  every?: number;
  /** Starts with "*" (cron treats "*\/2" as unrestricted for the day-or-weekday rule). */
  open: boolean;
  raw: string;
}

export interface Cron {
  minute: CronField;
  hour: CronField;
  dom: CronField;
  month: CronField;
  dow: CronField;
  source: string;
}

const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES: Record<string, number> = Object.fromEntries(MONTHS.map((m, k) => [m.slice(0, 3).toUpperCase(), k + 1]));
const DAY_NAMES: Record<string, number> = Object.fromEntries(DAYS.map((d, k) => [d.slice(0, 3).toUpperCase(), k]));

const FIELD_SPECS = [
  { key: "minute", label: "minute", min: 0, max: 59 },
  { key: "hour", label: "hour", min: 0, max: 23 },
  { key: "dom", label: "day of month", min: 1, max: 31 },
  { key: "month", label: "month", min: 1, max: 12, names: MONTH_NAMES },
  { key: "dow", label: "weekday", min: 0, max: 7, names: DAY_NAMES },
] as const;

export function parseCron(expr: unknown): { cron: Cron | null; error: string | null } {
  if (typeof expr !== "string" || !expr.trim()) return { cron: null, error: "needs a cron expression, e.g. \"30 9 * * 1-5\"" };
  const source = expr.trim();
  const text = MACROS[source.toLowerCase()] ?? source;
  if (text.startsWith("@")) return { cron: null, error: `${source} is not a cron macro (use @hourly, @daily, @weekly, @monthly or @yearly)` };
  const parts = text.split(/\s+/);
  if (parts.length === 6 || parts.length === 7) return { cron: null, error: "use five fields (minute hour day month weekday); seconds and years aren't supported" };
  if (parts.length !== 5) return { cron: null, error: `"${source}" has ${parts.length} ${parts.length === 1 ? "field" : "fields"}; cron needs five: minute hour day month weekday` };
  const fields: Partial<Record<string, CronField>> = {};
  for (let k = 0; k < 5; k++) {
    const spec = FIELD_SPECS[k];
    const r = parseField(parts[k], spec.min, spec.max, "names" in spec ? spec.names : undefined);
    if (typeof r === "string") return { cron: null, error: `${spec.label} "${parts[k]}": ${r}` };
    if (spec.key === "dow") r.values = [...new Set(r.values.map((v) => (v === 7 ? 0 : v)))].sort((a, b) => a - b);
    fields[spec.key] = r;
  }
  return { cron: { ...(fields as Omit<Cron, "source">), source }, error: null };
}

function parseField(raw: string, min: number, max: number, names?: Record<string, number>): CronField | string {
  if (raw === "?") raw = "*";
  const bare = raw.replace(/[A-Z]+/gi, (m) => (names && m.toUpperCase() in names ? "0" : m));
  if (bare.includes("#") || (/^[\d,\-/*?LW]*$/i.test(bare) && /[LW]/i.test(bare))) return "L, W and # aren't supported";
  const word = /[A-Z]+/i.exec(bare);
  if (word) return `"${word[0]}" is not a ${names === MONTH_NAMES ? "month" : names === DAY_NAMES ? "weekday" : "number"}`;
  const set = new Set<number>();
  let every: number | undefined;
  const value = (s: string): number | string => {
    const named = names?.[s.toUpperCase()];
    if (named !== undefined) return named;
    if (!/^\d+$/.test(s)) return `"${s}" is not a number`;
    const n = Number(s);
    return n < min || n > max ? `${n} is outside ${min}-${max}` : n;
  };
  for (const part of raw.split(",")) {
    const m = /^([^/]+)(?:\/(\d+))?$/.exec(part);
    if (!m) return `can't read "${part}"`;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return "a step must be 1 or more";
    let lo: number;
    let hi: number;
    if (m[1] === "*") {
      lo = min;
      hi = max === 7 ? 6 : max;
      if (m[2] && raw.split(",").length === 1 && (hi - lo + 1) % step === 0) every = step;
    } else {
      const [a, b] = m[1].split("-");
      const va = value(a);
      if (typeof va === "string") return va;
      lo = va;
      if (b !== undefined) {
        const vb = value(b);
        if (typeof vb === "string") return vb;
        hi = vb;
      } else hi = m[2] ? (max === 7 ? 6 : max) : va;
      if (hi < lo) return `${a}-${b} runs backwards`;
    }
    for (let v = lo; v <= hi; v += step) set.add(v);
  }
  const values = [...set].sort((a, b) => a - b);
  return { values, star: raw === "*" || raw === "*/1", every: every && every > 1 ? every : undefined, open: raw.startsWith("*"), raw };
}

function joinWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/** Runs of consecutive values: [1,2,3,5] reads "1 through 3 and 5". */
function runs(values: number[], name: (v: number) => string, through = "through"): string {
  const out: string[] = [];
  for (let k = 0; k < values.length; ) {
    let j = k;
    while (j + 1 < values.length && values[j + 1] === values[j] + 1) j++;
    if (j - k >= 2) out.push(`${name(values[k])} ${through} ${name(values[j])}`);
    else for (let x = k; x <= j; x++) out.push(name(values[x]));
    k = j + 1;
  }
  return joinWords(out);
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

function timePart(c: Cron): string {
  const { minute: mi, hour: h } = c;
  const contiguous = h.values.every((v, k) => k === 0 || v === h.values[k - 1] + 1);
  if (mi.star && h.star) return "Every minute";
  if (mi.values.length === 1) {
    const m = mi.values[0];
    if (h.star) return m === 0 ? "Every hour, on the hour" : `Every hour at ${m} past`;
    if (h.every) return `Every ${h.every} hours${m ? ` at ${m} past` : ""}`;
    if (h.values.length <= 6) return `At ${joinWords(h.values.map((x) => clockText(x, m)))}`;
    if (contiguous) return `Every hour from ${clockText(h.values[0], m)} to ${clockText(h.values[h.values.length - 1], m)}`;
    return `At ${m} past hours ${runs(h.values, String)}`;
  }
  if (h.values.length === 1 && !mi.star && !mi.every && mi.values.length <= 4) return `At ${joinWords(mi.values.map((m) => clockText(h.values[0], m)))}`;
  const phrase = mi.star ? "Every minute" : mi.every ? `Every ${mi.every} minutes` : `At minutes ${runs(mi.values, String)} past ${h.star ? "every" : "the"} hour`;
  if (h.star) return phrase;
  if (h.every) return `${phrase}, every ${ordinal(h.every)} hour`;
  if (contiguous) return `${phrase}, between ${clockText(h.values[0], 0)} and ${clockText(h.values[h.values.length - 1], 59)}`;
  return `${phrase}, in hours ${runs(h.values, String)}`;
}

function dayPart(c: Cron): string {
  const out: string[] = [];
  const dows = c.dow.values;
  const dowText = c.dow.star
    ? ""
    : dows.length === 2 && dows[0] === 0 && dows[1] === 6
      ? "on weekends"
      : dows.length === 5 && dows.join() === "1,2,3,4,5"
        ? "Monday through Friday"
        : dows.length === 1
          ? `on ${DAYS[dows[0]]}s`
          : `on ${runs(dows, (d) => DAYS[d])}`;
  const domText = c.dom.star ? "" : c.dom.values.length === 1 ? `on the ${ordinal(c.dom.values[0])} of the month` : `on the ${runs(c.dom.values, ordinal)} of the month`;
  const everyDow = dows.length === 5 && dows.join() === "1,2,3,4,5" ? "every weekday" : dows.length === 2 && dows[0] === 0 && dows[1] === 6 ? "every weekend day" : `every ${runs(dows, (d) => DAYS[d])}`;
  // Both restricted: either matches. A field starting with "*" (like "*\/2") narrows the other instead.
  if (domText && dowText) out.push(c.dom.open || c.dow.open ? `${domText}, when it falls ${dowText.replace("Monday through Friday", "on a weekday")}` : `${domText}, and ${everyDow}`);
  else if (domText || dowText) out.push(domText || dowText);
  if (!c.month.star) out.push(c.month.every ? `every ${ordinal(c.month.every)} month (${runs(c.month.values, (m) => MONTHS[m - 1].slice(0, 3))})` : `in ${runs(c.month.values, (m) => MONTHS[m - 1])}`);
  return out.join(", ");
}

/** A cron expression in plain words, e.g. "At 09:30, Monday through Friday". */
export function describeCron(c: Cron): string {
  const days = dayPart(c);
  return `${timePart(c)}${days ? `, ${days}` : ""}`;
}

/** Field-by-field reading, for the breakdown under the sentence. */
export function cronFields(c: Cron): { label: string; raw: string; meaning: string }[] {
  const read = (f: CronField, all: string, name: (v: number) => string) => (f.star ? all : f.every ? `every ${f.every}` : runs(f.values, name));
  return [
    { label: "Minute", raw: c.minute.raw, meaning: read(c.minute, "every", String) },
    { label: "Hour", raw: c.hour.raw, meaning: read(c.hour, "every", String) },
    { label: "Day", raw: c.dom.raw, meaning: read(c.dom, "every", String) },
    { label: "Month", raw: c.month.raw, meaning: read(c.month, "every", (m) => MONTHS[m - 1].slice(0, 3)) },
    { label: "Weekday", raw: c.dow.raw, meaning: read(c.dow, "every", (d) => DAYS[d].slice(0, 3)) },
  ];
}

function dayMatches(c: Cron, w: WallClock): boolean {
  const dom = c.dom.values.includes(w.day);
  const dow = c.dow.values.includes(w.weekday);
  // Vixie cron: when both are restricted, either one matching is enough.
  if (!c.dom.open && !c.dow.open) return dom || dow;
  return dom && dow;
}

/** The next `count` instants after `from` (ms) when the schedule fires, read on clocks in `tz`. */
export function nextRuns(c: Cron, from: number, count: number, tz: string): number[] {
  const out: number[] = [];
  let t = Math.floor(from / 60000) * 60000 + 60000;
  const limit = from + 5 * 366 * 864e5;
  for (let guard = 0; out.length < count && t < limit && guard < 200_000; guard++) {
    const w = wallClock(tz, t);
    const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
    if (!c.month.values.includes(w.month)) {
      const next = w.month === 12 ? ymd(w.year + 1, 1, 1) : ymd(w.year, w.month + 1, 1);
      t = Math.max(t + 60000, zonedInstant(next, 0, tz));
      continue;
    }
    if (!dayMatches(c, w)) {
      const d = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
      t = Math.max(t + 60000, zonedInstant(ymd(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), 0, tz));
      continue;
    }
    if (!c.hour.values.includes(w.hour)) {
      t += (60 - w.minute) * 60000;
      continue;
    }
    if (!c.minute.values.includes(w.minute)) {
      const nextMin = c.minute.values.find((m) => m > w.minute);
      t += nextMin === undefined ? (60 - w.minute) * 60000 : (nextMin - w.minute) * 60000;
      continue;
    }
    out.push(t);
    t += 60000;
  }
  return out;
}

export function cronProblems(expr: unknown, tz: unknown): string[] {
  const out: string[] = [];
  const { cron, error } = parseCron(expr);
  if (error) out.push(error);
  const zone = tz === undefined ? "UTC" : resolveZone(tz);
  if (!zone) out.push(`"${String(tz)}" is not a time zone`);
  if (cron && zone && !nextRuns(cron, Date.parse("2026-01-01T00:00:00Z"), 1, zone).length) out.push(`"${cron.source}" never runs (no date matches it)`);
  return out;
}

// ---------- dates and business days ----------

export interface Day {
  y: number;
  m: number;
  d: number;
}

export function parseDay(v: unknown): Day | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (!m) return null;
  const day = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  const back = new Date(Date.UTC(day.y, day.m - 1, day.d));
  return back.getUTCMonth() === day.m - 1 && back.getUTCDate() === day.d ? day : null;
}

const dayNumber = (d: Day) => Math.round(Date.UTC(d.y, d.m - 1, d.d) / 864e5);
const fromNumber = (n: number): string => new Date(n * 864e5).toISOString().slice(0, 10);

export interface Holiday {
  date: string;
  name?: string;
}

export interface DayCell {
  date: string;
  weekday: number;
  kind: "work" | "weekend" | "holiday";
  name?: string;
}

export interface BusinessSpan {
  from: string;
  to: string;
  /** to - from in days (negative when to is earlier). */
  calendarDays: number;
  businessDays: number;
  weekendDays: number;
  /** Holidays that fell on a working weekday inside the range. */
  holidays: Holiday[];
  /** Every day counted, in order (empty when the range is longer than maxCells). */
  cells: DayCell[];
  backwards: boolean;
}

export function readHolidays(v: unknown): { list: Holiday[]; problems: string[] } {
  const problems: string[] = [];
  if (v == null) return { list: [], problems };
  if (!Array.isArray(v)) return { list: [], problems: ["holidays needs a list of dates or {date, name}"] };
  const list: Holiday[] = [];
  v.forEach((h, k) => {
    const o = typeof h === "string" ? { date: h } : h && typeof h === "object" ? (h as Record<string, unknown>) : {};
    if (!parseDay(o.date)) problems.push(`holiday ${k + 1}: "${String(o.date ?? h)}" is not a date (YYYY-MM-DD)`);
    else list.push({ date: String(o.date).slice(0, 10), name: typeof o.name === "string" ? o.name : undefined });
  });
  return { list, problems };
}

/**
 * Business days in a range. inclusive counts both ends (like NETWORKDAYS);
 * otherwise the start day is skipped. weekend lists weekday numbers (0 = Sunday).
 */
export function businessSpan(from: string, to: string, opts: { holidays?: Holiday[]; weekend?: number[]; inclusive?: boolean; maxCells?: number } = {}): BusinessSpan {
  const a = parseDay(from);
  const b = parseDay(to);
  if (!a || !b) throw new Error(`${!a ? `from "${from}"` : `to "${to}"`} is not a date (use YYYY-MM-DD)`);
  const weekend = new Set(opts.weekend ?? [0, 6]);
  const holidays = new Map((opts.holidays ?? []).map((h) => [h.date, h]));
  const na = dayNumber(a);
  const nb = dayNumber(b);
  const backwards = nb < na;
  const [lo, hi] = backwards ? [nb, na] : [na, nb];
  // Not inclusive skips the start day, which is the later end when counting back.
  const skip = opts.inclusive === false;
  const first = skip && !backwards ? lo + 1 : lo;
  const last = skip && backwards ? hi - 1 : hi;
  if (hi - lo > 366 * 50) throw new Error("the range is longer than 50 years");
  let business = 0;
  let weekendDays = 0;
  const hit: Holiday[] = [];
  const cells: DayCell[] = [];
  const keepCells = last - first + 1 <= (opts.maxCells ?? 400);
  for (let n = first; n <= last; n++) {
    const date = fromNumber(n);
    const weekday = (((n + 4) % 7) + 7) % 7;
    const holiday = holidays.get(date);
    let kind: DayCell["kind"] = "work";
    if (weekend.has(weekday)) {
      kind = "weekend";
      weekendDays++;
    } else if (holiday) {
      kind = "holiday";
      hit.push(holiday);
    } else business++;
    if (keepCells) cells.push({ date, weekday, kind, name: holiday?.name });
  }
  const sign = backwards ? -1 : 1;
  return { from, to, calendarDays: nb - na, businessDays: sign * business || 0, weekendDays, holidays: hit, cells, backwards };
}

/** "3 weeks 2 days" for a day count. */
export function weeksAndDays(days: number): string {
  const a = Math.abs(days);
  const w = Math.floor(a / 7);
  const d = a % 7;
  const parts = [w ? `${w} ${w === 1 ? "week" : "weeks"}` : "", d || !w ? `${d} ${d === 1 ? "day" : "days"}` : ""].filter(Boolean);
  return parts.join(" ");
}

export function shortDate(date: string, withYear = false): string {
  const d = parseDay(date);
  if (!d) return date;
  return `${MONTHS[d.m - 1].slice(0, 3)} ${d.d}${withYear ? `, ${d.y}` : ""}`;
}

export const WEEKDAY_SHORT = DAYS.map((d) => d.slice(0, 3));
export const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));
