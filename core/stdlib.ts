// The functions every Iris expression can call. Pure and deterministic, except
// now(), which live cards use. Actions return ActionValues: they describe what
// should happen and only run when a person clicks.

import { type ActionKind, type ActionValue, type Host, type Interpreter, IrisError, Scope, defaultCompare, isFnValue, markSafe, mint, readField, toText } from "./evaluate";
import { formatValue, type NumberFormat } from "./format";

const action = (kind: ActionKind, args: unknown[]): ActionValue => mint({ $iris: "action", kind, args });

const num = (v: unknown, what: string): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (Number.isNaN(n)) throw new IrisError(`${what} needs a number, got ${JSON.stringify(v)}`);
  return n;
};

const list = (v: unknown, what: string): unknown[] => {
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object") return Object.values(v);
  throw new IrisError(`${what} needs a list`);
};

export function createGlobals(it: () => Interpreter, host: () => Host): Scope {
  const g = new Scope(null);
  const fn = (f: unknown, what: string) => it().toJs(f, what);
  /** A key name or a function picks the value of each item. */
  const picker = (by: unknown, what: string) =>
    by == null ? (x: unknown) => x : typeof by === "string" || typeof by === "number" ? (x: unknown) => readField(x, by) : fn(by, what);

  const MathNs = Object.freeze({
    abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max, pow: Math.pow,
    sqrt: Math.sqrt, cbrt: Math.cbrt, log: Math.log, log10: Math.log10, log2: Math.log2, exp: Math.exp, sign: Math.sign,
    trunc: Math.trunc, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2, hypot: Math.hypot, PI: Math.PI, E: Math.E,
  });

  const defs: Record<string, unknown> = {
    Math: Object.assign(Object.create(null), MathNs),
    // numbers
    round: (x: unknown, d: unknown = 0) => {
      const f = 10 ** num(d, "round()");
      return Math.round(num(x, "round()") * f) / f;
    },
    floor: (x: unknown) => Math.floor(num(x, "floor()")),
    ceil: (x: unknown) => Math.ceil(num(x, "ceil()")),
    abs: (x: unknown) => Math.abs(num(x, "abs()")),
    sqrt: (x: unknown) => Math.sqrt(num(x, "sqrt()")),
    clamp: (x: unknown, lo: unknown, hi: unknown) => Math.min(num(hi, "clamp()"), Math.max(num(lo, "clamp()"), num(x, "clamp()"))),
    min: (...a: unknown[]) => Math.min(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map((x) => num(x, "min()"))),
    max: (...a: unknown[]) => Math.max(...(a.length === 1 && Array.isArray(a[0]) ? a[0] : a).map((x) => num(x, "max()"))),
    sum: (xs: unknown, by?: unknown) => list(xs, "sum()").reduce<number>((s, x) => s + (Number(picker(by, "sum()")(x)) || 0), 0),
    avg: (xs: unknown, by?: unknown) => {
      const l = list(xs, "avg()");
      return l.length ? l.reduce<number>((s, x) => s + (Number(picker(by, "avg()")(x)) || 0), 0) / l.length : 0;
    },
    median: (xs: unknown, by?: unknown) => {
      const l = list(xs, "median()").map((x) => Number(picker(by, "median()")(x))).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
      if (!l.length) return 0;
      const m = Math.floor(l.length / 2);
      return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2;
    },
    range: (a: unknown, b?: unknown, step: unknown = 1) => {
      let start = num(a, "range()");
      let end: number;
      if (b === undefined) {
        end = start;
        start = 0;
      } else end = num(b, "range()");
      const s = num(step, "range()");
      if (s === 0) throw new IrisError("range() step can't be 0");
      const out: number[] = [];
      for (let x = start; s > 0 ? x < end : x > end; x += s) {
        out.push(x);
        if (out.length > 10_000) throw new IrisError("range() is limited to 10,000 numbers");
      }
      return out;
    },
    // formatting
    fmt: (x: unknown, format: unknown = "number") =>
      typeof format === "number" ? formatValue(x, { style: "number", decimals: format }) : formatValue(x, format as NumberFormat),
    pct: (x: unknown, d: unknown = 0) => formatValue(x, { style: "percent", decimals: num(d, "pct()") }),
    usd: (x: unknown, d?: unknown) => formatValue(x, { style: "currency", currency: "USD", decimals: d == null ? undefined : num(d, "usd()") }),
    eur: (x: unknown, d?: unknown) => formatValue(x, { style: "currency", currency: "EUR", decimals: d == null ? undefined : num(d, "eur()") }),
    money: (x: unknown, currency: unknown = "USD", d?: unknown) =>
      formatValue(x, { style: "currency", currency: String(currency), decimals: d == null ? undefined : num(d, "money()") }),
    bytes: (x: unknown) => formatValue(x, "bytes"),
    duration: (x: unknown, unit: unknown = "ms") => formatValue(unit === "s" ? num(x, "duration()") * 1000 : x, "duration"),
    compact: (x: unknown) => formatValue(x, "compact"),
    plural: (n: unknown, word: unknown, many?: unknown) => {
      const c = num(n, "plural()");
      return `${formatValue(c, "number")} ${c === 1 ? String(word) : many != null ? String(many) : `${String(word)}s`}`;
    },
    date: (x: unknown, style: unknown = "medium") => formatValue(x, { style: "date", date: String(style) as "short" }),
    daysBetween: (a: unknown, b: unknown) => Math.round((Date.parse(String(b)) - Date.parse(String(a))) / 86_400_000),
    now: () => host().now(),
    // data
    keys: (o: unknown) => (o && typeof o === "object" ? Object.keys(o) : []),
    values: (o: unknown) => (o && typeof o === "object" ? Object.values(o) : []),
    entries: (o: unknown) => (o && typeof o === "object" ? Object.entries(o) : []),
    fromEntries: (pairs: unknown) => Object.fromEntries(list(pairs, "fromEntries()") as [string, unknown][]),
    len: (x: unknown) => (Array.isArray(x) || typeof x === "string" ? x.length : x && typeof x === "object" ? Object.keys(x).length : 0),
    first: (x: unknown) => (Array.isArray(x) ? x[0] : undefined),
    last: (x: unknown) => (Array.isArray(x) ? x[x.length - 1] : undefined),
    groupBy: (xs: unknown, by: unknown) => {
      const out: Record<string, unknown[]> = {};
      const f = picker(by, "groupBy()");
      for (const x of list(xs, "groupBy()")) (out[toText(f(x))] ??= []).push(x);
      return out;
    },
    countBy: (xs: unknown, by: unknown) => {
      const out: Record<string, number> = {};
      const f = picker(by, "countBy()");
      for (const x of list(xs, "countBy()")) {
        const k = toText(f(x));
        out[k] = (out[k] ?? 0) + 1;
      }
      return out;
    },
    sortBy: (xs: unknown, by: unknown, dir: unknown = "asc") => {
      const f = picker(by, "sortBy()");
      const sign = dir === "desc" ? -1 : 1;
      return list(xs, "sortBy()").slice().sort((a, b) => sign * defaultCompare(f(a), f(b)));
    },
    unique: (xs: unknown, by?: unknown) => {
      const f = picker(by, "unique()");
      const seen = new Set<unknown>();
      return list(xs, "unique()").filter((x) => {
        const k = f(x);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    },
    pluck: (xs: unknown, key: unknown) => list(xs, "pluck()").map((x) => readField(x, key)),
    zip: (...ls: unknown[]) => {
      const arrays = ls.map((l) => list(l, "zip()"));
      const n = Math.min(...arrays.map((a) => a.length));
      return Array.from({ length: n }, (_, k) => arrays.map((a) => a[k]));
    },
    json: (x: unknown) => JSON.stringify(x, null, 2),
    str: (x: unknown) => toText(x),
    number: (x: unknown) => Number(x),
    isList: (x: unknown) => Array.isArray(x),
    load: (path: unknown, options?: unknown) => {
      if (typeof path !== "string" || !path) throw new IrisError('load() needs a file path, like load("$BB_THREAD_STORAGE/tests.json")');
      return host().load(path, (options ?? undefined) as { raw?: boolean; tail?: boolean; fallback?: unknown } | undefined);
    },
    // actions: they describe what a click does
    send: (text: unknown) => action("send", [toText(text)]),
    insert: (text: unknown) => action("insert", [toText(text)]),
    copy: (text: unknown) => action("copy", [typeof text === "string" ? text : JSON.stringify(text, null, 2)]),
    openUrl: (url: unknown) => action("openUrl", [toText(url)]),
    open: (url: unknown) => action("openUrl", [toText(url)]),
    openFile: (path: unknown, line?: unknown) => action("openFile", [toText(path), line == null ? null : num(line, "openFile()")]),
    explain: (topic: unknown) => action("explain", [toText(topic)]),
    set: (name: unknown, value: unknown) => action("set", [String(name), value]),
    toggle: (name: unknown) => action("toggle", [String(name)]),
    submit: (value?: unknown) => action("submit", value === undefined ? [] : [value]),
  };
  for (const v of Object.values(MathNs)) if (typeof v === "function") markSafe(v);
  for (const [k, v] of Object.entries(defs)) g.vars.set(k, typeof v === "function" ? markSafe(v as (...a: never[]) => unknown) : v);
  void isFnValue;
  return g;
}

export const GLOBAL_NAMES = [
  "Math", "round", "floor", "ceil", "abs", "sqrt", "clamp", "min", "max", "sum", "avg", "median", "range", "fmt", "pct", "usd", "eur",
  "money", "bytes", "duration", "compact", "plural", "date", "daysBetween", "now", "keys", "values", "entries", "fromEntries", "len",
  "first", "last", "groupBy", "countBy", "sortBy", "unique", "pluck", "zip", "json", "str", "number", "isList", "load", "send", "insert",
  "copy", "openUrl", "open", "openFile", "explain", "set", "toggle", "submit",
] as const;
