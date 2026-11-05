// The data explorer behind DataGrid: pure functions over plain rows, so 10,000+
// rows filter, sort, group, pivot and summarize in a few milliseconds and tests
// can pin every behavior without a browser.

import { delimited } from "./data";
import { toText } from "./evaluate";

// One collator for every comparison: localeCompare with options builds a new
// one per call, which turns a 50,000-row sort into seconds.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Numbers by value, everything else as text in natural order ("item 2" before "item 10"). */
export function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return collator.compare(toText(a), toText(b));
}

export type ColumnType = "number" | "text" | "date" | "bool";

export interface GridColumn {
  key: string;
  label: string;
  type: ColumnType;
  format?: unknown;
  align: "left" | "right" | "center";
  width?: number;
  tone?: unknown;
  render?: unknown;
}

export type Row = Record<string, unknown>;

export interface GridData {
  rows: Row[];
  cols: GridColumn[];
}

const DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Accepts every shape a query or file gives: a list of objects, a list of lists
 * (first row as header unless columns name them), {columns, rows} from SQL
 * tools, {fields: [{name}], rows} from Postgres clients, or CSV/TSV text.
 */
export function normalizeGrid(input: unknown, columns?: unknown): GridData {
  let list: unknown[] = [];
  let names: string[] | null = null;
  if (typeof input === "string") {
    const nl = input.indexOf("\n");
    const first = nl < 0 ? input : input.slice(0, nl);
    list = delimited(input, first.includes("\t") && !first.includes(",") ? "\t" : ",");
  } else if (Array.isArray(input)) list = input;
  else if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.rows)) {
      list = o.rows;
      const c = Array.isArray(o.columns) ? o.columns : Array.isArray(o.fields) ? o.fields : null;
      if (c) names = c.map((x) => (x && typeof x === "object" ? toText((x as Record<string, unknown>).name ?? (x as Record<string, unknown>).key) : toText(x)));
    } else if (Array.isArray(o.data)) list = o.data;
    else list = Object.values(o);
  }
  const specs = Array.isArray(columns) ? columns : null;
  if (list.length && Array.isArray(list[0])) {
    if (!names && specs) names = specs.map((c) => (typeof c === "string" ? c : toText((c as Record<string, unknown>).key ?? (c as Record<string, unknown>).label)));
    if (!names) {
      names = (list[0] as unknown[]).map(toText);
      list = list.slice(1);
    }
    const n = names;
    list = list.map((r) => (Array.isArray(r) ? Object.fromEntries(n.map((name, k) => [name, r[k]])) : r));
  }
  const rows: Row[] = list.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? (r as Row) : { value: r }));
  let keys: unknown[];
  if (specs) keys = specs;
  else if (names) keys = names;
  else {
    const seen = new Set<string>();
    for (const r of rows.slice(0, 200)) for (const k of Object.keys(r)) seen.add(k);
    keys = [...seen];
  }
  const cols = keys.map((c): GridColumn => {
    const o = typeof c === "string" ? { key: c } : ((c ?? {}) as Record<string, unknown>);
    const key = toText(o.key ?? o.label);
    const type = inferType(rows, key);
    const align = o.align === "left" || o.align === "right" || o.align === "center" ? o.align : type === "number" ? "right" : "left";
    return {
      key,
      label: o.label != null ? toText(o.label) : humanize(key),
      type,
      format: o.format,
      align,
      width: typeof o.width === "number" ? o.width : undefined,
      tone: o.tone,
      render: o.render,
    };
  });
  return { rows, cols };
}

export function humanize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

function inferType(rows: Row[], key: string): ColumnType {
  let n = 0;
  let nums = 0;
  let bools = 0;
  let dates = 0;
  for (const r of rows) {
    const v = r[key];
    if (v == null || v === "") continue;
    n++;
    if (typeof v === "number") nums++;
    else if (typeof v === "boolean") bools++;
    else if (typeof v === "string" && DATE.test(v)) dates++;
    if (n >= 200) break;
  }
  if (!n) return "text";
  if (nums === n) return "number";
  if (bools === n) return "bool";
  if (dates === n) return "date";
  return "text";
}

// ---------- filters ----------

export type Predicate = (value: unknown) => boolean;

/**
 * A column filter as a person types it. Numbers and dates take comparisons
 * (">10", "<=2026-01-01", "!=0", "5..20"); text matches anywhere, "=x" matches
 * exactly, "!x" excludes, and "empty" or "!empty" find missing values.
 */
