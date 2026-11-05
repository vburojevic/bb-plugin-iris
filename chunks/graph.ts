// Graph layout, loaded only when a card shows a node-and-edge Graph: dagre for
// layered (dependency) layouts, d3-force for organic ones.
import dagre from "@dagrejs/dagre";
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  /** Room for an edge label, if any. */
  labelWidth?: number;
}

export interface Layout {
  nodes: Record<string, { x: number; y: number }>;
  /** Bend points per edge, in edge order; empty for straight edges. */
  edges: { x: number; y: number }[][];
  width: number;
  height: number;
}

export function layered(nodes: LayoutNode[], edges: LayoutEdge[], direction: "LR" | "TB" | "RL" | "BT"): Layout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: direction, nodesep: 28, ranksep: 56, edgesep: 14, marginx: 12, marginy: 12 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: n.width, height: n.height });
  edges.forEach((e, k) => {
    if (g.hasNode(e.from) && g.hasNode(e.to)) g.setEdge(e.from, e.to, { width: e.labelWidth ?? 0, height: e.labelWidth ? 16 : 0, labelpos: "c" }, `e${k}`);
  });
  dagre.layout(g);
  const out: Layout = { nodes: {}, edges: [], width: g.graph().width ?? 0, height: g.graph().height ?? 0 };
  for (const n of nodes) {
    const p = g.node(n.id);
    out.nodes[n.id] = { x: p.x, y: p.y };
  }
  out.edges = edges.map((e, k) => (g.hasNode(e.from) && g.hasNode(e.to) ? ((g.edge({ v: e.from, w: e.to, name: `e${k}` }) as { points?: { x: number; y: number }[] } | undefined)?.points ?? []) : []));
  return out;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
}

export function force(nodes: LayoutNode[], edges: LayoutEdge[]): Layout {
  const sim: SimNode[] = nodes.map((n, k) => {
    // A deterministic start (a sunflower spiral) keeps the layout stable between renders.
    const a = k * 2.399963;
    const d = 18 * Math.sqrt(k + 0.5);
    return { id: n.id, r: Math.hypot(n.width, n.height) / 2 + 6, x: Math.cos(a) * d, y: Math.sin(a) * d };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const links: SimulationLinkDatum<SimNode>[] = edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to).map((e) => ({ source: e.from, target: e.to }));
  const s = forceSimulation(sim)
    .force("link", forceLink<SimNode, SimulationLinkDatum<SimNode>>(links).id((d) => d.id).distance(90).strength(0.6))
    .force("charge", forceManyBody().strength(-320))
    .force("collide", forceCollide<SimNode>((d) => d.r).strength(0.9))
    .force("x", forceX(0).strength(0.04))
    .force("y", forceY(0).strength(0.06))
    .stop();
  const ticks = Math.min(400, 120 + nodes.length * 2);
  for (let i = 0; i < ticks; i++) s.tick();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  nodes.forEach((n, k) => {
    const p = sim[k];
    minX = Math.min(minX, p.x! - n.width / 2);
    maxX = Math.max(maxX, p.x! + n.width / 2);
    minY = Math.min(minY, p.y! - n.height / 2);
    maxY = Math.max(maxY, p.y! + n.height / 2);
  });
  const pad = 12;
  const out: Layout = { nodes: {}, edges: edges.map(() => []), width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  nodes.forEach((n, k) => (out.nodes[n.id] = { x: sim[k].x! - minX + pad, y: sim[k].y! - minY + pad }));
  return out;
}
