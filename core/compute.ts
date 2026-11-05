// Compute cells: a notebook-like stack of named expressions. Each cell is
// parsed by Iris's own parser and run by the card's interpreter (never eval),
// in a scope that holds every earlier cell's value, so later cells read
// earlier ones by name. A failing cell fails alone; cells that read it say so.

import type { Expr } from "./ast";
import { type CellResult, type CellSpec, normalizeCells } from "./cells";
import { type Interpreter, IrisError, Scope, isElementValue, isFnValue, isPendingValue } from "./evaluate";
import { parseExpression } from "./parse";

export * from "./cells";

/** Parse problems in cell expressions, for check(). */
export function cellProblems(v: unknown): string[] {
  const { cells, problems } = normalizeCells(v);
  cells.forEach((c, k) => {
    if (!c.expr.trim()) return problems.push(`cell ${k + 1}${c.name ? ` (${c.name})` : ""} is empty`);
    try {
      parseExpression(c.expr);
    } catch (e) {
      problems.push(`cell ${k + 1}${c.name ? ` (${c.name})` : ""}: ${e instanceof Error ? e.message : String(e)}`);
    }
  });
  return problems;
}

const parsed = new Map<string, Expr | Error>();
function compileCell(expr: string): Expr {
  let e = parsed.get(expr);
  if (!e) {
    try {
      e = parseExpression(expr);
    } catch (cause) {
      e = cause instanceof Error ? cause : new Error(String(cause));
    }
    if (parsed.size > 500) parsed.clear();
    parsed.set(expr, e);
  }
  if (e instanceof Error) throw new IrisError(`can't read this: ${e.message.replace(/ at \d+$/, "")}`);
  return e;
}

/**
 * Runs cells top to bottom. Each sees the card's globals, states and lets,
 * plus the cells above it. A cell that reads a failed cell reports that cell,
 * not a confusing "not defined".
 */
export function runCells(cells: CellSpec[], interp: Interpreter, globals: Scope, bound?: string): CellResult[] {
  const scope = new Scope(globals);
  // A cell that reads the state its own values are written to would chase itself.
  const reads = bound ? new RegExp(`(^|[^.\\w$])${bound.replace(/\$/g, "\\$")}(?![\\w$])`) : null;
  const failed = new Set<string>();
  const out: CellResult[] = [];
  const later = new Set(cells.map((c) => c.name).filter(Boolean));
  for (const cell of cells) {
    if (cell.name) later.delete(cell.name);
    let value: unknown;
    let error: string | null = null;
    if (!cell.expr.trim()) error = "empty cell";
    else if (reads?.test(cell.expr.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""'))) error = `reads ${bound}, which these cells write; use the cell names directly`;
    else
      try {
        const expr = compileCell(cell.expr);
        interp.steps = 0;
        value = interp.eval(expr, scope);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const missing = /^(\S+) is not defined/.exec(message)?.[1];
        error = missing && failed.has(missing) ? `${missing} has an error` : missing && later.has(missing) ? `${missing} is defined in a later cell; move this cell below it` : message;
      }
    const pending = !error && containsPending(value);
    if (cell.name) {
      if (error) failed.add(cell.name);
      else scope.vars.set(cell.name, value);
    }
    out.push({ name: cell.name, value, error, pending });
  }
  return out;
}

function containsPending(v: unknown, depth = 0): boolean {
  if (isPendingValue(v)) return true;
  if (depth > 2 || !v || typeof v !== "object" || isElementValue(v) || isFnValue(v)) return false;
  return (Array.isArray(v) ? v : Object.values(v)).some((x) => containsPending(x, depth + 1));
}

