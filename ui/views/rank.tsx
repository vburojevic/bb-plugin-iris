// Rank: the person drags options into order (or moves them with buttons and keys). The state is
// the list of values in that order, so "what first" arrives as a plain list.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { moveItem, rankOrder } from "../../core/rank";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { type Opt, options, same, useBound } from "./inputs";
import { Chip, Glyph, cn, str } from "./kit";

export function RankView({ props }: ViewProps) {
  const env = useEnv();
  const opts = options(props.options);
  const [bound, setBound, name] = useBound(props);
  const [local, setLocal] = useState<unknown>(null);
  const state = name ? bound : local;
  const order = rankOrder(opts, state, (o, v) => same((o as Opt).value, v));
  const writes = Boolean(name && env.runtime.hasState(name));
  const write = (next: Opt[]) => {
    const values = next.map((o) => o.value);
    if (name) setBound(values);
    else setLocal(values);
  };
  // The state names the order on screen from the start, so an answer sent untouched still says it.
  const key = order.map((o) => String(o.value)).join("\u0000");
  const stateKey = Array.isArray(state) ? state.map(String).join("\u0000") : null;
  useEffect(() => {
    if (writes && stateKey !== key) setBound(order.map((o) => o.value));
  }, [writes, stateKey, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const list = useRef<HTMLOListElement>(null);
  const rows = useRef<(HTMLLIElement | null)[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);
  const [said, setSaid] = useState("");
  // Handlers read the order through a ref, so two moves between renders never apply to a stale list.
  const latest = useRef(order);
  latest.current = order;
  const apply = (from: number, to: number) => {
    const cur = latest.current;
    const next = moveItem(cur, from, to);
    latest.current = next;
    write(next);
    const at = next.indexOf(cur[Math.max(0, Math.min(cur.length - 1, from))]);
    setSaid(`${next[at]?.label} moved to ${at + 1} of ${next.length}`);
    return at;
  };
  const moveBy = (k: number, step: -1 | 1, focus: "row" | "button") => {
    const at = apply(k, k + step);
    // Focus follows the item to its new row: the same button, or the row itself from the keyboard.
    requestAnimationFrame(() => {
      const row = rows.current[at];
      const btn = row?.querySelector<HTMLButtonElement>(`button[data-step="${step}"]`);
      (focus === "button" && btn && !btn.disabled ? btn : row)?.focus();
    });
  };
  // The drag follows the pointer on the window: rows move in the page as the order changes, which
  // would break pointer capture on the grip.
  const startDrag = (e: ReactPointerEvent<HTMLSpanElement>, k: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let at = k;
    const id = e.pointerId;
    setDragging(k);
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      let to = latest.current.length - 1;
      for (let i = 0; i < rows.current.length; i++) {
        const r = rows.current[i]?.getBoundingClientRect();
        if (r && ev.clientY < r.top + r.height / 2) {
          to = i;
          break;
        }
      }
      if (to !== at) {
        at = apply(at, to);
        setDragging(at);
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
  const onRowKey = (e: KeyboardEvent<HTMLLIElement>, k: number) => {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    moveBy(k, e.key === "ArrowUp" ? -1 : 1, "row");
  };

  if (!order.length) return <div className="text-xs text-muted-foreground">Rank has no options</div>;
  const label = str(props.label);
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] text-muted-foreground">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">Drag to reorder</span>
      </div>
      <ol ref={list} aria-label={label ?? "Ranking"} className="flex flex-col gap-1.5">
        {order.map((o, k) => (
          <li
            key={opts.indexOf(o)}
            ref={(el) => {
              rows.current[k] = el;
            }}
            tabIndex={0}
            aria-label={`${k + 1}. ${o.label}. Alt and the arrow keys move it.`}
            onKeyDown={(e) => onRowKey(e, k)}
            className={cn(
              "flex min-w-0 items-start gap-2 rounded-xl py-1.5 pl-1 pr-1.5 ring-1 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-foreground/40",
              dragging === k ? "iris-picked ring-transparent shadow-[0_6px_18px_-8px_rgb(0_0_0/0.45)]" : "ring-border",
            )}
          >
            {/* The grip is for the pointer; buttons and keys do the same for everyone else. */}
            <span
              data-iris-drag=""
              aria-hidden
              onPointerDown={(e) => startDrag(e, k)}
              className="iris-hit grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center rounded-md text-muted-foreground hover:bg-state-hover active:cursor-grabbing"
            >
              <Glyph name="grip-vertical" size={15} />
            </span>
            <span className="mt-[7px] w-4 shrink-0 text-right text-[13px] font-medium tabular-nums text-muted-foreground">{k + 1}</span>
            {o.icon ? <Glyph name={o.icon} size={15} className="mt-2 shrink-0 text-muted-foreground" /> : null}
            <span className="min-w-0 flex-1 py-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13.5px]">{o.label}</span>
                {o.badges?.map((b, i) => (
                  <Chip key={i} tone={b.tone}>
                    {b.label}
                  </Chip>
                ))}
              </span>
              {o.detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{o.detail}</span> : null}
            </span>
            <span className="flex shrink-0 flex-col">
              <button type="button" data-step="-1" disabled={k === 0} onClick={() => moveBy(k, -1, "button")} aria-label={`Move ${o.label} up`} className="iris-hit grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-30">
                <Glyph name="chevron-up" size={14} />
              </button>
              <button type="button" data-step="1" disabled={k === order.length - 1} onClick={() => moveBy(k, 1, "button")} aria-label={`Move ${o.label} down`} className="iris-hit grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground disabled:opacity-30">
                <Glyph name="chevron-down" size={14} />
              </button>
            </span>
          </li>
        ))}
      </ol>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
    </div>
  );
}
