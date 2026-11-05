// Budget's data: spend against a limit for one or many lines, each in its own
// unit (tokens, dollars, runs, characters, minutes or any word). Reads inline
// props, a JSON object or list, or CSV rows; works out each line's state
// (under, warn, over), its burn rate from timed points and when the limit is
// reached at that rate. Views live in the "track" chunk.

import { formatWhen, readTime } from "./forecast";

export type BudgetState = "ok" | "warn" | "over";

export interface BudgetPart {
  label: string;
  value: number;
}

export interface BudgetRate {
  /** Units per millisecond. */
  perMs: number;
  /** The period the rate reads in. */
  per: "min" | "h" | "day";
  /** The time the rate is measured up to (the last reading). */
  asOf: number;
  /** When the limit is reached at this rate, or null (already over, no limit, or not spending). */
  limitAt: number | null;
}

export interface BudgetLine {
  label: string;
  spent: number;
  limit: number | null;
  unit: string;
  /** Share of the limit where the meter turns warn (0-1). */
  warn: number;
  state: BudgetState;
  /** spent / limit, or null without a limit. */
  ratio: number | null;
  parts: BudgetPart[];
  points: { t: number; spent: number }[];
  rate: BudgetRate | null;
  note?: string;
}

export interface BudgetTotal {
  unit: string;
  spent: number;
  limit: number | null;
  state: BudgetState;
  ratio: number | null;
  warn: number;
  lines: number;
}

export interface BudgetModel {
  lines: BudgetLine[];
  /** One total per unit, for units shared by two or more lines. */
  totals: BudgetTotal[];
  /** A breakdown of the whole budget (the top-level `by`). */
  parts: BudgetPart[];
}

const UNIT_WORDS: Record<string, string> = {
  token: "tokens",
  tokens: "tokens",
  tok: "tokens",
  "$": "usd",
  dollars: "usd",
  usd: "usd",
  eur: "eur",
  euro: "eur",
  euros: "eur",
  gbp: "gbp",
  run: "runs",
  runs: "runs",
  char: "characters",
  chars: "characters",
  character: "characters",
  characters: "characters",
  min: "minutes",
  mins: "minutes",
  minute: "minutes",
  minutes: "minutes",
};

export function readUnit(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "usd";
  const u = v.trim();
  return UNIT_WORDS[u.toLowerCase()] ?? u;
}

const CURRENCIES = new Set(["usd", "eur", "gbp"]);

function plainNumber(n: number): string {
  return Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n.toFixed(Math.abs(n) >= 10 ? 1 : 2)).toLocaleString("en-US");
}

/** 8,400, 18.4K, 353K, 1.2M: one decimal below 100 of a unit, none above. */
function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs < 10_000) return plainNumber(n);
  const [div, suffix] = abs >= 1e9 ? [1e9, "B"] : abs >= 1e6 ? [1e6, "M"] : [1e3, "K"];
  const v = n / div;
  return `${Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(1))}${suffix}`;
}

/** Whole amounts without cents, the rest with two decimals. */
function money(n: number, unit: string, cents = !Number.isInteger(Math.round(n * 100) / 100)): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: unit.toUpperCase(), minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 }).format(n);
}

/** A number in its unit, without the unit word (for "12 of 20 runs"). */
export function amountNumber(n: number, unit: string): string {
  if (CURRENCIES.has(unit)) return money(n, unit);
  if (unit === "tokens") return compact(n);
  if (unit === "characters") return Math.round(n).toLocaleString("en-US");
  return plainNumber(n);
}

/** A line measured in percent of its own limit, such as a plan's usage window. */
export function isPercentUnit(unit: string): boolean {
  return unit === "percent" || unit === "%";
}

function unitWord(n: number, unit: string): string {
  if (CURRENCIES.has(unit)) return "";
  if (unit === "minutes") return "min";
  if (unit === "runs") return Math.abs(n) === 1 ? "run" : "runs";
  if (unit === "tokens") return Math.abs(n) === 1 ? "token" : "tokens";
  if (unit === "characters") return Math.abs(n) === 1 ? "character" : "characters";
  return unit;
}