export function parseFilter(text: string, type: ColumnType): Predicate | null {
  const t = text.trim();
  if (!t) return null;
  if (t === "empty") return (v) => v == null || v === "";
  if (t === "!empty") return (v) => v != null && v !== "";
  const range = /^(-?[\w.:-]+)\s*\.\.\s*(-?[\w.:-]+)$/.exec(t);
  if (range && type !== "text") {
    const lo = operand(range[1], type);
    const hi = operand(range[2], type);
    return (v) => v != null && v !== "" && cmp(v, lo, type) >= 0 && cmp(v, hi, type) <= 0;
  }
  const op = /^(>=|<=|!=|>|<|=)\s*(.*)$/.exec(t);
  if (op) {
    const [, sign, rest] = op;
    if (type === "text" || type === "bool") {
      const want = rest.toLowerCase();
      if (sign === "=") return (v) => toText(v).toLowerCase() === want;
      if (sign === "!=") return (v) => toText(v).toLowerCase() !== want;
    }
    const x = operand(rest, type);
    return (v) => {
      if (v == null || v === "") return sign === "!=";
      const c = cmp(v, x, type);
      return sign === ">" ? c > 0 : sign === ">=" ? c >= 0 : sign === "<" ? c < 0 : sign === "<=" ? c <= 0 : sign === "=" ? c === 0 : c !== 0;
    };
  }
  if (t.startsWith("!")) {
    const q = t.slice(1).toLowerCase();
    return (v) => !toText(v).toLowerCase().includes(q);
  }
  if (type === "number" && /^-?\d+(\.\d+)?$/.test(t)) {
    const x = Number(t);
    return (v) => Number(v) === x;
  }
  const q = t.toLowerCase();
  return (v) => toText(v).toLowerCase().includes(q);
}

function operand(s: string, type: ColumnType): unknown {
  const t = s.trim();
  if (type === "number" && t !== "" && !Number.isNaN(Number(t))) return Number(t);
  return t;
}

function cmp(v: unknown, x: unknown, type: ColumnType): number {
  if (type === "number" && typeof x === "number") return Number(v) - x;
  if (type === "date") return toText(v).localeCompare(toText(x));
  return compare(v, x);
}

/** A lowercase text index per row, built once, so a search over 10,000 rows is one pass. */
export function searchIndex(rows: Row[], cols: GridColumn[]): string[] {
  return rows.map((r) => cols.map((c) => toText(r[c.key])).join("\u0001").toLowerCase());
}

export interface Query {
  search?: string;
  filters?: Record<string, string>;
  sort?: { key: string; dir: 1 | -1 } | null;
}

