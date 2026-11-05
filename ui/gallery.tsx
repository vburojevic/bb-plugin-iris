// The component gallery: a docs-style browser. A sidebar lists every group and
// component (with search and ⌘K); the main pane shows one component at a time on
// a framed stage with Preview, Code and Props tabs, and previous and next links.
// Deep links go through bb's panel routing: /plugins/iris/gallery/Chart opens
// Chart, /plugins/iris/gallery/react-Card the React kit's Card, and back and
// forward walk between them. Old #Chart links still open.
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CATALOG, GROUPS } from "../core/catalog";
import type { PropSpec } from "../core/catalog/spec";
import { KIT } from "../core/react-kit";
import { AppFrame } from "./app-frame";
import { IrisBlock } from "./block";
import { IrisMark } from "./brand";
import { usePalette } from "./palette";
import { Glyph, cn } from "./views/kit";

interface Entry {
  id: string;
  name: string;
  group: string;
  summary: string;
  example: string;
  aliases: string[];
  props: [string, { type: string; doc: string; required?: boolean; def?: unknown; values?: readonly string[] }][];
  kind: "iris" | "react";
}

const REACT_GROUP = "React kit";

const ENTRIES: Entry[] = [
  ...[...CATALOG]
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group))
    .map((c) => ({
      id: c.name,
      name: c.name,
      group: c.group as string,
      summary: c.summary,
      example: c.example,
      aliases: [...(c.aliases ?? [])],
      props: Object.entries(c.props).map(([k, p]: [string, PropSpec]) => [k, { type: p.type, doc: p.doc, required: p.required, def: p.def, values: p.values }] as Entry["props"][number]),
      kind: "iris" as const,
    })),
  ...KIT.map((k) => ({
    id: `react-${k.name}`,
    name: k.name,
    group: REACT_GROUP,
    summary: k.summary,
    example: k.example,
    aliases: [],
    props: Object.entries(k.props).map(([n, p]) => [n, { type: p.type, doc: p.doc, required: p.required, def: p.def }] as Entry["props"][number]),
    kind: "react" as const,
  })),
];
const BY_ID = new Map(ENTRIES.map((e) => [e.id.toLowerCase(), e]));
/** True when the gallery has a page for this id (a component name, or react-<Name> for the React kit). */
export function hasGalleryEntry(id: string): boolean {
  return BY_ID.has(id.toLowerCase());
}
const GROUP_ORDER = [...GROUPS, REACT_GROUP].filter((g) => ENTRIES.some((e) => e.group === g));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

function matches(e: Entry, q: string) {
  if (!q) return true;
  return e.name.toLowerCase().includes(q) || e.group.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q) || e.aliases.some((a) => a.toLowerCase().includes(q));
}

function entryFor(subPath: string): Entry | null {
  const id = subPath
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })[0];
  return id ? (BY_ID.get(id.toLowerCase()) ?? null) : null;
}

/** True when a key event comes from somewhere a shortcut must not fire: text entry, a live example, or a dialog. */
function keepKeys(ev: KeyboardEvent): boolean {
  const t = ev.target instanceof Element ? ev.target : null;
  if (ev.defaultPrevented || ev.isComposing || !t) return true;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName))) return true;
  return Boolean(t.closest("[data-iris-stage], [aria-modal='true'], [role='dialog']"));
}

