// Pin alerts reach the person here: an always-mounted overlay hears the server's "iris-alert" signal
// and shows a toast in every visible bb window (bb keeps it in its notification center), plus a
// desktop notification in bb's desktop app when bb may show them and the window isn't in front.
// bb gives plugins no push to the phone; the pin's own mark and the thread's unread state carry it there.
import { useBbNavigate, useRealtime } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

interface AlertSignal {
  threadId: string;
  threadTitle: string;
  pinId: string;
  title: string;
  message: string;
}

function parse(payload: unknown): AlertSignal | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const threadId = str(p.threadId, 64);
  const pinId = str(p.pinId, 40);
  const message = str(p.message, 200);
  if (!threadId || !pinId || !message) return null;
  return { threadId, pinId, message, title: str(p.title, 120) ?? message, threadTitle: str(p.threadTitle, 120) ?? "a thread" };
}

/** bb's desktop app marks its window; the phone app and plain browsers get the toast only. */
const isDesktop = () => typeof window !== "undefined" && "bbDesktop" in window;

export function PinAlertOverlay() {
  const navigate = useBbNavigate();
  useRealtime("iris-alert", (payload) => {
    const a = parse(payload);
    if (!a) return;
    const tag = `iris-alert:${a.threadId}:${a.pinId}`;
    const where = a.message === a.title ? `Pinned in ${a.threadTitle}` : `${a.title} · ${a.threadTitle}`;
    if (document.visibilityState === "visible") toast.warning(a.message, { id: tag, description: where, action: { label: "Open", onClick: () => navigate.toThread(a.threadId) } });
    // A desktop notification only where bb already may show them; Iris never asks for the permission itself.
    if (isDesktop() && typeof Notification !== "undefined" && Notification.permission === "granted" && (document.visibilityState !== "visible" || !document.hasFocus())) {
      try {
        const n = new Notification(a.message, { body: where, tag });
        n.onclick = () => {
          window.focus();
          navigate.toThread(a.threadId);
        };
      } catch {
        // The toast and the pin's own mark still show.
      }
    }
  });
  return null;
}
