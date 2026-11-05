// Editable Board rules that need no browser: card ids, the person's saved
// moves, renames and new cards laid over the agent's items, moving a card, and
// the arrangement a bound <state> (and so an iris_ask picker) answers with.

type Obj = Record<string, unknown>;

export interface KanbanCard {
  id: string;
  title: string;
  status: string;
  /** The item as the agent wrote it, so the answer keeps its other fields. */
  raw: Obj;
  added?: boolean;
}

export interface Kanban {
  columns: string[];
  order: Record<string, string[]>;
  cards: Record<string, KanbanCard>;
}

/** What the card keeps in its saved state: only the person's changes. */
export interface KanbanMemory {
  order?: Record<string, string[]>;
  titles?: Record<string, string>;
  added?: { id: string; title: string; status: string }[];
}

export interface KanbanArrangement {
  columns: Record<string, string[]>;
  items: Obj[];
}

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "");

export function normalizeKanban(rawItems: unknown, rawColumns: unknown): { board: Kanban; problems: string[] } {
  const problems: string[] = [];
  const items: Obj[] = (Array.isArray(rawItems) ? rawItems : []).map((x) => (isObj(x) ? x : { title: x }));
  const columns = Array.isArray(rawColumns) ? [...new Set(rawColumns.map(text))] : [...new Set(items.map((i) => text(i.status)))];
  const order: Record<string, string[]> = Object.fromEntries(columns.map((c) => [c, []]));
  const cards: Record<string, KanbanCard> = {};
  items.forEach((raw, k) => {
    const title = text(raw.title);
    const status = text(raw.status);
    let id = text(raw.id);
    if (id && cards[id]) problems.push(`Card ${k + 1}: id "${id}" is used twice`);
    if (!id || cards[id]) {
      // Cards without ids go by title; a repeated title gets a number.
      const stem = id || title || `card-${k + 1}`;
      id = stem;
      for (let n = 2; cards[id]; n++) id = `${stem} ${n}`;
    }
    if (!(status in order)) {
      problems.push(`Card "${title || id}": status "${status}" is not one of the columns (${columns.join(", ")})`);
      return;
    }
    cards[id] = { id, title, status, raw };
    order[status].push(id);
  });
  return { board: { columns, order, cards }, problems };
}

/** The board with the person's moves, renames and new cards on top of the agent's. */
export function applyMemory(base: Kanban, memory: KanbanMemory | null | undefined): Kanban {
  if (!memory) return base;
  const cards: Record<string, KanbanCard> = { ...base.cards };
  for (const a of memory.added ?? []) if (!cards[a.id] && base.columns.includes(a.status)) cards[a.id] = { id: a.id, title: a.title, status: a.status, raw: {}, added: true };
  for (const [id, title] of Object.entries(memory.titles ?? {})) if (cards[id]) cards[id] = { ...cards[id], title };
  const order: Record<string, string[]> = Object.fromEntries(base.columns.map((c) => [c, []]));
  const placed = new Set<string>();
  for (const col of base.columns) {
    for (const id of memory.order?.[col] ?? []) {
      if (!cards[id] || placed.has(id)) continue;
      order[col].push(id);
      placed.add(id);
    }
  }
  // Cards the person never moved (or the agent added since) stay where the agent put them.
  for (const col of base.columns) {
    for (const id of base.order[col]) if (!placed.has(id)) order[col].push(id), placed.add(id);
  }
  for (const a of memory.added ?? []) if (cards[a.id] && !placed.has(a.id)) order[a.status].push(a.id), placed.add(a.id);
  for (const col of base.columns) for (const id of order[col]) cards[id] = cards[id].status === col ? cards[id] : { ...cards[id], status: col };
  return { columns: base.columns, order, cards };
}

/** Moves a card to a column at an index (counted without the card itself). */
export function moveCard(order: Record<string, string[]>, id: string, to: string, index: number): Record<string, string[]> {
  if (!(to in order)) return order;
  const out: Record<string, string[]> = {};
  for (const [col, ids] of Object.entries(order)) out[col] = ids.filter((x) => x !== id);
  const list = out[to];
  list.splice(Math.max(0, Math.min(list.length, index)), 0, id);
  return out;
}

/** Where a card sits. */
export function locate(order: Record<string, string[]>, id: string): { column: string; index: number } | null {
  for (const [column, ids] of Object.entries(order)) {
    const index = ids.indexOf(id);
    if (index >= 0) return { column, index };
  }
  return null;
}

/** One keyboard step: up and down within a column, left and right to the next column at the same height. */
export function nudge(order: Record<string, string[]>, columns: string[], id: string, dir: "up" | "down" | "left" | "right"): Record<string, string[]> {
  const at = locate(order, id);
  if (!at) return order;
  if (dir === "up" || dir === "down") {
    const index = at.index + (dir === "up" ? -1 : 1);
    if (index < 0 || index >= order[at.column].length) return order;
    return moveCard(order, id, at.column, index);
  }
  const c = columns.indexOf(at.column) + (dir === "left" ? -1 : 1);
  if (c < 0 || c >= columns.length) return order;
  return moveCard(order, id, columns[c], at.index);
}

/** The person's changes compared with the agent's board, to save. */
export function memoryOf(base: Kanban, board: Kanban): KanbanMemory {
  const titles: Record<string, string> = {};
  for (const card of Object.values(board.cards)) if (!card.added && base.cards[card.id] && base.cards[card.id].title !== card.title) titles[card.id] = card.title;
  const added = Object.values(board.cards)
    .filter((c) => c.added)
    .map((c) => ({ id: c.id, title: c.title, status: c.status }));
  return { order: board.order, ...(Object.keys(titles).length ? { titles } : {}), ...(added.length ? { added } : {}) };
}

/** A fresh id for a card the person adds. */
export function newCardId(board: Kanban): string {
  let n = 1;
  while (board.cards[`new-${n}`]) n++;
  return `new-${n}`;
}

/** What a bound <state> holds: ids per column, and every card in board order with its new status and title. */
export function arrangement(board: Kanban): KanbanArrangement {
  const columns: Record<string, string[]> = {};
  const items: Obj[] = [];
  for (const col of board.columns) {
    columns[col] = [...board.order[col]];
    for (const id of board.order[col]) {
      const c = board.cards[id];
      items.push({ ...c.raw, id, title: c.title, status: col, ...(c.added ? { added: true } : {}) });
    }
  }
  return { columns, items };
}
