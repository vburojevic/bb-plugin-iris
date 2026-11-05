// Small pieces the "tools" chunk views share: saved per-component memory,
// container width, buttons and a compact error line.

import { Glyph, cn, useEnv } from "@iris/ui";
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { ElementNode } from "../core/ast";

/**
 * A component's own state, saved with the card under an "@" key, so edits
 * survive scrolling, reloads and devices. The key carries a hash of the props
 * that tell instances apart, so new data from the agent starts fresh.
 */
export function useMemory<T>(node: ElementNode, name: string, identity: unknown): [T | null, (v: T | null) => void] {
  const env = useEnv();
  const key = `@${node.name}:${node.start}:${name}:${hash(identity)}`;
  const value = (env.runtime.state.get(key) as T | undefined) ?? null;
  const set = useCallback((v: T | null) => env.runtime.setState(key, v), [env.runtime, key]);
  return [value, set];
}

export function hash(v: unknown): string {
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

/** The element's content width, kept current. 0 until measured. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setW(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Re-renders every `ms` while mounted. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]";
export const GHOST_BTN = `inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-45 ${FOCUS}`;
export const ICON_BTN = `grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-state-hover hover:text-foreground ${FOCUS}`;
export const FIELD = "rounded-lg bg-transparent px-2 py-1 font-mono text-[12.5px] ring-1 ring-border outline-none hover:ring-foreground/25 focus:ring-2 focus:ring-[color-mix(in_oklab,var(--iris-accent)_55%,transparent)]";

export function Header({ title, right }: { title?: string; right?: ReactNode }) {
  if (!title && !right) return null;
  return (
    <div className="mb-2 flex min-w-0 items-center gap-2">
      {title ? <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</div> : <div className="flex-1" />}
      {right}
    </div>
  );
}

/** A one-line problem in the bad tone, smaller than a card error. */
export function ErrorLine({ children, className }: { children: ReactNode; className?: string }) {
  const { palette } = useEnv();
  return (
    <div role="alert" className={cn("flex min-w-0 items-start gap-1.5 text-[12px] leading-snug", className)} style={{ color: palette.tone.bad }}>
      <Glyph name="circle-alert" size={13} className="mt-px" />
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

export const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;
