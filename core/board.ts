// Whiteboard rules that need no browser: reading the items and arrows an agent
// wrote, laying out the ones it gave no position, which group each note sits
// in, the arrangement a picker answers with, and where an arrow meets a box.

export const BOARD_KINDS = ["note", "text", "group"] as const;
export type BoardKind = (typeof BOARD_KINDS)[number];
export type XY = [number, number];

export interface BoardItem {
  id: string;
  type: BoardKind;
  text: string;
  at: XY | null;
  size: XY | null;
  /** A theme color name or series number; null picks one. */
  color: string | number | null;
  /** The group a note starts in, when it has no position of its own. */
  in: string | null;
}

export interface BoardArrow {
  from: string;
  to: string;
  label: string | null;
  dashed: boolean;
}

export const NOTE_SIZE: XY = [168, 104];
export const TEXT_SIZE: XY = [240, 36];
const PAD = 16;
const HEAD = 40;
const GAP = 16;
const GROUP_GAP = 72;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function xy(v: unknown, x?: unknown, y?: unknown): XY | null {
  if (Array.isArray(v) && finite(v[0]) && finite(v[1])) return [v[0], v[1]];
  if (finite(x) && finite(y)) return [x, y];
  return null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

export function normalizeBoard(rawItems: unknown, rawArrows: unknown): { items: BoardItem[]; arrows: BoardArrow[]; problems: string[] } {
  const problems: string[] = [];
  const items: BoardItem[] = [];
  const ids = new Set<string>();
  (Array.isArray(rawItems) ? rawItems : []).forEach((raw, k) => {
    const r: Record<string, unknown> = isObj(raw) ? raw : { text: raw };
    const type = (typeof r.type === "string" ? r.type : "note") as BoardKind;
    if (!BOARD_KINDS.includes(type)) return problems.push(`Item ${k + 1}: type must be note, text or group`);
    const id = text(r.id) || `${type}-${k + 1}`;
    if (ids.has(id)) return problems.push(`Item ${k + 1}: id "${id}" is used twice`);
    ids.add(id);
    const size = xy(r.size, r.w, r.h);
    items.push({
      id,
      type,
      text: text(r.text ?? r.title ?? r.label),
      at: xy(r.at, r.x, r.y),
      size: size && size[0] > 0 && size[1] > 0 ? size : null,
      color: typeof r.color === "string" || finite(r.color) ? (r.color as string | number) : null,
      in: text(r.in ?? r.group) || null,
    });
  });
  if (rawItems !== undefined && !Array.isArray(rawItems)) problems.push("items must be a list");
  const groups = new Set(items.filter((i) => i.type === "group").map((i) => i.id));
  for (const i of items) if (i.in && !groups.has(i.in)) problems.push(`${i.id}: no group "${i.in}"`);
  const arrows: BoardArrow[] = [];
  (Array.isArray(rawArrows) ? rawArrows : []).forEach((raw, k) => {
    const r: Record<string, unknown> = Array.isArray(raw) ? { from: raw[0], to: raw[1], label: raw[2] } : isObj(raw) ? raw : {};
    const from = text(r.from);
    const to = text(r.to);
    if (!ids.has(from) || !ids.has(to)) return problems.push(`Arrow ${k + 1}: ${!ids.has(from) ? `no item "${from}"` : `no item "${to}"`}`);
    arrows.push({ from, to, label: text(r.label) || null, dashed: r.dashed === true });
  });
  return { items, arrows, problems };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const baseSize = (i: BoardItem): XY => i.size ?? (i.type === "text" ? TEXT_SIZE : NOTE_SIZE);

function grid(n: number, cols: number, cell: XY): { w: number; h: number; at: (k: number) => XY } {
  const rows = Math.max(1, Math.ceil(n / cols));
  return {
    w: cols * cell[0] + (cols - 1) * GAP,
    h: rows * cell[1] + (rows - 1) * GAP,
    at: (k) => [(k % cols) * (cell[0] + GAP), Math.floor(k / cols) * (cell[1] + GAP)],
  };
}

const cellOf = (list: BoardItem[]): XY => [Math.max(NOTE_SIZE[0], ...list.map((i) => baseSize(i)[0])), Math.max(NOTE_SIZE[1], ...list.map((i) => baseSize(i)[1]))];

/**
 * Every item's box. Positions given win; a group with none goes in a row
 * (four to a row), its unplaced notes in a grid inside it; loose unplaced
 * items go in a grid below everything else.
 */
export function layoutBoard(items: BoardItem[]): Record<string, Box> {
  const boxes: Record<string, Box> = {};
  const groups = items.filter((i) => i.type === "group");
  const groupIds = new Set(groups.map((g) => g.id));
  const members = (g: BoardItem) => items.filter((i) => i.type !== "group" && !i.at && i.in === g.id);
  let cx = 0;
  let cy = 0;
  let rowH = 0;
  let placedInRow = 0;
  for (const g of groups) {
    const list = members(g);
    const cell = cellOf(list);
    const cols = g.size ? Math.max(1, Math.floor((g.size[0] - 2 * PAD + GAP) / (cell[0] + GAP))) : list.length > 4 ? 2 : 1;
    const inner = grid(list.length, cols, cell);
    const w = Math.max(g.size?.[0] ?? 0, inner.w + 2 * PAD, 200);
    const h = Math.max(g.size?.[1] ?? 0, HEAD + (list.length ? inner.h : cell[1]) + PAD, 160);
    let at = g.at;
    if (!at) {
      if (placedInRow === 4) {
        cx = 0;
        cy += rowH + GROUP_GAP;
        rowH = 0;
        placedInRow = 0;
      }
      at = [cx, cy];
      cx += w + GROUP_GAP;
      rowH = Math.max(rowH, h);
      placedInRow++;
    }
    boxes[g.id] = { x: at[0], y: at[1], w, h };
    list.forEach((i, k) => {
      const [dx, dy] = inner.at(k);
      const [iw, ih] = baseSize(i);
      boxes[i.id] = { x: at[0] + PAD + dx, y: at[1] + HEAD + dy, w: iw, h: ih };
    });
  }
  for (const i of items) if (i.at && !boxes[i.id]) boxes[i.id] = { x: i.at[0], y: i.at[1], w: baseSize(i)[0], h: baseSize(i)[1] };
  const loose = items.filter((i) => !boxes[i.id] && (!i.in || !groupIds.has(i.in)));
  if (loose.length) {
    const placed = Object.values(boxes);
    const top = placed.length ? Math.max(...placed.map((b) => b.y + b.h)) + GROUP_GAP : 0;
    const left = placed.length ? Math.min(...placed.map((b) => b.x)) : 0;
    const cell = cellOf(loose);
    const cols = Math.min(5, Math.max(1, Math.ceil(Math.sqrt(loose.length * 1.5))));
    const g = grid(loose.length, cols, cell);
    loose.forEach((i, k) => {
      const [dx, dy] = g.at(k);
      boxes[i.id] = { x: left + dx, y: top + dy, w: baseSize(i)[0], h: baseSize(i)[1] };
    });
  }
  return boxes;
}

const center = (b: Box): XY => [b.x + b.w / 2, b.y + b.h / 2];
const inside = (p: XY, b: Box) => p[0] >= b.x && p[0] <= b.x + b.w && p[1] >= b.y && p[1] <= b.y + b.h;

/** The smallest group whose box holds the item's center. */
export function groupOf(id: string, items: BoardItem[], boxes: Record<string, Box>): string | null {
  const b = boxes[id];
  if (!b) return null;
  const c = center(b);
  let best: { id: string; area: number } | null = null;
  for (const g of items) {
    if (g.type !== "group" || g.id === id) continue;
    const gb = boxes[g.id];
    if (!gb || !inside(c, gb)) continue;
    const area = gb.w * gb.h;
    if (!best || area < best.area) best = { id: g.id, area };
  }
  return best?.id ?? null;
}

/** Items whose center sits inside a group's box: they move with it. */
export function contents(groupId: string, items: BoardItem[], boxes: Record<string, Box>): string[] {
  const gb = boxes[groupId];
  if (!gb) return [];
  return items.filter((i) => i.id !== groupId && boxes[i.id] && inside(center(boxes[i.id]), gb) && (i.type !== "group" || boxes[i.id].w * boxes[i.id].h < gb.w * gb.h)).map((i) => i.id);
}

export interface Arrangement {
  /** Group id → its notes and text, in reading order (top to bottom, then left to right). */
  groups: Record<string, string[]>;
  /** Notes and text in no group. */
  loose: string[];
  /** Top-left corner of every item. */
  at: Record<string, XY>;
  /** Every note's text, when the board is editable. */
  text?: Record<string, string>;
}

export function arrangement(items: BoardItem[], boxes: Record<string, Box>, withText = false): Arrangement {
  const groups: Record<string, string[]> = {};
  const loose: string[] = [];
  const order = (a: string, b: string) => boxes[a].y - boxes[b].y || boxes[a].x - boxes[b].x;
  for (const g of items) if (g.type === "group") groups[g.id] = [];
  for (const i of items) {
    if (i.type === "group" || !boxes[i.id]) continue;
    const g = groupOf(i.id, items, boxes);
    (g ? groups[g] : loose).push(i.id);
  }
  for (const list of Object.values(groups)) list.sort(order);
  loose.sort(order);
  const at = Object.fromEntries(items.filter((i) => boxes[i.id]).map((i) => [i.id, [Math.round(boxes[i.id].x), Math.round(boxes[i.id].y)] as XY]));
  const out: Arrangement = { groups, loose, at };
  if (withText) out.text = Object.fromEntries(items.filter((i) => i.type !== "group").map((i) => [i.id, i.text]));
  return out;
}

/** Where the line from a box's center toward a point leaves the box. */
export function edgePoint(b: Box, toward: XY, pad = 4): XY {
  const [cx, cy] = center(b);
  const dx = toward[0] - cx;
  const dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = b.w / 2 + pad;
  const hh = b.h / 2 + pad;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return [cx + dx * t, cy + dy * t];
}

/** The box around every item, for fitting the view. */
export function bounds(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 1, h: 1 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
}

/** What the person changed, saved with the card. */
export interface BoardMemory {
  at?: Record<string, XY>;
  /** Group sizes after a resize. */
  size?: Record<string, XY>;
  text?: Record<string, string>;
  added?: { id: string; text: string; at: XY; in?: string | null }[];
  removed?: string[];
}

/** The agent's items with the person's moves, edits, additions and removals applied. */
export function applyMemory(items: BoardItem[], memory: BoardMemory | null): BoardItem[] {
  if (!memory) return items;
  const removed = new Set(memory.removed ?? []);
  const out = items.filter((i) => !removed.has(i.id)).map((i) => {
    const t = memory.text?.[i.id];
    const s = memory.size?.[i.id];
    return t === undefined && !s ? i : { ...i, text: t ?? i.text, size: s ?? i.size };
  });
  for (const a of memory.added ?? []) if (!removed.has(a.id) && !out.some((i) => i.id === a.id)) out.push({ id: a.id, type: "note", text: memory.text?.[a.id] ?? a.text, at: a.at, size: null, color: null, in: null });
  return out;
}

/** Boxes with the person's moves on top of the layout. */
export function placeBoxes(items: BoardItem[], memory: BoardMemory | null): Record<string, Box> {
  const boxes = layoutBoard(items);
  for (const [id, at] of Object.entries(memory?.at ?? {})) if (boxes[id]) boxes[id] = { ...boxes[id], x: at[0], y: at[1] };
  return boxes;
}

/**
 * A change about to be saved, with every other item pinned where it stands,
 * so a group that grows or moves never reflows the rest out from under notes
 * already placed.
 */
export function pinned(items: BoardItem[], change: BoardMemory, laid: Record<string, Box>): BoardMemory {
  const at = { ...change.at };
  for (const i of applyMemory(items, change)) if (!at[i.id] && laid[i.id]) at[i.id] = [Math.round(laid[i.id].x), Math.round(laid[i.id].y)];
  return { ...change, at };
}

/** Removes a note: one the person added is forgotten entirely, so its id can be reused cleanly. */
export function withoutItem(memory: BoardMemory | null, id: string): BoardMemory {
  const added = memory?.added ?? [];
  if (!added.some((a) => a.id === id)) return { ...memory, removed: [...(memory?.removed ?? []), id] };
  const { [id]: _at, ...at } = memory?.at ?? {};
  const { [id]: _text, ...text } = memory?.text ?? {};
  return { ...memory, at, text, added: added.filter((a) => a.id !== id) };
}
