// Graph: nodes and edges from data, laid out by dagre (layered) or d3-force
// from an on-demand chunk, drawn as SVG. Pan by dragging the background, zoom
// with a pinch or the buttons, drag nodes, click one for its detail.

import { toneColor } from "../palette";
import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { isPendingValue, toText } from "../../core/evaluate";
import { loadChunk } from "../chunks";
import { signature } from "./grid";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Prose } from "./prose";
import { Glyph, Shimmer, cn, num, str } from "./kit";

type GraphChunk = typeof import("../../chunks/graph");

interface GNode {
  id: string;
  label: string;
  group?: string;
  tone?: string;
  note?: string;
  raw: Record<string, unknown>;
  width: number;
  height: number;
}

interface GEdge {
  from: string;
  to: string;
  label?: string;
  tone?: string;
  dashed: boolean;
}

const NODE_H = 32;

function normalize(nodesIn: unknown, edgesIn: unknown): { nodes: GNode[]; edges: GEdge[] } {
  const nodes = new Map<string, GNode>();
  const add = (raw: Record<string, unknown>) => {
    const id = toText(raw.id ?? raw.name ?? raw.label);
    if (!id || nodes.has(id)) return;
    const label = toText(raw.label ?? raw.name ?? id);
    const shown = label.length > 32 ? `${label.slice(0, 31)}…` : label;
    nodes.set(id, {
      id,
      label: shown,
      group: raw.group != null ? toText(raw.group) : undefined,
      tone: typeof raw.tone === "string" ? raw.tone : undefined,
      note: raw.note != null ? toText(raw.note) : raw.detail != null ? toText(raw.detail) : undefined,
      raw,
      width: Math.round(Math.max(56, shown.length * 6.9 + 28)),
      height: NODE_H,
    });
  };
  for (const n of Array.isArray(nodesIn) ? nodesIn : []) add(n && typeof n === "object" ? (n as Record<string, unknown>) : { id: n });
  const edges: GEdge[] = [];
  for (const e of Array.isArray(edgesIn) ? edgesIn : []) {
    let from: string;
    let to: string;
    let o: Record<string, unknown> = {};
    if (Array.isArray(e)) [from, to] = [toText(e[0]), toText(e[1])];
    else if (e && typeof e === "object") {
      o = e as Record<string, unknown>;
      from = toText(o.from ?? o.source);
      to = toText(o.to ?? o.target);
    } else continue;
    if (!from || !to) continue;
    add({ id: from });
    add({ id: to });
    edges.push({ from, to, label: o.label != null ? toText(o.label) : undefined, tone: typeof o.tone === "string" ? o.tone : undefined, dashed: o.dashed === true });
  }
  return { nodes: [...nodes.values()], edges };
}

/** Where a line from a box's center toward (tx, ty) leaves the box. */
function boxExit(cx: number, cy: number, w: number, h: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const s = Math.min(Math.abs(w / 2 / (dx || 1e-9)), Math.abs(h / 2 / (dy || 1e-9)));
  return [cx + dx * s, cy + dy * s];
}

/** A smooth path through dagre's bend points. */
function curve(points: [number, number][]): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0]},${points[0][1]}`;
  if (points.length === 2) return `${d}L${points[1][0]},${points[1][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    const mx = i === points.length - 2 ? nx : (x + nx) / 2;
    const my = i === points.length - 2 ? ny : (y + ny) / 2;
    d += `Q${x},${y} ${mx},${my}`;
  }
  return d;
}

interface View {
  x: number;
  y: number;
  k: number;
}

