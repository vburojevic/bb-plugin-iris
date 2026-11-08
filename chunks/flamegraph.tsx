// Flamegraph (chunk "debug"): the merged call tree drawn top-down, widest
// callers first. Click a frame to zoom into it (its callers stay above as a
// path back); search dims what doesn't match and totals what does. Frames
// take one series color per file, so a module reads as one color; the line
// under the graph names the frame under the pointer. Logic lives in core/flame.ts.

import { Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { isPendingValue } from "../core/evaluate";
import { type FlameModel, type FlameNode, flamePath, flameSearch, parseProfile, topSelf } from "../core/flame";
import { formatValue } from "../core/format";
import type { ViewProps } from "../ui/render";
import { Caption, FOCUS, Meter, Nothing, Problems, pct, tint } from "./agents-kit";
import { useWidth } from "./tools-kit";

const ROW = 20;
const MAX_ROWS = 40;
const MAX_FRAMES = 2500;

function amount(v: number, unit: string): string {
  if (unit === "ms") return formatValue(v, "ms");
  if (unit === "bytes") return formatValue(v, "bytes");
  return `${formatValue(Math.round(v), "compact")} ${unit === "samples" ? (Math.round(v) === 1 ? "sample" : "samples") : unit}`;
}

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function FlamegraphView({ props }: ViewProps) {
  const pending = isPendingValue(props.profile);
  const model = useMemo(() => (pending ? null : parseProfile(props.profile, props.unit)), [pending, props.profile, props.unit]);
  // A new profile starts unzoomed: the key gives Flame fresh state for every new model.
  const key = useMemo(() => `${Math.random()}`, [model]);
  if (!model) return <Shimmer className="h-56" />;
  return <Flame key={key} model={model} title={str(props.title)} />;
}

interface Placed {
  node: FlameNode;
  x: number;
  w: number;
  row: number;
}

function Flame({ model, title }: { model: FlameModel; title?: string }) {
  const { palette } = useEnv();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [focus, setFocus] = useState<FlameNode>(model.root);
  const [hover, setHover] = useState<FlameNode | null>(null);
  const [query, setQuery] = useState("");
  const search = useMemo(() => flameSearch(model.root, query), [model.root, query]);
  const path = useMemo(() => flamePath(model.root, focus), [model.root, focus]);
  const top = useMemo(() => topSelf(focus, 8), [focus]);
  // Series: one per file when the profile names files; otherwise one per branch below the
  // first frame that calls more than one thing, so each subtree reads as one color.
  const branches = useMemo(() => {
    const all: FlameNode[] = [];
    const walk = (n: FlameNode) => (all.push(n), n.children.forEach(walk));
    walk(model.root);
    const withFile = all.filter((n) => n.file).length;
    const of = new Map<FlameNode, number>();
    if (withFile >= (all.length - 1) / 2) return { byFile: true, of };
    let split = model.root;
    while (split.children.length === 1) split = split.children[0];
    split.children.forEach((c, k) => {
      const mark = (n: FlameNode) => (of.set(n, k), n.children.forEach(mark));
      mark(c);
    });
    return { byFile: false, of };
  }, [model.root]);

  // Callers of the focus span the full width above it; its subtree fills the width below.
  const placed = useMemo(() => {
    const out: Placed[] = [];
    const ancestors = path.slice(0, -1);
    ancestors.forEach((n, k) => out.push({ node: n, x: 0, w: 1, row: k }));
    const base = ancestors.length;
    const minW = width ? 0.75 / width : 0.001;
    const lay = (n: FlameNode, x: number, w: number, row: number) => {
      if (out.length >= MAX_FRAMES || row - base >= MAX_ROWS) return;
      out.push({ node: n, x, w, row });
      let cx = x;
      for (const c of n.children) {
        const cw = (c.total / (focus.total || 1)) * 1;
        if (cw * 1 < minW) break;
        lay(c, cx, cw, row + 1);
        cx += cw;
      }
    };
    lay(focus, 0, 1, base);
    return out;
  }, [path, focus, width]);

  if (model.total <= 0)
    return (
      <div>
        <Caption title={title} />
        <Nothing>No samples in this profile</Nothing>
        <Problems items={model.problems} />
      </div>
    );

  const rows = Math.max(...placed.map((p) => p.row)) + 1;
  const neutral = "color-mix(in oklab, var(--foreground) 30%, transparent)";
  const colorOf = (n: FlameNode) => {
    if (n.depth === 0) return neutral;
    if (branches.byFile) return n.file ? palette.series[hashOf(n.file) % palette.series.length] : neutral;
    const k = branches.of.get(n);
    return k == null ? neutral : palette.series[k % palette.series.length];
  };
  const shown = hover ?? (focus !== model.root ? focus : null);
  const searching = query.trim().length > 0;
  const unit = model.unit;

  return (
    <div ref={ref} className="min-w-0">
      <Caption title={title}>
        <span>{amount(model.total, unit)}</span>
        <span>{model.nodes.toLocaleString("en-US")} frames</span>
      </Caption>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-40">
          <Glyph name="search" size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search functions or files" aria-label="Search frames" className="h-7 w-full rounded-full bg-transparent pl-7 pr-3 text-[12.5px] ring-1 ring-border outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[color-mix(in_oklab,var(--iris-accent)_55%,transparent)]" />
        </label>
        {searching ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {search.hits.size ? `${search.hits.size} ${search.hits.size === 1 ? "frame" : "frames"}, ${pct(search.total / model.total)} of the time` : "No match"}
          </span>
        ) : null}
        {focus !== model.root ? (
          <button type="button" onClick={() => setFocus(model.root)} className={cn("inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground", FOCUS)}>
            <Glyph name="zoom-out" size={13} />
            Reset zoom
          </button>
        ) : null}
      </div>

      <div className="iris-scroll-x max-h-[440px] overflow-y-auto" data-iris-drag>
        <div className="relative w-full" style={{ height: rows * ROW }} role="tree" aria-label="Flame graph" onPointerLeave={() => setHover(null)}>
          {placed.map((p, k) => {
            const n = p.node;
            const isAncestor = p.row < path.length - 1;
            const dim = (searching && !search.hits.has(n)) || isAncestor;
            const px = p.w * (width || 600);
            const c = colorOf(n);
            const label = px >= 34;
            return (
              <div
                key={k}
                role="treeitem"
                aria-label={`${n.name}, ${amount(n.total, unit)}, ${pct(n.total / model.total)}`}
                tabIndex={label ? 0 : -1}
                onClick={() => setFocus(n === focus && n !== model.root ? (path.at(-2) ?? model.root) : n)}
                onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setFocus(n))}
                onPointerEnter={() => setHover(n)}
                className={cn("absolute cursor-pointer overflow-hidden rounded-[3px] px-1 text-[11px] leading-[19px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--iris-accent)]", hover === n && "ring-1 ring-foreground/60")}
                style={{ left: `${p.x * 100}%`, width: `calc(${p.w * 100}% - 1px)`, top: p.row * ROW, height: ROW - 1, background: tint(c, dim ? 12 : searching ? 70 : 42), color: dim ? "var(--muted-foreground)" : "var(--foreground)" }}
              >
                {label ? <span className="block truncate">{n.depth === 0 ? "all" : n.name}</span> : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-1.5 min-h-[34px] text-[12px] leading-snug" aria-live="polite">
        {shown ? (
          <>
            <div className="truncate font-medium">{shown.depth === 0 ? "All" : shown.name}</div>
            <div className="truncate tabular-nums text-muted-foreground">
              {[shown.file ? `${shown.file}${shown.line ? `:${shown.line}` : ""}` : null, `${amount(shown.total, unit)} total (${pct(shown.total / model.total)})`, `${amount(shown.self, unit)} self`].filter(Boolean).join(" · ")}
            </div>
          </>
        ) : (
          <div className="text-muted-foreground">Hover a frame to read it. Click or tap to zoom in, again to step back.</div>
        )}
      </div>

      {path.length > 1 ? (
        <nav aria-label="Zoom path" className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-[11.5px] text-muted-foreground">
          {path.map((n, k) => (
            <span key={k} className="inline-flex min-w-0 items-center gap-1">
              {k ? <Glyph name="chevron-right" size={11} /> : null}
              <button type="button" onClick={() => setFocus(n)} className={cn("max-w-[12rem] truncate rounded px-0.5 hover:text-foreground", k === path.length - 1 && "text-foreground", FOCUS)}>
                {n.depth === 0 ? "All" : n.name}
              </button>
            </span>
          ))}
        </nav>
      ) : null}

      {top.length ? (
        <div className="mt-3">
          <div className="mb-1 text-[11.5px] text-muted-foreground">Heaviest by self {unit === "ms" ? "time" : unit}{focus !== model.root ? ` under ${focus.name}` : ""}</div>
          <ol className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,7rem)_auto] items-center gap-x-3 gap-y-1">
            {top.map((f, k) => (
              <li key={k} className="contents text-[12px]">
                <button type="button" onClick={() => setQuery(f.name)} className={cn("min-w-0 truncate rounded text-left hover:underline", FOCUS)} title={`Search for ${f.name}`}>
                  <span className="font-mono text-[11.5px]">{f.name}</span>
                  {f.file ? <span className="text-muted-foreground"> {f.file}</span> : null}
                </button>
                <Meter share={f.self / (top[0].self || 1)} color={palette.accent} />
                <span className="text-right tabular-nums text-muted-foreground">{amount(f.self, unit)}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      <Problems items={model.problems} />
    </div>
  );
}
