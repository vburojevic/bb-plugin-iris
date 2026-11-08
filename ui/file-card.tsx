// A card that lives in a file: the agent writes Iris markup to a workspace or thread storage file and
// the card follows it, read again every few seconds while it shows. Pins that follow a file and the
// ::iris{file="..."} message directive both draw through here.
import { useRpc, type PluginMessageDirectiveProps } from "@get-bb/plugin-sdk/app";
import { useEffect, useRef, useState } from "react";
import { cardFromFile } from "../core/pins";
import type { RpcContract } from "../shared/rpc";
import { IrisBlock } from "./block";

/** How often a card that follows a file reads it again while it shows. */
export const FILE_EVERY_MS = 3_000;
/** The longest card a file may hold, as for a pinned card's source. */
const MAX_FILE_CARD = 100_000;

/** A short hash, so each file's card keeps its own inputs. */
export function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** A TSX module rather than Iris markup. */
const isReactModule = (source: string) => /^\s*export\s+default\b/m.test(source) || /^\s*import\s[^;]*\bfrom\s*["'](react|iris|lucide-react)["']/m.test(source);

export interface FileCardState {
  source: string | null;
  error: string | null;
}

/**
 * A file's card, read now and every FILE_EVERY_MS while `active` and the window shows. A failed
 * read keeps the last good card and says why it's old.
 */
export function useFileCard(threadId: string, file: string | null, active = true): FileCardState {
  const rpc = useRpc<RpcContract>();
  const [state, setState] = useState<FileCardState>({ source: null, error: null });
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    if (!file) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      // Hidden windows and cards scrolled away don't read; the next tick after they show again does.
      if (document.visibilityState !== "hidden" && activeRef.current) {
        const r = await rpc.call("load_file", { threadId, path: file, raw: true }).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
        if (!live) return;
        setState((prev) => {
          if (!r.ok) return { source: prev.source, error: r.error };
          if (typeof r.value !== "string") return { source: prev.source, error: "not a text file" };
          const next = cardFromFile(r.value);
          if (next.length > MAX_FILE_CARD) return { source: prev.source, error: `the card is longer than ${MAX_FILE_CARD.toLocaleString("en-US")} characters` };
          if (isReactModule(next)) return { source: null, error: "it holds an iris-react app; a file card takes Iris markup" };
          return prev.source === next && !prev.error ? prev : { source: next, error: null };
        });
      }
      timer = setTimeout(() => void tick(), FILE_EVERY_MS);
    };
    void tick();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, threadId, file]);
  return state;
}

/** The ::iris{file="..."} directive: the file's card inline in the message, following the file. */
export function FileCardDirective({ attributes, message }: PluginMessageDirectiveProps) {
  const file = typeof attributes.file === "string" && attributes.file.trim() && attributes.file.length <= 2000 ? attributes.file.trim() : null;
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const { source, error } = useFileCard(message.threadId, file, visible);
  const name = file ? file.split("/").pop() : "";
  return (
    <div ref={box} className="iris-file-card my-2 min-w-0" data-iris-file={file ?? ""}>
      {!file ? (
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">An Iris file card needs a file, like ::iris{"{"}file="$BB_THREAD_STORAGE/status.iris"{"}"}</div>
      ) : source ? (
        <IrisBlock source={source} streaming={false} threadId={message.threadId} mode="fence" stateKey={`${message.id}#iris-file#${shortHash(file)}`} />
      ) : (
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{error ? `Couldn't read ${name}: ${error}` : `Loading ${name}`}</div>
      )}
      {file && source && error ? <div className="mt-1 px-0.5 text-[11px] text-muted-foreground">Showing the last version: {name} can't be read right now ({error}).</div> : null}
    </div>
  );
}
