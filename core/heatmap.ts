// Heatmap: a grid of rows by columns, each cell colored by its value.

export interface HeatGrid {
  rows: string[];
  columns: string[];
  /** values[row][col], null where there is no value. */
  values: (number | null)[][];
  min: number;
  max: number;
}

export const MAX_HEAT_ROWS = 60;
export const MAX_HEAT_COLUMNS = 60;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const name = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.slice(0, 80) : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

/**
 * The grid from either cells [{row, column, value}] or a matrix {rows, columns, values}. Rows and
 * columns keep first-seen order unless named; a repeated cell keeps its last value.
 */
export function heatGrid(data: unknown, rowOrder?: unknown, columnOrder?: unknown): HeatGrid {
  let rows: string[] = [];
  let columns: string[] = [];
  const cell = new Map<string, number>();
  const key = (r: string, c: string) => `${r}\u0000${c}`;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    rows = (Array.isArray(o.rows) ? o.rows : []).map(name).filter((x): x is string => x != null);
    columns = (Array.isArray(o.columns) ? o.columns : []).map(name).filter((x): x is string => x != null);
    const m = Array.isArray(o.values) ? o.values : [];
    rows.forEach((r, i) => columns.forEach((c, j) => {
      const v = num(Array.isArray(m[i]) ? (m[i] as unknown[])[j] : null);
      if (v != null) cell.set(key(r, c), v);
    }));
  } else {
    for (const item of Array.isArray(data) ? data : []) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const r = name(o.row ?? o.y);
      const c = name(o.column ?? o.col ?? o.x);
      const v = num(o.value ?? o.v);
      if (r == null || c == null) continue;
      if (!rows.includes(r)) rows.push(r);
      if (!columns.includes(c)) columns.push(c);
      if (v != null) cell.set(key(r, c), v);
    }
  }
  const ordered = (seen: string[], order: unknown) => {
    const named = [...new Set((Array.isArray(order) ? order : []).map(name).filter((x): x is string => x != null))];
    return named.length ? [...named, ...seen.filter((x) => !named.includes(x))] : seen;
  };
  rows = [...new Set(ordered(rows, rowOrder))].slice(0, MAX_HEAT_ROWS);
  columns = [...new Set(ordered(columns, columnOrder))].slice(0, MAX_HEAT_COLUMNS);
  const values = rows.map((r) => columns.map((c) => cell.get(key(r, c)) ?? null));
  const all = values.flat().filter((v): v is number => v != null);
  return { rows, columns, values, min: all.length ? Math.min(...all) : 0, max: all.length ? Math.max(...all) : 0 };
}

/** Where a value sits between lo and hi, 0 to 1; a flat range sits in the middle. */
export function heatPosition(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 0.5;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}
