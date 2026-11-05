// One Iris block: compiles the source as it streams, keeps a runtime for its
// state, saves that state per card, refreshes live cards, and draws the frame
// with its toolbar (open in panel, source, copy, reset).

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { isPluginSource, loadPluginData } from "../core/plugin-data";
import { isBbSource } from "../core/bb-data";
import { experimental_copyToClipboard, experimental_useAppPanel, useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ElementNode } from "../core/ast";
import { findComponent } from "../core/catalog";
import { IrisError } from "../core/evaluate";
import { CardRuntime, compile, type LoadResult, type Program } from "../core/program";
import { MAX_LINK_SOURCE, PLAYGROUND_URL, playLink } from "../shared/playground";
import type { RpcContract } from "../shared/rpc";
import { EnvContext, type IrisEnv, type IrisMode, useActions } from "./env";
import { usePalette } from "./palette";
import { setPin, usePin } from "./pin-store";
import { InlineError, renderNodes } from "./render";
import { Glyph, cn } from "./views/kit";
import { BlockContext } from "./views/layout";

export interface BlockProps {
  source: string;
  streaming: boolean;
  threadId: string | null;
  mode: IrisMode;
  /** Where this card's state is saved; null keeps it in memory only. */
  stateKey: string | null;
  submit?: (value: unknown) => void;
  /** Hide the toolbar (gallery thumbnails, the panel itself). */
  bare?: boolean;
  /** Shown in the toolbar's source view. */
  language?: string;
}

const LIVE_INTERVAL_MS = 2000;

