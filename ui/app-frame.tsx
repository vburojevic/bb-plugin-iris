// ```iris-app and ```iris-react blocks, run in a sandboxed iframe with no
// network. An iris-app block is a full HTML page; an iris-react block is a
// TSX module, compiled here by a pure string transform (sucrase, from an
// on-demand chunk) and run in the frame with its own React and Iris's kit.
// bb's theme colors are passed in, a small bridge lets the page write to the
// composer or answer a waiting picker, and localStorage is kept per card on
// the plugin's server. Nothing the agent wrote ever runs in this document.

import { useEffect, useMemo, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { RpcContract } from "../shared/rpc";
import { CardRuntime, compile } from "../core/program";
import type { AppProblem } from "../core/react-kit";
import { EnvContext, type IrisEnv, useActions } from "./env";
import { type Palette, usePalette } from "./palette";
import { loadChunk } from "./chunks";
import { loadIconNode } from "./icons";
import { Glyph } from "./views/kit";
import { titleOf } from "./block";
import { type AppKind, buildHtmlDoc, buildReactDoc } from "./app-doc";

export type { AppKind };

const TOKENS = [
  "--background", "--foreground", "--card", "--card-foreground", "--popover", "--muted", "--muted-foreground", "--border", "--input",
  "--ring", "--primary", "--primary-foreground", "--secondary", "--accent", "--destructive", "--destructive-foreground", "--success", "--warning", "--radius",
  "--font-sans", "--font-mono", "--surface-raised", "--surface-recessed", "--canvas", "--ink",
  ...Array.from({ length: 16 }, (_, k) => `--ansi-${k}`),
];

// A sandboxed page may send, insert, copy, open a link or answer a picker only right after the
// person used the page itself. The browser gives no event for a click inside a frame, so the
// parent infers it: the page has focus, the window holds a live user activation, and no input
// in bb's own window could have given that activation (so it came from inside a frame).
// send and a picker answer spend the activation; copy, insert and openUrl are only rate-limited.
const activation = () => (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
let lastHostGesture = -Infinity;
let spent = false;
let lastAction = -Infinity;
if (typeof window !== "undefined") {
  const mark = () => {
    lastHostGesture = performance.now();
  };
  // Only input that grants an activation counts: a mouse press, a finished tap (a scroll ends in
  // pointercancel and grants none), and keys other than Tab and modifiers, which only move focus.
  addEventListener("mousedown", mark, true);
  addEventListener("pointerup", (e) => e.pointerType !== "mouse" && mark(), true);
  addEventListener("touchend", mark, true);
  addEventListener("keydown", (e) => !["Tab", "Shift", "Control", "Alt", "Meta", "Escape"].includes(e.key) && mark(), true);
}
/** Browsers keep a user activation alive for a few seconds; a host gesture inside that window rules the frame out. */
const HOST_GESTURE_MS = 5500;

type Gate = "ok" | "unsupported" | "no-click" | "spent";
function gate(frame: HTMLIFrameElement | null, spends: boolean): Gate {
  const ua = activation();
  if (!ua) return "unsupported";
  if (frame === null || document.activeElement !== frame || !ua.isActive) return "no-click";
  if (performance.now() - lastHostGesture < HOST_GESTURE_MS) return "no-click";
  if (spends && spent) return "spent";
  if (!spends && performance.now() - lastAction < 400) return "spent";
  lastAction = performance.now();
  if (spends) {
    spent = true;
    // The spent activation re-arms once it expires, so each new click inside a page can send once.
    const rearm = setInterval(() => {
      if (activation()?.isActive) return;
      spent = false;
      clearInterval(rearm);
    }, 200);
  }
  return "ok";
}

let lastNotice = -Infinity;
/** Says why a click in a page did nothing, at most every few seconds. */
function denied(why: Gate) {
  if (why === "ok" || performance.now() - lastNotice < 4000) return;
  lastNotice = performance.now();
  toast(
    why === "unsupported"
      ? "This browser can't confirm a click inside the card, so the card can't act on its own. Copy the text or answer in chat instead."
      : why === "spent"
        ? "That click was already used. Click the button again in a few seconds."
        : "For safety, a card acts only on a fresh click inside it. Click the button again.",
  );
}

function themeCss(el: Element, palette: Palette): string {
  const css = getComputedStyle(el);
  const vars = TOKENS.map((t) => [t, css.getPropertyValue(t).trim()] as const).filter(([, v]) => v);
  const extra = [
    ...palette.series.slice(0, 8).map((c, k) => [`--iris-${k + 1}`, c] as const),
    ...Object.entries(palette.tone).map(([k, v]) => [`--iris-${k}`, v] as const),
    ["--iris-accent", palette.accent] as const,
    ["--iris-spectrum", palette.spectrum] as const,
  ];
  const dark = css.getPropertyValue("color-scheme").includes("dark") || document.documentElement.classList.contains("dark");
  return `:root{color-scheme:${dark ? "dark" : "light"};${[...vars, ...extra].map(([k, v]) => `${k}:${v}`).join(";")}}`;
}

interface ReactChunk {
  runtime: string;
  css: string;
  compileApp(source: string): { ok: true; code: string } | { ok: false; problems: AppProblem[] };
}

type Prepared = { doc: string } | { problems: AppProblem[] } | null;

export function AppFrame({ source, streaming, threadId, stateKey, submit, kind = "html" }: { source: string; streaming: boolean; threadId: string | null; stateKey: string | null; submit?: (v: unknown) => void; kind?: AppKind }) {
  const palette = usePalette();
  const rpc = useRpc<RpcContract>();
  const frame = useRef<HTMLIFrameElement | null>(null);
  const host = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState(kind === "react" ? 0 : 320);
  const [errors, setErrors] = useState<AppProblem[]>([]);
  // The page reports its height as soon as its script runs. When it never does, this client
  // can't run the page (some hosts block scripts in frames), so the person sees why instead of a blank box.
  const [alive, setAlive] = useState(false);
  const [stuck, setStuck] = useState(false);
  const [storage, setStorage] = useState<Record<string, string> | null>(stateKey ? null : {});
  const [chunk, setChunk] = useState<ReactChunk | Error | null>(null);
  const runtime = useMemo(() => new CardRuntime(compile("")), []);
  const actions = useActions({ runtime, threadId, submit });
  const env = useMemo<IrisEnv>(() => ({ runtime, palette, mode: "fence", threadId, source, streaming, submit, ...actions }), [runtime, palette, threadId, source, streaming, submit, actions]);

  useEffect(() => {
    if (!stateKey || storage) return;
    rpc.call("state_get", { key: stateKey }).then(
      (r) => setStorage((r.state?.storage as Record<string, string> | undefined) ?? {}),
      () => setStorage({}),
    );
  }, [stateKey, storage, rpc]);

  useEffect(() => {
    if (kind !== "react" || streaming || chunk) return;
    let live = true;
    loadChunk<ReactChunk>("react-app").then(
      (m) => live && setChunk(m),
      (e) => live && setChunk(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [kind, streaming, chunk]);

  const prepared = useMemo<Prepared>(() => {
    if (streaming || !storage) return null;
    const el = host.current ?? document.body;
    const theme = themeCss(el, palette);
    if (kind === "html") return { doc: buildHtmlDoc(source, theme, storage) };
    if (!chunk) return null;
    if (chunk instanceof Error) return { problems: [{ message: `The React runtime didn't load: ${chunk.message}` }] };
    const compiled = chunk.compileApp(source);
    if (!compiled.ok) return { problems: compiled.problems };
    return { doc: buildReactDoc(chunk.runtime, compiled.code, theme, storage, chunk.css) };
    // The theme is pushed live below; rebuilding the page would reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, streaming, storage === null, kind, chunk]);

  const doc = prepared && "doc" in prepared ? prepared.doc : null;
  const shown = prepared && "problems" in prepared ? prepared.problems : errors;

  useEffect(() => setErrors([]), [doc]);

  useEffect(() => {
    setAlive(false);
    setStuck(false);
    if (!doc) return;
    // Count only time the page is on screen, so a busy or hidden tab never reads as a broken client.
    let shown = 0;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") shown += 1;
      if (shown >= 12) {
        setStuck(true);
        clearInterval(timer);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [doc]);

  useEffect(() => {
    const w = frame.current?.contentWindow;
    if (w && host.current) w.postMessage({ __irisTheme: themeCss(host.current, palette) }, "*");
  }, [palette]);

  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data || e.data.__iris !== true) return;
      const { type, data } = e.data as { type: string; data: unknown };
      if (type === "height") setAlive(true);
      if (type === "height") setHeight(Math.max(kind === "react" ? 24 : 80, Math.min(1600, Number(data) || 0)));
      else if (type === "error") setErrors((list) => addError(list, { message: String(data) }));
      else if (type === "app-error" && kind === "react" && data && typeof data === "object") {
        const d = data as { message?: unknown; line?: unknown };
        setErrors((list) => addError(list, { message: String(d.message ?? "Unknown error").slice(0, 2000), line: typeof d.line === "number" && d.line > 0 ? Math.floor(d.line) : undefined }));
      } else if (type === "icon" && kind === "react" && typeof data === "string" && /^[A-Za-z0-9]{1,64}$/.test(data)) {
        // Read-only: the shape of one of our own icons, from our own bundle.
        const target = e.source as Window;
        loadIconNode(data).then((node) => target.postMessage({ __irisIcon: { key: data, node } }, "*"), () => undefined);
      } else if (type === "submit") {
        // Like actions below: only a click inside the page may answer.
        const g = gate(frame.current, true);
        if (g !== "ok") return denied(g);
        if (submit) submit(data);
        else actions.report(new Error("iris.submit() works only inside an iris_ask picker"));
      } else if (type === "action") {
        const a = data as { kind: string; args: unknown[] };
        // A page can't send, copy or open anything on its own, only in answer to a click.
        const g = gate(frame.current, a.kind === "send");
        if (g !== "ok") return denied(g);
        if (["send", "insert", "copy", "openUrl"].includes(a.kind)) actions.perform([{ $iris: "action", kind: a.kind as "send", args: a.args }]);
      } else if (type === "storage" && stateKey) {
        clearTimeout(saveTimer);
        const snapshot = JSON.stringify(data).length < 200_000 ? (data as Record<string, string>) : null;
        if (snapshot) saveTimer = setTimeout(() => rpc.call("state_set", { key: stateKey, state: { storage: snapshot } }).catch(() => undefined), 500);
      }
    };
    addEventListener("message", onMessage);
    return () => {
      removeEventListener("message", onMessage);
      clearTimeout(saveTimer);
    };
  }, [actions, rpc, stateKey, submit, kind]);

  const title = titleOf(source);
  const placeholder = (
    <section className="iris-card relative overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_var(--border)]" data-state={streaming ? "live" : "done"}>
      <i className="iris-edge" aria-hidden />
      <div className="flex h-40 flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
        <Glyph name={kind === "react" ? "code" : "app-window"} size={18} />
        {streaming ? "The app starts when the reply finishes" : prepared && "problems" in prepared ? "The app didn't compile" : "Loading"}
      </div>
    </section>
  );
  const iframe = doc ? <iframe ref={frame} title={title} srcDoc={doc} sandbox="allow-scripts allow-forms" className="block w-full border-0 bg-transparent" style={{ height }} referrerPolicy="no-referrer" /> : null;

  return (
    <EnvContext.Provider value={env}>
      <div ref={host} data-iris-root="" className="iris-root my-2 min-w-0">
        {kind === "react" && iframe ? (
          // The app draws its own cards; the frame itself has no chrome, so they read as native ones.
          <div className="-mx-0.5 min-w-0">{iframe}</div>
        ) : iframe ? (
          <section className="iris-card relative overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_var(--border)]" data-state="done">
            <i className="iris-edge" aria-hidden />
            {iframe}
          </section>
        ) : (
          placeholder
        )}
        {doc && stuck && !alive ? (
          <div role="status" className="iris-error my-1 flex items-start gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground ring-1 ring-border">
            <Glyph name="monitor-off" size={13} className="mt-px shrink-0" />
            <span className="min-w-0 flex-1">
              This {kind === "react" ? "app" : "page"} can't run in this bb client. {submit ? "Skip it to answer in chat, or open this thread in bb on a computer." : "Open this thread in bb on a computer to use it."}
            </span>
          </div>
        ) : null}
        {shown.map((p, k) => (
          <AppError key={k} problem={p} kind={kind} fix={!streaming && threadId !== null && !submit ? (text) => actions.perform([{ $iris: "action", kind: "insert", args: [text] }]) : null} />
        ))}
      </div>
    </EnvContext.Provider>
  );
}

function addError(list: AppProblem[], p: AppProblem): AppProblem[] {
  if (list.some((x) => x.message === p.message && x.line === p.line) || list.length >= 3) return list;
  return [...list, p];
}

function AppError({ problem, kind, fix }: { problem: AppProblem; kind: AppKind; fix: ((text: string) => void) | null }) {
  const what = kind === "react" ? "Your Iris React app" : "Your Iris app";
  return (
    <div role="alert" className="iris-error my-1 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-foreground">
      <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
      <span className="min-w-0 flex-1 break-words">
        {problem.message}
        {problem.line ? <span className="text-muted-foreground"> (line {problem.line})</span> : null}
      </span>
      {fix ? (
        <button type="button" className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline" onClick={() => fix(`${what} has an error${problem.line ? ` at line ${problem.line}` : ""}: ${problem.message}. Please fix it.`)}>
          Ask to fix
        </button>
      ) : null}
    </div>
  );
}
