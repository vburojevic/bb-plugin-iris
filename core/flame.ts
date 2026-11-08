// Flamegraph: CPU profiles as one merged call tree. Reads V8 .cpuprofile
// (node --cpu-prof, Chrome DevTools), Chrome trace JSON (its ProfileChunk
// samples, or X and B/E duration events of the busiest thread), speedscope
// JSON (evented and sampled), folded stacks ("main;parse;lex 12" per line) and
// nested {name, value, children}. Identical call paths merge, so a function
// called from the same place many times is one frame as wide as all of them.

export interface FlameNode {
  name: string;
  file?: string;
  line?: number;
  /** Time (or samples, or bytes) spent in this frame itself. */
  self: number;
  /** self plus every frame below. */
  total: number;
  children: FlameNode[];
  depth: number;
}

export interface FlameModel {
  root: FlameNode;
  total: number;
  unit: string;
  format: "cpuprofile" | "chrome-trace" | "speedscope" | "folded" | "tree" | "none";
  nodes: number;
  depth: number;
  problems: string[];
}

export const MAX_FLAME_NODES = 30_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

interface Frame {
  name: string;
  file?: string;
  line?: number;
}

/** Builds the merged tree: each insert adds weight along one root-first stack. */
class Builder {
  root: FlameNode = { name: "all", self: 0, total: 0, children: [], depth: 0 };
  private index = new Map<FlameNode, Map<string, FlameNode>>();
  count = 0;
  add(stack: Frame[], weight: number) {
    if (!(weight > 0)) return;
    let node = this.root;
    node.total += weight;
    for (const f of stack) {
      let kids = this.index.get(node);
      if (!kids) this.index.set(node, (kids = new Map()));
      const k = `${f.name}\u0000${f.file ?? ""}\u0000${f.line ?? ""}`;
      let next = kids.get(k);
      if (!next) {
        next = { name: f.name, file: f.file, line: f.line, self: 0, total: 0, children: [], depth: node.depth + 1 };
        kids.set(k, next);
        node.children.push(next);
        this.count += 1;
      }
      next.total += weight;
      node = next;
    }
    node.self += weight;
  }
}