export function IrisBlock(props: BlockProps) {
  const { source, streaming, threadId, mode, stateKey } = props;
  const rpc = useRpc<RpcContract>();
  const palette = usePalette();
  const lastGood = useRef<Program | null>(null);
  const program = useMemo(() => {
    const p = compile(source);
    // While streaming, a hiccup keeps the last tree that parsed.
    if (p.error && streaming && lastGood.current) return lastGood.current;
    if (!p.error) lastGood.current = p;
    return p;
  }, [source, streaming]);

  const loader = useCallback(
    async (path: string, raw: boolean, tail?: boolean): Promise<LoadResult> => {
      // bb's own live data, read by Iris's server for this card's thread.
      if (isBbSource(path)) {
        const r = await rpc.call("bb_data", { threadId, spec: path });
        if (!r.ok || !tail) return r;
        return { ok: true, value: { text: JSON.stringify(r.value, null, 2), size: 0, truncated: false } };
      }
      // A plugin's own Iris data (the public plugin data contract) reads from bb's page, in or out of a thread.
      if (isPluginSource(path)) {
        const r = await loadPluginData(path, threadId, raw || tail === true);
        if (!r.ok || !tail) return r;
        const text = String(r.value);
        return { ok: true, value: { text, size: text.length, truncated: false } };
      }
      if (!threadId) return { ok: false, error: "files load only inside a thread" };
      return rpc.call("load_file", tail ? { threadId, path, tail: true } : { threadId, path, raw });
    },
    [rpc, threadId],
  );

  const runtimeRef = useRef<CardRuntime | null>(null);
  if (!runtimeRef.current) runtimeRef.current = new CardRuntime(program, { load: loader });
  const runtime = runtimeRef.current;
  useEffect(() => {
    if (runtime.program !== program) runtime.update(program);
  }, [runtime, program]);
  useSyncExternalStore(
    useCallback((fn: () => void) => runtime.subscribe(fn), [runtime]),
    () => runtime.version,
  );

  // Saved state: restored once, written back after changes.
  const restored = useRef(false);
  const [ready, setReady] = useState(stateKey === null);
  useEffect(() => {
    if (!stateKey || restored.current || streaming) {
      if (!stateKey) setReady(true);
      return;
    }
    restored.current = true;
    rpc.call("state_get", { key: stateKey }).then(
      (r) => {
        // "@" keys hold a component's own progress (a quiz round, a timer), saved beside <state>.
        if (r.state) for (const [k, v] of Object.entries(r.state)) if (runtime.hasState(k) || k.startsWith("@")) runtime.state.set(k, v);
        if (r.state) runtime.update(runtime.program);
        setReady(true);
      },
      () => setReady(true),
    );
  }, [stateKey, streaming, rpc, runtime]);
  const savedVersion = useRef(-1);
  useEffect(() => {
    if (!stateKey || !ready || streaming) return;
    // The baseline is taken once ready, even with no state yet: a card whose only
    // state is a component's progress ("@" keys) must save its first change too.
    if (savedVersion.current === -1) {
      savedVersion.current = runtime.version;
      return;
    }
    if (savedVersion.current === runtime.version || runtime.state.size === 0) return;
    const t = setTimeout(() => {
      savedVersion.current = runtime.version;
      rpc.call("state_set", { key: stateKey, state: jsonSafe(runtime.snapshot()) }).catch(() => undefined);
    }, 600);
    return () => clearTimeout(t);
  });

  // Live cards re-read their files while on screen.
  // A live Card re-reads every file; live components (LiveLog, LiveProgress) re-read
  // their own, wherever they render, including inside {list.map(...)}.
  const liveCard = useMemo(() => hasLiveCard(program.nodes), [program]);
  const [watching, setWatching] = useState(false);
  useEffect(() => {
    if (!watching && runtime.isWatching()) setWatching(true);
  });
  const live = liveCard ? "card" : watching ? "parts" : null;
  const frame = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!live || streaming) return;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    if (frame.current) io.observe(frame.current);
    const t = setInterval(() => {
      if (visible && document.visibilityState === "visible") runtime.reloadFiles(live === "card" ? "all" : "watched");
    }, LIVE_INTERVAL_MS);
    return () => {
      clearInterval(t);
      io.disconnect();
    };
  }, [live, streaming, runtime]);

  const actions = useActions({ runtime, threadId, submit: props.submit });
  const env = useMemo<IrisEnv>(
    () => ({ runtime, palette, mode, threadId, source, streaming, submit: props.submit, ...actions }),
    // runtime.version keeps consumers fresh after state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runtime, palette, mode, threadId, source, streaming, props.submit, actions, runtime.version],
  );

  const [showSource, setShowSource] = useState(false);
  const rootCard = firstCard(program.nodes);
  const tools = props.bare ? null : (
    <Toolbar
      source={source}
      language={props.language ?? "iris"}
      showSource={showSource}
      onToggleSource={() => setShowSource((v) => !v)}
      canReset={program.states.length > 0}
      onReset={() => runtime.reset()}
      threadId={threadId}
      streaming={streaming}
    />
  );
  const empty = !program.nodes.some((n) => n.kind !== "text" || n.value.trim());
  let body: ReactNode;
  if (empty) body = <div className="iris-shimmer h-24 rounded-[14px]" aria-label="Loading card" />;
  else
    body = (
      <BlockContext.Provider value={{ toolsFor: rootCard?.start ?? null, tools }}>
        <div className="flex min-w-0 flex-col gap-3">{renderNodes(program.nodes, runtime.globals)}</div>
      </BlockContext.Provider>
    );

  return (
    <EnvContext.Provider value={env}>
      <div
        ref={frame}
        data-iris-root=""
        data-streaming={streaming ? "" : undefined}
        className="iris-root group/iris relative my-2 min-w-0 text-foreground"
        style={{ ["--iris-accent" as string]: palette.accent, ["--iris-spectrum" as string]: palette.accent }}
      >
        {!rootCard && tools ? <div className="pointer-events-none absolute -top-1 right-0 z-[2] opacity-0 transition-opacity focus-within:pointer-events-auto focus-within:opacity-100 group-hover/iris:pointer-events-auto group-hover/iris:opacity-100">{tools}</div> : null}
        {showSource ? <SourceView source={source} onClose={() => setShowSource(false)} /> : body}
        {!streaming && program.error ? <InlineError error={new IrisError(program.error.message, program.error.start, program.error.end)} context="Syntax" /> : null}
        {!streaming && !program.error && program.incomplete ? <InlineError error={new IrisError("The block ended before every tag was closed")} /> : null}
      </div>
    </EnvContext.Provider>
  );
}

