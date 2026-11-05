// WebGL views (Scene, Shader) share a small budget of live contexts. Browsers
// drop the oldest context past about 16, and every live canvas costs GPU
// memory, so a long chat keeps only a few: a view far off screen gives its
// context back and shows its last frame until it scrolls into view again.
// Views also pause while off screen or while the tab is hidden.

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { rgb } from "./palette";

export const MAX_LIVE_GL = 4;

interface Client {
  visible: boolean;
  seen: number;
  evict(): void;
  /** A slot came free: a blocked view tries again. */
  retry(): void;
}

const live = new Set<Client>();
const waiting = new Set<Client>();

function release(client: Client) {
  if (!live.delete(client)) return;
  for (const c of [...waiting]) c.retry();
}

function claim(client: Client, force: boolean): boolean {
  if (live.has(client)) return true;
  while (live.size >= MAX_LIVE_GL) {
    const candidates = [...live].filter((c) => force || !c.visible).sort((a, b) => a.seen - b.seen);
    const victim = candidates[0];
    if (!victim) return false;
    live.delete(victim);
    victim.evict();
  }
  live.add(client);
  return true;
}

export interface GlSlot {
  /** Holds a context: mount the canvas. */
  live: boolean;
  /** On screen and the tab is showing: draw. */
  running: boolean;
  /** The last frame, shown while the context is given back. */
  poster: string | null;
  /** On screen but every slot is taken by other visible views. */
  blocked: boolean;
  /** Takes a slot even from a visible view (a click on a blocked one). */
  wake(): void;
  /** Ref for the view's frame. The slot is held only while that element is mounted. */
  attach(el: HTMLElement | null): void;
}

/** snapshot() returns the view's current frame as a data URL, or null. */
export function useGlSlot(snapshot: RefObject<(() => string | null) | null>): GlSlot {
  const [el, attach] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [isLive, setLive] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [shown, setShown] = useState(() => typeof document === "undefined" || document.visibilityState === "visible");
  const [attempt, setAttempt] = useState(0);
  const client = useRef<Client | null>(null);
  client.current ??= {
    visible: false,
    seen: 0,
    retry: () => setAttempt((n) => n + 1),
    evict: () => {
      try {
        const frame = snapshot.current?.();
        if (frame) setPoster(frame);
      } catch {
        // A lost context has no frame to keep.
      }
      setLive(false);
    },
  };

  useEffect(() => {
    const c = client.current!;
    if (!el) {
      // No frame on screen (still loading, or a shader that failed to compile): hold no slot.
      c.visible = false;
      waiting.delete(c);
      release(c);
      setVisible(false);
      setLive(false);
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      c.visible = true;
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        c.visible = e.isIntersecting;
        if (e.isIntersecting) c.seen = performance.now();
        setVisible(e.isIntersecting);
      },
      { rootMargin: "120px" },
    );
    io.observe(el);
    const onVis = () => setShown(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [el]);

  useEffect(() => {
    const c = client.current!;
    if (!visible || isLive) {
      waiting.delete(c);
      return;
    }
    if (claim(c, false)) {
      waiting.delete(c);
      setBlocked(false);
      setLive(true);
    } else {
      waiting.add(c);
      setBlocked(true);
    }
  }, [visible, isLive, attempt]);

  useEffect(() => {
    const c = client.current!;
    return () => {
      waiting.delete(c);
      release(c);
    };
  }, []);

  const wake = useCallback(() => {
    const c = client.current!;
    c.seen = performance.now();
    if (claim(c, true)) {
      waiting.delete(c);
      setBlocked(false);
      setLive(true);
    }
  }, []);

  return { live: isLive, running: isLive && visible && shown, poster, blocked, wake, attach };
}

/** A theme color as #rrggbb, for WebGL code that can't read oklch(). */
export function hexColor(css: string, fallback = "#888888"): string {
  const c = rgb(css);
  return c ? `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}` : fallback;
}

/** A CSS custom property of the theme, as #rrggbb. Without an element it reads Iris's root. */
export function themeVar(el: Element | null, name: string, fallback: string): string {
  el ??= typeof document === "undefined" ? null : (document.querySelector("[data-iris-root]") ?? document.body);
  if (!el) return fallback;
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v ? hexColor(v, fallback) : fallback;
}