const shortFile = (url: unknown): string | undefined => {
  if (typeof url !== "string" || !url) return undefined;
  const clean = url.replace(/^file:\/\//, "").replace(/[?#].*$/, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || clean;
};

// ---------- V8 cpuprofile ----------

interface CpuNode {
  id: number;
  callFrame?: Obj;
  hitCount?: number;
  children?: number[];
  parent?: number;
}

function fromCpuNodes(nodes: CpuNode[], samples: number[], deltas: number[], span: number | null, b: Builder) {
  const byId = new Map<number, CpuNode>();
  for (const n of nodes) if (typeof n.id === "number") byId.set(n.id, n);
  const parent = new Map<number, number>();
  for (const n of nodes) {
    if (typeof n.parent === "number") parent.set(n.id, n.parent);
    for (const c of n.children ?? []) parent.set(c, n.id);
  }
  const weight = new Map<number, number>();
  if (samples.length) {
    const sorted = deltas.filter((d) => d > 0).sort((x, y) => x - y);
    const typical = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1000;
    // V8 records each sample's delta from the one before; the time belongs to the earlier sample.
    samples.forEach((id, i) => {
      const d = deltas[i + 1];
      weight.set(id, (weight.get(id) ?? 0) + (typeof d === "number" && d >= 0 ? d : typical));
    });
  } else {
    const hits = nodes.reduce((a, n) => a + (n.hitCount ?? 0), 0);
    const per = span && hits ? span / hits : 1000;
    for (const n of nodes) if (n.hitCount) weight.set(n.id, n.hitCount * per);
  }
  const paths = new Map<number, Frame[]>();
  const pathOf = (id: number, guard = 0): Frame[] => {
    const hit = paths.get(id);
    if (hit) return hit;
    const n = byId.get(id);
    if (!n || guard > 2000) return [];
    const cf = n.callFrame ?? {};
    const raw = typeof cf.functionName === "string" ? cf.functionName : "";
    const p = parent.get(id);
    const up = p != null ? pathOf(p, guard + 1) : [];
    // "(root)" is the tree's own root, not a frame anyone wrote.
    const out = raw === "(root)" && p == null ? up : [...up, { name: raw || "(anonymous)", file: shortFile(cf.url), line: typeof cf.lineNumber === "number" && cf.lineNumber >= 0 ? cf.lineNumber + 1 : undefined }];
    paths.set(id, out);
    return out;
  };
  for (const [id, w] of weight) b.add(pathOf(id), w / 1000);
}

function isCpuProfile(v: Obj): boolean {
  return Array.isArray(v.nodes) && (v.nodes as unknown[]).some((n) => isObj(n) && isObj(n.callFrame));
}

function cpuProfile(v: Obj, b: Builder) {
  const span = num(v.endTime) != null && num(v.startTime) != null ? (num(v.endTime) as number) - (num(v.startTime) as number) : null;
  fromCpuNodes(v.nodes as CpuNode[], Array.isArray(v.samples) ? (v.samples as number[]) : [], Array.isArray(v.timeDeltas) ? (v.timeDeltas as number[]) : [], span, b);
}

// ---------- Chrome trace ----------

function chromeTrace(events: Obj[], b: Builder, problems: string[]): void {
  // Samples recorded by the Performance panel: Profile + ProfileChunk events per profile id.
  const profiles = new Map<string, { nodes: CpuNode[]; samples: number[]; deltas: number[] }>();
  for (const e of events) {
    if (e.name !== "ProfileChunk" && e.name !== "Profile") continue;
    const data = isObj(e.args) && isObj(e.args.data) ? e.args.data : null;
    if (!data) continue;
    const id = String(e.id ?? "0");
    const p = profiles.get(id) ?? { nodes: [], samples: [], deltas: [] };
    const cpu = isObj(data.cpuProfile) ? data.cpuProfile : {};
    if (Array.isArray(cpu.nodes)) p.nodes.push(...(cpu.nodes as CpuNode[]));
    if (Array.isArray(cpu.samples)) p.samples.push(...(cpu.samples as number[]));
    if (Array.isArray(data.timeDeltas)) p.deltas.push(...(data.timeDeltas as number[]));
    profiles.set(id, p);
  }
  const best = [...profiles.values()].sort((x, y) => y.samples.length - x.samples.length)[0];
  if (best && best.samples.length) {
    if (profiles.size > 1) problems.push(`the trace has ${profiles.size} CPU profiles; showing the one with the most samples`);
    fromCpuNodes(best.nodes, best.samples, best.deltas, null, b);
    return;
  }
  // Otherwise duration events: X (ts, dur) and B/E pairs, in µs, on the busiest thread.
  type Span = { name: string; ts: number; dur: number; cat?: string };
  const threads = new Map<string, Span[]>();
  const open = new Map<string, { name: string; ts: number }[]>();
  for (const e of events) {
    const ts = num(e.ts);
    if (ts == null || (e.ph !== "E" && typeof e.name !== "string")) continue;
    const tid = `${e.pid ?? 0}:${e.tid ?? 0}`;
    const list = threads.get(tid) ?? [];
    if (e.ph === "X") {
      const dur = num(e.dur);
      if (dur != null && dur > 0) list.push({ name: String(e.name), ts, dur });
    } else if (e.ph === "B") (open.get(tid) ?? open.set(tid, []).get(tid)!).push({ name: String(e.name), ts });
    else if (e.ph === "E") {
      const st = open.get(tid);
      const top = st?.pop();
      if (top && ts > top.ts) list.push({ name: top.name, ts: top.ts, dur: ts - top.ts });
    }
    threads.set(tid, list);
  }
  const busiest = [...threads.values()].map((l) => ({ l, top: topLevel(l) })).sort((x, y) => y.top - x.top)[0];
  if (!busiest || !busiest.l.length) return;
  if ([...threads.values()].filter((l) => l.length).length > 1) problems.push("showing the busiest thread of the trace");
  const spans = [...busiest.l].sort((x, y) => x.ts - y.ts || y.dur - x.dur);
  const stack: { span: Span; frames: Frame[]; child: number }[] = [];
  const close = (upTo: number) => {
    while (stack.length && stack[stack.length - 1].span.ts + stack[stack.length - 1].span.dur <= upTo) {
      const s = stack.pop()!;
      b.add(s.frames, Math.max(0, s.span.dur - s.child) / 1000);
      if (stack.length) stack[stack.length - 1].child += s.span.dur;
    }
  };
  for (const s of spans) {
    close(s.ts);
    const frames = [...(stack.at(-1)?.frames ?? []), { name: s.name }];
    stack.push({ span: s, frames, child: 0 });
  }
  close(Infinity);
}

function topLevel(list: { ts: number; dur: number }[]): number {
  let end = -Infinity;
  let total = 0;
  for (const s of [...list].sort((a, b) => a.ts - b.ts)) {
    if (s.ts >= end) {
      total += s.dur;
      end = s.ts + s.dur;
    } else if (s.ts + s.dur > end) {
      total += s.ts + s.dur - end;
      end = s.ts + s.dur;
    }
  }
  return total;
}

// ---------- speedscope ----------

const SPEEDSCOPE_UNITS: Record<string, [number, string]> = { nanoseconds: [1e-6, "ms"], microseconds: [1e-3, "ms"], milliseconds: [1, "ms"], seconds: [1000, "ms"], bytes: [1, "bytes"], none: [1, "samples"] };

function speedscope(v: Obj, b: Builder, problems: string[]): string {
  const frames: Frame[] = (isObj(v.shared) && Array.isArray(v.shared.frames) ? v.shared.frames : []).map((f) => (isObj(f) ? { name: typeof f.name === "string" ? f.name : "(anonymous)", file: shortFile(f.file), line: num(f.line) ?? undefined } : { name: "(anonymous)" }));
  const profiles = Array.isArray(v.profiles) ? v.profiles.filter(isObj) : [];
  const pick = num(v.activeProfileIndex) ?? 0;
  const p = profiles[pick] ?? profiles[0];
  if (!p) return "ms";
  if (profiles.length > 1) problems.push(`showing profile ${pick + 1} of ${profiles.length}${typeof p.name === "string" ? `: ${p.name}` : ""}`);
  const [k, unit] = SPEEDSCOPE_UNITS[String(p.unit)] ?? [1, String(p.unit ?? "samples")];
  const fr = (i: unknown) => frames[num(i) ?? -1] ?? { name: `frame ${String(i)}` };
  if (p.type === "evented" && Array.isArray(p.events)) {
    const stack: Frame[] = [];
    let last: number | null = null;
    for (const e of p.events.filter(isObj)) {
      const at = num(e.at);
      if (at == null) continue;
      if (last != null && stack.length) b.add([...stack], (at - last) * k);
      last = at;
      if (e.type === "O") stack.push(fr(e.frame));
      else if (e.type === "C") stack.pop();
    }
  } else if (p.type === "sampled" && Array.isArray(p.samples)) {
    const weights = Array.isArray(p.weights) ? p.weights : [];
    p.samples.forEach((s, i) => Array.isArray(s) && b.add(s.map(fr), (num(weights[i]) ?? 1) * k));
  }
  return unit;
}

// ---------- folded and nested ----------

function folded(text: string, b: Builder) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^(.*\S)\s+(\d+(?:\.\d+)?)\s*$/.exec(line);
    if (!m) continue;
    b.add(m[1].split(";").map((name) => ({ name: name.trim() || "(anonymous)" })), Number(m[2]));
  }
}

