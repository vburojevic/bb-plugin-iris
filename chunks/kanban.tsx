// Board with editable (chunk "interact"): the read-only Board's columns and
// cards, plus dragging cards within and between columns (a long press on
// touch), keyboard moves (Space lifts, arrows move, Space drops, Escape puts
// it back), adding and renaming cards. Changes are saved with the card under
// an "@" key and handed to a bound <state>; the rules live in core/kanban.ts.

import { Chip, Glyph, cn, str, useEnv } from "@iris/ui";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { isPendingValue } from "../core/evaluate";
import { type Kanban, type KanbanCard, type KanbanMemory, applyMemory, arrangement, locate, memoryOf, moveCard, newCardId, normalizeKanban, nudge } from "../core/kanban";
import type { ViewProps } from "../ui/render";

function hash(v: unknown): string {
  const s = JSON.stringify(v) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

type Drag = { id: string; pointer: number; touch: boolean; sx: number; sy: number; offX: number; offY: number; w: number; h: number; x: number; y: number; on: boolean; drop: { col: string; index: number } | null };
type Lift = { id: string; before: Record<string, string[]> };

export function EditableBoardView({ props, node }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.items) || isPendingValue(props.columns);
  const sig = pending ? "" : JSON.stringify([props.items ?? null, props.columns ?? null]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => normalizeKanban(pending ? [] : props.items, pending ? undefined : props.columns).board, [sig]);
  const bindName = str(props.bind);
  const memKey = `@Board:${node.start}:${hash(Object.keys(base.cards))}`;
  const memory = (env.runtime.getState(memKey) as KanbanMemory | undefined) ?? null;
  const board = useMemo(() => applyMemory(base, memory), [base, memory]);
  const locked = env.streaming || pending;

  const publish = useCallback(
    (next: Kanban) => {
      if (bindName && env.runtime.hasState(bindName)) env.runtime.setState(bindName, arrangement(next));
    },
    [bindName, env.runtime],
  );
  const commit = useCallback(
    (next: Kanban) => {
      env.runtime.setState(memKey, memoryOf(base, next));
      publish(next);
    },
    [base, env.runtime, memKey, publish],
  );
  const reorder = useCallback((order: Record<string, string[]>) => commit(withOrder(board, order)), [board, commit]);

  // A picker reads the arrangement even before the first change.
  useEffect(() => {
    if (locked || !bindName || !env.runtime.hasState(bindName)) return;
    const cur = env.runtime.getState(bindName);
    if (!cur || typeof cur !== "object" || !("columns" in cur)) publish(board);
  }, [locked, bindName, env.runtime, publish, board]);

  // ---- Keyboard: Space lifts, arrows move, Space or Enter drops, Escape puts it back ----
  const [lift, setLift] = useState<Lift | null>(null);
  const [say, setSay] = useState("");
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const focusId = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusId.current) return;
    cardEls.current.get(focusId.current)?.focus();
    focusId.current = null;
  });
  const where = (order: Record<string, string[]>, id: string) => {
    const at = locate(order, id);
    return at ? `${at.column}, ${at.index + 1} of ${order[at.column].length}` : "";
  };
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  const onCardKey = (e: KeyboardEvent<HTMLDivElement>, card: KanbanCard) => {
    if (locked || editing) return;
    if (e.key === " " || (lift && e.key === "Enter")) {
      e.preventDefault();
      if (lift?.id === card.id) {
        setLift(null);
        setSay(`${card.title} dropped in ${where(board.order, card.id)}.`);
      } else {
        setLift({ id: card.id, before: board.order });
        setSay(`${card.title} picked up in ${where(board.order, card.id)}. Arrow keys move it, Space drops it, Escape puts it back.`);
      }
      return;
    }
    if (lift?.id === card.id) {
      const dir = ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" } as const)[e.key as "ArrowUp"];
      if (dir) {
        e.preventDefault();
        const order = nudge(board.order, board.columns, card.id, dir);
        if (order !== board.order) {
          focusId.current = card.id;
          reorder(order);
          setSay(`${card.title} moved to ${where(order, card.id)}.`);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        focusId.current = card.id;
        reorder(lift.before);
        setLift(null);
        setSay(`${card.title} put back in ${where(lift.before, card.id)}.`);
      }
      return;
    }
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setEditing(card.id);
    } else if ((e.key === "Delete" || e.key === "Backspace") && card.added) {
      e.preventDefault();
      remove(card.id);
    }
  };

  const rename = (id: string, title: string) => {
    setEditing(null);
    focusId.current = id;
    const t = title.trim();
    if (!t || t === board.cards[id]?.title) return;
    commit({ ...board, cards: { ...board.cards, [id]: { ...board.cards[id], title: t } } });
  };
  const add = (col: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    const id = newCardId(board);
    commit({ ...board, order: { ...board.order, [col]: [...board.order[col], id] }, cards: { ...board.cards, [id]: { id, title: t, status: col, raw: {}, added: true } } });
    setSay(`Added ${t} to ${col}.`);
  };
  const remove = (id: string) => {
    const cards = { ...board.cards };
    const title = cards[id]?.title ?? "";
    delete cards[id];
    const order = Object.fromEntries(Object.entries(board.order).map(([c, ids]) => [c, ids.filter((x) => x !== id)]));
    commit({ ...board, order, cards });
    setSay(`Removed ${title}.`);
  };

  // ---- Pointer dragging ----
  const root = useRef<HTMLDivElement | null>(null);
  const colEls = useRef(new Map<string, HTMLDivElement>());
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const hold = useRef<number | null>(null);

  // Once a touch drag starts, the page must not scroll under it.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const stop = (e: TouchEvent) => {
      if (dragRef.current?.on) e.preventDefault();
    };
    el.addEventListener("touchmove", stop, { passive: false });
    return () => el.removeEventListener("touchmove", stop);
  }, []);

  const dropAt = (x: number, y: number, id: string): Drag["drop"] => {
    let best: { col: string; d: number } | null = null;
    for (const col of board.columns) {
      const el = colEls.current.get(col);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (!best || d < best.d) best = { col, d };
    }
    if (!best) return null;
    let index = 0;
    for (const cid of board.order[best.col]) {
      if (cid === id) continue;
      const r = cardEls.current.get(cid)?.getBoundingClientRect();
      if (r && y > r.top + r.height / 2) index++;
    }
    return { col: best.col, index };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, card: KanbanCard) => {
    if (locked || editing || e.button !== 0 || (e.target as HTMLElement).closest("button, input, textarea, a")) return;
    const r = e.currentTarget.getBoundingClientRect();
    const touch = e.pointerType === "touch";
    const d: Drag = { id: card.id, pointer: e.pointerId, touch, sx: e.clientX, sy: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, w: r.width, h: r.height, x: e.clientX, y: e.clientY, on: false, drop: null };
    if (!touch) e.preventDefault(), e.currentTarget.focus();
    setDrag(d);
    if (touch) {
      // On touch a long press starts the drag, so a swipe still scrolls.
      hold.current = window.setTimeout(() => {
        const cur = dragRef.current;
        if (cur && !cur.on) setDrag({ ...cur, on: true, drop: dropAt(cur.x, cur.y, cur.id) });
      }, 280);
    }
  };
  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    if (!d.on) {
      if (d.touch) {
        if (moved > 8) cancelDrag();
        return;
      }
      if (moved < 4) return;
    }
    const scroller = root.current;
    if (scroller) {
      const r = scroller.getBoundingClientRect();
      if (e.clientX > r.right - 36) scroller.scrollLeft += 14;
      else if (e.clientX < r.left + 36) scroller.scrollLeft -= 14;
    }
    setDrag({ ...d, on: true, x: e.clientX, y: e.clientY, drop: dropAt(e.clientX, e.clientY, d.id) });
  };
  const cancelDrag = () => {
    if (hold.current) window.clearTimeout(hold.current);
    hold.current = null;
    setDrag(null);
  };
  const onPointerUp = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointer !== e.pointerId) return;
    cancelDrag();
    if (!d.on || !d.drop) return;
    const order = moveCard(board.order, d.id, d.drop.col, d.drop.index);
    if (JSON.stringify(order) !== JSON.stringify(board.order)) {
      reorder(order);
      setSay(`${board.cards[d.id]?.title} moved to ${where(order, d.id)}.`);
    }
  };
  // The dragged card leaves its column while it moves, so the window follows the pointer.
  const handlers = useRef({ move: onPointerMove, up: onPointerUp, cancel: cancelDrag });
  handlers.current = { move: onPointerMove, up: onPointerUp, cancel: cancelDrag };
  const dragging = drag != null;
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => handlers.current.move(e);
    const up = (e: PointerEvent) => handlers.current.up(e);
    const cancel = () => handlers.current.cancel();
    const esc = (e: globalThis.KeyboardEvent) => e.key === "Escape" && handlers.current.cancel();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", esc);
    };
  }, [dragging]);

  const changed = memory != null;
  const rootRect = root.current?.getBoundingClientRect();

  return (
    <div className="min-w-0">
      <div ref={root} className={cn("iris-scroll-x relative -mx-1 flex min-w-0 gap-2.5 overflow-x-auto px-1 pb-1", drag?.on && "select-none")} aria-describedby={`${memKey}-help`}>
        {board.columns.map((col) => {
          const ids = board.order[col];
          const target = drag?.on && drag.drop?.col === col ? drag.drop.index : -1;
          const visible = ids.filter((id) => !(drag?.on && id === drag.id));
          return (
            <div
              key={col}
              ref={(el) => void (el ? colEls.current.set(col, el) : colEls.current.delete(col))}
              className={cn("flex min-w-[11rem] max-w-[18rem] flex-1 basis-0 flex-col gap-1.5 rounded-xl bg-muted/50 p-2 transition-colors", target >= 0 && "bg-muted")}
              role="group"
              aria-label={`${col}, ${ids.length} card${ids.length === 1 ? "" : "s"}`}
            >
              <div className="flex items-center justify-between px-1 text-xs font-medium">
                {col}
                <span className="tabular-nums text-muted-foreground">{ids.length}</span>
              </div>
              {visible.map((id, k) => (
                <div key={id} className="contents">
                  {target === k ? <Slot h={drag!.h} /> : null}
                  <CardTile
                    card={board.cards[id]}
                    lifted={lift?.id === id}
                    editing={editing === id}
                    locked={locked}
                    setEl={(el) => void (el ? cardEls.current.set(id, el) : cardEls.current.delete(id))}
                    onPointerDown={(e) => onPointerDown(e, board.cards[id])}
                    onKeyDown={(e) => onCardKey(e, board.cards[id])}
                    onBlur={() => lift?.id === id && focusId.current !== id && setLift(null)}
                    onRename={(t) => rename(id, t)}
                    onEdit={() => !locked && setEditing(id)}
                    onRemove={() => remove(id)}
                  />
                </div>
              ))}
              {target >= visible.length ? <Slot h={drag!.h} /> : null}
              {!ids.length && target < 0 ? <div className="px-1 py-3 text-center text-xs text-muted-foreground">Empty</div> : null}
              {adding === col ? (
                <TitleInput
                  placeholder="Card title"
                  onDone={(t, again) => {
                    add(col, t);
                    if (!again) setAdding(null);
                  }}
                  onCancel={() => setAdding(null)}
                />
              ) : (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => setAdding(col)}
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-50"
                >
                  <Glyph name="plus" size={13} />
                  Add card
                </button>
              )}
            </div>
          );
        })}
        {drag?.on && rootRect && board.cards[drag.id] ? (
          <div
            className="pointer-events-none absolute z-20 rotate-[1.5deg] rounded-lg bg-card px-2.5 py-2 text-[13px] shadow-[0_0_0_1px_var(--border),0_10px_24px_-10px_rgb(0_0_0/0.45)]"
            style={{ left: drag.x - rootRect.left + (root.current?.scrollLeft ?? 0) - drag.offX, top: drag.y - rootRect.top - drag.offY, width: drag.w }}
            aria-hidden
          >
            <CardBody card={board.cards[drag.id]} />
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-between gap-3 px-0.5 text-[11.5px] text-muted-foreground">
        <span id={`${memKey}-help`}>Drag cards to move them. From the keyboard, Space picks one up and arrows move it. Double-click or Enter renames.</span>
        {changed ? (
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 hover:bg-state-hover hover:text-foreground"
            onClick={() => {
              env.runtime.setState(memKey, undefined);
              publish(base);
              setSay("Board reset.");
            }}
          >
            Reset
          </button>
        ) : null}
      </div>
      <div className="sr-only" aria-live="assertive">
        {say}
      </div>
    </div>
  );
}

