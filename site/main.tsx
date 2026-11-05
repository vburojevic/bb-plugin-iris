// The public Iris site: a front page, the real gallery and a live editor, running
// the same views as the plugin with bb's SDK swapped for site/sdk-shim.tsx.
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CATALOG, GROUPS } from "../core/catalog";
import { IrisBlock } from "../ui/block";
import { IrisMark } from "../ui/brand";
import { GalleryPage, hasGalleryEntry } from "../ui/gallery";
import { Glyph, cn } from "../ui/views/kit";
import { Editor, type EditorApi } from "./editor";
import { ESTIMATE, Landing } from "./landing";
import { Toasts, toast } from "./sdk-shim";
import { REPO, copyInstall, copyText, decode, encode, store } from "./share";
import { THEMES, defaultTheme, type ThemeName } from "./themes";

type Route =
  | { page: "home" }
  | { page: "components"; subPath: string; missing: string | null }
  | { page: "play"; shared: string | null; badLink: boolean };

function parse(hash: string): Route {
  const route = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  if (!route) return { page: "home" };
  if (/^play(\?|$)/i.test(route)) {
    const code = new URLSearchParams(route.split("?")[1] ?? "").get("c");
    const shared = code ? decode(code) : null;
    return { page: "play", shared: shared || null, badLink: Boolean(code) && !shared };
  }
  // #/components, #/components/Chart and #/Chart all work; an unknown name lands on the overview with a note.
  const sub = route.replace(/^components\/?/i, "");
  const name = (() => {
    try {
      return decodeURIComponent(sub.split("/")[0] ?? "");
    } catch {
      return sub;
    }
  })();
  if (!name || hasGalleryEntry(name)) return { page: "components", subPath: name, missing: null };
  return { page: "components", subPath: "", missing: name };
}

