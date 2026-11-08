// AgentTrace: an agent run as a span tree. Reads nested spans ({name, kind,
// ms, children}), flat spans that name their parent ({id, parent}), or
// OpenTelemetry JSON (resourceSpans > scopeSpans > spans, with gen_ai usage
// attributes). Missing start times lay siblings end to end; a parent without a
// duration spans its children; tokens and cost roll up from children when a
// parent has none of its own.

export type SpanKind = "agent" | "llm" | "tool" | "step";

export interface TraceSpan {
  id: string;
  name: string;
  kind: SpanKind;
  /** ms from the trace's start. */
  start: number;
  duration: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** Own tokens, or the sum of the children's when the span has none. */
  tokens: number | null;
  tokensRolled: boolean;
  cost: number | null;
  costRolled: boolean;
  error: string | null;
  model?: string;
  input?: unknown;
  output?: unknown;
  depth: number;
  children: TraceSpan[];
}

export interface TraceModel {
  roots: TraceSpan[];
  /** Depth-first, the order rows show in. */
  flat: TraceSpan[];
  duration: number;
  tokens: number | null;
  cost: number | null;
  errors: number;
  tools: number;
  llm: number;
  agents: number;
  problems: string[];
}

export const MAX_SPANS = 2000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);
const numberOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** A time as ms: epoch ms, epoch seconds, ISO text or unix nanoseconds (OpenTelemetry). */
function timeOf(v: unknown): number | null {
  if (typeof v === "string" && /^\d{16,}$/.test(v.trim())) return Number(BigInt(v.trim()) / 1000n) / 1000;
  const n = numberOf(v);
  if (n != null) return n > 1e15 ? n / 1e6 : n;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function kindOf(v: unknown, o: Obj): SpanKind {
  const k = text(v)?.toLowerCase() ?? "";
  if (/agent|subagent|task|chain|workflow|run/.test(k)) return "agent";
  if (/llm|model|generation|completion|chat|inference/.test(k)) return "llm";
  if (/tool|function|mcp|call|retriev/.test(k)) return "tool";
  if (o.model != null && o.tool == null) return "llm";
  if (o.tool != null || o.args != null || o.arguments != null) return "tool";
  return "step";
}

function errorOf(o: Obj): string | null {
  const e = o.error ?? o.exception;
  if (typeof e === "string" && e.trim()) return e.trim().slice(0, 2000);
  if (isObj(e)) return (text(e.message) ?? JSON.stringify(e)).slice(0, 2000);
  if (e === true || o.isError === true) return "failed";
  const s = text(o.status ?? o.state)?.toLowerCase();
  if (s && /^(error|failed|failure|cancelled|timeout|timed out)$/.test(s)) return s;
  return null;
}

interface Raw {
  id: string;
  parent?: string;
  name: string;
  kind: SpanKind;
  start: number | null;
  end: number | null;
  duration: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  tokens: number | null;
  cost: number | null;
  error: string | null;
  model?: string;
  input?: unknown;
  output?: unknown;
  children: Raw[];
}

let autoId = 0;
function rawOf(o: Obj, parent?: string): Raw {
  const usage = isObj(o.usage) ? o.usage : isObj(o.tokens) ? o.tokens : {};
  const tokensIn = numberOf(o.inputTokens ?? o.input_tokens ?? o.promptTokens ?? usage.input ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.in);
  const tokensOut = numberOf(o.outputTokens ?? o.output_tokens ?? o.completionTokens ?? usage.output ?? usage.output_tokens ?? usage.completion_tokens ?? usage.out);
  const own = numberOf(typeof o.tokens === "number" || typeof o.tokens === "string" ? o.tokens : (usage.total ?? usage.total_tokens));
  const tokens = own ?? (tokensIn != null || tokensOut != null ? (tokensIn ?? 0) + (tokensOut ?? 0) : null);
  const start = timeOf(o.start ?? o.startTime ?? o.started ?? o.startedAt ?? o.ts ?? o.at);
  const end = timeOf(o.end ?? o.endTime ?? o.ended ?? o.endedAt);
  const duration = numberOf(o.ms ?? o.duration ?? o.durationMs ?? o.elapsed) ?? (numberOf(o.seconds) != null ? (numberOf(o.seconds) as number) * 1000 : null);
  const id = text(o.id ?? o.spanId ?? o.span_id) ?? `span-${++autoId}`;
  const kids = Array.isArray(o.children) ? o.children : Array.isArray(o.spans) ? o.spans : Array.isArray(o.steps) ? o.steps : [];
  return {
    id,
    parent: text(o.parent ?? o.parentId ?? o.parent_id ?? o.parentSpanId) ?? parent,
    name: (text(o.name ?? o.title ?? o.tool ?? o.label) ?? "span").slice(0, 200),
    kind: kindOf(o.kind ?? o.type, o),
    start,
    end,
    duration: duration != null && duration >= 0 ? duration : null,
    tokensIn,
    tokensOut,
    tokens,
    cost: numberOf(o.cost ?? o.costUsd ?? o.usd),
    error: errorOf(o),
    model: text(o.model),
    input: o.input ?? o.args ?? o.arguments ?? o.prompt,
    output: o.output ?? o.result ?? o.response,
    children: kids.filter(isObj).map((c) => rawOf(c, id)),
  };
}

// ---------- OpenTelemetry ----------

function attrValue(v: unknown): unknown {
  if (!isObj(v)) return v;
  for (const k of ["stringValue", "intValue", "doubleValue", "boolValue"]) if (k in v) return k === "intValue" ? Number(v[k]) : v[k];
  return undefined;
}

function fromOtel(root: Obj): Obj[] {
  const out: Obj[] = [];
  for (const rs of Array.isArray(root.resourceSpans) ? root.resourceSpans : []) {
    if (!isObj(rs)) continue;
    for (const ss of [...(Array.isArray(rs.scopeSpans) ? rs.scopeSpans : []), ...(Array.isArray(rs.instrumentationLibrarySpans) ? rs.instrumentationLibrarySpans : [])]) {
      if (!isObj(ss) || !Array.isArray(ss.spans)) continue;
      for (const s of ss.spans) {
        if (!isObj(s)) continue;
        const a: Obj = {};
        for (const kv of Array.isArray(s.attributes) ? s.attributes : []) if (isObj(kv) && typeof kv.key === "string") a[kv.key] = attrValue(kv.value);
        const status = isObj(s.status) ? s.status : {};
        const op = text(a["gen_ai.operation.name"]);
        out.push({
          id: s.spanId,
          parentId: s.parentSpanId || undefined,
          name: s.name,
          kind: a["gen_ai.tool.name"] != null || op === "execute_tool" ? "tool" : op === "invoke_agent" ? "agent" : a["gen_ai.request.model"] != null || op === "chat" ? "llm" : "step",
          startTime: s.startTimeUnixNano,
          endTime: s.endTimeUnixNano,
          inputTokens: a["gen_ai.usage.input_tokens"],
          outputTokens: a["gen_ai.usage.output_tokens"],
          model: a["gen_ai.response.model"] ?? a["gen_ai.request.model"],
          error: status.code === 2 || status.code === "STATUS_CODE_ERROR" ? (text(status.message) ?? "error") : undefined,
          input: a["gen_ai.tool.call.arguments"] ?? a["input.value"],
          output: a["gen_ai.tool.call.result"] ?? a["output.value"],
        });
      }
    }
  }
  return out;
}

// ---------- tree ----------

function treeOf(input: unknown, problems: string[]): Raw[] {
  autoId = 0;
  let items: Obj[] = [];
  if (Array.isArray(input)) items = input.filter(isObj);
  else if (isObj(input)) {
    if (Array.isArray(input.resourceSpans)) items = fromOtel(input);
    else if (Array.isArray(input.spans)) items = input.spans.filter(isObj);
    else items = [input];
  } else if (input != null) problems.push("spans should be a list of {name, kind, ms, children?} or OpenTelemetry JSON");
  const top = items.map((o) => rawOf(o));
  // Flat spans that name a parent nest under it; nested ones keep their place.
  const all = new Map<string, Raw>();
  const walk = (r: Raw) => (all.set(r.id, r), r.children.forEach(walk));
  top.forEach(walk);
  const roots: Raw[] = [];
  for (const r of top) {
    const p = r.parent ? all.get(r.parent) : undefined;
    if (p && p !== r && !isAncestor(r, p)) p.children.push(r);
    else roots.push(r);
  }
  return roots;
}

function isAncestor(a: Raw, b: Raw): boolean {
  for (const c of a.children) if (c === b || isAncestor(c, b)) return true;
  return false;
}

/** Lays out times: a start defaults to the end of the sibling before, a duration to the span of its children. */
function layout(spans: Raw[], from: number): number {
  let cursor = from;
  let end = from;
  // A span with a start keeps it; one without follows the sibling before it.
  for (const s of spans) {
    const start = s.start ?? cursor;
    s.start = start;
    const childEnd = layout(s.children, start);
    if (s.duration == null) s.duration = s.end != null ? Math.max(0, s.end - start) : Math.max(0, childEnd - start);
    const e = start + s.duration;
    cursor = e;
    end = Math.max(end, e, childEnd);
  }
  return end;
}

function finish(r: Raw, origin: number, depth: number, out: TraceSpan[], count: { n: number }): TraceSpan {
  const span: TraceSpan = {
    id: r.id,
    name: r.name,
    kind: r.kind,
    start: Math.max(0, (r.start ?? origin) - origin),
    duration: r.duration ?? 0,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    tokens: r.tokens,
    tokensRolled: false,
    cost: r.cost,
    costRolled: false,
    error: r.error,
    model: r.model,
    input: r.input,
    output: r.output,
    depth,
    children: [],
  };
  if (count.n++ < MAX_SPANS) out.push(span);
  span.children = [...r.children].sort((a, b) => (a.start ?? 0) - (b.start ?? 0)).map((c) => finish(c, origin, depth + 1, out, count));
  const sum = (k: "tokens" | "cost") => {
    const vals = span.children.map((c) => c[k]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  if (span.tokens == null) {
    span.tokens = sum("tokens");
    span.tokensRolled = span.tokens != null;
  }
  if (span.cost == null) {
    span.cost = sum("cost");
    span.costRolled = span.cost != null;
  }
  return span;
}

export function normalizeTrace(input: unknown): TraceModel {
  const problems: string[] = [];
  const raw = treeOf(input, problems);
  const starts: number[] = [];
  const collect = (r: Raw) => (r.start != null && starts.push(r.start), r.children.forEach(collect));
  raw.forEach(collect);
  const origin = starts.length ? Math.min(...starts) : 0;
  const end = layout(raw, origin);
  const flat: TraceSpan[] = [];
  const count = { n: 0 };
  const roots = raw.map((r) => finish(r, origin, 0, flat, count));
  if (count.n > MAX_SPANS) problems.push(`showing the first ${MAX_SPANS} of ${count.n} spans`);
  const total = (k: "tokens" | "cost") => {
    const vals = roots.map((s) => s[k]).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const by = (k: SpanKind) => flat.filter((s) => s.kind === k).length;
  return {
    roots,
    flat,
    duration: Math.max(0, end - origin),
    tokens: total("tokens"),
    cost: total("cost"),
    errors: flat.filter((s) => s.error).length,
    tools: by("tool"),
    llm: by("llm"),
    agents: by("agent"),
    problems,
  };
}

/** The spans whose subtree holds an error, so their rows open at first. */
export function errorPath(model: TraceModel): Set<string> {
  const out = new Set<string>();
  const visit = (s: TraceSpan): boolean => {
    let hit = !!s.error;
    for (const c of s.children) if (visit(c)) hit = true;
    if (hit && s.children.length) out.add(s.id);
    return hit;
  };
  model.roots.forEach(visit);
  return out;
}