function nested(v: Obj, b: Builder, path: Frame[] = [], guard = 0) {
  if (guard > 500) return;
  const frame: Frame = { name: typeof v.name === "string" ? v.name : "(anonymous)", file: shortFile(v.file), line: num(v.line) ?? undefined };
  const here = [...path, frame];
  const kids = Array.isArray(v.children) ? v.children.filter(isObj) : [];
  const total = num(v.value ?? v.total ?? v.size) ?? 0;
  const below = kids.reduce((a, c) => a + (num(c.value ?? c.total ?? c.size) ?? 0), 0);
  const self = num(v.self) ?? Math.max(0, total - below);
  b.add(here, self);
  for (const c of kids) nested(c, b, here, guard + 1);
}

// ---------- the model ----------

function prune(root: FlameNode, min: number): number {
  let count = 0;
  const walk = (n: FlameNode) => {
    const keep: FlameNode[] = [];
    for (const c of n.children) {
      if (c.total < min) n.self += c.total;
      else keep.push(c);
    }
    n.children = keep.sort((a, b) => b.total - a.total);
    count += keep.length;
    keep.forEach(walk);
  };
  walk(root);
  return count;
}

export function parseProfile(input: unknown, unitHint?: unknown): FlameModel {
  const problems: string[] = [];
  const b = new Builder();
  let format: FlameModel["format"] = "none";
  let unit = "ms";
  if (typeof input === "string") {
    const t = input.trim();
    if (/^[[{]/.test(t)) {
      try {
        return parseProfile(JSON.parse(t), unitHint);
      } catch {
        problems.push("the profile looks like JSON but doesn't parse");
      }
    } else {
      folded(input, b);
      format = "folded";
      unit = "samples";
    }
  } else if (Array.isArray(input)) {
    const objs = input.filter(isObj);
    if (objs.some((e) => typeof e.ph === "string")) {
      chromeTrace(objs, b, problems);
      format = "chrome-trace";
    } else if (objs.some((e) => e.stack != null)) {
      for (const e of objs) {
        const stack = Array.isArray(e.stack) ? e.stack.map(String) : typeof e.stack === "string" ? e.stack.split(";") : [];
        b.add(stack.map((name) => ({ name })), num(e.value ?? e.weight ?? e.count) ?? 1);
      }
      format = "folded";
      unit = "samples";
    }
  } else if (isObj(input)) {
    if (isCpuProfile(input)) {
      cpuProfile(input, b);
      format = "cpuprofile";
    } else if (Array.isArray(input.traceEvents)) {
      chromeTrace(input.traceEvents.filter(isObj), b, problems);
      format = "chrome-trace";
    } else if (Array.isArray(input.profiles) && (isObj(input.shared) || String(input.$schema ?? "").includes("speedscope"))) {
      unit = speedscope(input, b, problems);
      format = "speedscope";
    } else if (typeof input.name === "string" && (input.value != null || Array.isArray(input.children))) {
      nested(input, b);
      format = "tree";
      unit = "samples";
    }
  }
  if (typeof unitHint === "string" && unitHint.trim()) unit = unitHint.trim();
  const root = b.root;
  if (format === "none" && input != null && !problems.length) problems.push("not a profile Iris reads: give a .cpuprofile, Chrome trace, speedscope JSON, folded stacks or {name, value, children}");
  else if (input != null && root.total <= 0 && !problems.length) problems.push("the profile has no samples");
  let nodes = b.count;
  if (nodes > MAX_FLAME_NODES) {
    nodes = prune(root, root.total / 20_000);
    problems.push("frames thinner than 0.005% are folded into their callers");
  } else prune(root, 0);
  let depth = 0;
  const walk = (n: FlameNode) => {
    depth = Math.max(depth, n.depth);
    n.children.forEach(walk);
  };
  walk(root);
  return { root, total: root.total, unit, format, nodes, depth, problems };
}

/** Frames whose name or file holds the query (case-insensitive), and the share of time under them, counted once. */
export function flameSearch(root: FlameNode, query: string): { hits: Set<FlameNode>; total: number } {
  const q = query.trim().toLowerCase();
  const hits = new Set<FlameNode>();
  if (!q) return { hits, total: 0 };
  let total = 0;
  const walk = (n: FlameNode, inside: boolean) => {
    const match = n.depth > 0 && (n.name.toLowerCase().includes(q) || (n.file ?? "").toLowerCase().includes(q));
    if (match) hits.add(n);
    if (match && !inside) total += n.total;
    for (const c of n.children) walk(c, inside || match);
  };
  walk(root, false);
  return { hits, total };
}

/** The path from the root to a node, root first. */
export function flamePath(root: FlameNode, target: FlameNode): FlameNode[] {
  const path: FlameNode[] = [];
  const walk = (n: FlameNode): boolean => {
    path.push(n);
    if (n === target) return true;
    for (const c of n.children) if (walk(c)) return true;
    path.pop();
    return false;
  };
  return walk(root) ? path : [root];
}

/** Self time summed per function across the tree, heaviest first. */
export function topSelf(root: FlameNode, limit = 10): { name: string; file?: string; self: number }[] {
  const by = new Map<string, { name: string; file?: string; self: number }>();
  const walk = (n: FlameNode) => {
    if (n.depth > 0 && n.self > 0) {
      const k = `${n.name}\u0000${n.file ?? ""}`;
      const e = by.get(k) ?? { name: n.name, file: n.file, self: 0 };
      e.self += n.self;
      by.set(k, e);
    }
    n.children.forEach(walk);
  };
  walk(root);
  return [...by.values()].sort((a, b) => b.self - a.self).slice(0, limit);
}