function useHash(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function useTheme(): [ThemeName, (t: ThemeName) => void] {
  const [theme, setTheme] = useState<ThemeName>(() => {
    const saved = store.get("local", "iris-site-theme");
    return saved && Object.hasOwn(THEMES, saved) ? (saved as ThemeName) : defaultTheme();
  });
  useEffect(() => {
    const t = THEMES[theme];
    const el = document.getElementById("bb-app-theme");
    if (el && el.textContent !== t.css) el.textContent = t.css;
    document.documentElement.classList.toggle("dark", t.dark);
    document.documentElement.style.colorScheme = t.dark ? "dark" : "light";
    document.documentElement.style.removeProperty("background");
    store.set("local", "iris-site-theme", theme);
  }, [theme]);
  return [theme, setTheme];
}

function Swatch({ theme }: { theme: ThemeName }) {
  return (
    <span className="site-swatch" style={{ background: THEMES[theme].swatch[0] }}>
      <span style={{ background: THEMES[theme].swatch[1] }} />
    </span>
  );
}

/** A disclosure with a list of theme buttons: focus moves into it, arrows move between them, Escape returns to the trigger. */
function ThemeMenu({ theme, setTheme }: { theme: ThemeName; setTheme: (t: ThemeName) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const list = useRef<HTMLDivElement | null>(null);
  const names = Object.keys(THEMES) as ThemeName[];
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("pointerdown", outside);
    return () => removeEventListener("pointerdown", outside);
  }, [open]);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items[next]?.focus();
  };
  return (
    <div
      className="site-menu"
      ref={box}
      onKeyDown={open ? onKeyDown : undefined}
      onBlur={(e) => {
        if (open && !box.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button ref={trigger} type="button" className="site-icon-button site-theme-trigger" aria-expanded={open} aria-controls="site-theme-list" aria-label={`Theme: ${theme}`} onClick={() => setOpen((o) => !o)}>
        <Swatch theme={theme} />
        <span className="site-theme-name">{theme}</span>
        <Glyph name="chevron-down" size={14} />
      </button>
      {open ? (
        <div className="site-menu-list" id="site-theme-list" ref={list} role="group" aria-label="Theme">
          {names.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === theme}
              onClick={() => {
                setTheme(t);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <Swatch theme={t} />
              {t}
              {t === theme ? <Glyph name="check" size={14} className="ml-auto" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const GitHubMark = () => (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
  </svg>
);

function Header({ page, theme, setTheme }: { page: Route["page"]; theme: ThemeName; setTheme: (t: ThemeName) => void }) {
  const tabs = [
    { label: "Overview", to: "#/", on: page === "home" },
    { label: "Components", to: "#/components", on: page === "components" },
    { label: "Playground", to: "#/play", on: page === "play" },
  ];
  return (
    <header className="site-header">
      <a href="#/" className="site-brand" aria-label="Iris, home">
        <IrisMark size={24} />
        <span>Iris</span>
      </a>
      <nav className="site-nav" aria-label="Sections">
        {tabs.map((t) => (
          <a key={t.label} href={t.to} aria-current={t.on ? "page" : undefined} className={cn(t.label === "Overview" && "site-nav-overview")}>
            {t.label}
          </a>
        ))}
      </nav>
      <div className="site-header-end">
        <ThemeMenu theme={theme} setTheme={setTheme} />
        <a href={REPO} className="site-icon-button" aria-label="Iris on GitHub">
          <GitHubMark />
        </a>
        <button type="button" className="site-button site-button-primary site-button-sm site-header-install" onClick={() => void copyInstall()}>
          <Glyph name="download" size={14} />
          Install
        </button>
      </div>
    </header>
  );
}

const DRAFT = "iris-play-source";

function Playground({ shared, badLink }: { shared: string | null; badLink: boolean }) {
  // A shared link wins; otherwise the last edit in this tab comes back, so leaving the page loses nothing.
  const [source, setSource] = useState(() => shared ?? store.get("session", DRAFT) ?? ESTIMATE);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [width, setWidth] = useState<"chat" | "phone">("chat");
  const [run, setRun] = useState(0);
  const editor = useRef<EditorApi | null>(null);
  const examples = useMemo(() => GROUPS.map((g) => ({ group: g, names: CATALOG.filter((c) => c.group === g).map((c) => c.name) })).filter((g) => g.names.length), []);
  useEffect(() => {
    if (shared !== null) {
      editor.current ? editor.current.replaceAll(shared) : setSource(shared);
      // Once opened, the link's markup is the draft; Back won't bring the link's version over later edits.
      history.replaceState(null, "", "#/play");
    }
  }, [shared]);
  useEffect(() => {
    if (badLink) {
      toast("That link's markup couldn't be read, so the playground opened your last draft.");
      history.replaceState(null, "", "#/play");
    }
  }, [badLink]);
  useEffect(() => {
    const t = setTimeout(() => store.set("session", DRAFT, source), 300);
    return () => clearTimeout(t);
  }, [source]);
  const replace = (text: string) => (editor.current ? editor.current.replaceAll(text) : setSource(text));
  const share = () => void copyText(`${location.origin}${location.pathname}#/play?c=${encode(source)}`, "Link copied. It opens this markup in the playground.");
  return (
    <div className="site-play" data-view={view}>
      <div className="site-play-switch" role="tablist" aria-label="View">
        {(["edit", "preview"] as const).map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}>
            {v === "edit" ? "Markup" : "Preview"}
          </button>
        ))}
      </div>
      <section className="site-play-pane site-play-edit" aria-label="Markup">
        <div className="site-toolbar">
          <label className="site-select">
            <Glyph name="layout-grid" size={14} />
            <select
              value=""
              onChange={(e) => {
                const c = CATALOG.find((x) => x.name === e.target.value);
                if (c) replace(c.example);
              }}
              aria-label="Load a component's example"
            >
              <option value="">Load an example</option>
              {examples.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <Glyph name="chevron-down" size={14} />
          </label>
          <span className="site-toolbar-spacer" />
          <button type="button" className="site-icon-button" onClick={() => replace(ESTIMATE)} aria-label="Start over" title="Start over (Cmd+Z undoes it)">
            <Glyph name="rotate-ccw" size={15} />
          </button>
          <button type="button" className="site-icon-button" onClick={() => void copyText(source, "Markup copied")} aria-label="Copy the markup" title="Copy the markup">
            <Glyph name="copy" size={15} />
          </button>
          <button type="button" className="site-button site-button-sm site-share" onClick={share} aria-label="Copy a share link">
            <Glyph name="link" size={14} />
            <span>Share</span>
          </button>
        </div>
        <Editor value={source} onChange={setSource} label="Iris markup" api={editor} />
        <p className="site-play-hint" id="site-editor-hint">
          The preview renders as you type. Tab indents; press Esc, then Tab, to move on. Loading an example or starting over can be undone with Cmd+Z. <a href="#/components">Every prop is in the gallery.</a>
        </p>
      </section>
      <section className="site-play-pane site-play-preview" aria-label="Preview">
        <div className="site-toolbar">
          <span className="site-toolbar-title">Preview</span>
          <span className="site-toolbar-spacer" />
          <div className="site-seg" role="radiogroup" aria-label="Preview width">
            {(["chat", "phone"] as const).map((w) => (
              <button key={w} type="button" role="radio" aria-checked={width === w} onClick={() => setWidth(w)} title={w === "chat" ? "Chat width" : "Phone width"}>
                <Glyph name={w === "chat" ? "monitor" : "smartphone"} size={14} />
                <span>{w === "chat" ? "Chat" : "Phone"}</span>
              </button>
            ))}
          </div>
          <button type="button" className="site-icon-button" onClick={() => setRun((n) => n + 1)} aria-label="Run again" title="Run again">
            <Glyph name="refresh-cw" size={15} />
          </button>
        </div>
        <div className="site-play-canvas">
          <div className="site-play-frame" data-width={width} data-iris-stage="">
            <IrisBlock key={run} source={source} streaming={false} threadId={null} mode="gallery" stateKey={null} />
          </div>
        </div>
      </section>
    </div>
  );
}

function App() {
  const route = parse(useHash());
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    document.getElementById("site-main")?.scrollTo({ top: 0 });
  }, [route.page]);
  const missing = route.page === "components" ? route.missing : null;
  useEffect(() => {
    if (!missing) return;
    toast(`There's no component named "${missing.slice(0, 60)}". Here is every one.`);
    history.replaceState(null, "", "#/components");
  }, [missing]);
  return (
    <div className="site-shell">
      <button type="button" className="site-skip" onClick={() => document.getElementById("site-main")?.focus()}>
        Skip to content
      </button>
      <Header page={route.page} theme={theme} setTheme={setTheme} />
      <main id="site-main" tabIndex={-1} className={cn("site-main", route.page === "home" && "site-main-scroll")}>
        {route.page === "home" ? <Landing theme={theme} setTheme={setTheme} /> : route.page === "play" ? <Playground shared={route.shared} badLink={route.badLink} /> : <GalleryPage subPath={route.subPath} brand={false} />}
      </main>
      <Toasts />
    </div>
  );
}

// Iris's own sample feed (plugin:iris/example), answered here as the plugin's server would.
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/v1/plugins/iris/http/iris/example")) {
    const t = Date.now();
    const minute = Math.floor(t / 60_000);
    const points = Array.from({ length: 12 }, (_, k) => ({ t: new Date((minute - 11 + k) * 60_000).toISOString(), value: Math.round(50 + 30 * Math.sin((minute - 11 + k) / 3)) }));
    return Promise.resolve(new Response(JSON.stringify({ source: "iris", updated: new Date(t).toISOString(), seconds: new Date(t).getSeconds(), points }), { headers: { "content-type": "application/json" } }));
  }
  return realFetch(input, init);
};

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