function withOrder(board: Kanban, order: Record<string, string[]>): Kanban {
  const cards = { ...board.cards };
  for (const [col, ids] of Object.entries(order)) for (const id of ids) if (cards[id] && cards[id].status !== col) cards[id] = { ...cards[id], status: col };
  return { ...board, order, cards };
}

function Slot({ h }: { h: number }) {
  return <div className="shrink-0 rounded-lg border border-dashed border-border bg-card/40" style={{ height: Math.max(36, h) }} aria-hidden />;
}

function CardBody({ card }: { card: KanbanCard }) {
  const c = card.raw;
  return (
    <>
      <div className="leading-snug">{card.title}</div>
      {str(c.detail) ? <div className="mt-0.5 text-xs text-muted-foreground">{str(c.detail)}</div> : null}
      {str(c.tag) || str(c.assignee) ? (
        <div className="mt-1.5 flex items-center gap-1.5">
          {str(c.tag) ? <Chip tone={c.tone}>{str(c.tag)}</Chip> : null}
          {str(c.assignee) ? <span className="ml-auto text-[11px] text-muted-foreground">{str(c.assignee)}</span> : null}
        </div>
      ) : null}
    </>
  );
}

function CardTile(p: {
  card: KanbanCard;
  lifted: boolean;
  editing: boolean;
  locked: boolean;
  setEl: (el: HTMLDivElement | null) => void;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
  onBlur: () => void;
  onRename: (title: string) => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { palette } = useEnv();
  const tone = p.card.raw.tone;
  const color = typeof tone === "string" && tone in palette.tone ? palette.tone[tone as keyof typeof palette.tone] : undefined;
  const ring = p.lifted ? `0 0 0 2px ${palette.accent}` : "0 0 0 1px var(--border)";
  return (
    <div
      ref={p.setEl}
      tabIndex={p.editing ? -1 : 0}
      aria-roledescription="movable card"
      aria-label={`${p.card.title}${p.lifted ? ", picked up" : ""}`}
      className={cn("group relative rounded-lg bg-card px-2.5 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring", !p.locked && !p.editing && "cursor-grab select-none active:cursor-grabbing")}
      style={{ boxShadow: color ? `inset 3px 0 0 ${color}, ${ring}` : ring }}
      onPointerDown={p.onPointerDown}
      onKeyDown={p.onKeyDown}
      onBlur={p.onBlur}
      onDoubleClick={p.onEdit}
    >
      {p.editing ? (
        <TitleInput initial={p.card.title} onDone={(t) => p.onRename(t)} onCancel={() => p.onRename(p.card.title)} />
      ) : (
        <>
          <CardBody card={p.card} />
          {p.card.added && !p.locked ? (
            <button
              type="button"
              aria-label={`Remove ${p.card.title}`}
              onClick={p.onRemove}
              className="absolute right-1 top-1 hidden size-5 place-items-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground group-focus-within:grid group-hover:grid"
            >
              <Glyph name="x" size={12} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

function TitleInput({ initial = "", placeholder, onDone, onCancel }: { initial?: string; placeholder?: string; onDone: (title: string, again: boolean) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  return (
    <textarea
      autoFocus
      rows={2}
      value={value}
      placeholder={placeholder}
      aria-label={placeholder ?? "Card title"}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (!initial && value.trim()) {
            // Adding: Enter adds and keeps the field open for the next card.
            onDone(value, true);
            setValue("");
            return;
          }
          done.current = true;
          onDone(value, false);
        } else if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (done.current) return;
        done.current = true;
        if (value.trim() && value !== initial) onDone(value, false);
        else onCancel();
      }}
      className="w-full resize-none rounded-md bg-card px-2 py-1.5 text-[13px] leading-snug shadow-[0_0_0_1px_var(--border)] outline-none focus:shadow-[0_0_0_2px_var(--ring)]"
    />
  );
}