/** "$41.20", "1.2M tokens", "3 runs", "3,812 characters", "42 min". */
export function formatAmount(n: number, unit: string): string {
  if (isPercentUnit(unit)) return `${amountNumber(n, "")}%`;
  if (unit === "minutes" && Math.abs(n) >= 60) {
    const m = Math.round(Math.abs(n));
    return `${n < 0 ? "-" : ""}${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  }
  const word = unitWord(n, unit);
  return word ? `${amountNumber(n, unit)} ${word}` : amountNumber(n, unit);
}

/** Spent and limit as separate strings that match: "$41.20" and "$60.00", "1.2M tokens" and "2M tokens". */
export function formatPair(spent: number, limit: number, unit: string): [string, string] {
  if (!CURRENCIES.has(unit)) return [formatAmount(spent, unit), formatAmount(limit, unit)];
  const cents = [spent, limit].some((v) => !Number.isInteger(Math.round(v * 100) / 100));
  return [money(spent, unit, cents), money(limit, unit, cents)];
}

/** "$41.20 of $60.00", "1.2M of 2M tokens", "53% of 100%". */
export function formatOf(spent: number, limit: number | null, unit: string): string {
  if (limit == null) return formatAmount(spent, unit);
  if (isPercentUnit(unit)) return `${formatAmount(spent, unit)} of ${formatAmount(limit, unit)}`;
  // Cents on both sides or neither: "$41.20 of $60.00", "$86 of $100".
  if (CURRENCIES.has(unit) || unit === "minutes") return formatPair(spent, limit, unit).join(" of ");
  return `${amountNumber(spent, unit)} of ${formatAmount(limit, unit)}`;
}

const PER_MS = { min: 60_000, h: 3_600_000, day: 86_400_000 } as const;

/** "$4.10/h", "120K tokens/min". */
export function formatRate(rate: BudgetRate, unit: string): string {
  const v = rate.perMs * PER_MS[rate.per];
  if (isPercentUnit(unit)) return `${amountNumber(v, "")}%/${rate.per}`;
  const word = unit === "minutes" ? "min" : unitWord(2, unit);
  return `${amountNumber(v, unit)}${word ? ` ${word}` : ""}/${rate.per}`;
}

/** "2 h 10 min", "3 days", "40 min". */
export function formatSpan(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) {
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h >= 10 || !r ? `${Math.round(m / 60)} h` : `${h} h ${r} min`;
  }
  return `${Math.round(m / 1440)} days`;
}

function readWarn(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v.replace(/%$/, "")) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1 ? Math.min(1, n / 100) : n;
}

function readNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim().replace(/[$€£,_\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readParts(v: unknown, where: string, problems: string[]): BudgetPart[] {
  if (v == null) return [];
  const out: BudgetPart[] = [];
  if (Array.isArray(v)) {
    for (const p of v) {
      const r = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      const value = readNumber(r.value ?? r.spent ?? r.amount);
      const label = r.label ?? r.name ?? r.category;
      if (value == null || label == null) problems.push(`${where}: each part needs a label and a value`);
      else out.push({ label: String(label), value: Math.max(0, value) });
    }
  } else if (typeof v === "object") {
    for (const [label, raw] of Object.entries(v as Record<string, unknown>)) {
      const value = readNumber(raw);
      if (value == null) problems.push(`${where}: "${label}" is not a number`);
      else out.push({ label, value: Math.max(0, value) });
    }
  } else problems.push(`${where} must be {category: amount} or [{label, value}]`);
  return out;
}

function readPoints(v: unknown, where: string, problems: string[]): { t: number; spent: number }[] {
  if (v == null) return [];
  if (!Array.isArray(v)) {
    problems.push(`${where} must be a list of {t, spent}`);
    return [];
  }
  const out: { t: number; spent: number }[] = [];
  for (const p of v) {
    const r = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
    const t = readTime(r.t ?? r.time ?? r.at ?? r.date);
    const spent = readNumber(r.spent ?? r.value ?? r.used);
    if (t == null || spent == null) problems.push(`${where}: each point needs a time (t) and spent`);
    else out.push({ t, spent });
  }
  return out.sort((a, b) => a.t - b.t);
}

function stateOf(ratio: number | null, warn: number): BudgetState {
  if (ratio == null) return "ok";
  if (ratio > 1) return "over";
  return ratio >= warn ? "warn" : "ok";
}

/** Burn rate from the first and last readings (or `since` to now), and when it reaches the limit. */
export function burnRate(points: { t: number; spent: number }[], spent: number, limit: number | null, since: number | null, now: number): BudgetRate | null {
  let from: { t: number; spent: number } | null = null;
  let to: { t: number; spent: number } | null = null;
  if (points.length >= 2) {
    from = points[0];
    to = points[points.length - 1];
    if (since != null && since < from.t) from = { t: since, spent: 0 };
  } else if (since != null) {
    from = { t: since, spent: 0 };
    to = points.length === 1 ? points[0] : { t: Math.max(now, since), spent };
    if (to.t <= from.t) to = { t: Math.max(now, since), spent };
  }
  if (!from || !to || to.t <= from.t) return null;
  const perMs = (to.spent - from.spent) / (to.t - from.t);
  const span = to.t - from.t;
  const per = span < 3_600_000 ? "min" : span < 3 * 86_400_000 ? "h" : "day";
  const limitAt = limit != null && perMs > 0 && spent < limit ? to.t + (limit - spent) / perMs : null;
  return { perMs, per, asOf: to.t, limitAt };
}

const LINE_KEYS = new Set(["spent", "used", "value", "limit", "budget", "max", "label", "name", "line", "unit", "warn", "by", "parts", "points", "since", "note"]);

/** Groups CSV-like rows: rows with a time are readings of their line; the rest are lines. */
function linesFromRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const order: string[] = [];
  const byLabel = new Map<string, Record<string, unknown>>();
  for (const r of rows) {
    const label = String(r.line ?? r.label ?? r.name ?? "");
    const timed = r.t ?? r.time ?? r.at ?? r.date;
    let line = byLabel.get(label);
    if (!line) {
      line = { label: label || undefined };
      byLabel.set(label, line);
      order.push(label);
    }
    for (const k of ["limit", "budget", "max", "unit", "warn", "note", "since"]) if (r[k] != null && r[k] !== "") line[k] = r[k];
    if (timed != null && timed !== "") {
      const pts = (line.points as unknown[] | undefined) ?? [];
      pts.push({ t: timed, spent: r.spent ?? r.used ?? r.value });
      line.points = pts;
    } else if (r.category != null && r.category !== "") {
      const parts = (line.by as Record<string, unknown> | undefined) ?? {};
      parts[String(r.category)] = r.spent ?? r.value;
      line.by = parts;
    } else line.spent = r.spent ?? r.used ?? r.value;
  }
  return order.map((k) => byLabel.get(k)!);
}

/**
 * Reads Budget's data. `data` is a line, a list of lines, {lines, by}, or CSV
 * rows; `props` carries the shortcut for one line (spent, limit, unit, points, by)
 * and defaults (unit, warn). `now` stands in for a line's last reading when it has only `since`.
 */
export function normalizeBudget(data: unknown, props: Record<string, unknown> = {}, now = Date.now()): { model: BudgetModel; problems: string[] } {
  const problems: string[] = [];
  const defaultUnit = props.unit;
  const defaultWarn = readWarn(props.warn) ?? 0.8;
  let raws: Record<string, unknown>[] = [];
  let topBy: unknown = props.by;
  const asLine = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
  if (Array.isArray(data)) {
    const rows = data.filter((r) => asLine(r)) as Record<string, unknown>[];
    if (rows.length !== data.length) problems.push("each line must be an object like {label, spent, limit}");
    const csvLike = rows.some((r) => r.t != null || r.time != null || r.category != null) || rows.some((r, k) => rows.findIndex((o) => (o.line ?? o.label) === (r.line ?? r.label)) !== k);
    raws = csvLike ? linesFromRows(rows) : rows;
  } else if (asLine(data)) {
    const d = asLine(data)!;
    if (Array.isArray(d.lines)) return normalizeBudget(d.lines, { ...props, by: d.by ?? props.by, unit: d.unit ?? props.unit, warn: d.warn ?? props.warn }, now);
    raws = [d];
    if (d.by == null && topBy != null) raws = [{ ...d, by: topBy }];
    topBy = undefined;
  } else if (data != null) problems.push("data must be a line {label, spent, limit}, a list of lines or {lines: [...]}");
  else if (Object.keys(props).some((k) => LINE_KEYS.has(k) && k !== "unit" && k !== "warn" && props[k] !== undefined)) {
    raws = [props];
    topBy = undefined;
  }

  const lines: BudgetLine[] = [];
  raws.forEach((r, k) => {
    const where = raws.length > 1 ? `line ${k + 1}${r.label ?? r.name ? ` (${String(r.label ?? r.name)})` : ""}` : "budget";
    const unit = readUnit(r.unit ?? defaultUnit);
    const points = readPoints(r.points, `${where} points`, problems);
    const spentRaw = r.spent ?? r.used ?? r.value;
    const spent = readNumber(spentRaw) ?? (points.length ? points[points.length - 1].spent : null);
    if (spent == null) {
      problems.push(spentRaw == null ? `${where} needs spent (or timed points)` : `${where}: spent "${String(spentRaw)}" is not a number`);
      return;
    }
    const limitRaw = r.limit ?? r.budget ?? r.max;
    let limit = readNumber(limitRaw);
    if (limitRaw != null && limit == null) problems.push(`${where}: limit "${String(limitRaw)}" is not a number`);
    if (limit != null && limit <= 0) {
      problems.push(`${where}: limit must be above 0`);
      limit = null;
    }
    const warn = readWarn(r.warn) ?? defaultWarn;
    const ratio = limit != null ? spent / limit : null;
    const since = r.since != null ? readTime(r.since) : null;
    if (r.since != null && since == null) problems.push(`${where}: since "${String(r.since)}" is not a time`);
    lines.push({
      label: String(r.label ?? r.name ?? (raws.length > 1 ? `Line ${k + 1}` : "Spent")),
      spent,
      limit,
      unit,
      warn,
      state: stateOf(ratio, warn),
      ratio,
      parts: readParts(r.by ?? r.parts, `${where} by`, problems),
      points,
      rate: burnRate(points, spent, limit, since, now),
      note: typeof r.note === "string" ? r.note : undefined,
    });
  });
  if (!lines.length && !problems.length) problems.push("needs spent and limit, lines, or data");

  const totals: BudgetTotal[] = [];
  const units = [...new Set(lines.map((l) => l.unit))];
  for (const unit of units) {
    const same = lines.filter((l) => l.unit === unit);
    // Shares of separate limits (usage windows in percent) don't add up to anything.
    if (same.length < 2 || isPercentUnit(unit)) continue;
    const spent = same.reduce((s, l) => s + l.spent, 0);
    const limit = same.every((l) => l.limit != null) ? same.reduce((s, l) => s + (l.limit ?? 0), 0) : null;
    const ratio = limit ? spent / limit : null;
    totals.push({ unit, spent, limit, ratio, warn: defaultWarn, state: stateOf(ratio, defaultWarn), lines: same.length });
  }
  return { model: { lines, totals, parts: readParts(topBy, "by", problems) }, problems };
}

/** One line in words: "$41.20 of $60 (69%), $4.10/h, limit in about 4 h 35 min (3:40 PM)". */
export function describeLine(line: BudgetLine, timeZone?: string): string {
  const out = [isPercentUnit(line.unit) && line.limit === 100 ? formatAmount(line.spent, line.unit) : formatOf(line.spent, line.limit, line.unit)];
  if (line.ratio != null && !(isPercentUnit(line.unit) && line.limit === 100)) out[0] += ` (${Math.round(line.ratio * 100)}%)`;
  if (line.state === "over" && line.limit != null) out.push(`${formatAmount(line.spent - line.limit, line.unit)} over`);
  if (line.rate) {
    out.push(formatRate(line.rate, line.unit));
    if (line.rate.limitAt != null) out.push(`limit in about ${formatSpan(line.rate.limitAt - line.rate.asOf)} (${formatWhen(line.rate.limitAt, line.rate.asOf, timeZone)})`);
  }
  return out.join(", ");
}
