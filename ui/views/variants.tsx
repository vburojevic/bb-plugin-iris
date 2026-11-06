// Variants: one of several design directions shown large, with a switcher to flip between them.
// The bound state always holds the variant on screen, so in an iris_ask picker <Submit /> sends it.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { ElementNode } from "../../core/ast";
import { findComponent } from "../../core/catalog";
import { toText } from "../../core/evaluate";
import { AppFrame } from "../app-frame";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { renderNodes } from "../render";
import { Glyph, cn, str } from "./kit";

interface Shown {
  node: ElementNode;
  value: unknown;
  label: string;
  detail?: string;
  colors: string[];
  html?: string;
}

const same = (a: unknown, b: unknown) => a === b || (a != null && b != null && toText(a) === toText(b));

export function VariantsView({ props, node, scope }: ViewProps) {
  const env = useEnv();
  const bind = str(props.bind);
  const items: Shown[] = node.children
    .filter((c): c is ElementNode => c.kind === "element" && findComponent(c.name)?.name === "Variant")
    .map((c, k) => {
      const { props: vp } = env.runtime.props(c, scope);
      const label = str(vp.label) ?? `Option ${k + 1}`;
      return {
        node: c,
        value: vp.value ?? label,
        label,
        detail: str(vp.detail),
        colors: Array.isArray(vp.colors) ? vp.colors.map(toText).filter(Boolean).slice(0, 6) : [],
        html: str(vp.html),
      };
    });
  const [local, setLocal] = useState(0);
  const bound = bind ? env.runtime.getState(bind) : undefined;
  const boundIndex = bind ? items.findIndex((v) => same(v.value, bound)) : -1;
  // The chip last clicked wins when its value matches the state, so variants that share a value stay reachable.
  const active = items[local] && bind && same(items[local].value, bound) ? local : boundIndex >= 0 ? boundIndex : Math.min(local, Math.max(0, items.length - 1));
  const writes = Boolean(bind && env.runtime.hasState(bind));
  const chips = useRef<(HTMLButtonElement | null)[]>([]);

  // The state names the variant on screen from the start, so an answer sent without touching
  // the switcher still says which one the person looked at.
  const shownValue = items[active]?.value;
  useEffect(() => {
    if (writes && bind && items.length && boundIndex < 0) env.runtime.setState(bind, shownValue);
  }, [writes, bind, boundIndex, items.length, shownValue, env.runtime]);

  const go = (k: number, focus = false) => {
    const next = (k + items.length) % items.length;
    setLocal(next);
    if (writes && bind) env.runtime.setState(bind, items[next].value);
    if (focus) chips.current[next]?.focus();
    chips.current[next]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };
  const onKey = (e: KeyboardEvent) => {
    const k = e.key === "ArrowRight" || e.key === "ArrowDown" ? active + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? active - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
    if (k == null) return;
    e.preventDefault();
    go(k, true);
  };

  if (!items.length) return null;
  const shown = items[active];
  const label = str(props.label);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">{label}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="mr-1 text-xs tabular-nums text-muted-foreground" aria-live="polite" aria-label={`${shown.label}, ${active + 1} of ${items.length}`}>
            {active + 1} of {items.length}
          </span>
          <button type="button" aria-label="Previous" onClick={() => go(active - 1)} className="iris-hit grid size-7 place-items-center rounded-lg ring-1 ring-border hover:bg-state-hover">
            <Glyph name="chevron-left" size={15} />
          </button>
          <button type="button" aria-label="Next" onClick={() => go(active + 1)} className="iris-hit grid size-7 place-items-center rounded-lg ring-1 ring-border hover:bg-state-hover">
            <Glyph name="chevron-right" size={15} />
          </button>
        </span>
      </div>
      {/* Two pixels of room keep each chip's outline whole inside the sideways scroller. */}
      <div role="radiogroup" aria-label={label ?? "Variants"} onKeyDown={onKey} className="iris-scroll-x -m-0.5 flex gap-1.5 overflow-x-auto p-0.5">
        {items.map((v, k) => {
          const on = k === active;
          return (
            <button
              key={k}
              ref={(el) => {
                chips.current[k] = el;
              }}
              type="button"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => go(k)}
              className={cn("iris-hit inline-flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[13px] ring-1 transition-colors", on ? "iris-picked ring-transparent font-medium" : "ring-border text-muted-foreground hover:bg-state-hover hover:text-foreground")}
            >
              {v.colors.length ? (
                <span className="flex -space-x-1" aria-hidden>
                  {v.colors.map((c, i) => (
                    <span key={i} className="size-3 rounded-full ring-1 ring-border" style={{ background: c }} />
                  ))}
                </span>
              ) : null}
              {v.label}
            </button>
          );
        })}
      </div>
      {/* An html mock brings its own framed card; Iris children get a frame of the same shape. */}
      <div className="mt-2.5 min-w-0" aria-label={`Preview of ${shown.label}`}>
        {shown.html ? (
          <div className="-my-2">
            <AppFrame key={active} source={shown.html} streaming={env.streaming} threadId={env.threadId} stateKey={null} kind="html" />
          </div>
        ) : (
          <div key={active} className="flex min-w-0 flex-col gap-3 rounded-[14px] p-3 shadow-[0_0_0_1px_var(--border)]">
            {renderNodes(shown.node.children, scope)}
          </div>
        )}
      </div>
      {shown.detail ? <p className="mt-2 text-xs text-muted-foreground">{shown.detail}</p> : null}
    </div>
  );
}

export function VariantView({ children }: ViewProps) {
  // Rendered by Variants; a stray Variant shows its content.
  return <div className="flex min-w-0 flex-col gap-3">{children}</div>;
}