export function GraphView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const pending = isPendingValue(props.nodes) || isPendingValue(props.edges);
  // Inline nodes and edges are new arrays on every render; key the layout on what they say,
  // so zoom, pan and dragged nodes survive a state change.
  const key = signature([props.nodes, props.edges]);
  const graph = useMemo(() => (pending ? { nodes: [], edges: [] } : normalize(props.nodes, props.edges)), [key, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [chunk, setChunk] = useState<GraphChunk | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadChunk<GraphChunk>("graph").then(
      (c) => live && setChunk(c),
      (e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  const [layoutKind, setLayoutKind] = useState<"layered" | "force">(str(props.layout) === "force" ? "force" : "layered");
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Left to right unless asked otherwise; top to bottom on a phone, where width is short.
  const asked = ["LR", "TB", "RL", "BT"].includes(str(props.direction) ?? "") ? (str(props.direction) as "LR" | "TB" | "RL" | "BT") : null;
  const dir = asked ?? (width < 520 ? "TB" : "LR");
  const layout = useMemo(() => {
    if (!chunk || !graph.nodes.length) return null;
    const input = graph.nodes.map((n) => ({ id: n.id, width: n.width, height: n.height }));
    const edges = graph.edges.map((e) => ({ from: e.from, to: e.to, labelWidth: e.label ? e.label.length * 6.2 + 10 : 0 }));
    return layoutKind === "force" ? chunk.force(input, edges) : chunk.layered(input, edges, dir);
  }, [chunk, graph, layoutKind, dir]);

  // Nodes the person dragged keep their place until the layout changes.
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  useEffect(() => setMoved({}), [layout]);
  const pos = (id: string) => moved[id] ?? layout?.nodes[id] ?? { x: 0, y: 0 };

  // Room for the legend above and the controls below.
  const TOP = 28;
  const BOTTOM = 44;
  const fitScale = layout ? Math.max(0.55, Math.min(1, (width - 16) / Math.max(1, layout.width))) : 1;
  const fitHeight = layout ? Math.min(520, Math.max(180, layout.height * fitScale + TOP + BOTTOM)) : 260;
  const height = Math.max(160, Math.min(900, num(props.height) ?? fitHeight));

  const fit = (): View => {
    if (!layout) return { x: 0, y: 0, k: 1 };
    // Never shrink text past legible; a graph wider than that pans.
    const k = Math.max(0.55, Math.min(1.25, (width - 16) / Math.max(1, layout.width), (height - TOP - BOTTOM) / Math.max(1, layout.height)));
    const w = layout.width * k;
    return { k, x: w <= width ? (width - w) / 2 : 8, y: TOP + Math.max(0, (height - TOP - BOTTOM - layout.height * k) / 2) };
  };
  const [view, setView] = useState<View | null>(null);
  const v = view ?? fit();
  useEffect(() => setView(null), [layout, width, height]);

  const zoomAt = (factor: number, cx = width / 2, cy = height / 2) => {
    const k = Math.max(0.15, Math.min(4, v.k * factor));
    const f = k / v.k;
    setView({ k, x: cx - (cx - v.x) * f, y: cy - (cy - v.y) * f });
  };

  // ---- pointers: pan the background, drag a node, pinch to zoom ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ kind: "pan" | "node"; id?: string; startX: number; startY: number; origin: View | { x: number; y: number }; moved: boolean; pinch?: { d: number; view: View; cx: number; cy: number } } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: ReactPointerEvent, id?: string) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { kind: "pan", startX: p.x, startY: p.y, origin: v, moved: true, pinch: { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, view: v, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 } };
      return;
    }
    drag.current = id ? { kind: "node", id, startX: p.x, startY: p.y, origin: pos(id), moved: false } : { kind: "pan", startX: p.x, startY: p.y, origin: v, moved: false };
  };
  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || !pointers.current.has(e.pointerId)) return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (d.pinch && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const k = Math.max(0.15, Math.min(4, d.pinch.view.k * (Math.hypot(a.x - b.x, a.y - b.y) / d.pinch.d)));
      const f = k / d.pinch.view.k;
      setView({ k, x: d.pinch.cx - (d.pinch.cx - d.pinch.view.x) * f, y: d.pinch.cy - (d.pinch.cy - d.pinch.view.y) * f });
      return;
    }
    const dx = p.x - d.startX;
    const dy = p.y - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "pan") {
      const o = d.origin as View;
      setView({ ...o, x: o.x + dx, y: o.y + dy });
    } else if (d.id) {
      const o = d.origin as { x: number; y: number };
      setMoved((m) => ({ ...m, [d.id!]: { x: o.x + dx / v.k, y: o.y + dy / v.k } }));
    }
  };
  const onUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (pointers.current.size > 0) return;
    drag.current = null;
    if (!d || d.moved) return;
    if (d.kind === "node" && d.id) choose(d.id);
    else if (d.kind === "pan") setPicked(null);
  };
  // Pinch on a trackpad arrives as a wheel event with ctrlKey; plain wheels scroll the chat.
  const svg = useRef<SVGSVGElement | null>(null);
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomRef.current(Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [layout]);

  const [picked, setPicked] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const choose = (id: string) => {
    setPicked(id);
    const n = byId.get(id);
    if (n && props.onNodeClick != null) env.run(props.onNodeClick, [{ ...n.raw, id: n.id, label: n.label }]);
  };

  const groups = useMemo(() => [...new Set(graph.nodes.map((n) => n.group).filter((g): g is string => !!g))], [graph]);
  const colorOf = (n: GNode) => (toneColor(palette, n.tone) ?? (n.group ? palette.series[groups.indexOf(n.group) % palette.series.length] : palette.series[0]));
  const edgeColor = (e: GEdge) => (toneColor(palette, e.tone) ?? "var(--muted-foreground)");
  const focus = hovered ?? picked;
  const near = useMemo(() => {
    if (!focus) return null;
    const s = new Set([focus]);
    for (const e of graph.edges) {
      if (e.from === focus) s.add(e.to);
      if (e.to === focus) s.add(e.from);
    }
    return s;
  }, [focus, graph]);

  if (pending) return <Shimmer className="h-64" />;
  if (!graph.nodes.length) return <div className="rounded-lg bg-muted/40 py-8 text-center text-xs text-muted-foreground">No nodes to draw</div>;
  if (loadError) return <div className="rounded-lg bg-muted/40 py-6 text-center text-xs text-muted-foreground">The graph layout couldn't load: {loadError}</div>;

  const pickedNode = picked ? (byId.get(picked) ?? null) : null;
  const uses = pickedNode ? graph.edges.filter((e) => e.from === pickedNode.id).map((e) => e.to) : [];
  const usedBy = pickedNode ? graph.edges.filter((e) => e.to === pickedNode.id).map((e) => e.from) : [];
  const markerColors = [...new Set(graph.edges.map(edgeColor))];
  const mid = (color: string) => `${uid}-arrow-${markerColors.indexOf(color)}`;
  const btn = "grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground";

  return (
    <figure className="min-w-0">
      <div ref={box} className="relative min-w-0 overflow-hidden rounded-[10px] bg-muted/20 ring-1 ring-border" style={{ height }}>
        {!layout ? (
          <Shimmer className="absolute inset-0" />
        ) : (
          <svg
            ref={svg}
            width={width}
            height={height}
            className="block cursor-grab touch-none select-none active:cursor-grabbing"
            role="img"
            aria-label={`${str(props.title) ?? "Graph"}: ${graph.nodes.length} nodes, ${graph.edges.length} edges`}
            onPointerDown={(e) => onDown(e)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={(e) => {
              const p = local(e);
              zoomAt(1.6, p.x, p.y);
            }}
          >
            <defs>
              {markerColors.map((c, k) => (
                <marker key={k} id={`${uid}-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0,0 L10,5 L0,10 z" fill={c} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${v.x},${v.y}) scale(${v.k})`}>
              {graph.edges.map((e, k) => {
                const a = byId.get(e.from)!;
                const b = byId.get(e.to)!;
                const pa = pos(a.id);
                const pb = pos(b.id);
                const bends = layoutKind === "layered" && !moved[a.id] && !moved[b.id] ? (layout.edges[k] ?? []) : [];
                let pts: [number, number][];
                if (bends.length >= 2) pts = bends.map((p) => [p.x, p.y]);
                else pts = [boxExit(pa.x, pa.y, a.width + 4, a.height + 4, pb.x, pb.y), boxExit(pb.x, pb.y, b.width + 6, b.height + 6, pa.x, pa.y)];
                const dim = near && !(near.has(e.from) && near.has(e.to) && (e.from === focus || e.to === focus));
                const color = edgeColor(e);
                const m = pts[Math.floor(pts.length / 2)];
                const m0 = pts[Math.floor(pts.length / 2) - 1] ?? m;
                const lx = pts.length === 2 ? (pts[0][0] + pts[1][0]) / 2 : (m[0] + m0[0]) / 2;
                const ly = pts.length === 2 ? (pts[0][1] + pts[1][1]) / 2 : (m[1] + m0[1]) / 2;
                return (
                  <g key={k} opacity={dim ? 0.18 : near ? 1 : 0.75} className="transition-opacity">
                    <path d={curve(pts)} fill="none" stroke={color} strokeWidth={near && !dim ? 1.8 : 1.3} strokeDasharray={e.dashed ? "5 4" : undefined} markerEnd={`url(#${mid(color)})`} />
                    {e.label ? (
                      <g transform={`translate(${lx},${ly})`}>
                        <rect x={-(e.label.length * 3.1 + 5)} y={-8} width={e.label.length * 6.2 + 10} height={16} rx={4} className="fill-card" />
                        <text textAnchor="middle" y={4} className="fill-muted-foreground text-[10.5px]">
                          {e.label}
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
              {graph.nodes.map((n) => {
                const p = pos(n.id);
                const color = colorOf(n);
                const dim = near && !near.has(n.id);
                const sel = picked === n.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${p.x - n.width / 2},${p.y - n.height / 2})`}
                    opacity={dim ? 0.3 : 1}
                    className="cursor-pointer outline-none transition-opacity"
                    role="button"
                    tabIndex={0}
                    aria-label={`${n.label}${n.group ? `, ${n.group}` : ""}: show detail`}
                    aria-pressed={sel}
                    onPointerDown={(e) => onDown(e, n.id)}
                    onPointerEnter={() => setHovered(n.id)}
                    onPointerLeave={() => setHovered(null)}
                    onFocus={() => setHovered(n.id)}
                    onBlur={() => setHovered(null)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        choose(n.id);
                      }
                    }}
                  >
                    <rect width={n.width} height={n.height} rx={9} fill="var(--card)" stroke={color} strokeOpacity={sel ? 1 : 0.55} strokeWidth={sel ? 2 : 1.2} />
                    <rect width={n.width} height={n.height} rx={9} fill={color} fillOpacity={sel ? 0.16 : 0.07} />
                    <circle cx={12} cy={n.height / 2} r={3.5} fill={color} />
                    <text x={22} y={n.height / 2 + 4.2} className="fill-foreground text-[12px]" style={{ fontWeight: sel ? 600 : 500 }}>
                      {n.label}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        <div className="absolute right-1.5 bottom-1.5 flex items-center gap-0.5 rounded-lg bg-card/90 p-0.5 shadow-[0_0_0_1px_var(--border)] backdrop-blur-sm">
          <div className="mr-0.5 flex rounded-md bg-muted/70 p-0.5 text-[11.5px]" role="tablist" aria-label="Layout">
            {(["layered", "force"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={layoutKind === k} onClick={() => setLayoutKind(k)} className={cn("rounded px-2 py-0.5 capitalize", layoutKind === k ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}>
                {k}
              </button>
            ))}
          </div>
          <button type="button" className={btn} onClick={() => zoomAt(1 / 1.3)} aria-label="Zoom out" title="Zoom out">
            <Glyph name="minus" size={14} />
          </button>
          <button type="button" className={btn} onClick={() => zoomAt(1.3)} aria-label="Zoom in" title="Zoom in">
            <Glyph name="plus" size={14} />
          </button>
          <button type="button" className={btn} onClick={() => (setView(null), setMoved({}))} aria-label="Fit to view" title="Fit and reset">
            <Glyph name="maximize" size={13} />
          </button>
        </div>
        {groups.length > 1 ? (
          <div className="pointer-events-none absolute top-1.5 left-2.5 flex flex-wrap gap-x-3 gap-y-0.5 pr-16 text-[11px] text-muted-foreground">
            {groups.map((g, k) => (
              <span key={g} className="inline-flex items-center gap-1">
                <span className="size-2 rounded-full" style={{ background: palette.series[k % palette.series.length] }} />
                {g}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {str(props.title) ? <figcaption className="mt-1 text-xs text-muted-foreground">{str(props.title)}</figcaption> : null}
      {pickedNode ? (
        <div className="mt-2 flex min-w-0 items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
          <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: colorOf(pickedNode) }} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className="font-medium break-all">{toText(pickedNode.raw.label ?? pickedNode.id)}</span>
              {pickedNode.group ? <span className="text-xs text-muted-foreground">{pickedNode.group}</span> : null}
            </div>
            {pickedNode.note ? <Prose text={pickedNode.note} className="text-muted-foreground" /> : null}
            <Neighbors label="Points to" ids={uses} onPick={setPicked} />
            <Neighbors label="Pointed to by" ids={usedBy} onPick={setPicked} />
          </div>
          {props.explain !== false ? (
            <button type="button" className="shrink-0 rounded-md px-2 py-1 text-xs font-medium ring-1 ring-border hover:bg-state-hover" onClick={() => env.perform([{ $iris: "action", kind: "explain", args: [`"${pickedNode.id}" in the graph${str(props.title) ? ` "${str(props.title)}"` : ""}${uses.length || usedBy.length ? ` (points to ${uses.join(", ") || "nothing"}; pointed to by ${usedBy.join(", ") || "nothing"})` : ""}`] }])}>
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

function Neighbors({ label, ids, onPick }: { label: string; ids: string[]; onPick: (id: string) => void }) {
  if (!ids.length) return null;
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {ids.slice(0, 12).map((id) => (
        <button key={id} type="button" onClick={() => onPick(id)} className="max-w-[14rem] truncate rounded-full bg-card px-2 py-0.5 ring-1 ring-border hover:bg-state-hover">
          {id}
        </button>
      ))}
      {ids.length > 12 ? <span className="text-muted-foreground">+{ids.length - 12}</span> : null}
    </div>
  );
}
