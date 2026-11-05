// A stand-in for "@get-bb/plugin-sdk/app" so Iris's real views run on a static
// page (the public playground). Nothing here reaches a server: RPCs answer with
// sample data or a short "only inside bb" note, navigation moves the page hash,
// and composer actions show a toast instead of typing into bb.
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

// ---------- toast ----------

type Toast = { id: number; text: string };
const toastListeners = new Set<(t: Toast) => void>();
let toastId = 0;
export function toast(text: string) {
  const t = { id: ++toastId, text };
  for (const fn of toastListeners) fn(t);
}
export function Toasts() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => {
    const fn = (t: Toast) => {
      setList((l) => [...l, t]);
      setTimeout(() => setList((l) => l.filter((x) => x.id !== t.id)), 3200);
    };
    toastListeners.add(fn);
    return () => void toastListeners.delete(fn);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {list.map((t) => (
        <div key={t.id} className="pointer-events-auto max-w-[min(92vw,560px)] rounded-xl bg-card px-4 py-2.5 text-[13px] text-foreground shadow-[0_0_0_1px_var(--border),0_12px_32px_-12px_rgb(0_0_0/0.5)]">
          {t.text}
        </div>
      ))}
    </div>
  );
}

// ---------- RPC ----------

const now = Date.now();
const SAMPLE_BB: Record<string, unknown> = {
  thread: { id: "thr_demo", title: "Ship the onboarding redesign", status: "active", waitingOnYou: false, queued: 0, branch: "onboarding-redesign", context: { used: 412_000, window: 1_000_000, percent: 41.2, model: "claude-opus", estimated: false, categories: [{ label: "Messages", tokens: 301_000 }, { label: "Tools", tokens: 64_000 }, { label: "System", tokens: 47_000 }] }, cost: { amount: 4.82, currency: "USD" } },
  threads: [
    { id: "thr_a", title: "Onboarding: welcome screens", status: "idle", waitingOnYou: false, queuedWork: "none", updatedAt: now - 120_000, branch: "onboarding-welcome" },
    { id: "thr_b", title: "Onboarding: permissions step", status: "active", waitingOnYou: false, queuedWork: "none", updatedAt: now - 15_000, branch: "onboarding-permissions" },
    { id: "thr_c", title: "Review: onboarding copy", status: "idle", waitingOnYou: true, queuedWork: "waiting", updatedAt: now - 600_000, branch: null },
  ],
  usage: [
    { provider: "claude-code", plan: "Max", label: "Current session", usedPercent: 38, resetsAt: new Date(now + 3 * 3_600_000).toISOString(), spentUsd: null, limitUsd: null },
    { provider: "claude-code", plan: "Max", label: "Weekly limit", usedPercent: 61, resetsAt: new Date(now + 4 * 86_400_000).toISOString(), spentUsd: null, limitUsd: null },
  ],
  machines: [
    { name: "Studio Mac", status: "connected", lastSeenAt: now - 4000 },
    { name: "Build server", status: "connected", lastSeenAt: now - 9000 },
  ],
  terminals: [
    { id: "term_web", title: "npm run dev", status: "running", exitCode: null, cwd: "~/checkout-service", createdAt: now - 1_800_000, output: "\u001b[32m✓\u001b[0m Ready in 1.2s\n\u001b[2m○ Local:   http://localhost:3000\u001b[0m\n GET /checkout 200 in 41ms\n GET /api/cart 200 in 12ms\n" },
    { id: "term_test", title: "vitest --watch", status: "exited", exitCode: 1, cwd: "~/checkout-service", createdAt: now - 600_000, output: " \u001b[31m✗\u001b[0m CartTotals applies discount once\n Tests  1 failed | 142 passed (143)\n" },
  ],
  plugins: [
    { id: "iris", version: "0.6.0", status: "running", detail: null },
    { id: "github-status", version: "1.2.0", status: "running", detail: null },
    { id: "notes", version: "0.3.1", status: "degraded", detail: "sync paused" },
  ],
};

async function sampleDataUrl(path: string): Promise<string> {
  const blob = await (await fetch(new URL(path, location.href))).blob();
  return await new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
}

const ONLY_IN_BB = "This reads a thread's live data inside bb; the playground shows sample data where it can.";

