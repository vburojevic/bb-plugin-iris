import { toneColor } from "../palette";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Markdown, experimental_Diff as HostDiff, experimental_SourceCode as SourceCode, useRpc } from "@get-bb/plugin-sdk/app";
import { isPendingValue, toText } from "../../core/evaluate";
import type { RpcContract } from "../../shared/rpc";
import { DEMO_THREAD } from "../demo";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Glyph, Shimmer, cn, num, str } from "./kit";
import { Prose } from "./prose";

const EXT: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", swift: "swift", py: "py", rb: "rb", go: "go", rs: "rs", sh: "sh", bash: "sh", zsh: "sh", json: "json", yaml: "yaml", yml: "yaml", css: "css", html: "html", md: "md", sql: "sql", kotlin: "kt", kt: "kt", java: "java", c: "c", cpp: "cpp", text: "txt", txt: "txt" };

function lineRange(spec: unknown): { start: number; end: number } | null {
  const s = str(spec);
  if (!s) return null;
  const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(s.trim());
  return m ? { start: Number(m[1]), end: Number(m[2] ?? m[1]) } : null;
}

function Frame({ title, right, children }: { title?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] bg-muted/30 ring-1 ring-border">
      {title || right ? (
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
          <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{title}</div>
          {right}
        </div>
      ) : null}
      <div className="min-w-0 text-[12.5px]">{children}</div>
    </div>
  );
}

export function CodeView({ props, text }: ViewProps) {
  const lang = str(props.lang) ?? "txt";
  const title = str(props.title);
  const path = title && title.includes(".") ? title : `snippet.${EXT[lang] ?? lang}`;
  return (
    <Frame title={title}>
      <SourceCode content={text ?? ""} path={path} highlightedLines={lineRange(props.lines)} overflow="scroll" />
    </Frame>
  );
}

