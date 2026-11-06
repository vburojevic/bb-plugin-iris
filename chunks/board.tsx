// Whiteboard (chunk "board"): notes, groups, text and arrows on a canvas the
// person pans, zooms and rearranges. Layout, group membership and the
// arrangement a picker answers with live in core/board.ts. Moves, edits,
// additions and removals are saved with the card under an "@" key.

import { Glyph, InlineError, cn, num, str, useEnv } from "@iris/ui";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  type BoardItem,
  type BoardMemory,
  type Box,
  type XY,
  NOTE_SIZE,
  applyMemory,
  arrangement,
  bounds,
  contents,
  edgePoint,
  groupOf,
  normalizeBoard,
  pinned,
  placeBoxes,
  withoutItem,
} from "../core/board";
import { isPendingValue } from "../core/evaluate";
import type { ViewProps } from "../ui/render";

const MIN_K = 0.2;
const MAX_K = 2.5;
const clampK = (k: number) => Math.min(MAX_K, Math.max(MIN_K, k));
const tint = (c: string, pct: number, base = "transparent") => `color-mix(in oklab, ${c} ${pct}%, ${base})`;

function hash(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? "";
  } catch {
    s = "";
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

type View = { x: number; y: number; k: number };
type Drag = { kind: "move" | "resize"; ids: string[]; start: Record<string, Box>; sx: number; sy: number; dx: number; dy: number; moved: boolean };
type Pan = { sx: number; sy: number; view: View; moved: boolean };

export function WhiteboardView({ props, node }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.items) || isPendingValue(props.arrows);
  const json = pending ? "" : JSON.stringify([props.items ?? null, props.arrows ?? null]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => normalizeBoard(pending ? [] : props.items, pending ? [] : props.arrows), [json]);
  const editable = props.editable === true;
  const height = Math.max(200, Math.min(1200, num(props.height) ?? 420));
  const title = str(props.title);
  const bindName = str(props.bind);
  const dotsId = `iris-dots-${useId().replace(/[^\w-]/g, "")}`;

  // ---- Saved changes ----
  const memKey = `@Whiteboard:${node.start}:${hash(base.items.map((i) => i.id))}`;
  const memory = (env.runtime.getState(memKey) as BoardMemory | undefined) ?? null;
  const items = useMemo(() => applyMemory(base.items, memory), [base, memory]);
  const laid = useMemo(() => placeBoxes(items, memory), [items, memory]);

  const [drag, setDrag] = useState<Drag | null>(null);
  const boxes = useMemo(() => {
    if (!drag || !drag.moved) return laid;
    const out = { ...laid };
    for (const id of drag.ids) {
      const s = drag.start[id];
      if (!s) continue;
      out[id] = drag.kind === "move" ? { ...s, x: s.x + drag.dx, y: s.y + drag.dy } : { ...s, w: Math.max(160, s.w + drag.dx), h: Math.max(120, s.h + drag.dy) };
    }
    return out;
  }, [laid, drag]);

  const publish = useCallback(
    (nextItems: BoardItem[], nextBoxes: Record<string, Box>) => {
      if (bindName && env.runtime.hasState(bindName)) env.runtime.setState(bindName, arrangement(nextItems, nextBoxes, editable));
    },
    [bindName, editable, env.runtime],
  );
  const save = useCallback(
    (change: BoardMemory) => {
      const next = pinned(base.items, change, laid);
      const nextItems = applyMemory(base.items, next);
      env.runtime.setState(memKey, next);
      publish(nextItems, placeBoxes(nextItems, next));
    },
    [base.items, env.runtime, laid, memKey, publish],
  );

  // A picker reads the arrangement even before the first move.
  useEffect(() => {
    if (pending || env.streaming || !bindName || !env.runtime.hasState(bindName)) return;
    const cur = env.runtime.getState(bindName);
    if (!cur || typeof cur !== "object" || !("groups" in cur)) publish(items, laid);
  }, [pending, env.streaming, bindName, env.runtime, publish, items, laid]);

  // ---- View: fit until the person pans or zooms ----
  const viewport = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const touched = useRef(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const fit = useCallback(() => {
    const el = viewport.current;
    const all = Object.values(laid);
    if (!el || !all.length) return;
    const b = bounds(all);
    const pad = 28;
    const w = el.clientWidth;
    const h = el.clientHeight;
    // Where the hint shows (sm and up) the board keeps clear of it.
    const padBottom = w >= 640 ? 44 : pad;
    // Never fit below readable: on a phone notes keep about 80% of their size and the board starts
    // at its top-left, to pan from there.
    const floor = w < 520 ? 0.8 : 0.5;
    const k = clampK(Math.max(floor, Math.min((w - pad * 2) / b.w, (h - pad - padBottom) / b.h, 1.15)));
    const x = b.w * k <= w - pad * 2 ? (w - b.w * k) / 2 - b.x * k : pad - b.x * k;
    const y = b.h * k <= h - pad - padBottom ? (h - padBottom + pad - b.h * k) / 2 - b.y * k : pad - b.y * k;
    setView({ k, x, y });
  }, [laid]);
  useLayoutEffect(() => {
    if (!touched.current) fit();
  }, [fit]);
  useEffect(() => {
    const el = viewport.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let last = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== last && !touched.current) fit();
      last = el.clientWidth;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, px?: number, py?: number) => {
    const el = viewport.current;
    if (!el) return;
    const v = viewRef.current;
    const cx = px ?? el.clientWidth / 2;
    const cy = py ?? el.clientHeight / 2;
    const k = clampK(v.k * factor);
    touched.current = true;
    setView({ k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k });
  }, []);

  // Pinch and ⌘-scroll zoom; plain scrolling still scrolls the chat.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const toWorld = (clientX: number, clientY: number): XY => {
    const r = viewport.current?.getBoundingClientRect();
    const v = viewRef.current;
    return [(clientX - (r?.left ?? 0) - v.x) / v.k, (clientY - (r?.top ?? 0) - v.y) / v.k];
  };

  // ---- Selection and editing ----
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const move = (ids: string[], dx: number, dy: number) => {
    const at = { ...(memory?.at ?? {}) };
    for (const id of ids) if (laid[id]) at[id] = [Math.round(laid[id].x + dx), Math.round(laid[id].y + dy)];
    const next: BoardMemory = { ...memory, at };
    // A note dropped into a group that is too small for it grows the group.
    const moved = placeBoxes(items, next);
    for (const id of ids) {
      if (byId.get(id)?.type === "group" || ids.some((x) => byId.get(x)?.type === "group")) break;
      const g = groupOf(id, items, moved);
      if (!g) continue;
      const gb = moved[g];
      const b = moved[id];
      const w = Math.max(gb.w, Math.round(b.x + b.w + 16 - gb.x));
      const h = Math.max(gb.h, Math.round(b.y + b.h + 16 - gb.y));
      if (w !== gb.w || h !== gb.h) next.size = { ...(next.size ?? {}), [g]: [w, h] };
    }
    save(next);
  };
  const movingIds = (id: string) => (byId.get(id)?.type === "group" ? [id, ...contents(id, items, laid)] : [id]);

  const addNote = (center: XY) => {
    const used = new Set([...items.map((i) => i.id), ...Object.keys(memory?.text ?? {}), ...Object.keys(memory?.at ?? {}), ...(memory?.removed ?? [])]);
    let n = (memory?.added?.length ?? 0) + 1;
    while (used.has(`note-${n}`)) n++;
    const id = `note-${n}`;
    const at: XY = [Math.round(center[0] - NOTE_SIZE[0] / 2), Math.round(center[1] - NOTE_SIZE[1] / 2)];
    save({ ...memory, added: [...(memory?.added ?? []), { id, text: "", at }] });
    setSelected(id);
    setEditing(id);
  };
  const remove = (id: string) => {
    save(withoutItem(memory, id));
    setSelected(null);
  };
  const commitText = (id: string, value: string) => {
    setEditing(null);
    const item = byId.get(id);
    if (!item) return;
    const isAdded = memory?.added?.some((a) => a.id === id);
    if (!value.trim() && isAdded) return remove(id);
    if (value === item.text) return;
    save({ ...memory, text: { ...(memory?.text ?? {}), [id]: value } });
  };
  const pick = (id: string) => {
    const item = byId.get(id);
    if (!item || item.type === "group") return;
    if (editable) setEditing(id);
    else if (props.onPick) env.run(props.onPick, [id, item.text]);
  };

  // ---- Pointer: drag items, pan the background ----
  const startDrag = (e: ReactPointerEvent, id: string, kind: Drag["kind"]) => {
    if (e.button !== 0 || editing === id) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const ids = kind === "move" ? movingIds(id) : [id];
    setSelected(byId.get(id)?.type === "group" ? null : id);
    setDrag({ kind, ids, start: Object.fromEntries(ids.map((x) => [x, laid[x]])), sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false });
  };
  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const k = viewRef.current.k;
    const dx = (e.clientX - drag.sx) / k;
    const dy = (e.clientY - drag.sy) / k;
    setDrag({ ...drag, dx, dy, moved: drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3 });
  };
  const endDrag = () => {
    if (!drag) return;
    if (drag.moved) {
      if (drag.kind === "move") move(drag.ids, drag.dx, drag.dy);
      else {
        const id = drag.ids[0];
        const s = drag.start[id];
        save({ ...memory, size: { ...(memory?.size ?? {}), [id]: [Math.round(Math.max(160, s.w + drag.dx)), Math.round(Math.max(120, s.h + drag.dy))] } });
      }
    }
    setDrag(null);
  };

  const pan = useRef<Pan | null>(null);
  const onBgDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setSelected(null);
    pan.current = { sx: e.clientX, sy: e.clientY, view: viewRef.current, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onBgMove = (e: ReactPointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.sx;
    const dy = e.clientY - p.sy;
    if (!p.moved && Math.hypot(dx, dy) < 3) return;
    p.moved = true;
    touched.current = true;
    setView({ ...p.view, x: p.view.x + dx, y: p.view.y + dy });
  };
  const onBgUp = () => {
    pan.current = null;
  };

  // ---- Keyboard ----
  const onItemKey = (e: KeyboardEvent, id: string) => {
    if (editing) return;
    const step = e.shiftKey ? 32 : 8;
    const d: Record<string, XY> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (d[e.key]) {
      e.preventDefault();
      e.stopPropagation();
      move(movingIds(id), d[e.key][0], d[e.key][1]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(id);
    } else if ((e.key === "Delete" || e.key === "Backspace") && editable && byId.get(id)?.type !== "group") {
      e.preventDefault();
      remove(id);
    } else if (e.key === "Escape") {
      setSelected(null);
      viewport.current?.focus();
    }
  };
  const onViewKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    const d: Record<string, XY> = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] };
    if (e.key === "+" || e.key === "=") zoomAt(1.2);
    else if (e.key === "-") zoomAt(1 / 1.2);
    else if (e.key === "0") (touched.current = false), fit();
    else if (d[e.key]) {
      touched.current = true;
      setView((v) => ({ ...v, x: v.x + d[e.key][0], y: v.y + d[e.key][1] }));
    } else return;
    e.preventDefault();
  };

  // ---- Colors ----
  // Theme surfaces by default; a color only where the agent gave one a
  // meaning (a tone) or marked it (accent). A note takes its group's color.
  const named = (v: string | number | null): string | null => {
    const n = typeof v === "string" ? v.toLowerCase() : "";
    if (n === "good" || n === "warn" || n === "bad" || n === "info") return env.palette.tone[n];
    return n === "accent" || n === "primary" ? env.palette.accent : null;
  };
  const groups = items.filter((i) => i.type === "group");
  const colorOf = (i: BoardItem): string | null => {
    const own = named(i.color);
    if (own || i.type !== "note") return own;
    const g = groupOf(i.id, items, boxes);
    return g ? named(byId.get(g)?.color ?? null) : null;
  };

  if (pending) return <div className="iris-shimmer rounded-[10px]" style={{ height }} aria-label="Loading" />;

  const orderedGroups = [...groups].filter((g) => boxes[g.id]).sort((a, b) => boxes[b.id].w * boxes[b.id].h - boxes[a.id].w * boxes[a.id].h);
  const others = items.filter((i) => i.type !== "group" && boxes[i.id]);
  const dragging = new Set(drag?.moved ? drag.ids : []);
  const gridSize = 22 * view.k;


  return (
    <div className="min-w-0">
      {title ? <div className="mb-2 truncate text-[13.5px] font-semibold">{title}</div> : null}
      {base.problems.length ? (
        <div className="mb-2">
          <InlineError error={new Error(base.problems.slice(0, 3).join("; ") + (base.problems.length > 3 ? ` (and ${base.problems.length - 3} more)` : ""))} context="<Whiteboard>" />
        </div>
      ) : null}
      <div
        ref={viewport}
        tabIndex={0}
        role="group"
        aria-roledescription="whiteboard"
        aria-label={`${title ?? "Whiteboard"}: ${others.length} items. Tab to an item, arrow keys move it. Plus and minus zoom, 0 fits.`}
        data-iris-drag=""
        onPointerDown={onBgDown}
        onPointerMove={onBgMove}
        onPointerUp={onBgUp}
        onPointerCancel={onBgUp}
        onDoubleClick={(e) => editable && e.target === e.currentTarget && addNote(toWorld(e.clientX, e.clientY))}
        onKeyDown={onViewKey}
        className={cn("relative min-w-0 select-none overflow-hidden rounded-[10px] bg-muted/25 ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--iris-accent)_45%,transparent)]", pan.current?.moved ? "cursor-grabbing" : "cursor-grab")}
        style={{
          height,
          touchAction: "pan-y",
        }}
      >
        <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden style={{ color: "color-mix(in oklab, var(--foreground) 16%, transparent)" }}>
          <defs>
            <pattern id={dotsId} width={gridSize} height={gridSize} x={view.x} y={view.y} patternUnits="userSpaceOnUse">
              <circle cx={1} cy={1} r={Math.max(0.6, Math.min(1.2, view.k))} fill="currentColor" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill={`url(#${dotsId})`} />
        </svg>
        <div className="pointer-events-none absolute left-0 top-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}>
          {orderedGroups.map((g) => {
            const b = boxes[g.id];
            const c = colorOf(g);
            const count = others.filter((i) => groupOf(i.id, items, boxes) === g.id).length;
            return (
              <div key={g.id} className={cn("absolute rounded-2xl", !c && "bg-muted/40")} style={{ left: b.x, top: b.y, width: b.w, height: b.h, background: c ? tint(c, 7) : undefined, boxShadow: `inset 0 0 0 1px ${c ? tint(c, dragging.has(g.id) ? 60 : 32) : dragging.has(g.id) ? "var(--muted-foreground)" : "var(--border)"}`, zIndex: dragging.has(g.id) ? 3 : 0 }}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Group ${g.text || g.id}, ${count} items. Drag or arrow keys move it with its items.`}
                  onPointerDown={(e) => startDrag(e, g.id, "move")}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => onItemKey(e, g.id)}
                  className="pointer-events-auto flex h-10 cursor-grab items-center gap-2 rounded-t-2xl px-4 outline-none focus-visible:ring-2 focus-visible:ring-[var(--iris-accent)] active:cursor-grabbing"
                  style={{ touchAction: "none" }}
                >
                  {c ? <span className="size-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden /> : null}
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{g.text || g.id}</span>
                  <span className="rounded-full bg-card/80 px-1.5 text-[11px] tabular-nums text-muted-foreground">{count}</span>
                </div>
                <div
                  aria-hidden
                  onPointerDown={(e) => startDrag(e, g.id, "resize")}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  title="Resize"
                  className="pointer-events-auto absolute bottom-0 right-0 grid size-6 cursor-nwse-resize place-items-center rounded-br-2xl"
                  style={{ touchAction: "none" }}
                >
                  <span className="mb-1 mr-1 size-2 self-end justify-self-end rounded-br-[3px] border-b-2 border-r-2 border-muted-foreground/50" />
                </div>
              </div>
            );
          })}
          <Arrows items={items} boxes={boxes} arrows={base.arrows} />
          {others.map((i) => {
            const b = boxes[i.id];
            const c = colorOf(i);
            const isText = i.type === "text";
            const sel = selected === i.id;
            const lift = dragging.has(i.id);
            return (
              <div
                key={i.id}
                role="button"
                tabIndex={0}
                aria-label={`${i.text || "Empty note"}${groupOf(i.id, items, boxes) ? `, in ${byId.get(groupOf(i.id, items, boxes) ?? "")?.text ?? "a group"}` : ""}`}
                aria-pressed={sel}
                data-iris-drag=""
                onPointerDown={(e) => startDrag(e, i.id, "move")}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={(e) => (e.stopPropagation(), pick(i.id))}
                onKeyDown={(e) => onItemKey(e, i.id)}
                onFocus={() => setSelected(i.id)}
                className={cn(
                  "pointer-events-auto absolute flex cursor-grab outline-none active:cursor-grabbing",
                  isText ? "items-start px-1 text-[16px] font-semibold leading-tight" : "rounded-[10px] p-2.5 text-[13px] leading-snug",
                  sel && "ring-2 ring-[var(--iris-accent)] ring-offset-1 ring-offset-transparent",
                )}
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.w,
                  height: isText ? undefined : b.h,
                  minHeight: isText ? b.h : undefined,
                  zIndex: lift ? 5 : sel ? 4 : 2,
                  touchAction: "none",
                  color: isText ? (c ?? undefined) : undefined,
                  background: isText ? undefined : c ? tint(c, 18, "var(--card)") : "var(--card)",
                  boxShadow: isText ? undefined : `inset 0 0 0 1px ${c ? tint(c, 30) : "var(--border)"}, 0 ${lift ? 10 : 1}px ${lift ? 24 : 2}px rgb(0 0 0 / ${lift ? 0.28 : 0.14})`,
                  transform: lift ? "rotate(-1.2deg)" : undefined,
                  transition: lift ? "none" : "box-shadow 150ms ease, transform 150ms ease",
                }}
              >
                {editing === i.id ? (
                  <EditText initial={i.text} onDone={(v) => commitText(i.id, v)} />
                ) : (
                  <span className={cn("min-w-0 flex-1 whitespace-pre-wrap break-words", !isText && "overflow-hidden", !i.text && "italic text-muted-foreground")}>{i.text || (editable ? "Double-click to write" : "")}</span>
                )}
              </div>
            );
          })}
        </div>
        <div className="absolute bottom-2 right-2 flex items-center gap-0.5 rounded-full bg-card/90 p-0.5 text-[12px] shadow-sm ring-1 ring-border backdrop-blur-sm" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {editable ? (
            <button type="button" onClick={() => { const el = viewport.current; addNote(el ? toWorld(el.getBoundingClientRect().left + el.clientWidth / 2, el.getBoundingClientRect().top + el.clientHeight / 2) : [0, 0]); }} className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 hover:bg-state-hover" title="Add a note">
              <Glyph name="sticky-note" size={13} />
              Note
            </button>
          ) : null}
          <ToolButton icon="minus" label="Zoom out" onClick={() => zoomAt(1 / 1.2)} />
          <button type="button" onClick={() => zoomAt(1 / view.k)} className="h-7 min-w-11 rounded-full px-1.5 tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground" title="Zoom to 100%">
            {Math.round(view.k * 100)}%
          </button>
          <ToolButton icon="plus" label="Zoom in" onClick={() => zoomAt(1.2)} />
          <ToolButton icon="scan" label="Fit everything" onClick={() => ((touched.current = false), fit())} />
        </div>
        {editable && selected && byId.get(selected)?.type !== "group" && editing !== selected ? (
          <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => remove(selected)} className="absolute right-2 top-2 inline-flex h-7 items-center gap-1 rounded-full bg-card/90 px-2.5 text-[12px] ring-1 ring-border hover:bg-state-hover" title="Delete the selected note">
            <Glyph name="trash-2" size={13} />
            Delete
          </button>
        ) : null}
        <div className="pointer-events-none absolute bottom-3 left-3 hidden text-[11.5px] text-muted-foreground @lg/iris:block">{editable ? "Double-click to add · drag to move · ⌘-scroll to zoom" : "Drag to move · ⌘-scroll to zoom"}</div>
      </div>
    </div>
  );
}

function ToolButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label} className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-state-hover hover:text-foreground">
      <Glyph name={icon} size={14} />
    </button>
  );
}

function EditText({ initial, onDone }: { initial: string; onDone: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <textarea
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish(initial);
        else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          finish(value);
        }
      }}
      aria-label="Note text"
      className="size-full min-w-0 resize-none bg-transparent text-[13px] leading-snug outline-none"
    />
  );
}

function Arrows({ items, boxes, arrows }: { items: BoardItem[]; boxes: Record<string, Box>; arrows: { from: string; to: string; label: string | null; dashed: boolean }[] }) {
  const live = new Set(items.map((i) => i.id));
  const lines = arrows
    .filter((a) => live.has(a.from) && live.has(a.to) && boxes[a.from] && boxes[a.to] && a.from !== a.to)
    .map((a, k) => {
      const A = boxes[a.from];
      const B = boxes[a.to];
      const p1 = edgePoint(A, [B.x + B.w / 2, B.y + B.h / 2]);
      const p2 = edgePoint(B, [A.x + A.w / 2, A.y + A.h / 2], 6);
      const ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);
      const head = (s: number) => [p2[0] - 10 * Math.cos(ang + s), p2[1] - 10 * Math.sin(ang + s)];
      const [h1, h2] = [head(0.42), head(-0.42)];
      return { k, a, p1, p2, head: `${p2[0]},${p2[1]} ${h1[0]},${h1[1]} ${h2[0]},${h2[1]}`, mid: [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2] as XY };
    });
  if (!lines.length) return null;
  return (
    <>
      <svg className="absolute left-0 top-0 overflow-visible" width={1} height={1} style={{ zIndex: 1, color: "var(--muted-foreground)" }} aria-hidden>
        {lines.map((l) => (
          <g key={l.k}>
            <line x1={l.p1[0]} y1={l.p1[1]} x2={l.p2[0]} y2={l.p2[1]} stroke="currentColor" strokeWidth={1.6} strokeDasharray={l.a.dashed ? "6 5" : undefined} strokeLinecap="round" />
            <polygon points={l.head} fill="currentColor" />
          </g>
        ))}
      </svg>
      {lines
        .filter((l) => l.a.label)
        .map((l) => (
          <div key={`t${l.k}`} className="absolute max-w-40 -translate-x-1/2 -translate-y-1/2 truncate rounded-full bg-card px-2 py-0.5 text-[11.5px] text-muted-foreground ring-1 ring-border" style={{ left: l.mid[0], top: l.mid[1], zIndex: 2 }}>
            {l.a.label}
          </div>
        ))}
    </>
  );
}
