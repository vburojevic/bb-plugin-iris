// Sheet: an editable grid whose cells may hold formulas (=B2*C2, SUM(B2:B9)).
// Formulas run in this file's own small interpreter, never eval: a tokenizer,
// a precedence parser into a tiny AST, and an evaluator with memo, cycle
// detection and a step budget. Row 1 is the header row; data starts at row 2,
// as in a spreadsheet with a header. Bare names (qty, [Q1]) read a column of
// the same row, which is how computed columns are written.

import { delimited } from "./data";
import { toText } from "./evaluate";

// ---------- values ----------

export type ErrorCode = "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#NUM!" | "#CYCLE!" | "#N/A" | "#ERROR!";

export interface CellError {
  $error: ErrorCode;
  detail: string;
}

export type CellValue = number | string | boolean | null | CellError;

export const isCellError = (v: unknown): v is CellError => typeof v === "object" && v !== null && "$error" in v;
const err = (code: ErrorCode, detail: string): CellError => ({ $error: code, detail });

// ---------- addresses ----------

export function colName(c: number): string {
  let s = "";
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** "B3" for data row 1 (sheet row 3), column 1. */
export const address = (row: number, col: number) => `${colName(col)}${row + 2}`;

// ---------- tokens ----------

type Tok =
  | { t: "num"; v: number; at: number; end: number }
  | { t: "str"; v: string; at: number; end: number }
  | { t: "ref"; col: number; row: number; at: number; end: number }
  | { t: "referr"; at: number; end: number }
  | { t: "cols"; c1: number; c2: number; at: number; end: number }
  | { t: "name"; v: string; at: number; end: number }
  | { t: "field"; v: string; at: number; end: number }
  | { t: "op"; v: string; at: number; end: number };

const REF = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})(?![A-Za-z0-9_(])/;
const COLS = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![A-Za-z0-9_(])/;
const NUM = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
const NAME = /^[A-Za-z_][A-Za-z0-9_.]*/;
const OPS = ["<=", ">=", "<>", "!=", "==", "+", "-", "*", "/", "^", "&", "=", "<", ">", "%", "(", ")", ",", ";", ":"];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    const rest = src.slice(i);
    if (ch === '"') {
      let j = i + 1;
      let v = "";
      for (;;) {
        if (j >= src.length) throw new FormulaSyntax("a string is not closed", i);
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += src[j++];
      }
      out.push({ t: "str", v, at: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (rest.startsWith("#REF!")) {
      out.push({ t: "referr", at: i, end: i + 5 });
      i += 5;
      continue;
    }
    if (ch === "[") {
      const j = src.indexOf("]", i);
      if (j < 0) throw new FormulaSyntax("a [column] is not closed", i);
      out.push({ t: "field", v: src.slice(i + 1, j).trim(), at: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    let m = COLS.exec(rest);
    if (m) {
      out.push({ t: "cols", c1: colIndex(m[1]), c2: colIndex(m[2]), at: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    m = REF.exec(rest);
    if (m) {
      out.push({ t: "ref", col: colIndex(m[1]), row: Number(m[2]), at: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    m = NUM.exec(rest);
    if (m) {
      out.push({ t: "num", v: Number(m[0]), at: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    m = NAME.exec(rest);
    if (m) {
      out.push({ t: "name", v: m[0], at: i, end: i + m[0].length });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => rest.startsWith(o));
    if (!op) throw new FormulaSyntax(`unexpected "${ch}"`, i);
    out.push({ t: "op", v: op, at: i, end: i + op.length });
    i += op.length;
  }
  return out;
}

export class FormulaSyntax extends Error {
  constructor(
    message: string,
    readonly at: number,
  ) {
    super(message);
  }
}

// ---------- parse ----------

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; col: number; row: number; text: string }
  | { k: "referr" }
  | { k: "range"; c1: number; r1: number; c2: number; r2: number }
  | { k: "cols"; c1: number; c2: number }
  | { k: "field"; name: string }
  | { k: "call"; name: string; args: Expr[] }
  | { k: "neg"; x: Expr }
  | { k: "pct"; x: Expr }
  | { k: "bin"; op: string; l: Expr; r: Expr };

const BIN: Record<string, number> = { "=": 1, "==": 1, "<>": 1, "!=": 1, "<": 1, ">": 1, "<=": 1, ">=": 1, "&": 2, "+": 3, "-": 3, "*": 4, "/": 4, "^": 6 };

/** Parses a formula, with or without its leading "=". */
export function parseFormula(src: string): Expr {
  const body = src.replace(/^\s*=/, "");
  const toks = tokenize(body);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === "op" && (peek() as { v: string }).v === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaSyntax(`expected "${v}"`, peek()?.at ?? body.length);
    i++;
  };
  function expr(min: number): Expr {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.t !== "op" || !(t.v in BIN)) break;
      const prec = BIN[t.v];
      if (prec < min) break;
      i++;
      // ^ is right-associative; the rest are left.
      const right = expr(t.v === "^" ? prec : prec + 1);
      left = { k: "bin", op: t.v, l: left, r: right };
    }
    return left;
  }
  function unary(): Expr {
    if (isOp("-")) {
      i++;
      return { k: "neg", x: unary() };
    }
    if (isOp("+")) {
      i++;
      return unary();
    }
    return postfix(primary());
  }
  function postfix(x: Expr): Expr {
    while (isOp("%")) {
      i++;
      x = { k: "pct", x };
    }
    return x;
  }
  function primary(): Expr {
    const t = peek();
    if (!t) throw new FormulaSyntax("the formula ends too early", body.length);
    i++;
    switch (t.t) {
      case "num":
        return { k: "num", v: t.v };
      case "str":
        return { k: "str", v: t.v };
      case "field":
        return { k: "field", name: t.v };
      case "referr":
        return { k: "referr" };
      case "cols":
        return { k: "cols", c1: Math.min(t.c1, t.c2), c2: Math.max(t.c1, t.c2) };
      case "ref": {
        if (isOp(":")) {
          i++;
          const b = peek();
          if (!b || b.t !== "ref") throw new FormulaSyntax("a range needs a cell after the colon, e.g. B2:B9", b?.at ?? body.length);
          i++;
          return { k: "range", c1: Math.min(t.col, b.col), r1: Math.min(t.row, b.row), c2: Math.max(t.col, b.col), r2: Math.max(t.row, b.row) };
        }
        return { k: "ref", col: t.col, row: t.row, text: body.slice(t.at, t.end) };
      }
      case "name": {
        if (isOp("(")) {
          i++;
          const args: Expr[] = [];
          if (!isOp(")")) {
            for (;;) {
              args.push(expr(1));
              if (isOp(",") || isOp(";")) {
                i++;
                continue;
              }
              break;
            }
          }
          expect(")");
          return { k: "call", name: t.v.toUpperCase(), args };
        }
        const up = t.v.toUpperCase();
        if (up === "TRUE" || up === "FALSE") return { k: "bool", v: up === "TRUE" };
        return { k: "field", name: t.v };
      }
      case "op":
        if (t.v === "(") {
          const x = expr(1);
          expect(")");
          return x;
        }
        throw new FormulaSyntax(`unexpected "${t.v}"`, t.at);
    }
  }
  const out = expr(1);
  if (i < toks.length) throw new FormulaSyntax(`unexpected "${body.slice(toks[i].at, toks[i].end)}"`, toks[i].at);
  return out;
}

// ---------- the sheet ----------

export interface SheetColumn {
  key: string;
  label: string;
  format?: unknown;
  /** A per-row formula: every cell in the column is computed and read-only. */
  formula?: string;
  width?: number;
  align?: "left" | "right" | "center";
}

/** Raw cell contents: numbers, text, booleans, empty, or "=formula" text. */
export type Raw = string | number | boolean | null;

export interface SheetData {
  columns: SheetColumn[];
  cells: Raw[][];
}

export const MAX_ROWS = 2000;
export const MAX_COLS = 52;

/** Reads every shape a Sheet takes: list of lists (first row is the header), list of objects, {columns, rows} or CSV text. */
export function normalizeSheet(input: unknown, columns?: unknown): { data: SheetData; problems: string[] } {
  const problems: string[] = [];
  let list: unknown[] = [];
  if (typeof input === "string") {
    const nl = input.indexOf("\n");
    const first = nl < 0 ? input : input.slice(0, nl);
    const sep = first.includes("\t") && !first.includes(",") ? "\t" : ",";
    const header = splitLine(first, sep);
    list = [header, ...delimited(input, sep).map((r) => header.map((h) => (r as Record<string, unknown>)[h]))];
  } else if (Array.isArray(input)) list = input;
  else if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.rows) && Array.isArray(o.columns)) list = [o.columns.map((c) => (c && typeof c === "object" ? toText((c as Record<string, unknown>).name ?? (c as Record<string, unknown>).key) : toText(c))), ...o.rows];
    else if (Array.isArray(o.rows)) list = o.rows;
    else problems.push("rows takes a list of lists, a list of objects or CSV text");
  } else if (input != null) problems.push("rows takes a list of lists, a list of objects or CSV text");

  const specs = Array.isArray(columns) ? columns : null;
  let keys: string[] = [];
  let body: Raw[][] = [];
  if (list.length && Array.isArray(list[0])) {
    const header = (list[0] as unknown[]).map((h) => toText(h));
    keys = header;
    body = list.slice(1).map((r) => (Array.isArray(r) ? r.map(raw) : [raw(r)]));
  } else if (list.length) {
    const seen: string[] = [];
    for (const r of list.slice(0, 200)) if (r && typeof r === "object" && !Array.isArray(r)) for (const k of Object.keys(r)) if (!seen.includes(k)) seen.push(k);
    keys = seen;
    body = list.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? keys.map((k) => raw((r as Record<string, unknown>)[k])) : [raw(r)]));
    if (!keys.length) keys = ["value"];
  }

  let cols: SheetColumn[];
  if (specs) {
    cols = specs.map((c) => {
      const o = typeof c === "string" ? { key: c } : ((c ?? {}) as Record<string, unknown>);
      const key = toText(o.key ?? o.label ?? "");
      const align = o.align === "left" || o.align === "right" || o.align === "center" ? o.align : undefined;
      return { key, label: o.label != null ? toText(o.label) : key, format: o.format ?? undefined, formula: typeof o.formula === "string" && o.formula.trim() ? o.formula : undefined, width: typeof o.width === "number" ? o.width : undefined, align };
    });
    // Columns named in rows but not in columns keep their place at the end.
    const named = new Set(cols.map((c) => c.key));
    const pos = new Map(keys.map((k, n) => [k, n]));
    for (const k of keys) if (!named.has(k)) cols.push({ key: k, label: k });
    body = body.map((r) => cols.map((c) => (pos.has(c.key) ? (r[pos.get(c.key)!] ?? null) : null)));
  } else {
    cols = keys.map((k) => ({ key: k, label: k }));
    body = body.map((r) => keys.map((_, n) => r[n] ?? null));
  }
  if (cols.length > MAX_COLS) {
    problems.push(`shows the first ${MAX_COLS} of ${cols.length} columns`);
    cols = cols.slice(0, MAX_COLS);
    body = body.map((r) => r.slice(0, MAX_COLS));
  }
  if (body.length > MAX_ROWS) {
    problems.push(`shows the first ${MAX_ROWS} of ${body.length} rows; DataGrid explores more`);
    body = body.slice(0, MAX_ROWS);
  }
  for (const c of cols) {
    if (!c.formula) continue;
    try {
      parseFormula(c.formula);
    } catch (e) {
      problems.push(`column ${c.key} formula: ${(e as Error).message}`);
    }
  }
  return { data: { columns: cols, cells: body }, problems };
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let k = 0; k < line.length; k++) {
    const ch = line[k];
    if (q) {
      if (ch === '"' && line[k + 1] === '"') (cur += '"'), k++;
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) out.push(cur.trim()), (cur = "");
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function raw(v: unknown): Raw {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean" || typeof v === "string") return v;
  return toText(v);
}

/** What a person typed, as a cell's contents: numbers become numbers ("1,200", "12%", "$5"), "=..." stays a formula. */
export function readInput(text: string): Raw {
  const t = text.trim();
  if (t === "") return null;
  if (t.startsWith("=")) return t;
  // Long text is never a number; skipping the patterns keeps them linear.
  if (t.length > 64) return text;
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === "true";
  const pct = /^([-+]?[\d,]*\.?\d+)\s*%$/.exec(t);
  if (pct && !Number.isNaN(Number(pct[1].replace(/,/g, "")))) return Number(pct[1].replace(/,/g, "")) / 100;
  const money = t.replace(/^([-+]?)[$€£]/, "$1").replace(/,(?=\d{3}(\D|$))/g, "");
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(money)) return Number(money);
  return text;
}

/** A cell's contents as the person edits them. */
export function rawText(v: Raw): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

export const isFormula = (v: Raw): v is string => typeof v === "string" && v.trim().startsWith("=") && v.trim().length > 1;

// ---------- evaluation ----------

const BUDGET = 5_000_000;

/** Evaluates every cell. Formulas see other cells' values, never raw text. */
export function computeSheet(data: SheetData): CellValue[][] {
  const { columns, cells } = data;
  const rows = cells.length;
  const cols = columns.length;
  const memo: (CellValue | undefined)[][] = cells.map(() => new Array(cols).fill(undefined));
  const busy = new Set<number>();
  const parsed = new Map<string, Expr | FormulaSyntax>();
  const fieldIndex = new Map<string, number>();
  columns.forEach((c, k) => {
    for (const name of [c.key, c.label]) {
      const low = name.toLowerCase();
      if (name && !fieldIndex.has(low)) fieldIndex.set(low, k);
    }
  });
  let steps = 0;

  // A cell's own formula wins over its column's, so a totals row can sit under a computed column.
  const formulaOf = (r: number, c: number): string | null => {
    const v = cells[r][c];
    return isFormula(v) ? v : (columns[c].formula ?? null);
  };

  const parse = (src: string): Expr | FormulaSyntax => {
    let p = parsed.get(src);
    if (!p) {
      try {
        p = parseFormula(src);
      } catch (e) {
        p = e instanceof FormulaSyntax ? e : new FormulaSyntax(String(e), 0);
      }
      parsed.set(src, p);
    }
    return p;
  };

  function cell(r: number, c: number): CellValue {
    if (r < 0 || c < 0 || c >= cols || r >= rows) return null;
    const m = memo[r][c];
    if (m !== undefined) return m;
    const f = formulaOf(r, c);
    if (!f) {
      const v = cells[r][c];
      const out: CellValue = typeof v === "string" ? v : (v ?? null);
      memo[r][c] = out;
      return out;
    }
    const id = r * cols + c;
    if (busy.has(id)) return err("#CYCLE!", `${address(r, c)} depends on itself`);
    busy.add(id);
    let out: CellValue;
    const p = parse(f);
    if (p instanceof FormulaSyntax) out = err("#ERROR!", p.message);
    else {
      try {
        out = scalar(ev(p, r));
      } catch (e) {
        // Nothing a formula does may break the sheet: any other failure is that cell's error.
        out = e instanceof Budget ? err("#NUM!", "the formulas take too long to compute") : err("#ERROR!", e instanceof Error ? e.message : String(e));
      }
    }
    busy.delete(id);
    // A cycle is only final once the cell that started it finishes.
    memo[r][c] = out;
    return out;
  }

  type V = CellValue | CellValue[];

  function ref(col: number, sheetRow: number): CellValue {
    if (sheetRow === 1) return col < cols ? columns[col].label : null;
    if (col >= cols || sheetRow - 2 >= rows) return null;
    return cell(sheetRow - 2, col);
  }

  function ev(e: Expr, row: number): V {
    if (++steps > BUDGET) throw new Budget();
    switch (e.k) {
      case "num":
        return e.v;
      case "str":
        return e.v;
      case "bool":
        return e.v;
      case "ref": {
        // A column key shaped like a cell (qty2) reads as the column when no such cell exists.
        const k = e.col >= cols ? fieldIndex.get(e.text.toLowerCase()) : undefined;
        return k !== undefined ? cell(row, k) : ref(e.col, e.row);
      }
      case "referr":
        return err("#REF!", "refers to a row that was removed");
      case "range": {
        const out: CellValue[] = [];
        steps += (e.r2 - e.r1 + 1) * (e.c2 - e.c1 + 1);
        if (steps > BUDGET) throw new Budget();
        for (let rr = e.r1; rr <= Math.min(e.r2, rows + 1); rr++) for (let cc = e.c1; cc <= Math.min(e.c2, cols - 1); cc++) out.push(ref(cc, rr));
        return out;
      }
      case "cols": {
        const out: CellValue[] = [];
        steps += rows * Math.max(0, Math.min(e.c2, cols - 1) - e.c1 + 1);
        if (steps > BUDGET) throw new Budget();
        for (let rr = 0; rr < rows; rr++) for (let cc = e.c1; cc <= Math.min(e.c2, cols - 1); cc++) out.push(cell(rr, cc));
        return out;
      }
      case "field": {
        const k = fieldIndex.get(e.name.toLowerCase());
        if (k === undefined) return err("#NAME?", `no column named ${e.name}`);
        return cell(row, k);
      }
      case "neg": {
        const n = toNum(scalar(ev(e.x, row)));
        return isCellError(n) ? n : -n;
      }
      case "pct": {
        const n = toNum(scalar(ev(e.x, row)));
        return isCellError(n) ? n : n / 100;
      }
      case "bin":
        return binary(e.op, scalar(ev(e.l, row)), scalar(ev(e.r, row)));
      case "call":
        return call(e.name, e.args, row);
    }
  }

  function call(name: string, args: Expr[], row: number): V {
    const fn = FUNCTIONS[name] ?? FUNCTIONS[ALIASES[name] ?? ""];
    if (!fn) return err("#NAME?", `${name} is not a function here; try SUM, AVG, MIN, MAX, IF, ROUND`);
    if (args.length < fn.min || (fn.max !== undefined && args.length > fn.max)) return err("#VALUE!", `${name} takes ${fn.max === fn.min ? fn.min : fn.max === undefined ? `${fn.min} or more` : `${fn.min} to ${fn.max}`} arguments`);
    if (fn.lazy) return fn.lazy(args.map((a) => () => ev(a, row)));
    const vals = args.map((a) => ev(a, row));
    return fn.run!(vals);
  }

  const values = cells.map((_, r) => columns.map((__, c) => cell(r, c)));
  return values;
}

class Budget extends Error {}

function scalar(v: CellValue | CellValue[]): CellValue {
  if (!Array.isArray(v)) return v;
  return v.length === 1 ? v[0] : err("#VALUE!", "a range where one value goes; wrap it in SUM, AVG, MIN or MAX");
}

function toNum(v: CellValue): number | CellError {
  if (isCellError(v)) return v;
  if (v == null || v === "") return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = readInput(v);
  return typeof n === "number" ? n : err("#VALUE!", `"${v}" is not a number`);
}

function toStr(v: CellValue): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return String(Math.round(v * 1e10) / 1e10);
  return isCellError(v) ? v.$error : v;
}

function truthy(v: CellValue): boolean | CellError {
  if (isCellError(v)) return v;
  if (typeof v === "string") {
    if (/^true$/i.test(v)) return true;
    if (/^false$/i.test(v) || v === "") return false;
    const n = toNum(v);
    return isCellError(n) ? err("#VALUE!", `"${v}" is not true or false`) : n !== 0;
  }
  return Boolean(v);
}

function compareCells(a: CellValue, b: CellValue): number {
  const an = typeof a === "number" || typeof a === "boolean" || a == null ? toNum(a) : null;
  const bn = typeof b === "number" || typeof b === "boolean" || b == null ? toNum(b) : null;
  if (typeof an === "number" && typeof bn === "number") return an - bn;
  const as = toStr(a).toLowerCase();
  const bs = toStr(b).toLowerCase();
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function binary(op: string, l: CellValue, r: CellValue): CellValue {
  if (isCellError(l)) return l;
  if (isCellError(r)) return r;
  switch (op) {
    case "&":
      return toStr(l) + toStr(r);
    case "=":
    case "==":
      return compareCells(l, r) === 0;
    case "<>":
    case "!=":
      return compareCells(l, r) !== 0;
    case "<":
      return compareCells(l, r) < 0;
    case ">":
      return compareCells(l, r) > 0;
    case "<=":
      return compareCells(l, r) <= 0;
    case ">=":
      return compareCells(l, r) >= 0;
  }
  const a = toNum(l);
  if (isCellError(a)) return a;
  const b = toNum(r);
  if (isCellError(b)) return b;
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      return b === 0 ? err("#DIV/0!", "divides by zero") : a / b;
    case "^": {
      const p = a ** b;
      return Number.isFinite(p) ? p : err("#NUM!", "the result is too large");
    }
  }
  return err("#ERROR!", `unknown operator ${op}`);
}

// ---------- functions ----------

type Arg = CellValue | CellValue[];

interface Fn {
  min: number;
  max?: number;
  run?: (args: Arg[]) => Arg;
  lazy?: (args: (() => Arg)[]) => Arg;
}

/** Numbers from the arguments: ranges skip text and blanks; direct arguments must read as numbers. */
function numbers(args: Arg[]): number[] | CellError {
  const out: number[] = [];
  for (const a of args) {
    if (Array.isArray(a)) {
      for (const v of a) {
        if (isCellError(v)) return v;
        if (typeof v === "number") out.push(v);
      }
    } else {
      if (a == null) continue;
      const n = toNum(a);
      if (isCellError(n)) return n;
      out.push(n);
    }
  }
  return out;
}

const agg = (f: (ns: number[]) => CellValue): Fn => ({
  min: 1,
  run: (args) => {
    const ns = numbers(args);
    return isCellError(ns) ? ns : f(ns);
  },
});

const num1 = (f: (n: number, d: number) => CellValue, max = 1): Fn => ({
  min: 1,
  max,
  run: (args) => {
    const a = toNum(scalar(args[0]));
    if (isCellError(a)) return a;
    const d = args.length > 1 ? toNum(scalar(args[1])) : 0;
    if (isCellError(d)) return d;
    const out = f(a, d);
    return typeof out === "number" && !Number.isFinite(out) ? err("#NUM!", "the result is not a finite number") : out;
  },
});

const str1 = (f: (s: string, n: number) => CellValue, max = 1): Fn => ({
  min: 1,
  max,
  run: (args) => {
    const s = scalar(args[0]);
    if (isCellError(s)) return s;
    const n = args.length > 1 ? toNum(scalar(args[1])) : 1;
    if (isCellError(n)) return n;
    return f(toStr(s), n);
  },
});

function roundTo(n: number, d: number, mode: "round" | "up" | "down"): number {
  const f = 10 ** Math.trunc(d);
  const x = n * f;
  // Nudge by a relative epsilon so 1.005 rounds the way a person expects.
  const eps = Math.abs(x) * Number.EPSILON * 4;
  const r = mode === "round" ? Math.sign(x) * Math.round(Math.abs(x) + eps) : mode === "up" ? Math.sign(x) * Math.ceil(Math.abs(x) - eps) : Math.sign(x) * Math.floor(Math.abs(x) + eps);
  return r / f;
}

/** "&gt;100", "=done", "&lt;&gt;x" or a plain value, as in SUMIF. */
function criterion(c: CellValue): (v: CellValue) => boolean {
  if (typeof c !== "string") return (v) => compareCells(v, c) === 0 && v != null;
  const m = /^(<=|>=|<>|=|<|>)?([\s\S]*)$/.exec(c)!;
  const op = m[1] ?? "=";
  const target = readInput(m[2]) ?? "";
  return (v) => {
    if (v == null && op !== "<>") return false;
    const cmp = compareCells(v, target);
    return op === "=" ? cmp === 0 : op === "<>" ? cmp !== 0 : op === "<" ? cmp < 0 : op === ">" ? cmp > 0 : op === "<=" ? cmp <= 0 : cmp >= 0;
  };
}

const list = (a: Arg): CellValue[] => (Array.isArray(a) ? a : [a]);

export const FUNCTIONS: Record<string, Fn> = {
  SUM: agg((ns) => ns.reduce((a, b) => a + b, 0)),
  AVERAGE: agg((ns) => (ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : err("#DIV/0!", "no numbers to average"))),
  MIN: agg((ns) => (ns.length ? Math.min(...ns) : 0)),
  MAX: agg((ns) => (ns.length ? Math.max(...ns) : 0)),
  MEDIAN: agg((ns) => {
    if (!ns.length) return err("#NUM!", "no numbers");
    const s = [...ns].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }),
  PRODUCT: agg((ns) => ns.reduce((a, b) => a * b, 1)),
  COUNT: { min: 1, run: (args) => args.flatMap(list).filter((v) => typeof v === "number").length },
  COUNTA: { min: 1, run: (args) => args.flatMap(list).filter((v) => v != null && v !== "").length },
  ROUND: num1((n, d) => roundTo(n, d, "round"), 2),
  ROUNDUP: num1((n, d) => roundTo(n, d, "up"), 2),
  ROUNDDOWN: num1((n, d) => roundTo(n, d, "down"), 2),
  INT: num1((n) => Math.floor(n)),
  ABS: num1((n) => Math.abs(n)),
  SQRT: num1((n) => (n < 0 ? err("#NUM!", "square root of a negative number") : Math.sqrt(n))),
  POWER: num1((n, d) => n ** d, 2),
  MOD: num1((n, d) => (d === 0 ? err("#DIV/0!", "MOD by zero") : n - d * Math.floor(n / d)), 2),
  FLOOR: num1((n, d) => (d ? Math.floor(n / d) * d : Math.floor(n)), 2),
  CEILING: num1((n, d) => (d ? Math.ceil(n / d) * d : Math.ceil(n)), 2),
  IF: {
    min: 2,
    max: 3,
    lazy: ([c, a, b]) => {
      const t = truthy(scalar(c()));
      if (isCellError(t)) return t;
      return t ? a() : b ? b() : false;
    },
  },
  IFERROR: {
    min: 2,
    max: 2,
    lazy: ([x, alt]) => {
      const v = x();
      return isCellError(scalar(v)) ? alt() : v;
    },
  },
  AND: {
    min: 1,
    run: (args) => {
      for (const v of args.flatMap(list)) {
        const t = truthy(v);
        if (isCellError(t)) return t;
        if (!t) return false;
      }
      return true;
    },
  },
  OR: {
    min: 1,
    run: (args) => {
      for (const v of args.flatMap(list)) {
        const t = truthy(v);
        if (isCellError(t)) return t;
        if (t) return true;
      }
      return false;
    },
  },
  NOT: {
    min: 1,
    max: 1,
    run: ([a]) => {
      const t = truthy(scalar(a));
      return isCellError(t) ? t : !t;
    },
  },
  CONCAT: {
    min: 1,
    run: (args) => {
      let s = "";
      for (const v of args.flatMap(list)) {
        if (isCellError(v)) return v;
        s += toStr(v);
      }
      return s;
    },
  },
  LEN: str1((s) => s.length),
  UPPER: str1((s) => s.toUpperCase()),
  LOWER: str1((s) => s.toLowerCase()),
  TRIM: str1((s) => s.trim().replace(/\s+/g, " ")),
  LEFT: str1((s, n) => s.slice(0, Math.max(0, n)), 2),
  RIGHT: str1((s, n) => (n <= 0 ? "" : s.slice(-n)), 2),
  SUMIF: {
    min: 2,
    max: 3,
    run: ([range, crit, sumRange]) => {
      const c = scalar(crit);
      if (isCellError(c)) return c;
      const test = criterion(c);
      const keys = list(range);
      const vals = sumRange === undefined ? keys : list(sumRange);
      let total = 0;
      for (let k = 0; k < keys.length; k++) {
        if (!test(keys[k])) continue;
        const v = vals[k];
        if (isCellError(v)) return v;
        if (typeof v === "number") total += v;
      }
      return total;
    },
  },
  COUNTIF: {
    min: 2,
    max: 2,
    run: ([range, crit]) => {
      const c = scalar(crit);
      if (isCellError(c)) return c;
      const test = criterion(c);
      return list(range).filter((v) => test(v)).length;
    },
  },
  PI: { min: 0, max: 0, run: () => Math.PI },
};

const ALIASES: Record<string, string> = { AVG: "AVERAGE", MEAN: "AVERAGE", CONCATENATE: "CONCAT", CEIL: "CEILING", POW: "POWER", TOTAL: "SUM" };

// ---------- edits that move rows ----------

/**
 * Rewrites a formula's row numbers after rows were inserted (delta > 0) or
 * removed (delta < 0) at data row `at`, as a spreadsheet does: references
 * below move with their cells, ranges grow or shrink, and a reference to a
 * removed cell becomes #REF!. With ownRow (the formula's data row after the
 * move), a range that ends right above inserted rows grows to take them when
 * the formula sits below them, so a totals row keeps adding everything.
 * With columns, a column key shaped like a cell (q1) is left alone.
 */
export function shiftFormula(src: string, at: number, delta: number, ownRow?: number, columns?: SheetColumn[]): string {
  if (!isFormula(src)) return src;
  const lead = src.indexOf("=") + 1;
  const body = src.slice(lead);
  let toks: Tok[];
  try {
    toks = tokenize(body);
  } catch {
    return src;
  }
  const sheetAt = at + 2;
  const removedEnd = sheetAt - delta; // exclusive, when delta < 0
  const move = (row: number): number | null => {
    if (row < sheetAt) return row;
    if (delta > 0) return row + delta;
    if (row < removedEnd) return null;
    return row + delta;
  };
  // Column keys shaped like cells (q1) read as columns, as computeSheet reads them, and never move.
  const names = new Set((columns ?? []).flatMap((c) => [c.key.toLowerCase(), c.label.toLowerCase()]));
  const isName = (t: Extract<Tok, { t: "ref" }>) => columns !== undefined && t.col >= columns.length && names.has(body.slice(t.at, t.end).toLowerCase());
  let out = "";
  let pos = 0;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== "ref" || isName(t)) continue;
    const next = toks[k + 1];
    const b = next?.t === "op" && next.v === ":" && toks[k + 2]?.t === "ref" ? (toks[k + 2] as Extract<Tok, { t: "ref" }>) : null;
    if (b) {
      const lo = Math.min(t.row, b.row);
      const hi = Math.max(t.row, b.row);
      let nlo: number | null;
      let nhi: number | null;
      if (delta > 0) {
        nlo = move(lo);
        nhi = move(hi);
        if (ownRow !== undefined && hi === sheetAt - 1 && lo < hi && ownRow + 2 >= sheetAt + delta) nhi = hi + delta;
      } else {
        // Shrink: rows removed inside the range leave it; a range entirely removed is #REF!.
        nlo = lo >= sheetAt && lo < removedEnd ? sheetAt : move(lo);
        nhi = hi >= sheetAt && hi < removedEnd ? sheetAt - 1 : move(hi);
        if (nlo !== null && nhi !== null && nhi < nlo) nlo = nhi = null;
      }
      const text = nlo === null || nhi === null ? "#REF!" : `${rewriteRow(body.slice(t.at, t.end), nlo)}:${rewriteRow(body.slice(b.at, b.end), nhi)}`;
      out += body.slice(pos, t.at) + text;
      pos = b.end;
      k += 2;
      continue;
    }
    const n = move(t.row);
    out += body.slice(pos, t.at) + (n === null ? "#REF!" : rewriteRow(body.slice(t.at, t.end), n));
    pos = t.end;
  }
  return src.slice(0, lead) + out + body.slice(pos);
}

function rewriteRow(ref: string, row: number): string {
  return ref.replace(/\d+$/, String(row));
}

// ---------- output ----------

/** The table as objects keyed by column, with computed values; errors read as their code. */
export function sheetRows(data: SheetData, values: CellValue[][]): Record<string, unknown>[] {
  return values.map((r) => Object.fromEntries(data.columns.map((c, k) => [c.key, out(r[k])])));
}

const out = (v: CellValue) => (isCellError(v) ? v.$error : typeof v === "number" ? Math.round(v * 1e10) / 1e10 : v);

export function sheetCsv(data: SheetData, values: CellValue[][]): string {
  const cell = (v: unknown) => {
    const t = v == null ? "" : toText(v);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [data.columns.map((c) => c.label), ...values.map((r) => r.map(out))].map((r) => r.map(cell).join(",")).join("\n");
}

/** Parses pasted text (tabs from a spreadsheet, or CSV) into a block of cells. */
export function parsePaste(text: string): Raw[][] {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.length > 1 && lines.every((l) => l.includes(",")) ? "," : null;
  return lines.map((l) => (sep ? (sep === "," ? splitLine(l, ",") : l.split("\t")) : [l]).map((c) => readInput(c)));
}
