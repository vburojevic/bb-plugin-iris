// The pinned cards of each thread: read once, cached briefly, and announced to every card and pane.
// A change from anywhere (a card's pin button, the agent's iris_pin, `bb iris pin`, another device)
// arrives as a realtime signal; a window coming back into focus reads again too.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { cardTitle, pinId, type Pin } from "../core/pins";
import type { PinsContract } from "../shared/pins-rpc";

export type { Pin };

type Rpc = ReturnType<typeof useRpc<PinsContract>>;
// One read per thread however many cards and panes ask, and every subscriber hears a change.
const FRESH_MS = 30_000;
const cache = new Map<string, { at: number; pins: Promise<Pin[]> }>();
const listeners = new Map<string, Set<(pins: Pin[]) => void>>();

function read(rpc: Rpc, threadId: string, fresh = false): Promise<Pin[]> {
  const hit = cache.get(threadId);
  // Fresh reads asked within a moment of each other (every card hears the same signal or focus) share one.
  if (hit && performance.now() - hit.at < (fresh ? 1_000 : FRESH_MS)) return hit.pins;
  const pins = rpc.call("pins.list", { threadId }).then((r) => r.pins);
  // A failed read is never remembered: the next card or focus asks again.
  pins.catch(() => cache.delete(threadId));
  cache.set(threadId, { at: performance.now(), pins });
  return pins;
}

/** After a change: the next read goes to the server, once, however many cards then ask. */
const signalAt = new Map<string, number>();
function invalidate(threadId: string) {
  const now = performance.now();
  if (now - (signalAt.get(threadId) ?? -Infinity) < 500) return;
  signalAt.set(threadId, now);
  cache.delete(threadId);
}

function announce(threadId: string, pins: Pin[]) {
  cache.set(threadId, { at: performance.now(), pins: Promise.resolve(pins) });
  for (const fn of listeners.get(threadId) ?? []) fn(pins);
}

const refreshers = new Set<(fresh: boolean) => void>();
if (typeof window !== "undefined") {
  addEventListener("focus", () => {
    for (const fn of refreshers) fn(true);
  });
}

/** The person pins a card from its toolbar: its id comes from its title and source, so the same card toggles. */
export const personPinId = (source: string) => pinId(cardTitle(source, ""), source);

export async function pinFromCard(rpc: Rpc, threadId: string, source: string) {
  const r = await rpc.call("pins.set", { threadId, id: personPinId(source), source, by: "person" }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
  if (!r.ok) {
    toast.error(r.error.split("\n")[0] || "Couldn't pin this card");
    return;
  }
  cache.delete(threadId);
  announce(threadId, await read(rpc, threadId, true));
  toast.success("Pinned beside the conversation");
}

export async function unpin(rpc: Rpc, threadId: string, id: string) {
  const r = await rpc.call("pins.remove", { threadId, id }).catch(() => null);
  if (!r) {
    toast.error("Couldn't unpin this card");
    return;
  }
  cache.delete(threadId);
  announce(threadId, await read(rpc, threadId, true));
  toast.success("Unpinned");
}

/** The thread's pins, kept current: undefined while the first read runs. */
export function usePins(threadId: string | null): Pin[] | undefined {
  const rpc = useRpc<PinsContract>();
  const [pins, setPins] = useState<Pin[] | undefined>(undefined);
  useRealtime("iris-pins", (payload) => {
    const id = (payload as { threadId?: unknown } | null)?.threadId;
    if (!id || id !== threadId) return;
    invalidate(threadId);
    void read(rpc, threadId, true).then((p) => announce(threadId, p), () => undefined);
  });
  useEffect(() => {
    setPins(undefined);
    if (!threadId) return;
    let live = true;
    const load = (fresh = false) => read(rpc, threadId, fresh).then((p) => live && setPins(p), () => undefined);
    void load();
    const set = listeners.get(threadId) ?? new Set();
    const fn = (p: Pin[]) => setPins(p);
    set.add(fn);
    listeners.set(threadId, set);
    refreshers.add(load);
    return () => {
      live = false;
      set.delete(fn);
      if (!set.size) listeners.delete(threadId);
      refreshers.delete(load);
    };
  }, [rpc, threadId]);
  return pins;
}
