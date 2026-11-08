// Pinned cards: up to five live Iris cards per thread, kept in the thread's context card beside the
// conversation (and its Info tab), so a dashboard (a build, a fleet, context use) stays in view and
// keeps refreshing while the chat scrolls on. A pin holds a card, or follows a file the agent
// rewrites. Pins follow the thread across devices.
import { experimental_InfoSection as InfoSection, experimental_useThreadContextKind, useBbNavigate, useRpc, type ExperimentalThreadContextSegmentProps } from "@get-bb/plugin-sdk/app";
import { useState, type MouseEvent } from "react";
import { alertText, needsAttention, type Pin } from "../core/pins";
import type { PinsContract } from "../shared/pins-rpc";
import { copyCardImage, IrisBlock } from "./block";
import { type FileCardState, shortHash, useFileCard } from "./file-card";
import { ackAlert, unpin, useAllPins, usePins } from "./pin-store";
import { toneColor, usePalette } from "./palette";
import { Glyph, cn } from "./views/kit";

/** A pin's card: its own source, or its file's latest content (the last good one through a failed read). */
function usePinSource(threadId: string, pin: Pin): FileCardState {
  const fromFile = useFileCard(threadId, pin.file ?? null);
  return pin.file ? fromFile : { source: pin.source ?? null, error: null };
}