/** brand: false drops Iris's own name and mark, for a host page (the public site) that already shows them. */
export function GalleryPage({ subPath = "", brand = true }: { subPath?: string; brand?: boolean }) {
  const palette = usePalette();
  const root = useRef<HTMLDivElement | null>(null);
  const main = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const navigate = useBbNavigate();
  const current = entryFor(subPath);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [width, setWidth] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const wide = width >= 820;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const open = useCallback(
    (e: Entry | null) => {
      setMenuOpen(false);
      navigate.toPluginPanel("gallery", { subPath: e ? e.id : "" });
      main.current?.scrollTo({ top: 0 });
    },
    [navigate],
  );

  // ⌘K or / focuses search while the gallery has focus, never from inside a live example or a dialog.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onKey = (ev: KeyboardEvent) => {
      const k = ev.key === "k" && (ev.metaKey || ev.ctrlKey) && !ev.altKey && !ev.shiftKey;
      const slash = ev.key === "/" && !ev.metaKey && !ev.ctrlKey && !ev.altKey;
      if ((!k && !slash) || keepKeys(ev)) return;
      ev.preventDefault();
      // Focus right away when the search is on screen, so the next keys land in it.
      if (wide) search.current?.focus();
      else setMenuOpen(true);
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [wide]);

  useEffect(() => {
    if (wide) setMenuOpen(false);
  }, [wide]);

  // The phone menu is a dialog: focus moves into it, Escape closes it, focus returns to its button.
  useEffect(() => {
    if (!menuOpen) return;
    requestAnimationFrame(() => search.current?.focus());
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        setMenuOpen(false);
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      trigger.current?.focus();
    };
  }, [menuOpen]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => ENTRIES.filter((e) => matches(e, q)), [q]);
  useEffect(() => setCursor(q || !current ? 0 : Math.max(0, results.indexOf(current))), [q, current]); // eslint-disable-line react-hooks/exhaustive-deps

  const index = current ? ENTRIES.indexOf(current) : -1;
  const prev = index > 0 ? ENTRIES[index - 1] : null;
  const next = index >= 0 && index < ENTRIES.length - 1 ? ENTRIES[index + 1] : null;

  const nav = (
    <Sidebar
      results={results}
      query={query}
      setQuery={setQuery}
      cursor={cursor}
      setCursor={setCursor}
      current={current}
      open={open}
      searchRef={search}
      compact={!wide}
      brand={brand}
      onClose={() => setMenuOpen(false)}
      onEscape={() => (wide ? root.current?.focus() : setMenuOpen(false))}
    />
  );

  return (
    <div ref={root} tabIndex={-1} data-iris-root="" className="iris-gallery relative flex h-full min-h-0 bg-background text-foreground outline-none" style={{ ["--iris-accent" as string]: palette.accent }}>
      {wide ? <aside className="flex w-[264px] shrink-0 flex-col border-r border-border">{nav}</aside> : null}
      <div ref={main} className="min-w-0 flex-1 overflow-y-auto">
        {!wide ? (
          <div inert={menuOpen ? true : undefined} className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background px-4 py-2.5">
            <button
              ref={trigger}
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/60 px-3 text-left text-[13.5px] ring-1 ring-border"
              aria-haspopup="dialog"
            >
              <Glyph name="panel-left" size={15} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{current ? current.name : "All components"}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{current?.group}</span>
              <Glyph name="chevrons-up-down" size={14} className="shrink-0 text-muted-foreground" />
            </button>
          </div>
        ) : null}
        {!wide && menuOpen ? (
          <div role="dialog" aria-modal="true" aria-label="Components" className="absolute inset-0 z-40 flex flex-col bg-background">
            <div className="min-h-0 flex-1">{nav}</div>
          </div>
        ) : null}
        <div inert={!wide && menuOpen ? true : undefined} className={cn("mx-auto w-full max-w-[920px]", wide ? "px-10 pb-16 pt-9" : "px-4 pb-12 pt-5")}>
          {current ? <Detail key={current.id} entry={current} prev={prev} next={next} open={open} narrowPage={!wide} /> : <Overview open={open} brand={brand} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sidebar

function Sidebar({
  results,
  query,
  setQuery,
  cursor,
  setCursor,
  current,
  open,
  searchRef,
  compact,
  brand,
  onClose,
  onEscape,
}: {
  results: Entry[];
  query: string;
  setQuery: (q: string) => void;
  cursor: number;
  setCursor: (n: number) => void;
  current: Entry | null;
  open: (e: Entry | null) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  compact: boolean;
  brand: boolean;
  onClose: () => void;
  onEscape: () => void;
}) {
  const list = useRef<HTMLDivElement | null>(null);
  const searching = query.trim().length > 0;
  const [typing, setTyping] = useState(false);
  // Scrolls only the list, never bb's own containers around it.
  const reveal = (sel: string, center: boolean) => {
    const box = list.current;
    const el = box?.querySelector<HTMLElement>(sel);
    if (!box || !el) return;
    const top = el.offsetTop - box.offsetTop;
    if (center) box.scrollTop = top - box.clientHeight / 2 + el.offsetHeight / 2;
    else if (top < box.scrollTop) box.scrollTop = top - 8;
    else if (top + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + el.offsetHeight - box.clientHeight + 8;
  };

  // Keep the open component in view in the list.
  useEffect(() => {
    if (!current || searching) return;
    reveal(`[data-entry="${CSS.escape(current.id)}"]`, true);
  }, [current, searching]);

  useEffect(() => {
    if (!typing) return;
    if (cursor === 0 && list.current) list.current.scrollTop = 0;
    else reveal(`[data-cursor="true"]`, false);
  }, [cursor, typing]);

  const onKeyDown = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setCursor(Math.min(results.length - 1, cursor + 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setCursor(Math.max(0, cursor - 1));
    } else if (ev.key === "Enter" && results[cursor]) {
      ev.preventDefault();
      open(results[cursor]);
    } else if (ev.key === "Escape") {
      setQuery("");
      onEscape();
    }
  };

  const groups = GROUP_ORDER.map((g) => ({ group: g, items: results.filter((e) => e.group === g) })).filter((g) => g.items.length);
  let flat = -1;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="px-3 pb-2 pt-3.5">
        <div className="mb-3 flex items-center gap-1">
          <button type="button" onClick={() => open(null)} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1.5 py-1 text-left hover:bg-state-hover">
            {brand ? <IrisMark size={24} /> : null}
            <span className="text-[15px] font-semibold tracking-[-0.01em]">{brand ? "Iris" : "Components"}</span>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{CATALOG.length} components</span>
          </button>
          {compact ? (
            <button type="button" onClick={onClose} className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-state-hover hover:text-foreground" aria-label="Close">
              <Glyph name="x" size={18} />
            </button>
          ) : null}
        </div>
        <label className="flex h-9 items-center gap-2 rounded-lg bg-muted/60 px-2.5 text-[13px] ring-1 ring-border focus-within:ring-[color:var(--iris-accent)]">
          <Glyph name="search" size={14} className="shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={typing && results[cursor] ? `iris-opt-${results[cursor].id}` : undefined}
            placeholder="Find a component"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
            aria-label="Find a component"
            aria-controls="iris-gallery-list"
          />
          {query ? (
            <button type="button" onClick={() => setQuery("")} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <Glyph name="x" size={13} />
            </button>
          ) : compact ? null : (
            <kbd className="shrink-0 rounded border border-border px-1 font-sans text-[10.5px] text-muted-foreground">⌘K</kbd>
          )}
        </label>
      </div>
      <div ref={list} id="iris-gallery-list" className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" role="listbox" aria-label="Components">
        {!groups.length ? <p className="px-2 py-6 text-center text-[13px] text-muted-foreground">Nothing matches “{query}”</p> : null}
        {groups.map(({ group, items }) => (
          <div key={group} role="group" aria-labelledby={`iris-grp-${slug(group)}`} className="mt-3 first:mt-1">
            <div id={`iris-grp-${slug(group)}`} className="flex items-baseline px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {group}
              <span className="ml-auto font-medium tabular-nums">{items.length}</span>
            </div>
            {items.map((e) => {
              flat += 1;
              const active = current?.id === e.id;
              const focused = typing && flat === cursor;
              return (
                <button
                  key={e.id}
                  type="button"
                  role="option"
                  id={`iris-opt-${e.id}`}
                  tabIndex={-1}
                  aria-selected={active}
                  data-entry={e.id}
                  data-cursor={focused}
                  onClick={() => open(e)}
                  className={cn(
                    "relative flex w-full items-center gap-2 rounded-md py-[5px] pl-2.5 pr-2 text-left text-[13px] transition-colors",
                    active ? "bg-[color:var(--iris-accent-soft)] font-medium text-foreground" : focused ? "bg-state-hover text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
                  )}
                  style={{ ["--iris-accent-soft" as string]: "color-mix(in oklab, var(--iris-accent) 14%, transparent)" }}
                >
                  {active ? <span className="absolute left-0 top-1.5 bottom-1.5 w-[2.5px] rounded-full bg-[color:var(--iris-accent)]" aria-hidden /> : null}
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- overview

// A live card fed by Iris's own sample of the public plugin data contract.
// bb's own live data that needs no thread: plan usage, machines and plugin health.
const BB_DEMO = `<let u={load("bb:usage")} />
<let m={load("bb:machines")} />
<let p={load("bb:plugins")} />
<Card title="Live data from bb itself" icon="activity" state="live" subtitle={\`load("bb:usage"), bb:machines, bb:plugins\`}>
  <Row>
    <Metric label="Machines online" value={\`\${m.filter((x) => x.status == "connected").length} of \${m.length}\`} />
    <Metric label="Plugins healthy" value={\`\${p.filter((x) => x.status == "running" && !x.detail).length} of \${p.length}\`} />
  </Row>
  <Budget lines={u.filter((w) => w.usedPercent != null).map((w) => ({ label: \`\${w.provider} · \${w.label}\`, spent: w.usedPercent, limit: 100, unit: "percent" }))} />
  In a thread, bb:thread, bb:threads, bb:pr, bb:commits, bb:changes and bb:environments read that thread's own live data too.
</Card>`;

const LIVE_DEMO = `<let d={load("plugin:iris/example")} />
<Card title="Live data from any plugin" icon="radio" state="live" subtitle={\`load("plugin:iris/example") · updated \${d.updated ? fmt(d.updated, "date") : ""}\`}>
  <Row>
    <Metric label="Seconds" value={d.seconds} note="re-read every 2 s" />
    <Metric label="Latest value" value={d.points ? d.points[d.points.length - 1].value : null} trend={d.points ? d.points.map((p) => p.value) : []} />
  </Row>
  Any bb plugin can serve JSON under \`/iris/\` and cards read it live with \`load("plugin:pluginId/name")\`.
</Card>`;

function Overview({ open, brand }: { open: (e: Entry) => void; brand: boolean }) {
  return (
    <div>
      <div className="flex items-center gap-3">
        {brand ? <IrisMark size={44} /> : null}
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em]">{brand ? "Iris" : "Components"}</h1>
          <p className="text-[13.5px] text-muted-foreground">{brand ? "Live, interactive UI in your bb chat" : `${CATALOG.length} components, each live in your theme`}</p>
        </div>
      </div>
      <p className="mt-4 max-w-[640px] text-[14px] leading-relaxed text-muted-foreground">
        Agents draw these in replies with <InlineCode>```iris</InlineCode> blocks, and as apps with <InlineCode>```iris-react</InlineCode>. Every example is live and wears your theme's colors. Pick one to see it, its code and every prop.
      </p>
      <div className="mt-8" data-iris-stage="">
        <IrisBlock source={BB_DEMO} streaming={false} threadId={null} mode="gallery" stateKey={null} />
        <IrisBlock source={LIVE_DEMO} streaming={false} threadId={null} mode="gallery" stateKey={null} />
      </div>
      <div className="mt-8 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 248px), 1fr))" }}>
        {GROUP_ORDER.map((g) => {
          const items = ENTRIES.filter((e) => e.group === g);
          return (
            <section key={g} className="rounded-xl bg-card p-3.5 shadow-[0_0_0_1px_var(--border)]">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[13.5px] font-semibold">{g}</h2>
                <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {items.map((e) => (
                  <button key={e.id} type="button" onClick={() => open(e)} className="rounded-md px-1.5 py-0.5 text-[12.5px] text-muted-foreground ring-1 ring-border transition-colors hover:bg-state-hover hover:text-foreground">
                    {e.name}
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- detail

type TabName = "preview" | "code";

function Detail({ entry, prev, next, open, narrowPage }: { entry: Entry; prev: Entry | null; next: Entry | null; open: (e: Entry) => void; narrowPage: boolean }) {
  const [tab, setTab] = useState<TabName>("preview");
  const [narrow, setNarrow] = useState(false);
  const [run, setRun] = useState(0);
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(entry.example).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  const tabs: { id: TabName; label: string }[] = [
    { id: "preview", label: "Preview" },
    { id: "code", label: "Code" },
  ];

  return (
    <article>
      <p className="text-[12.5px] text-muted-foreground">{entry.group}</p>
      <h1 className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.03em]">{entry.name}</h1>
      <p className="mt-1.5 max-w-[680px] text-[14px] leading-relaxed text-muted-foreground">{entry.summary}</p>
      {entry.aliases.length ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Also answers to{" "}
          {entry.aliases.map((a) => (
            <span key={a} className="mr-1">
              <InlineCode>{a}</InlineCode>
            </span>
          ))}
        </p>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-[14px] bg-card shadow-[0_0_0_1px_var(--border)]">
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5" role="tablist" aria-label={`${entry.name} views`}>
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors", tab === t.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
            >
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-0.5">
            {tab === "preview" && !narrowPage ? (
              <ToolButton label={narrow ? "Full width" : "Phone width"} icon={narrow ? "monitor" : "smartphone"} onClick={() => setNarrow(!narrow)} active={narrow} />
            ) : null}
            {tab === "preview" ? <ToolButton label="Reset" icon="rotate-ccw" onClick={() => setRun(run + 1)} /> : null}
            <ToolButton label={copied ? "Copied" : "Copy code"} icon={copied ? "check" : "copy"} onClick={copy} />
          </div>
        </div>
        {tab === "preview" ? (
          <div data-iris-stage="" className="bg-muted/35 p-4 sm:p-6">
            <div key={run} className={cn("mx-auto min-w-0 transition-[max-width] duration-300", narrow ? "max-w-[390px]" : "max-w-full")}>
              {entry.kind === "react" ? (
                <AppFrame source={entry.example} streaming={false} threadId={null} stateKey={null} kind="react" />
              ) : (
                <IrisBlock source={entry.example} streaming={false} threadId={null} mode="gallery" stateKey={null} />
              )}
            </div>
          </div>
        ) : (
          <pre className="max-h-[560px] overflow-auto p-4 font-mono text-[12.5px] leading-relaxed">
            <code>{entry.example}</code>
          </pre>
        )}
      </div>

      {entry.props.length ? (
        <section className="mt-8">
          <h2 className="flex items-baseline gap-2 text-[15px] font-semibold">
            Props <span className="text-xs font-normal tabular-nums text-muted-foreground">{entry.props.length}</span>
          </h2>
          <div className="mt-3 overflow-hidden rounded-[14px] shadow-[0_0_0_1px_var(--border)]">
            <PropsTable props={entry.props} stacked={narrowPage} />
          </div>
        </section>
      ) : null}

      <nav className="mt-10 grid grid-cols-2 gap-3" aria-label="Previous and next">
        {prev ? <PageLink entry={prev} dir="prev" open={open} /> : <span />}
        {next ? <PageLink entry={next} dir="next" open={open} /> : <span />}
      </nav>
    </article>
  );
}

function PropsTable({ props, stacked }: { props: Entry["props"]; stacked: boolean }) {
  if (!props.length) return <p className="p-4 text-[13px] text-muted-foreground">No props.</p>;
  const type = (p: Entry["props"][number][1]) => (p.values ? p.values.map((v) => `"${v}"`).join(" | ") : p.type);
  if (stacked)
    return (
      <div className="divide-y divide-border/60">
        {props.map(([name, p]) => (
          <div key={name} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <code className="font-mono text-[12.5px] font-medium">{name}</code>
              {p.required ? <span className="text-[11px] text-muted-foreground">required</span> : null}
            </div>
            <code className="mt-0.5 block break-words font-mono text-[12px] text-muted-foreground">{type(p)}</code>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{p.doc}</p>
            {p.def !== undefined ? <p className="mt-0.5 text-[11.5px] text-muted-foreground">Default {JSON.stringify(p.def)}</p> : null}
          </div>
        ))}
      </div>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="w-[1%] whitespace-nowrap border-b border-border px-4 py-2 font-medium">Prop</th>
            <th className="w-[34%] border-b border-border px-4 py-2 font-medium">Type</th>
            <th className="border-b border-border px-4 py-2 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {props.map(([name, p]) => (
            <tr key={name} className="align-top [&:not(:last-child)>td]:border-b [&>td]:border-border/60">
              <td className="whitespace-nowrap px-4 py-2.5">
                <code className="font-mono text-[12.5px] font-medium">{name}</code>
                {p.required ? <span className="ml-1.5 text-[11px] text-muted-foreground">required</span> : null}
              </td>
              <td className="px-4 py-2.5">
                <code className="break-words font-mono text-[12px] text-muted-foreground">{type(p)}</code>
                {p.def !== undefined ? <div className="mt-0.5 text-[11.5px] text-muted-foreground">Default {JSON.stringify(p.def)}</div> : null}
              </td>
              <td className="px-4 py-2.5 leading-relaxed text-muted-foreground">{p.doc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageLink({ entry, dir, open }: { entry: Entry; dir: "prev" | "next"; open: (e: Entry) => void }) {
  return (
    <button
      type="button"
      onClick={() => open(entry)}
      className={cn("group flex min-w-0 flex-col rounded-xl px-4 py-3 shadow-[0_0_0_1px_var(--border)] transition-colors hover:bg-state-hover", dir === "next" ? "items-end text-right" : "items-start text-left")}
    >
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {dir === "prev" ? <Glyph name="arrow-left" size={12} /> : null}
        {dir === "prev" ? "Previous" : "Next"}
        {dir === "next" ? <Glyph name="arrow-right" size={12} /> : null}
      </span>
      <span className="mt-0.5 max-w-full truncate text-[14px] font-medium">{entry.name}</span>
      <span className="max-w-full truncate text-xs text-muted-foreground">{entry.group}</span>
    </button>
  );
}

function ToolButton({ label, icon, onClick, active }: { label: string; icon: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn("grid size-7 place-items-center rounded-md transition-colors", active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-state-hover hover:text-foreground")}
    >
      <Glyph name={icon} size={14} />
    </button>
  );
}

function InlineCode({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">{children}</code>;
}
