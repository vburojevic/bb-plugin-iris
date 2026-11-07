// Iris frontend: renders ```iris, ```iris-app and ```iris-react blocks in chat, the waiting
// pickers agents open with iris_ask, the side-panel view of a card, and the
// component gallery.
import "./app.css";
import { definePluginApp, type ExperimentalCodeFenceRendererProps, type PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { PLAYGROUND_URL } from "./shared/playground";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AppFrame } from "./ui/app-frame";
import { IrisBlock } from "./ui/block";
import { GalleryPage } from "./ui/gallery";
import { PinnedInfoSection, PinnedSection } from "./ui/pins";
import { Glyph } from "./ui/views/kit";
import { surfaceBehind } from "./ui/surface";

function Fence({ code, language, status, index, message }: ExperimentalCodeFenceRendererProps) {
  const streaming = status === "streaming";
  const stateKey = `${message.id}#${language}#${index}`;
  if (language.endsWith("-app") || language.endsWith("-react")) return <AppFrame source={code} streaming={streaming} threadId={message.threadId} stateKey={stateKey} kind={language.endsWith("-react") ? "react" : "html"} />;
  return <IrisBlock source={code} streaming={streaming} threadId={message.threadId} mode="fence" stateKey={stateKey} language={language} />;
}

/** What iris_ask sends: the picker's markup (or an HTML or React app) and its title. */
interface AskPayload {
  source?: string;
  html?: string;
  react?: string;
  title?: string;
}

function AskPicker({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const payload = (interaction.payload ?? {}) as AskPayload;
  const [sent, setSent] = useState(false);
  const answer = useCallback(
    (value: unknown) => {
      if (sent) return;
      setSent(true);
      submit(JSON.parse(JSON.stringify(value ?? null))).catch(() => setSent(false));
    },
    [sent, submit],
  );
  const box = useRef<HTMLDivElement>(null);
  // The Send row pins to the bottom edge only when the request panel scrolls, painted in the color of
  // the bb panel around it (read live, so it matches every theme) rather than a guessed token.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    // bb's request panel is the one scroller (a second one inside it hid Send below the fold).
    let scroller: HTMLElement = el;
    for (let up = el.parentElement; up; up = up.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(up).overflowY)) {
        scroller = up;
        break;
      }
    }
    // Painted again on every resize and theme change, so the pinned row never shows a stale color.
    const paint = () => {
      // bb's panels are often a translucent tint over the page: every layer down to the first opaque one.
      const bg = surfaceBehind(el);
      if (bg) el.style.setProperty("--iris-picker-bg", bg);
      // The pinned row reaches through the panel's padding so nothing peeks out below or beside it.
      const pad = getComputedStyle(scroller);
      el.style.setProperty("--iris-picker-x", `${(parseFloat(pad.paddingRight) || 0) + (parseFloat(getComputedStyle(el).paddingRight) || 0)}px`);
      el.style.setProperty("--iris-picker-b", `${parseFloat(pad.paddingBottom) || 0}px`);
    };
    const measure = () => {
      paint();
      el.toggleAttribute("data-overflow", scroller.scrollHeight > scroller.clientHeight + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    ro.observe(el);
    const themes = new MutationObserver(paint);
    themes.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    return () => {
      ro.disconnect();
      themes.disconnect();
    };
  }, []);
  return (
    <div ref={box} className="iris-picker group/picker px-1" aria-label={interaction.title}>
      <div className="flex justify-end px-1">
        <button type="button" onClick={() => void cancel()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground">
          <Glyph name="x" size={12} />
          Skip
        </button>
      </div>
      {payload.html || payload.react ? (
        <AppFrame source={payload.react ?? payload.html ?? ""} streaming={false} threadId={interaction.threadId} stateKey={null} submit={answer} kind={payload.react ? "react" : "html"} />
      ) : (
        <IrisBlock source={payload.source ?? ""} streaming={false} threadId={interaction.threadId} mode="picker" stateKey={null} submit={answer} bare />
      )}
    </div>
  );
}

function CardTab({ threadId, params }: { threadId: string; params: unknown }) {
  const p = (params ?? {}) as { source?: string; language?: string };
  if (!p.source) return <div className="p-6 text-sm text-muted-foreground">This card is no longer available.</div>;
  return (
    <div className="h-full overflow-y-auto p-4">
      {p.language?.endsWith("-app") || p.language?.endsWith("-react") ? <AppFrame source={p.source} streaming={false} threadId={threadId} stateKey={null} kind={p.language.endsWith("-react") ? "react" : "html"} /> : <IrisBlock source={p.source} streaming={false} threadId={threadId} mode="panel" stateKey={null} bare />}
    </div>
  );
}

declare const __BB_PLUGIN_ID__: string | undefined;
const PLUGIN_ID = typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : "iris";
/** A dev copy (bb-plugin-iris-dev-*) renders ```<its id> blocks so it never collides with the live Iris. */
const LANG = PLUGIN_ID === "iris" ? "iris" : PLUGIN_ID;

export default definePluginApp((app) => {
  app.slots.experimental_codeFenceRenderer({ id: "iris", languages: [LANG, `${LANG}-app`, `${LANG}-react`], component: Fence });
  app.slots.pendingInteraction({ id: "iris-ask", component: AskPicker });
  app.slots.experimental_tab({
    id: "iris-card",
    title: "Iris card",
    icon: `${PLUGIN_ID}/mark`,
    layout: "flush",
    context: { kind: "thread" },
    availability: "action",
    component: ({ threadId, params }) => <CardTab threadId={threadId} params={params} />,
  });
  // A pinned card shows in the thread context card where bb has it on, and in the thread's Info tab everywhere.
  app.slots.experimental_threadContextCardSection({ id: "iris-pinned", title: "Pinned card", group: "iris", component: ({ threadId }) => <PinnedSection threadId={threadId} /> });
  app.slots.experimental_threadInfoSection({ id: "iris-pinned-info", group: "iris", component: ({ threadId }) => <PinnedInfoSection threadId={threadId} /> });
  // Prose you'd rather see as a card: one click puts the request in the composer, ready to send.
  app.slots.messageAction({
    id: "iris-as-card",
    title: "Show as an Iris card",
    icon: `${PLUGIN_ID}/mark`,
    run: ({ message, selectedText, composer }) => {
      if (!composer) return;
      const part = selectedText?.trim();
      const text = part
        ? `Show this as an Iris card:\n> ${part.slice(0, 2000).replace(/\n/g, "\n> ")}`
        : message.role === "assistant"
          ? "Show your answer above as an Iris card."
          : "Answer that with an Iris card.";
      composer.insert(text, { at: "end", block: true });
      composer.focus();
    },
  });
  app.composer.experimental_registerCommand({
    id: "iris-ask-card",
    title: "Iris: show that as a card",
    run: ({ composer }) => {
      composer.insert("Show that as an Iris card.", { at: "end", block: true });
      composer.focus();
    },
  });
  app.commands.register({
    id: "iris-playground",
    title: "Iris: open the playground in the browser",
    // A palette command gets no navigate handle, so it opens the page directly.
    run: () => void window.open(`${PLAYGROUND_URL}#/play`, "_blank", "noopener,noreferrer"),
  });
  app.slots.navPanel({ id: "gallery", title: PLUGIN_ID === "iris" ? "Iris" : `Iris (${PLUGIN_ID})`, icon: `${PLUGIN_ID}/mark`, path: "gallery", component: GalleryPage });
});
