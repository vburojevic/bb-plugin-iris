// The drag behind every before/after divider (Compare and VideoCompare wipes).

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

interface Gesture {
  id: number;
  x: number;
  y: number;
  touch: boolean;
  /** Which way a finger or pen swipe went: "x" drives the divider, "y" scrolls the page. */
  axis: "x" | "y" | null;
}

/** Movement under this many pixels doesn't pick a direction yet (below the phone's own scroll slop). */
const SLOP = 4;

/**
 * Handlers for a before/after divider. A mouse grabs it at once. With a finger or a pen, a swipe
 * that starts sideways belongs to the divider and the page holds still under it, while one that
 * starts up or down scrolls the page and leaves the divider where it was. A tap moves the divider
 * to the tap. Spread the result on the element that spans the divider's whole track, which should
 * carry `touch-pan-y`.
 */
export function useWipeDrag(onMove: (percent: number) => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const move = useRef(onMove);
  move.current = onMove;

  const to = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r?.width) move.current(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  const decide = (g: Gesture, x: number, y: number) => {
    if (g.axis) return;
    const dx = Math.abs(x - g.x);
    const dy = Math.abs(y - g.y);
    if (dx < SLOP && dy < SLOP) return;
    g.axis = dx >= dy ? "x" : "y";
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React listens to touchmove passively, so holding the page still needs a listener of its own.
    // Phones that ignore touch-action (WebKit inside a scrolling page) still honor this.
    const hold = (e: TouchEvent) => {
      const g = gesture.current;
      const t = e.touches[0];
      if (!g || !g.touch || !t || e.touches.length > 1) return;
      decide(g, t.clientX, t.clientY);
      if (g.axis === "x" && e.cancelable) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);

  return {
    ref,
    // The card keeps these touches from bb's own swipe between the thread and the thread list.
    "data-iris-drag": "",
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
      // The first finger owns the gesture; a second one (a pinch, a resting thumb) doesn't take it over.
      if (e.button !== 0 || gesture.current) return;
      // A pen pans the page like a finger under touch-pan-y, so it picks a direction the same way.
      const touch = e.pointerType !== "mouse";
      gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, touch, axis: touch ? null : "x" };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (!touch) to(e.clientX);
    },
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      if (g.touch) decide(g, e.clientX, e.clientY);
      if (g.axis === "x") to(e.clientX);
    },
    onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      gesture.current = null;
      if (g.touch && !g.axis) to(e.clientX);
    },
    onPointerCancel(e: ReactPointerEvent<HTMLDivElement>) {
      if (gesture.current?.id === e.pointerId) gesture.current = null;
    },
  };
}
