// A pinned card: one live Iris card per thread, kept in the thread's context card beside the
// conversation, so a dashboard (a build, a PR, context use) stays in view and keeps refreshing
// while the chat scrolls on. Saved with the card state, so it follows the thread across devices.
import { experimental_InfoSection as InfoSection, useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../shared/rpc";
import { IrisBlock } from "./block";
import { setPin, usePin } from "./pin-store";
import { Glyph } from "./views/kit";

/** The context card section: the pinned card, live, with a way to unpin it. Nothing when none is pinned. */
export function PinnedSection({ threadId }: { threadId: string }) {
  const rpc = useRpc<RpcContract>();
  const pin = usePin(threadId);
  if (!pin) return null;
  return (
    <div className="iris-pinned relative min-w-0 pb-1">
      <IrisBlock source={pin.source} streaming={false} threadId={threadId} mode="panel" stateKey={`pinned:${threadId}`} bare />
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={() => void setPin(rpc, threadId, null)} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground">
          <Glyph name="pin-off" size={12} />
          Unpin
        </button>
      </div>
    </div>
  );
}

/** The same pinned card in the thread's Info tab, for bb setups without the context card. */
export function PinnedInfoSection({ threadId }: { threadId: string }) {
  const pin = usePin(threadId);
  if (!pin) return null;
  return (
    <InfoSection label="Pinned card">
      <PinnedSection threadId={threadId} />
    </InfoSection>
  );
}
