// Pinned cards: up to five live Iris cards per thread, kept in the thread's context card beside the
// conversation (and its Info tab), so a dashboard (a build, a fleet, context use) stays in view and
// keeps refreshing while the chat scrolls on. A pin holds a card, or follows a file the agent
// rewrites. Pins follow the thread across devices.
import { experimental_InfoSection as InfoSection, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { cardFromFile, type Pin } from "../core/pins";
import type { PinsContract } from "../shared/pins-rpc";
import type { RpcContract } from "../shared/rpc";
import { IrisBlock } from "./block";
import { unpin, usePins } from "./pin-store";
import { Glyph } from "./views/kit";

/** How often a pin that follows a file reads it again while it shows. */
const FILE_EVERY_MS = 3_000;

/** A short hash of the card's source, so each pinned card keeps its own inputs. */
function sourceKey(source: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < source.length; i++) h = Math.imul(h ^ source.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** A pin's card: its own source, or its file's latest content (the last good one through a failed read). */
function usePinSource(threadId: string, pin: Pin): { source: string | null; error: string | null } {
  const rpc = useRpc<RpcContract>();
  const [state, setState] = useState<{ source: string | null; error: string | null }>({ source: pin.source ?? null, error: null });
  useEffect(() => {
    if (!pin.file) {
      setState({ source: pin.source ?? null, error: null });
      return;
    }
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      // Hidden tabs and windows don't read; the next tick after they show again does.
      if (document.visibilityState !== "hidden") {
        const r = await rpc.call("load_file", { threadId, path: pin.file as string, raw: true }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
        if (!live) return;
        setState((prev) =>
          r.ok && typeof r.value === "string" ? (prev.source === cardFromFile(r.value) && !prev.error ? prev : { source: cardFromFile(r.value), error: null }) : { source: prev.source, error: r.ok ? "not a text file" : r.error },
        );
      }
      timer = setTimeout(() => void tick(), FILE_EVERY_MS);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, threadId, pin.file, pin.source]);
  return state;
}

function PinnedCard({ threadId, pin }: { threadId: string; pin: Pin }) {
  const rpc = useRpc<PinsContract>();
  const { source, error } = usePinSource(threadId, pin);
  return (
    <section className="iris-pinned min-w-0" aria-label={`Pinned: ${pin.title}`}>
      <div className="mb-1 flex min-w-0 items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
        <Glyph name={pin.by === "agent" ? "bot" : "pin"} size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={pin.file ? `Follows ${pin.file}` : undefined}>
          {pin.by === "agent" ? "Pinned by the agent" : "Pinned by you"}
          {pin.file ? " · live from a file" : ""}
        </span>
        <button type="button" onClick={() => void unpin(rpc, threadId, pin.id)} aria-label={`Unpin ${pin.title}`} className="iris-hit inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-state-hover hover:text-foreground">
          <Glyph name="pin-off" size={12} />
          Unpin
        </button>
      </div>
      {source ? (
        <IrisBlock source={source} streaming={false} threadId={threadId} mode="panel" stateKey={`pinned:${threadId}:${pin.id}:${pin.file ? "file" : sourceKey(source)}`} bare />
      ) : (
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{error ? `Couldn't read ${pin.file}: ${error}` : "Loading the pinned card"}</div>
      )}
      {source && error ? <div className="mt-1 px-0.5 text-[11px] text-muted-foreground">Showing the last version: {pin.file} can't be read right now.</div> : null}
    </section>
  );
}

/** The context card section: every pinned card, live, each with its own Unpin. Nothing when none is pinned. */
export function PinnedSection({ threadId }: { threadId: string }) {
  const pins = usePins(threadId);
  if (!pins?.length) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4 pb-1">
      {pins.map((pin) => (
        <PinnedCard key={pin.id} threadId={threadId} pin={pin} />
      ))}
    </div>
  );
}

/** The same pinned cards in the thread's Info tab, for bb setups without the context card. */
export function PinnedInfoSection({ threadId }: { threadId: string }) {
  const pins = usePins(threadId);
  if (!pins?.length) return null;
  return (
    <InfoSection label={pins.length === 1 ? "Pinned card" : `Pinned cards (${pins.length})`}>
      <PinnedSection threadId={threadId} />
    </InfoSection>
  );
}
