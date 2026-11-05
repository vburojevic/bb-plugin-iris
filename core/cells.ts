// Compute cells, the parts without the parser: reading cell lists, names and
// the values bind hands out. The "tools" chunk imports these; running cells
// (core/compute.ts) needs the parser and lives in the main bundle.

import { isElementValue, isFnValue } from "./evaluate";

export interface CellSpec {
  /** Empty for an unnamed cell (its value shows but nothing can read it). */
  name: string;
  expr: string;
  label?: string;
  format?: string;
  note?: string;
}

export interface CellResult {
  name: string;
  value: unknown;
  error: string | null;
  /** The value is still loading (a load() in flight). */
  pending: boolean;
}

const NAME = /^[A-Za-z_$][\w$]*$/;
const RESERVED = new Set(["true", "false", "null", "undefined", "if", "else", "return", "const", "let", "var", "function", "new", "this", "typeof", "in", "of"]);
const BLOCKED = new Set(["__proto__", "prototype", "constructor", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

/** Cells from {name, expr} objects, "name = expr" strings or bare expressions. */
export function normalizeCells(v: unknown): { cells: CellSpec[]; problems: string[] } {
  const problems: string[] = [];
  if (!Array.isArray(v)) return { cells: [], problems: ["cells needs a list of {name, expr}"] };
  const cells: CellSpec[] = [];
  const seen = new Set<string>();
  v.forEach((item, k) => {
    let cell: CellSpec | null = null;
    if (typeof item === "string") cell = splitCell(item);
    else if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      const expr = o.expr ?? o.value ?? o.code;
      if (typeof expr === "number" || typeof expr === "boolean") cell = { name: String(o.name ?? ""), expr: String(expr) };
      else if (typeof expr === "string") cell = { name: typeof o.name === "string" ? o.name.trim() : "", expr };
      if (cell) {
        if (typeof o.label === "string") cell.label = o.label;
        if (typeof o.format === "string") cell.format = o.format;
        if (typeof o.note === "string") cell.note = o.note;
      }
    }
    if (!cell) {
      problems.push(`cell ${k + 1} needs an expr (a string), e.g. { name: "total", expr: "price * seats" }`);
      return;
    }
    const issue = nameIssue(cell.name);
    if (issue) problems.push(`cell ${k + 1}: ${issue}`);
    else if (cell.name && seen.has(cell.name)) problems.push(`cell ${k + 1}: the name ${cell.name} is used twice`);
    if (cell.name) seen.add(cell.name);
    cells.push(cell);
  });
  return { cells, problems };
}

export function nameIssue(name: string): string | null {
  if (!name) return null;
  if (!NAME.test(name)) return `"${name}" is not a name (letters, digits and _, not starting with a digit)`;
  if (RESERVED.has(name) || BLOCKED.has(name)) return `"${name}" is a reserved word`;
  return null;
}

/** "total = price * seats" splits into a name and an expression; "a == b" stays whole. */
export function splitCell(text: string): CellSpec {
  const m = /^\s*([A-Za-z_$][\w$]*)\s*=(?!=)\s*([\s\S]*)$/.exec(text);
  if (m && !RESERVED.has(m[1])) return { name: m[1], expr: m[2] };
  return { name: "", expr: text };
}

/**
 * The values other components read through bind: named cells that ran, as
 * plain data. Functions and components stay inside the cells: saved card state
 * is JSON, and a function's captured scope wouldn't survive a reload.
 */
export function cellValues(results: CellResult[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of results) if (r.name && !BLOCKED.has(r.name) && !r.error && !r.pending && !hasCode(r.value)) out[r.name] = r.value;
  return out;
}

/** A function or component anywhere inside (three levels deep is enough for cell values). */
function hasCode(v: unknown, depth = 0): boolean {
  if (isFnValue(v) || isElementValue(v)) return true;
  if (!v || typeof v !== "object" || depth > 3) return false;
  return (Array.isArray(v) ? v : Object.values(v)).some((x) => hasCode(x, depth + 1));
}

/** A stable fingerprint of plain values, to skip writing state that didn't change. */
export function fingerprint(v: unknown): string {
  try {
    return JSON.stringify(v, (_k, x) => (isFnValue(x) ? "[fn]" : isElementValue(x) ? "[element]" : x)) ?? "undefined";
  } catch {
    return String(Math.random());
  }
}