/** Row indexes after search, filters and sort; the rows themselves never copy. */
export function query(data: GridData, q: Query, index?: string[]): number[] {
  const { rows, cols } = data;
  const preds: [string, Predicate][] = [];
  for (const [key, text] of Object.entries(q.filters ?? {})) {
    const col = cols.find((c) => c.key === key);
    const p = parseFilter(text, col?.type ?? "text");
    if (p) preds.push([key, p]);
  }
  const s = (q.search ?? "").trim().toLowerCase();
  const idx = s ? (index ?? searchIndex(rows, cols)) : null;
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (idx && !idx[i].includes(s)) continue;
    let ok = true;
    for (const [key, p] of preds) {
      if (!p(rows[i][key])) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  const sort = q.sort;
  if (sort) {
    const rank = sortRanks(rows, sort.key);
    const dir = sort.dir;
    // Empty values (rank -1) sink in both directions; ties keep row order.
    out.sort((a, b) => {
      const ra = rank[a];
      const rb = rank[b];
      if (ra < 0 || rb < 0) return ra === rb ? a - b : ra < 0 ? 1 : -1;
      return dir * (ra - rb) || a - b;
    });
  }
  return out;
}

/** Each row's place in the column's natural order: distinct values sort once, rows compare as numbers. */
function sortRanks(rows: Row[], key: string): Float64Array {
  const rank = new Float64Array(rows.length);
  const texts = new Map<string, number>();
  let numeric = true;
  for (const r of rows) {
    const v = r[key];
    if (v == null || v === "") continue;
    if (typeof v !== "number") numeric = false;
    if (!numeric) break;
  }
  if (numeric) {
    rows.forEach((r, i) => (rank[i] = r[key] == null || r[key] === "" ? -1 : 0));
    const order = rows.map((_, i) => i).filter((i) => rank[i] === 0).sort((a, b) => (rows[a][key] as number) - (rows[b][key] as number));
    let prev: unknown = undefined;
    let n = -1;
    for (const i of order) {
      if (rows[i][key] !== prev) (n++, (prev = rows[i][key]));
      rank[i] = n;
    }
    return rank;
  }
  for (const r of rows) {
    const v = r[key];
    if (v == null || v === "") continue;
    texts.set(toText(v), 0);
  }
  const sorted = [...texts.keys()].sort((a, b) => collator.compare(a, b));
  let n = -1;
  let prev: string | null = null;
  for (const t of sorted) {
    if (prev === null || collator.compare(prev, t) !== 0) n++;
    texts.set(t, n);
    prev = t;
  }
  rows.forEach((r, i) => {
    const v = r[key];
    rank[i] = v == null || v === "" ? -1 : texts.get(toText(v))!;
  });
  return rank;
}

// ---------- column stats ----------

export interface ColumnStats {
  key: string;
  type: ColumnType;
  count: number;
  empty: number;
  distinct: number;
  min?: unknown;
  max?: unknown;
  mean?: number;
  sum?: number;
  /** Most common values, most frequent first. */
  top: { value: string; count: number }[];
}

export function columnStats(rows: Row[], col: GridColumn, ids?: number[]): ColumnStats {
  const counts = new Map<string, number>();
  let empty = 0;
  let count = 0;
  let sum = 0;
  let nums = 0;
  let min: unknown;
  let max: unknown;
  const n = ids ? ids.length : rows.length;
  for (let j = 0; j < n; j++) {
    const v = rows[ids ? ids[j] : j][col.key];
    if (v == null || v === "") {
      empty++;
      continue;
    }
    count++;
    const k = toText(v);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    if (col.type === "number" && typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      nums++;
    }
    if (col.type === "number" && typeof v === "number") {
      if (min === undefined || v < (min as number)) min = v;
      if (max === undefined || v > (max as number)) max = v;
    } else if (col.type === "date") {
      if (min === undefined || k < (min as string)) min = k;
      if (max === undefined || k > (max as string)) max = k;
    }
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([value, c]) => ({ value, count: c }));
  const stats: ColumnStats = { key: col.key, type: col.type, count, empty, distinct: counts.size, top };
  if (col.type !== "text" && col.type !== "bool") {
    stats.min = min;
    stats.max = max;
  }
  if (col.type === "number" && nums) {
    stats.sum = sum;
    stats.mean = sum / nums;
  }
  return stats;
}

// ---------- group by ----------

export interface Group {
  value: unknown;
  label: string;
  ids: number[];
  /** Sums of each number column within the group. */
  sums: Record<string, number>;
}

export function groupRows(data: GridData, ids: number[], key: string, sortKey?: string): Group[] {
  const by = new Map<string, Group>();
  const numeric = data.cols.filter((c) => c.type === "number" && c.key !== key);
  for (const i of ids) {
    const r = data.rows[i];
    const v = r[key];
    const label = v == null || v === "" ? "(empty)" : toText(v);
    let g = by.get(label);
    if (!g) {
      g = { value: v, label, ids: [], sums: Object.fromEntries(numeric.map((c) => [c.key, 0])) };
      by.set(label, g);
    }
    g.ids.push(i);
    for (const c of numeric) {
      const x = r[c.key];
      if (typeof x === "number" && Number.isFinite(x)) g.sums[c.key] += x;
    }
  }
  const groups = [...by.values()];
  // Sorting by the grouped column orders the groups; otherwise biggest first.
  if (sortKey === key) return groups;
  return groups.sort((a, b) => b.ids.length - a.ids.length || compare(a.value, b.value));
}

/** The column worth grouping by first: few distinct values, but more than one. */
export function suggestGroupKey(data: GridData): string | null {
  const sample = data.rows.length > 2000 ? data.rows.slice(0, 2000) : data.rows;
  let best: { key: string; n: number } | null = null;
  for (const c of data.cols) {
    if (c.type === "number") continue;
    const seen = new Set<string>();
    for (const r of sample) {
      seen.add(toText(r[c.key]));
      if (seen.size > 60) break;
    }
    const n = seen.size;
    if (n < 2 || n > 60 || n > sample.length / 2) continue;
    if (!best || n < best.n) best = { key: c.key, n };
  }
  return best?.key ?? data.cols.find((c) => c.type !== "number")?.key ?? data.cols[0]?.key ?? null;
}

// ---------- pivot ----------

export type Agg = "count" | "sum" | "mean" | "min" | "max";
export const AGGS: readonly Agg[] = ["count", "sum", "mean", "min", "max"];

export interface PivotSpec {
  rows: string;
  columns?: string | null;
  value?: string | null;
  agg?: Agg;
}

export interface Pivot {
  rowLabels: string[];
  colLabels: string[];
  /** cells[r][c]; null where no rows fall. */
  cells: (number | null)[][];
  rowTotals: (number | null)[];
  colTotals: (number | null)[];
  total: number | null;
  /** Columns past the cap folded into "Other". */
  folded: number;
}

const MAX_PIVOT_COLUMNS = 24;

class Acc {
  n = 0;
  /** Rows with a number, for the mean; n counts every row. */
  nums = 0;
  sum = 0;
  min = Infinity;
  max = -Infinity;
  add(x: number | null) {
    this.n++;
    if (x == null) return;
    this.nums++;
    this.sum += x;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }
  get(agg: Agg): number | null {
    if (!this.n) return null;
    switch (agg) {
      case "count":
        return this.n;
      case "sum":
        return this.sum;
      case "mean":
        return this.nums ? this.sum / this.nums : null;
      case "min":
        return Number.isFinite(this.min) ? this.min : null;
      case "max":
        return Number.isFinite(this.max) ? this.max : null;
    }
  }
}

export function pivot(data: GridData, ids: number[], spec: PivotSpec): Pivot {
  const agg: Agg = spec.value ? (spec.agg ?? "sum") : "count";
  const label = (v: unknown) => (v == null || v === "" ? "(empty)" : toText(v));
  const colCounts = new Map<string, number>();
  if (spec.columns) for (const i of ids) colCounts.set(label(data.rows[i][spec.columns]), (colCounts.get(label(data.rows[i][spec.columns])) ?? 0) + 1);
  let colLabels = spec.columns ? [...colCounts.keys()].sort((a, b) => compare(numberish(a), numberish(b))) : ["Value"];
  let folded = 0;
  if (colLabels.length > MAX_PIVOT_COLUMNS) {
    const keep = new Set([...colCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PIVOT_COLUMNS - 1).map(([k]) => k));
    folded = colLabels.length - keep.size;
    colLabels = [...colLabels.filter((c) => keep.has(c)), "Other"];
  }
  const colIndex = new Map(colLabels.map((c, k) => [c, k]));
  const rowAcc = new Map<string, Acc[]>();
  const rowTot = new Map<string, Acc>();
  const colTot = colLabels.map(() => new Acc());
  const all = new Acc();
  for (const i of ids) {
    const r = data.rows[i];
    const rk = label(r[spec.rows]);
    const ck = spec.columns ? label(r[spec.columns]) : "Value";
    const c = colIndex.get(ck) ?? colIndex.get("Other") ?? 0;
    const raw = spec.value ? r[spec.value] : null;
    const x = typeof raw === "number" && Number.isFinite(raw) ? raw : raw != null && raw !== "" && !Number.isNaN(Number(raw)) ? Number(raw) : null;
    let accs = rowAcc.get(rk);
    if (!accs) {
      accs = colLabels.map(() => new Acc());
      rowAcc.set(rk, accs);
      rowTot.set(rk, new Acc());
    }
    accs[c].add(x);
    rowTot.get(rk)!.add(x);
    colTot[c].add(x);
    all.add(x);
  }
  const rowLabels = [...rowAcc.keys()].sort((a, b) => compare(numberish(a), numberish(b)));
  return {
    rowLabels,
    colLabels,
    cells: rowLabels.map((rk) => rowAcc.get(rk)!.map((a) => a.get(agg))),
    rowTotals: rowLabels.map((rk) => rowTot.get(rk)!.get(agg)),
    colTotals: colTot.map((a) => a.get(agg)),
    total: all.get(agg),
    folded,
  };
}

function numberish(s: string): unknown {
  return s !== "" && !Number.isNaN(Number(s)) ? Number(s) : s;
}

// ---------- CSV ----------

function csvCell(v: unknown): string {
  const t = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : toText(v);
  return /[",\n\r]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

export function rowsToCsv(data: GridData, ids: number[]): string {
  return toCsv(
    data.cols.map((c) => c.label),
    ids.map((i) => data.cols.map((c) => data.rows[i][c.key])),
  );
}

export function pivotToCsv(p: Pivot, rowName: string): string {
  return toCsv(
    [rowName, ...p.colLabels, "Total"],
    p.rowLabels.map((r, k) => [r, ...p.cells[k], p.rowTotals[k]]).concat([["Total", ...p.colTotals, p.total]]),
  );
}