function PinnedCard({ threadId, pin }: { threadId: string; pin: Pin }) {
  const rpc = useRpc<PinsContract>();
  const { source, error } = usePinSource(threadId, pin);
  const [drawing, setDrawing] = useState(false);
  const copyImage = (e: MouseEvent<HTMLButtonElement>) => {
    const root = e.currentTarget.closest(".iris-pinned")?.querySelector<HTMLElement>("[data-iris-root]");
    if (!root || drawing) return;
    setDrawing(true);
    void copyCardImage(root, pin.title).finally(() => setDrawing(false));
  };
  const attention = needsAttention(pin);
  return (
    <section className="iris-pinned min-w-0" aria-label={`Pinned: ${pin.title}`} data-attention={attention ? "" : undefined}>
      {attention ? <AlertBar threadId={threadId} pin={pin} /> : null}
      <div className="mb-1 flex min-w-0 items-center gap-1.5 px-0.5 text-xs text-muted-foreground">
        <Glyph name={pin.by === "agent" ? "bot" : "pin"} size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={pin.file ? `Follows ${pin.file}` : undefined}>
          {pin.by === "agent" ? "Pinned by the agent" : "Pinned by you"}
          {pin.file ? " · live from a file" : ""}
        </span>
        {source ? (
          <button type="button" onClick={copyImage} disabled={drawing} aria-label={`Copy ${pin.title} as an image`} title="Copy as image" className="iris-hit grid size-6 shrink-0 place-items-center rounded-md hover:bg-state-hover hover:text-foreground">
            <Glyph name={drawing ? "loader-circle" : "image"} size={12} className={drawing ? "animate-spin" : undefined} />
          </button>
        ) : null}
        <button type="button" onClick={() => void unpin(rpc, threadId, pin.id)} aria-label={`Unpin ${pin.title}`} className="iris-hit inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-state-hover hover:text-foreground">
          <Glyph name="pin-off" size={12} />
          Unpin
        </button>
      </div>
      {source ? (
        <IrisBlock source={source} streaming={false} threadId={threadId} mode="panel" stateKey={`pinned:${threadId}:${pin.id}:${pin.file ? "file" : shortHash(source)}`} bare />
      ) : (
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{error ? `Couldn't read ${pin.file}: ${error}` : "Loading the pinned card"}</div>
      )}
      {source && error ? <div className="mt-1 px-0.5 text-[11px] text-muted-foreground">Showing the last version: {pin.file} can't be read right now.</div> : null}
    </section>
  );
}

/** Since when, in words: "just now", "4 min ago", "2 h ago". */
function ago(at: number | undefined): string {
  if (!at) return "";
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** A pin whose alert holds: what it says, since when, and Dismiss. Warn tone, no decoration. */
function AlertBar({ threadId, pin }: { threadId: string; pin: Pin }) {
  const rpc = useRpc<PinsContract>();
  const warn = toneColor(usePalette(), "warn") ?? "var(--foreground)";
  return (
    <div role="status" className="mb-1.5 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-xs" style={{ background: `color-mix(in oklab, ${warn} 14%, transparent)` }}>
      <Glyph name="bell-ring" size={13} className="shrink-0" color={warn} />
      <span className="min-w-0 flex-1 text-foreground">
        <span className="font-medium">{alertText(pin)}</span>
        {pin.alert?.since ? <span className="text-muted-foreground"> · {ago(pin.alert.since)}</span> : null}
      </span>
      <button type="button" onClick={() => void ackAlert(rpc, threadId, pin.id)} className="iris-hit shrink-0 rounded-md px-1.5 py-0.5 font-medium text-foreground hover:bg-state-hover">
        Dismiss
      </button>
    </div>
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

/** How many pinned cards bb's home page shows before "Show all". */
const HOME_FIRST = 4;

/**
 * bb's home page: every open thread's pinned cards, live, the most recently pinned first. A thread's
 * title opens it. With nothing pinned anywhere, one line says how to pin (bb draws the heading either way).
 */
export function PinnedHome() {
  const threads = useAllPins();
  const navigate = useBbNavigate();
  const [all, setAll] = useState(false);
  if (!threads) return <div className="iris-shimmer h-16 rounded-[14px]" aria-label="Loading pinned cards" />;
  const total = threads.reduce((n, t) => n + t.pins.length, 0);
  if (!total) return <p className="text-sm text-muted-foreground">Pin a card from its toolbar and it stays here, live, with every other thread's pins.</p>;
  let left = all ? Infinity : HOME_FIRST;
  const shown = threads.flatMap((t) => {
    if (left <= 0) return [];
    const pins = t.pins.slice(0, left);
    left -= pins.length;
    return [{ ...t, pins }];
  });
  return (
    <div className="@container/pinhome flex min-w-0 flex-col gap-5">
      {shown.map((t) => (
        <section key={t.threadId} className="flex min-w-0 flex-col gap-2" aria-label={`Pinned in ${t.title}`}>
          <button
            type="button"
            onClick={() => navigate.toThread(t.threadId)}
            className="iris-hit group/open -mx-1 flex min-w-0 max-w-full items-center gap-1.5 self-start rounded-md px-1 py-0.5 text-left text-sm text-foreground hover:bg-state-hover"
            title="Open the thread"
          >
            <Glyph name="message-square" size={14} className="text-muted-foreground" />
            <span className="min-w-0 truncate font-medium">{t.title}</span>
            <Glyph name="arrow-up-right" size={14} className="text-muted-foreground opacity-0 transition-opacity group-hover/open:opacity-100 group-focus-visible/open:opacity-100" />
          </button>
          <div className={cn("grid min-w-0 gap-4", t.pins.length > 1 && "@[640px]/pinhome:grid-cols-2")}>
            {t.pins.map((pin) => (
              <PinnedCard key={pin.id} threadId={t.threadId} pin={pin} />
            ))}
          </div>
        </section>
      ))}
      {total > HOME_FIRST ? (
        <button type="button" onClick={() => setAll((v) => !v)} className="iris-hit self-start rounded-md px-1.5 py-0.5 text-sm text-muted-foreground hover:bg-state-hover hover:text-foreground">
          {all ? "Show fewer" : `Show all ${total} pinned cards`}
        </button>
      ) : null}
    </div>
  );
}

/** The chip in the context row above the composer: how many cards are pinned; a click shows them below the row. */
export function PinnedChip({ threadId, isExpanded, onToggle }: ExperimentalThreadContextSegmentProps) {
  const pins = usePins(threadId);
  const warn = toneColor(usePalette(), "warn");
  if (!pins?.length) return null;
  const alerting = pins.filter(needsAttention).length;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      title={isExpanded ? "Hide the pinned cards" : alerting ? pins.filter(needsAttention).map(alertText).join(", ") : pins.map((p) => p.title).join(", ")}
      className={cn("iris-hit inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground", isExpanded && "bg-state-active text-foreground")}
    >
      <Glyph name={alerting ? "bell-ring" : "pin"} size={12} color={alerting ? warn : undefined} />
      {pins.length} pinned
      {alerting ? <span className="font-medium text-foreground">· {alerting === 1 ? "1 alert" : `${alerting} alerts`}</span> : null}
      <Glyph name="chevron-down" size={12} className={cn("transition-transform", isExpanded && "rotate-180")} />
    </button>
  );
}

/** The pinned cards under the context row while the chip is open; they scroll there, so the composer stays in reach. */
export function PinnedChipDetails({ threadId, isExpanded }: ExperimentalThreadContextSegmentProps) {
  if (!isExpanded) return null;
  return (
    <div className="max-h-[min(55vh,560px)] min-w-0 overflow-y-auto overscroll-contain px-1 pt-2 pb-1">
      <PinnedSection threadId={threadId} />
    </div>
  );
}

/** The chip shows only in threads with pins, and not in panes that show the context card, which holds the pins already. */
export function usePinnedChipVisible({ threadId }: { threadId: string }): boolean {
  const kind = experimental_useThreadContextKind();
  const count = usePins(threadId)?.length ?? 0;
  return kind !== "card" && count > 0;
}