async function call(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "bb_data": {
      const spec = String(input.spec ?? "");
      const key = spec.slice(3).split("?")[0];
      return key in SAMPLE_BB ? { ok: true, value: SAMPLE_BB[key] } : { ok: false, error: ONLY_IN_BB };
    }
    case "web_status":
      // On: PhotoSearch answers with a bundled Wikimedia photo; maps show their list of places.
      return { enabled: true };
    case "state_get":
      return { state: null };
    case "state_set":
      return { ok: true };
    case "thread_info":
      return { environmentId: null, workspacePath: null, storagePath: null, hostId: null };
    case "load_image":
      return { ok: true, dataUrl: await sampleDataUrl("samples/screen.webp") };
    case "load_file": {
      // Code examples read a real Iris source file; other files exist only in a bb thread.
      const p = String(input.path ?? "");
      if (/\.(ts|tsx|js|mjs)$/.test(p)) return { ok: true, value: await (await fetch(new URL("samples/parse.ts", location.href))).text() };
      return { ok: false, error: "files load inside a bb thread" };
    }
    case "photo_search":
      return { ok: true, photo: await (await fetch(new URL("samples/photo.json", location.href))).json() };
    case "load_model":
    case "file_url":
    case "folder_files":
      return { ok: false, error: "files load inside a bb thread" };
    default:
      return { ok: false, error: ONLY_IN_BB };
  }
}

export function useRpc<_T = unknown>() {
  return useMemo(() => ({ call: (name: string, input: Record<string, unknown>) => call(name, input) }), []) as never;
}

// ---------- navigation and composers ----------

export function useBbNavigate() {
  return useMemo(
    () => ({
      toPluginPanel: (_path: string, opts?: { subPath?: string; replace?: boolean }) => {
        // The gallery's own home is the site's Components page; the site's front page is #/.
        const hash = `#/${opts?.subPath || "components"}`;
        if (opts?.replace) history.replaceState(null, "", hash);
        else location.hash = hash;
        dispatchEvent(new HashChangeEvent("hashchange"));
      },
      openUrl: (url: string) => window.open(url, "_blank", "noopener,noreferrer"),
      toThread: () => toast("In bb, this opens the thread."),
      toProject: () => toast("In bb, this opens the project."),
      experimental_openFilePreview: () => toast("In bb, this opens the file."),
    }),
    [],
  ) as never;
}

export function useComposers() {
  return useMemo(
    () => [
      {
        scope: { kind: "thread", threadId: "thr_demo" },
        insert: async (text: string) => toast(`In bb, this goes into your message: “${text.slice(0, 120)}${text.length > 120 ? "…" : ""}”`),
        replace: async (text: string) => toast(`In bb, this goes into your message: “${text.slice(0, 120)}${text.length > 120 ? "…" : ""}”`),
        submit: async () => toast("In bb, this sends it to the agent."),
        focus: () => undefined,
      },
    ],
    [],
  ) as never;
}

export function experimental_useAppPanel() {
  return { openTab: () => toast("In bb, this opens the card in a side panel.") } as never;
}

export async function experimental_copyToClipboard(text: string) {
  await navigator.clipboard?.writeText(text);
  toast("Copied");
}

// ---------- host components ----------

let mermaidModule: Promise<typeof import("mermaid").default> | null = null;
/** Mermaid in the page's theme: its colors come from the theme's own variables on every render. */
async function mermaid() {
  mermaidModule ??= import("mermaid").then((m) => m.default);
  const m = await mermaidModule;
  const css = getComputedStyle(document.documentElement);
  // Themes write colors as color-mix() or oklch(), which Mermaid's color parser rejects; a 1x1
  // canvas resolves any CSS color to plain rgb.
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const rgb = (color: string, fallback: string) => {
    if (!probe) return fallback;
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = fallback;
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return a ? `rgb(${r}, ${g}, ${b})` : fallback;
  };
  const v = (name: string, fallback: string) => rgb(css.getPropertyValue(name).trim() || fallback, fallback);
  const dark = document.documentElement.classList.contains("dark");
  m.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    // A diagram's own %%{init}%% directive can't restyle the page or change its theme.
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "theme", "themeCSS", "themeVariables", "fontFamily", "altFontFamily", "darkMode", "htmlLabels"],
    theme: "base",
    fontFamily: "inherit",
    themeVariables: {
      darkMode: dark,
      background: v("--card", dark ? "#141821" : "#ffffff"),
      primaryColor: v("--card", dark ? "#141821" : "#ffffff"),
      primaryTextColor: v("--foreground", dark ? "#e8e8ea" : "#222"),
      primaryBorderColor: v("--primary", "#888"),
      secondaryColor: v("--muted", dark ? "#1d2230" : "#f1f1f1"),
      tertiaryColor: v("--muted", dark ? "#1d2230" : "#f1f1f1"),
      lineColor: v("--muted-foreground", "#888"),
      textColor: v("--foreground", dark ? "#e8e8ea" : "#222"),
      edgeLabelBackground: v("--card", dark ? "#141821" : "#ffffff"),
    },
  });
  return m;
}

