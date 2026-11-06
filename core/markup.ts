// MarkUp's marks: boxes, arrows and pins the person draws on an image, each with a note.
// Coordinates are in the image's own pixels, so an agent can find the spot in the file it sent.

export type MarkKind = "box" | "arrow" | "pin";

export interface Mark {
  n: number;
  kind: MarkKind;
  x: number;
  y: number;
  /** box: size. */
  w?: number;
  h?: number;
  /** arrow: where it points. */
  x2?: number;
  y2?: number;
  note: string;
}

export const MAX_MARKS = 30;
export const MARK_KINDS: readonly MarkKind[] = ["box", "arrow", "pin"];

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const round = (v: number) => Math.round(v);

/** Marks read back from state: anything malformed is dropped, numbers are rounded to whole pixels. */
export function normalizeMarks(v: unknown): Mark[] {
  const out: Mark[] = [];
  for (const item of Array.isArray(v) ? v : []) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const kind = MARK_KINDS.includes(o.kind as MarkKind) ? (o.kind as MarkKind) : "pin";
    const x = num(o.x);
    const y = num(o.y);
    if (x == null || y == null) continue;
    // A number that is missing, not a positive whole number, or already used gets the next free one.
    const given = num(o.n);
    const n = given != null && Number.isInteger(given) && given > 0 && !out.some((x) => x.n === given) ? given : nextMarkNumber(out);
    const m: Mark = { n, kind, x: round(x), y: round(y), note: typeof o.note === "string" ? o.note : "" };
    if (kind === "box") {
      const w = num(o.w);
      const h = num(o.h);
      if (w == null || h == null) continue;
      m.w = round(w);
      m.h = round(h);
    }
    if (kind === "arrow") {
      const x2 = num(o.x2);
      const y2 = num(o.y2);
      if (x2 == null || y2 == null) continue;
      m.x2 = round(x2);
      m.y2 = round(y2);
    }
    out.push(m);
    if (out.length >= MAX_MARKS) break;
  }
  return out;
}

/** A drag from (ax, ay) to (bx, by) as a mark of this kind; a box is normalized to a positive size. */
export function markFromDrag(kind: MarkKind, ax: number, ay: number, bx: number, by: number, n: number): Mark {
  if (kind === "box") return { n, kind, x: round(Math.min(ax, bx)), y: round(Math.min(ay, by)), w: round(Math.abs(bx - ax)), h: round(Math.abs(by - ay)), note: "" };
  if (kind === "arrow") return { n, kind, x: round(ax), y: round(ay), x2: round(bx), y2: round(by), note: "" };
  return { n, kind, x: round(bx), y: round(by), note: "" };
}

/** Where a mark's number sits: a box's top-left corner, an arrow's tail, a pin's point. */
export function markAnchor(m: Mark): { x: number; y: number } {
  return { x: m.x, y: m.y };
}

/** The next number: one past the highest, so numbers stay stable when an earlier mark is deleted. */
export function nextMarkNumber(marks: Mark[]): number {
  return marks.reduce((hi, m) => Math.max(hi, m.n), 0) + 1;
}

/** A mark moved by (dx, dy), stopped at the image's edges so every point stays on it. */
export function moveMark(m: Mark, dx: number, dy: number, w: number, h: number): Mark {
  const xs = [m.x, m.kind === "box" ? m.x + (m.w ?? 0) : m.kind === "arrow" ? (m.x2 ?? m.x) : m.x];
  const ys = [m.y, m.kind === "box" ? m.y + (m.h ?? 0) : m.kind === "arrow" ? (m.y2 ?? m.y) : m.y];
  const cdx = Math.max(-Math.min(...xs), Math.min(w - Math.max(...xs), dx));
  const cdy = Math.max(-Math.min(...ys), Math.min(h - Math.max(...ys), dy));
  const out: Mark = { ...m, x: round(m.x + cdx), y: round(m.y + cdy) };
  if (m.kind === "arrow" && m.x2 != null && m.y2 != null) {
    out.x2 = round(m.x2 + cdx);
    out.y2 = round(m.y2 + cdy);
  }
  return out;
}
