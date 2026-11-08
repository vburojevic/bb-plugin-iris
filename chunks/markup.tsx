// MarkUp (chunk "review"): the person draws boxes, arrows and pins on a screenshot and writes a note for each,
// so "this is wrong" arrives with where it is. The state is the list of marks, in image pixels.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { isPendingValue } from "../core/evaluate";
import { MAX_MARKS, type Mark, type MarkKind, markFromDrag, moveMark, nextMarkNumber, normalizeMarks } from "../core/markup";
import { Glyph, Shimmer, cn, inkOn, str, useBound, useEnv, useLoadedImages, useTone } from "@iris/ui";
import type { ViewProps } from "../ui/render";

const TOOLS: { kind: MarkKind; label: string; icon: string; hint: string }[] = [
  { kind: "box", label: "Box", icon: "square", hint: "Drag to box an area" },
  { kind: "arrow", label: "Arrow", icon: "move-up-right", hint: "Drag from the note to the spot" },
  { kind: "pin", label: "Pin", icon: "map-pin", hint: "Tap a spot" },
];

/** Below this many screen pixels a drag counts as a tap. */
const TAP = 6;

export function MarkUpView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.src);
  const src = pending ? "" : (str(props.src) ?? "");
  const [state] = useLoadedImages(src ? [src] : []);
  const [bound, setBound, name] = useBound(props);
  // Without a bind the marks still work, held by the card.
  const [local, setLocal] = useState<unknown>([]);
  const marks = normalizeMarks(name ? bound : local);
  const write = (next: Mark[]) => (name ? setBound(next) : setLocal(next));
  const [tool, setTool] = useState<MarkKind>("box");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<Mark | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; ax: number; ay: number; sx: number; sy: number } | null>(null);
  const notes = useRef(new Map<number, HTMLInputElement | null>());
  const focusNote = useRef<number | null>(null);
  // Marks read as "look here" on any screenshot in any theme: the theme's alert color, numbers in
  // whichever ink stands out on it.
  const accent = useTone("bad") ?? env.palette.accent;
  const ink = inkOn(accent);

  useEffect(() => {
    const n = focusNote.current;
    if (n == null) return;
    focusNote.current = null;
    notes.current.get(n)?.focus({ preventScroll: true });
  });

  if (pending) return <Shimmer className="aspect-video w-full" />;
  if (!src) return <div className="text-xs text-muted-foreground">MarkUp needs an image src</div>;

  const toImage = (clientX: number, clientY: number) => {
    const r = stage.current?.getBoundingClientRect();
    if (!r || !size) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(size.w, ((clientX - r.left) / r.width) * size.w)),
      y: Math.max(0, Math.min(size.h, ((clientY - r.top) / r.height) * size.h)),
    };
  };
  const add = (m: Mark) => {
    if (marks.length >= MAX_MARKS) return;
    write([...marks, m]);
    setSelected(m.n);
    focusNote.current = m.n;
  };
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!size || e.button !== 0 || drag.current) return;
    const p = toImage(e.clientX, e.clientY);
    drag.current = { id: e.pointerId, ax: p.x, ay: p.y, sx: e.clientX, sy: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || tool === "pin") return;
    const p = toImage(e.clientX, e.clientY);
    setDraft(markFromDrag(tool, d.ax, d.ay, p.x, p.y, nextMarkNumber(marks)));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDraft(null);
    const p = toImage(e.clientX, e.clientY);
    const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= TAP;
    // A tap drops a pin whatever the tool; a drag draws the tool's shape.
    add(markFromDrag(moved && tool !== "pin" ? tool : "pin", d.ax, d.ay, p.x, p.y, nextMarkNumber(marks)));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!size) return;
    if (e.key === "Enter" || e.key === " ") {
      // Keyboard: a pin in the middle, then the arrow keys move it.
      e.preventDefault();
      add(markFromDrag("pin", 0, 0, size.w / 2, size.h / 2, nextMarkNumber(marks)));
      return;
    }
    const step = (e.shiftKey ? 0.1 : 0.01) * Math.max(size.w, size.h);
    const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
    const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
    if (selected == null || (!dx && !dy)) return;
    e.preventDefault();
    write(marks.map((m) => (m.n === selected ? moveMark(m, dx, dy, size.w, size.h) : m)));
  };
  const remove = (n: number) => {
    write(marks.filter((m) => m.n !== n));
    if (selected === n) setSelected(null);
  };
  const shown = draft ? [...marks, draft] : marks;
  const hint = TOOLS.find((t) => t.kind === tool)?.hint;
  const label = str(props.label);

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Mark tool" className="inline-flex gap-0.5 rounded-full bg-muted/70 p-0.5">
          {TOOLS.map((t) => (
            <button
              key={t.kind}
              type="button"
              role="radio"
              aria-checked={tool === t.kind}
              onClick={() => setTool(t.kind)}
              className={cn("iris-hit inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors", tool === t.kind ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}
            >
              <Glyph name={t.icon} size={13} />
              {t.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">{label ?? hint}</span>
      </div>
      <div
        ref={stage}
        data-iris-drag=""
        tabIndex={0}
        role="application"
        aria-label={`${label ?? "Image"}: ${hint}. Enter drops a pin; arrow keys move the selected mark.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
        onKeyDown={onKey}
        className="relative mx-auto cursor-crosshair touch-none select-none overflow-hidden rounded-lg bg-muted ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
        // The drawing surface takes every touch, so it stays short enough to leave room to scroll
        // past it: a tall screenshot narrows to fit rather than filling the panel.
        style={{ aspectRatio: size ? `${size.w} / ${size.h}` : "16 / 10", width: `min(100%, calc(min(45dvh, 420px) * ${size ? size.w / size.h : 1.6}))` }}
      >
        {state?.status === "ok" ? (
          <img src={state.url} alt={str(props.alt) ?? label ?? "Image to mark up"} draggable={false} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })} className="pointer-events-none absolute inset-0 size-full object-contain" />
        ) : state?.status === "error" ? (
          <div className="grid size-full place-items-center px-3 text-center text-xs text-muted-foreground">{state.error}</div>
        ) : (
          <Shimmer className="size-full" />
        )}
        {size ? (
          <svg className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden>
            <defs>
              <marker id="iris-markup-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10z" fill={accent} />
              </marker>
            </defs>
            {shown.map((m) => {
              const on = m.n === selected || m === draft;
              const stroke = { stroke: accent, strokeWidth: on ? 3.5 : 2.5, vectorEffect: "non-scaling-stroke" as const, fill: "none" };
              const halo = { stroke: "white", strokeOpacity: 0.85, strokeWidth: on ? 6.5 : 5.5, vectorEffect: "non-scaling-stroke" as const, fill: "none" };
              if (m.kind === "box") {
                return (
                  <g key={m.n}>
                    <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={4} {...halo} />
                    <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={4} {...stroke} style={{ fill: accent, fillOpacity: on ? 0.12 : 0.06 }} />
                  </g>
                );
              }
              if (m.kind === "arrow") {
                return (
                  <g key={m.n}>
                    <line x1={m.x} y1={m.y} x2={m.x2} y2={m.y2} {...halo} />
                    <line x1={m.x} y1={m.y} x2={m.x2} y2={m.y2} {...stroke} markerEnd="url(#iris-markup-head)" />
                  </g>
                );
              }
              return null;
            })}
          </svg>
        ) : null}
        {size
          ? shown.map((m) => (
              <span
                key={m.n}
                className={cn("pointer-events-none absolute grid size-6 place-items-center rounded-full text-[11.5px] font-semibold tabular-nums shadow-[0_0_0_2px_white]", m.kind === "pin" ? "-translate-x-1/2 -translate-y-full" : "-translate-x-1/2 -translate-y-1/2")}
                style={{ left: `${(m.x / size.w) * 100}%`, top: `${(m.y / size.h) * 100}%`, background: accent, color: ink }}
              >
                {m.n}
              </span>
            ))
          : null}
      </div>
      {marks.length ? (
        <ol className="mt-2 flex flex-col gap-1.5">
          {marks.map((m) => (
            <li key={m.n} className={cn("flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 transition-colors", m.n === selected && "bg-state-hover")} onFocusCapture={() => setSelected(m.n)}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full text-[11.5px] font-semibold tabular-nums" style={{ background: accent, color: ink }}>
                {m.n}
              </span>
              <span className="w-10 shrink-0 text-xs text-muted-foreground">{TOOLS.find((t) => t.kind === m.kind)?.label}</span>
              <input
                ref={(el) => {
                  notes.current.set(m.n, el);
                }}
                value={m.note}
                onChange={(e) => write(marks.map((x) => (x.n === m.n ? { ...x, note: e.target.value } : x)))}
                placeholder="What should change here?"
                aria-label={`Note for mark ${m.n}`}
                className="iris-field h-8 min-w-0 flex-1 rounded-lg bg-card px-2.5 text-[13px] ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-foreground/40"
              />
              <button type="button" onClick={() => remove(m.n)} aria-label={`Delete mark ${m.n}`} className="iris-hit grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-state-hover hover:text-foreground">
                <Glyph name="trash-2" size={14} />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">{marks.length >= MAX_MARKS ? `At most ${MAX_MARKS} marks` : "No marks yet. Draw on the image to add one."}</p>
      )}
    </div>
  );
}