function MermaidBlock({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    const style = document.getElementById("bb-app-theme");
    if (style) mo.observe(style, { childList: true, characterData: true, subtree: true });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    let live = true;
    mermaid()
      .then((m) => m.render(`m${Math.random().toString(36).slice(2)}`, source))
      .then(({ svg }) => {
        if (live && ref.current) ref.current.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ["foreignObject"] });
      })
      .catch((e: unknown) => {
        console.warn("Mermaid couldn't draw this diagram", e);
        if (live && ref.current) ref.current.textContent = source;
      });
    return () => {
      live = false;
    };
  }, [source, themeTick]);
  return <div ref={ref} className="flex justify-center overflow-x-auto [&_svg]:max-w-full" />;
}

// Markdown in cards may come from a share link, so only plain prose survives: no styles, forms or
// images (an image would be a network request), and links open in a new tab.
const MARKDOWN_TAGS = ["p", "br", "strong", "b", "em", "i", "del", "s", "code", "pre", "ul", "ol", "li", "a", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "table", "thead", "tbody", "tr", "th", "td", "span"];
const MARKDOWN_ATTRS = ["href", "title", "align", "start"];
let linkHook = false;
function sanitizeMarkdown(html: string): string {
  if (!linkHook) {
    linkHook = true;
    DOMPurify.addHook("afterSanitizeAttributes", (node) => {
      if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      }
    });
  }
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: MARKDOWN_TAGS, ALLOWED_ATTR: MARKDOWN_ATTRS, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#)/i });
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const mermaidOnly = /^```mermaid\n([\s\S]*?)\n```\s*$/.exec(content);
  if (mermaidOnly) return <MermaidBlock source={mermaidOnly[1]} />;
  const html = sanitizeMarkdown(marked.parse(content, { async: false, gfm: true, breaks: false }) as string);
  return <div className={`iris-site-markdown ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function experimental_SourceCode({ content, highlightedLines }: { content: string; path?: string; highlightedLines?: { start: number; end: number } | null; overflow?: string }) {
  const lines = content.split("\n");
  return (
    <pre className="overflow-auto py-2 font-mono text-[12.5px] leading-[1.6]">
      {lines.map((l, k) => {
        const n = k + 1;
        const on = highlightedLines && n >= highlightedLines.start && n <= highlightedLines.end;
        return (
          <div key={k} className={on ? "bg-[color:color-mix(in_oklab,var(--primary)_14%,transparent)]" : undefined}>
            <span className="inline-block w-10 select-none pr-3 text-right text-muted-foreground">{n}</span>
            {l || " "}
          </div>
        );
      })}
    </pre>
  );
}

export function experimental_Diff({ patch }: { patch: string; path?: string; view?: string; overflow?: string }): ReactNode {
  return (
    <pre className="overflow-auto py-2 font-mono text-[12.5px] leading-[1.6]">
      {patch.split("\n").map((l, k) => (
        <div
          key={k}
          className="px-3"
          style={l.startsWith("+") && !l.startsWith("+++") ? { background: "color-mix(in oklab, var(--success, #3fb950) 16%, transparent)" } : l.startsWith("-") && !l.startsWith("---") ? { background: "color-mix(in oklab, var(--destructive, #f85149) 16%, transparent)" } : l.startsWith("@@") ? { color: "var(--muted-foreground)" } : undefined}
        >
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

export function definePluginApp<T>(fn: T): T {
  return fn;
}
