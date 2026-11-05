// The pinned card of each thread: read once, cached briefly, and announced to every card and pane.
// A pin set on another device shows up when this window comes back into focus.
import { useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { RpcContract } from "../shared/rpc";

const titleOf = (source: string) => /<Card\b[^>]*?\btitle="([^"]+)"/.exec(source)?.[1] ?? "Iris card";

export interface Pin {
  source: string;
  title: string;
}

type Rpc = ReturnType<typeof useRpc<RpcContract>>;
const keyOf = (threadId: string) => `pin:${threadId}`;
// One read per thread however many cards and panes ask, and every subscriber hears a change.
const FRESH_MS = 30_000;
const cache = new Map<string, { at: number; pin: Promise<Pin | null> }>();
const listeners = new Map<string, Set<(pin: Pin | null) => void>>();

function read(rpc: Rpc, threadId: string): Promise<Pin | null> {
  const hit = cache.get(threadId);
  if (hit && performance.now() - hit.at < FRESH_MS) return hit.pin;
  const pin = rpc.call("state_get", { key: keyOf(threadId) }).then((r) => {
    const s = r.state as { source?: unknown; title?: unknown } | null;
    return s && typeof s.source === "string" && s.source ? { source: s.source, title: typeof s.title === "string" ? s.title : titleOf(s.source) } : null;
  });
  // A failed read is never remembered: the next card or focus asks again.
  pin.catch(() => cache.delete(threadId));
  cache.set(threadId, { at: performance.now(), pin });
  return pin;
}

const refreshers = new Set<() => void>();
if (typeof window !== "undefined") {
  addEventListener("focus", () => {
    for (const threadId of listeners.keys()) cache.delete(threadId);
    for (const fn of refreshers) fn();
  });
}

export async function setPin(rpc: Rpc, threadId: string, pin: Pin | null) {
  const r = await rpc.call("state_set", { key: keyOf(threadId), state: pin ? { source: pin.source, title: pin.title } : { source: null } }).catch(() => ({ ok: false }));
  if (!r.ok) {
    toast.error("Couldn't pin this card");
    return;
  }
  cache.set(threadId, { at: performance.now(), pin: Promise.resolve(pin) });
  for (const fn of listeners.get(threadId) ?? []) fn(pin);
  toast.success(pin ? "Pinned beside the conversation" : "Unpinned");
}

export function usePin(threadId: string | null): Pin | null | undefined {
  const rpc = useRpc<RpcContract>();
  const [pin, setPinState] = useState<Pin | null | undefined>(undefined);
  useEffect(() => {
    if (!threadId) return;
    let live = true;
    const load = () => read(rpc, threadId).then((p) => live && setPinState(p), () => undefined);
    void load();
    const set = listeners.get(threadId) ?? new Set();
    const fn = (p: Pin | null) => setPinState(p);
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
  return pin;
}