export function SnippetView({ props }: ViewProps) {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const path = str(props.path) ?? "";
  const [state, setState] = useState<{ status: "loading" } | { status: "ok"; text: string } | { status: "error"; error: string }>({ status: "loading" });
  useEffect(() => {
    const threadId = env.threadId ?? DEMO_THREAD;
    if (!threadId) {
      setState({ status: "error", error: "files load only inside a thread" });
      return;
    }
    let live = true;
    rpc.call("load_file", { threadId, path, raw: true }).then(
      (r) => live && setState(r.ok ? { status: "ok", text: String(r.value) } : { status: "error", error: r.error }),
      (e: unknown) => live && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [env.threadId, path, rpc]);
  const from = Math.max(1, num(props.from) ?? 1);
  const all = state.status === "ok" ? state.text.split("\n") : [];
  const to = Math.min(all.length, num(props.to) ?? Math.min(all.length, from + 59));
  const content = all.slice(from - 1, to).join("\n");
  const hl = lineRange(props.highlight);
  const open = () => env.perform([{ $iris: "action", kind: "openFile", args: [path, from] }]);
  return (
    <Frame
      title={
        <button type="button" onClick={open} className="truncate hover:underline">
          {str(props.title) ?? `${path}${state.status === "ok" ? `:${from}-${to}` : ""}`}
        </button>
      }
      right={
        <button type="button" onClick={open} className="text-muted-foreground hover:text-foreground" aria-label="Open file">
          <Glyph name="external-link" size={13} />
        </button>
      }
    >
      {state.status === "loading" ? (
        <Shimmer className="m-3 h-20" />
      ) : state.status === "error" ? (
        <div className="px-3 py-2 text-xs text-destructive">{state.error}</div>
      ) : (
        <SourceCode content={content} path={path} overflow="scroll" highlightedLines={hl ? { start: hl.start - from + 1, end: hl.end - from + 1 } : null} />
      )}
    </Frame>
  );
}

export function DiffView({ props, text }: ViewProps) {
  const patch = str(props.patch) ?? text ?? "";
  const path = str(props.path) ?? "file";
  const adds = patch.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const dels = patch.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
  const [view, setView] = useState<"unified" | "split">(props.view === "split" ? "split" : "unified");
  return (
    <Frame
      title={str(props.title) ?? path}
      right={
        <span className="flex shrink-0 items-center gap-2 tabular-nums">
          <span style={{ color: "var(--diff-added, var(--success))" }}>+{adds}</span>
          <span style={{ color: "var(--diff-removed, var(--destructive))" }}>−{dels}</span>
          <button type="button" className="ml-1 text-muted-foreground hover:text-foreground" onClick={() => setView(view === "unified" ? "split" : "unified")} aria-label="Switch diff layout">
            <Glyph name={view === "unified" ? "columns-2" : "rows-2"} size={13} />
          </button>
        </span>
      }
    >
      <HostDiff patch={patch} path={path} view={view} overflow="scroll" />
    </Frame>
  );
}

// ---------- ANSI logs ----------

export { normalizeEscapes, parseAnsi } from "../../core/ansi";
import { normalizeEscapes, parseAnsi } from "../../core/ansi";

export const ERROR_LINE = /\b(error|failed|fail|fatal|exception|panic)\b|✗|✘|×/i;
export const WARN_LINE = /\bwarn(ing)?\b/i;

export function LogsView({ props, text }: ViewProps) {
  const raw = isPendingValue(props.text) ? null : (str(props.text) ?? text ?? "");
  const exit = num(props.exit);
  const [filter, setFilter] = useState("");
  const tail = Math.max(20, num(props.tail) ?? 200);
  const [showAll, setShowAll] = useState(false);
  const lines = useMemo(() => (raw == null ? [] : normalizeEscapes(raw).replace(/\r\n?/g, "\n").split("\n")), [raw]);
  const end = useRef<HTMLDivElement | null>(null);
  if (raw == null) return <Shimmer className="h-28" />;
  const q = filter.trim().toLowerCase();
  const indexed = lines.map((l, k) => ({ l, k }));
  const matched = q ? indexed.filter(({ l }) => l.toLowerCase().includes(q)) : indexed;
  const visible = showAll || q ? matched : matched.slice(-tail);
  const hidden = matched.length - visible.length;
  const errors = lines.filter((l) => ERROR_LINE.test(l)).length;
  return (
    <Frame
      title={str(props.command) ? <span className="text-muted-foreground">$ <span className="text-foreground">{str(props.command)}</span></span> : str(props.title)}
      right={
        <span className="flex shrink-0 items-center gap-2">
          {errors ? <span className="text-destructive tabular-nums">{errors} error {errors === 1 ? "line" : "lines"}</span> : null}
          {exit != null ? (
            <span className={cn("rounded-full px-2 py-px text-[11px] font-medium tabular-nums", exit === 0 ? "text-[color:var(--success)]" : "text-destructive")} style={{ background: `color-mix(in oklab, ${exit === 0 ? "var(--success)" : "var(--destructive)"} 14%, transparent)` }}>
              exit {exit}
            </span>
          ) : null}
        </span>
      }
    >
      {lines.length > 12 ? (
        <div className="border-b border-border px-3 py-1">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter lines" aria-label="Filter lines" className="w-full bg-transparent py-0.5 text-xs outline-none placeholder:text-muted-foreground" />
        </div>
      ) : null}
      {hidden > 0 ? (
        <button type="button" onClick={() => setShowAll(true)} className="w-full border-b border-border px-3 py-1 text-left text-xs text-muted-foreground hover:text-foreground">
          Show {hidden} earlier lines
        </button>
      ) : null}
      <div className="iris-scroll-x max-h-[420px] overflow-auto py-1.5 font-mono text-[12px] leading-[1.6]">
        {visible.map(({ l, k }) => (
          <div key={k} className={cn("flex min-w-max px-3", ERROR_LINE.test(l) ? "bg-destructive/[0.07]" : WARN_LINE.test(l) ? "bg-[color:var(--warning)]/[0.06]" : "")}>
            <span className="mr-3 w-8 shrink-0 select-none text-right text-muted-foreground/60 tabular-nums">{k + 1}</span>
            <span className="whitespace-pre">
              {parseAnsi(l).map((sp, j) => (
                <span key={j} style={{ color: sp.fg != null ? `var(--ansi-${sp.fg})` : undefined, fontWeight: sp.bold ? 600 : undefined, opacity: sp.dim ? 0.65 : undefined }}>
                  {sp.text}
                </span>
              ))}
            </span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </Frame>
  );
}

// ---------- stack traces ----------

const FRAME_RE = [
  /^\s*at (?:([^()]*?(?:\(anonymous function\)[^()]*?)?) \()?((?:[A-Za-z]:)?[^():]+):(\d+)(?::(\d+))?\)?\s*$/, // JS
  /^\s*File "([^"]+)", line (\d+)(?:, in (.+))?/, // Python
  /^\s*\d+\s+\S+\s+0x[0-9a-f]+ (.+?) \+ \d+/, // Apple
];

export function StackTraceView({ props, text }: ViewProps) {
  const env = useEnv();
  const trace = str(props.trace) ?? text ?? "";
  const lines = trace.split("\n");
  const [showLib, setShowLib] = useState(false);
  const headline = lines.find((l) => l.trim()) ?? "Error";
  const frames = lines.slice(lines.indexOf(headline) + 1).map((l) => {
    // A frame line is short; a huge one is shown as is rather than matched.
    if (l.length > 2000) return { raw: l, fn: undefined, file: undefined, line: undefined };
    let m = FRAME_RE[0].exec(l);
    if (m) return { raw: l, fn: m[1], file: m[2], line: Number(m[3]) };
    m = FRAME_RE[1].exec(l);
    if (m) return { raw: l, fn: m[3], file: m[1], line: Number(m[2]) };
    return { raw: l, fn: undefined, file: undefined, line: undefined };
  });
  const isLib = (f: { file?: string }) => !f.file || /node_modules|internal\/|^node:|\/usr\/lib|site-packages|<anonymous>/.test(f.file);
  const lib = frames.filter((f) => f.file && isLib(f)).length;
  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] ring-1 ring-destructive/30">
      <div className="flex items-start gap-2 bg-destructive/[0.07] px-3 py-2">
        <Glyph name="circle-x" size={15} className="mt-0.5 text-destructive" />
        <div className="min-w-0 flex-1 font-mono text-[12.5px] font-medium break-words">{headline.trim()}</div>
      </div>
      <div className="py-1 font-mono text-[12px] leading-[1.7]">
        {frames
          .filter((f) => f.raw.trim() && (showLib || !isLib(f) || !f.file))
          .map((f, k) =>
            f.file && !isLib(f) ? (
              <button key={k} type="button" onClick={() => env.perform([{ $iris: "action", kind: "openFile", args: [f.file, f.line ?? null] }])} className="flex w-full min-w-0 gap-2 px-3 text-left hover:bg-state-hover">
                <span className="shrink-0 text-muted-foreground">at</span>
                <span className="truncate text-foreground">{f.fn ?? "(anonymous)"}</span>
                <span className="ml-auto shrink-0 truncate text-muted-foreground underline decoration-border underline-offset-2">
                  {f.file.split("/").slice(-2).join("/")}:{f.line}
                </span>
              </button>
            ) : (
              <div key={k} className="truncate px-3 text-muted-foreground/70">
                {f.raw.trim()}
              </div>
            ),
          )}
        {lib && !showLib ? (
          <button type="button" onClick={() => setShowLib(true)} className="px-3 text-xs text-muted-foreground hover:text-foreground">
            Show {lib} library frames
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------- Mermaid diagrams ----------

export function DiagramView({ props, text }: ViewProps) {
  const env = useEnv();
  const host = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<{ id: string; label: string } | null>(null);
  const notes = (props.notes && typeof props.notes === "object" ? props.notes : {}) as Record<string, unknown>;
  const explain = props.explain !== false;
  const source = text ?? "";
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const wire = () => {
      // Mermaid shrinks a wide diagram to the column until its labels are unreadable. Hold it at
      // about two thirds of its own size (labels near 11 px); anything wider scrolls sideways instead.
      const svg = el.querySelector<SVGSVGElement>("svg");
      const natural = svg?.viewBox?.baseVal?.width;
      if (svg && natural && !svg.dataset.irisSized) {
        svg.dataset.irisSized = "1";
        svg.style.minWidth = `${Math.round(natural * 0.68)}px`;
      }
      for (const node of el.querySelectorAll<SVGGElement>("g.node, g.actor, g.stateGroup, g.classGroup")) {
        if (node.dataset.irisWired) continue;
        node.dataset.irisWired = "1";
        node.style.cursor = "pointer";
        node.setAttribute("tabindex", "0");
        node.setAttribute("role", "button");
        const id = /^(?:flowchart-)?(.+?)-\d+$/.exec(node.id)?.[1] ?? node.id;
        const label = (node.textContent ?? id).trim();
        node.setAttribute("aria-label", `${label}: show detail`);
        const activate = () => setPicked({ id, label });
        node.addEventListener("click", activate);
        node.addEventListener("keydown", (e: Event) => {
          if ((e as KeyboardEvent).key === "Enter" || (e as KeyboardEvent).key === " ") activate();
        });
      }
    };
    const mo = new MutationObserver(wire);
    mo.observe(el, { childList: true, subtree: true });
    wire();
    return () => mo.disconnect();
  }, [source]);
  const note = picked ? notes[picked.id] ?? notes[picked.label] : undefined;
  return (
    <figure className="min-w-0">
      <div ref={host} className="iris-diagram min-w-0 overflow-x-auto [&_pre]:!bg-transparent">
        {env.streaming && !source.trim() ? <Shimmer className="h-40" /> : <Markdown content={`\`\`\`mermaid\n${source}\n\`\`\``} />}
      </div>
      {str(props.title) ? <figcaption className="mt-1 text-xs text-muted-foreground">{str(props.title)}</figcaption> : null}
      {picked ? (
        <div className="mt-2 flex min-w-0 items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{picked.label}</div>
            {note != null ? <Prose text={toText(note)} className="text-muted-foreground" /> : explain ? <div className="text-xs text-muted-foreground">No note for this node.</div> : null}
          </div>
          {note == null && explain ? (
            <button type="button" className="shrink-0 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-border hover:bg-state-hover" onClick={() => env.perform([{ $iris: "action", kind: "explain", args: [`"${picked.label}" in the diagram${str(props.title) ? ` "${str(props.title)}"` : ""}`] }])}>
              Ask to explain
            </button>
          ) : null}
          <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setPicked(null)} aria-label="Close detail">
            <Glyph name="x" size={14} />
          </button>
        </div>
      ) : null}
    </figure>
  );
}

// ---------- Tree ----------

interface TreeNode {
  label: string;
  path: string;
  note?: string;
  icon?: unknown;
  tone?: unknown;
  children: TreeNode[];
  leafPath?: string;
}

function buildTree(items: unknown[]): TreeNode[] {
  const root: TreeNode = { label: "", path: "", children: [] };
  const fromObj = (o: Record<string, unknown>, parent: string): TreeNode => {
    const label = toText(o.label ?? o.name);
    const path = parent ? `${parent}/${label}` : label;
    return { label, path, note: str(o.note), icon: o.icon, tone: o.tone, children: Array.isArray(o.children) ? o.children.map((c) => (typeof c === "string" ? { label: c, path: `${path}/${c}`, children: [] } : fromObj(c as Record<string, unknown>, path))) : [] };
  };
  for (const it of items) {
    if (typeof it === "string") {
      const parts = it.split("/").filter(Boolean);
      let cur = root;
      parts.forEach((part, k) => {
        let next = cur.children.find((c) => c.label === part);
        if (!next) {
          next = { label: part, path: parts.slice(0, k + 1).join("/"), children: [] };
          cur.children.push(next);
        }
        if (k === parts.length - 1) next.leafPath = it;
        cur = next;
      });
    } else if (it && typeof it === "object") root.children.push(fromObj(it as Record<string, unknown>, ""));
  }
  return root.children;
}

export function TreeView({ props }: ViewProps) {
  const items = Array.isArray(props.items) ? props.items : [];
  const tree = useMemo(() => buildTree(items), [items]);
  const open = num(props.open) ?? 2;
  return (
    <div className="min-w-0 font-mono text-[12.5px] leading-[1.75]" role="tree">
      {tree.map((n) => (
        <TreeRow key={n.path} node={n} depth={0} open={open} onClick={props.onClick} />
      ))}
    </div>
  );
}

function TreeRow({ node, depth, open, onClick }: { node: TreeNode; depth: number; open: number; onClick: unknown }) {
  const env = useEnv();
  const [expanded, setExpanded] = useState(depth < open);
  const folder = node.children.length > 0;
  const color = toneColor(env.palette, node.tone) ?? undefined;
  const activate = () => {
    if (folder) return setExpanded(!expanded);
    if (onClick != null) env.run(onClick, [{ label: node.label, path: node.leafPath ?? node.path }]);
    else if (node.leafPath) env.perform([{ $iris: "action", kind: "openFile", args: [node.leafPath, null] }]);
  };
  return (
    <div role="treeitem" aria-expanded={folder ? expanded : undefined}>
      <button type="button" onClick={activate} className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 text-left hover:bg-state-hover" style={{ paddingLeft: depth * 14 + 4 }}>
        {folder ? <Glyph name="chevron-right" size={12} className={cn("text-muted-foreground transition-transform", expanded && "rotate-90")} /> : <span className="w-3" />}
        <Glyph name={node.icon ?? (folder ? (expanded ? "folder-open" : "folder") : "file")} size={13} color={color} className="text-muted-foreground" />
        <span className="truncate" style={color ? { color } : undefined}>
          {node.label}
        </span>
        {node.note ? <span className="ml-2 truncate font-sans text-xs text-muted-foreground">{node.note}</span> : null}
      </button>
      {folder && expanded ? node.children.map((c) => <TreeRow key={c.path} node={c} depth={depth + 1} open={open} onClick={onClick} />) : null}
    </div>
  );
}
