// Small pieces the codework views share (chunk "codework").

import { InlineError, cn, useEnv } from "@iris/ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { ElementNode } from "../core/ast";
import { IrisError, isPendingValue } from "../core/evaluate";

/** A component's own progress, saved with the card under an "@" key (as chunks/learn.tsx does). */
export function useMemory<T>(node: ElementNode, name: string, identity: unknown): [T | null, (v: T | null) => void] {
  const env = useEnv();
  const key = `@${node.name}:${node.start}:${name}:${hash(identity)}`;
  const value = (env.runtime.state.get(key) as T | undefined) ?? null;
  const set = useCallback((v: T | null) => env.runtime.setState(key, v), [env.runtime, key]);
  return [value, set];
}

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

export type FileState = { status: "loading" } | { status: "missing" } | { status: "error"; error: string } | { status: "ok"; value: unknown };

/** Reads a file through the card's runtime; live re-reads it every 2 s while on screen. */
export function readFile(env: ReturnType<typeof useEnv>, path: string, opts: { raw?: boolean; live?: boolean } = {}): FileState {
  try {
    const v = opts.live ? env.runtime.loadLive(path, opts.raw ? { raw: true } : undefined) : env.runtime.load(path, opts.raw ? { raw: true } : undefined);
    if (isPendingValue(v)) return { status: "loading" };
    return { status: "ok", value: v };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/file not found/.test(message)) return { status: "missing" };
    return { status: "error", error: e instanceof IrisError ? message.replace(/^load\("[^"]*"\): /, "") : message };
  }
}

/** Re-renders every `ms` while mounted. */
export function useNow(ms: number, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return now;
}

export function Problems({ list, what }: { list: string[]; what: string }) {
  if (!list.length) return null;
  return <InlineError error={new Error(`${list[0]}${list.length > 1 ? ` (and ${list.length - 1} more)` : ""}`)} context={what} />;
}

export const BTN =
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-[opacity,background-color] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]";
export const PRIMARY = `${BTN} bg-foreground text-background hover:opacity-90`;
export const SECONDARY = `${BTN} ring-1 ring-border hover:bg-state-hover`;
export const ICON_BTN =
  "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)] disabled:pointer-events-none disabled:opacity-45";
export const FOCUS_BOX = "outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--iris-accent)_45%,transparent)] rounded-[10px]";
export const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;

export function Header({ title, right, className }: { title?: string | null; right?: ReactNode; className?: string }) {
  if (!title && !right) return null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      {title ? <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</div> : <div className="flex-1" />}
      {right}
    </div>
  );
}

/** Keys a view handles itself, unless a button or field inside it has focus. */
export function ownKey(e: { target: EventTarget | null; key: string }, keys: string[]): boolean {
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return false;
  if (t && t.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return false;
  return keys.includes(e.key);
}