function jsonSafe(v: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(v)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function firstCard(nodes: Program["nodes"]): ElementNode | null {
  const visible = nodes.filter((n) => (n.kind === "element" ? n.name !== "state" && n.name !== "let" : n.kind === "expr" || n.value.trim() !== ""));
  const first = visible[0];
  if (visible.length === 1 && first?.kind === "element" && findComponent(first.name)?.name === "Card") return first;
  if (first?.kind === "element" && findComponent(first.name)?.name === "Card") return first;
  return null;
}

function hasLiveCard(nodes: Program["nodes"]): boolean {
  for (const n of nodes) {
    if (n.kind !== "element") continue;
    const state = n.attrs.find((a) => a.name === "state");
    if (findComponent(n.name)?.name === "Card" && state?.value?.t === "lit" && state.value.v === "live") return true;
    if (hasLiveCard(n.children)) return true;
  }
  return false;
}

/** The site itself draws this toolbar too; there the button would only reopen the page. */
const ON_PLAYGROUND = typeof location !== "undefined" && PLAYGROUND_URL.startsWith(`${location.origin}/`);

function Toolbar(p: { source: string; language: string; showSource: boolean; onToggleSource: () => void; canReset: boolean; onReset: () => void; threadId: string | null; streaming: boolean }) {
  const panel = experimental_useAppPanel();
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const pin = usePin(p.threadId);
  const pinnable = p.threadId !== null && !p.streaming && !/-(app|react)$/.test(p.language);
  const pinned = pinnable && pin?.source === p.source;
  const togglePin = () => {
    if (!p.threadId) return;
    void setPin(rpc, p.threadId, pinned ? null : { source: p.source, title: titleOf(p.source) });
  };
  const open = () => {
    const ok = panel.openTab({ tab: { id: "iris-card", context: { kind: "thread" }, availability: "action" }, params: { source: p.source, language: p.language }, title: titleOf(p.source) });
    if (!ok) toast.error("The side panel isn't available here");
  };
  const copy = async () => {
    if (await experimental_copyToClipboard({ text: `\`\`\`${p.language}\n${p.source.trim()}\n\`\`\`` })) toast.success("Copied the card's source");
  };
  // The playground runs ```iris cards only; pages and apps need bb's sandbox bridge.
  const shareable = !ON_PLAYGROUND && !p.streaming && p.language === "iris" && p.source.trim().length > 0 && p.source.length <= MAX_LINK_SOURCE;
  const openInPlayground = () => {
    navigate.openUrl(PLAYGROUND_URL + playLink(p.source.trim()));
    // A card's files and bb data stay on this machine; the playground draws it without them.
    if (/\bload\(/.test(p.source)) toast("Opened in the playground. Files and bb data this card loads stay here, so it shows them as pending.");
  };
  const btn = "grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground";
  return (
    <div className="iris-tools flex shrink-0 items-center gap-0.5 rounded-full bg-card/80 p-0.5 opacity-60 backdrop-blur-sm transition-opacity hover:opacity-100 focus-within:opacity-100">
      {p.canReset ? (
        <button type="button" className={btn} onClick={p.onReset} title="Reset" aria-label="Reset inputs">
          <Glyph name="rotate-ccw" size={14} />
        </button>
      ) : null}
      <button type="button" className={cn(btn, p.showSource && "bg-state-active text-foreground")} onClick={p.onToggleSource} title="Source" aria-label="Show source" aria-pressed={p.showSource}>
        <Glyph name="code" size={14} />
      </button>
      <button type="button" className={btn} onClick={copy} title="Copy" aria-label="Copy source">
        <Glyph name="copy" size={14} />
      </button>
      {pinnable ? (
        <button type="button" className={cn(btn, pinned && "bg-state-active text-foreground")} onClick={togglePin} title={pinned ? "Unpin" : "Pin beside the conversation"} aria-label={pinned ? "Unpin this card" : "Pin this card beside the conversation"} aria-pressed={pinned}>
          <Glyph name={pinned ? "pin-off" : "pin"} size={14} />
        </button>
      ) : null}
      {shareable ? (
        <button type="button" className={btn} onClick={openInPlayground} title="Open in the web playground" aria-label="Open in the web playground">
          <Glyph name="external-link" size={14} />
        </button>
      ) : null}
      {p.threadId && !p.streaming ? (
        <button type="button" className={btn} onClick={open} title="Open in side panel" aria-label="Open in side panel">
          <Glyph name="panel-right-open" size={14} />
        </button>
      ) : null}
    </div>
  );
}

export function titleOf(source: string): string {
  const m = /<Card\b[^>]*?\btitle="([^"]+)"/.exec(source);
  return m ? m[1] : "Iris card";
}

function SourceView({ source, onClose }: { source: string; onClose: () => void }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_var(--border)]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-muted-foreground">
        <Glyph name="code" size={13} />
        Source
        <button type="button" onClick={onClose} className="ml-auto rounded px-1.5 py-0.5 hover:bg-state-hover hover:text-foreground">
          Back to card
        </button>
      </div>
      <pre className="max-h-[480px] overflow-auto p-3 font-mono text-[12px] leading-relaxed">{source.trim()}</pre>
    </div>
  );
}
