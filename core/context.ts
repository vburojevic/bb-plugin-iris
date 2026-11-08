// ContextMeter: how full a session's context window is, by category, with its
// cost, and how both moved over the session. Reads load("bb:thread") ({title,
// context: {used, window, percent, model, categories}, cost}), a list of them
// (load("bb:threads?usage=1"), which also totals by model), or plain
// {used, window, model?, categories?, cost?}. History comes from points
// [{t, used, cost?}] or from the readings a live card sees as it re-reads.

export interface ContextCategory {
  label: string;
  tokens: number;
}

export interface ContextRow {
  label: string;
  model?: string;
  used: number;
  window: number | null;
  /** 0 to 1, null without a window. */
  share: number | null;
  categories: ContextCategory[];
  cost: number | null;
  currency: string;
  estimated: boolean;
  status?: string;
}

export interface ModelTotal {
  model: string;
  used: number;
  cost: number | null;
  sessions: number;
}

export interface ContextPoint {
  t: number;
  used: number;
  cost: number | null;
}

export interface ContextModel {
  rows: ContextRow[];
  byModel: ModelTotal[];
  used: number;
  cost: number | null;
  currency: string;
  problems: string[];
}

export type ContextLevel = "ok" | "warn" | "full";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const numberOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};

function rowOf(v: Obj, k: number): ContextRow | null {
  const ctx = isObj(v.context) ? v.context : v;
  const used = numberOf(ctx.used ?? ctx.tokens ?? ctx.usedTokens);
  if (used == null) return null;
  const window = numberOf(ctx.window ?? ctx.limit ?? ctx.max ?? ctx.contextWindow);
  const cost = isObj(v.cost) ? numberOf(v.cost.amount) : numberOf(v.cost ?? v.costUsd);
  const currency = (isObj(v.cost) ? text(v.cost.currency) : undefined) ?? "USD";
  const categories = (Array.isArray(ctx.categories) ? ctx.categories : [])
    .filter(isObj)
    .map((c) => ({ label: text(c.label ?? c.name) ?? "Other", tokens: Math.max(0, numberOf(c.tokens ?? c.used ?? c.value) ?? 0) }))
    .filter((c) => c.tokens > 0);
  const model = text(ctx.model ?? v.model);
  return {
    label: (text(v.title ?? v.label ?? v.name) ?? model ?? `Session ${k + 1}`).slice(0, 120),
    model,
    used: Math.max(0, used),
    window: window && window > 0 ? window : null,
    share: window && window > 0 ? Math.max(0, used) / window : null,
    categories,
    cost,
    currency: currency.toUpperCase(),
    estimated: ctx.estimated === true,
    status: text(v.status),
  };
}

export function readContext(input: unknown): ContextModel {
  const problems: string[] = [];
  const list = Array.isArray(input) ? input.filter(isObj) : isObj(input) ? [input] : [];
  const rows = list.map(rowOf).filter((r): r is ContextRow => !!r);
  if (input != null && !rows.length) {
    if (list.length && list.every((o) => o.context === null)) problems.push("bb has no context reading for this session yet");
    else problems.push('needs load("bb:thread"), a list from load("bb:threads?usage=1"), or {used, window}');
  }
  const models = new Map<string, ModelTotal>();
  for (const r of rows) {
    const key = r.model ?? "Unknown model";
    const m = models.get(key) ?? { model: key, used: 0, cost: null, sessions: 0 };
    m.used += r.used;
    if (r.cost != null) m.cost = (m.cost ?? 0) + r.cost;
    m.sessions += 1;
    models.set(key, m);
  }
  const costs = rows.map((r) => r.cost).filter((c): c is number => c != null);
  return {
    rows,
    byModel: [...models.values()].sort((a, b) => b.used - a.used),
    used: rows.reduce((a, r) => a + r.used, 0),
    cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
    currency: rows.find((r) => r.cost != null)?.currency ?? "USD",
    problems,
  };
}

/** Categories that fill the window, with what they leave unaccounted as "Other" and what is free. */
export function contextSegments(r: ContextRow): { label: string; tokens: number; free?: boolean }[] {
  const listed = r.categories.reduce((a, c) => a + c.tokens, 0);
  const out: { label: string; tokens: number; free?: boolean }[] = [...r.categories].sort((a, b) => b.tokens - a.tokens);
  if (!out.length) out.push({ label: "Used", tokens: r.used });
  else if (r.used - listed > r.used * 0.005) out.push({ label: "Other", tokens: r.used - listed });
  if (r.window != null && r.window > r.used) out.push({ label: "Free", tokens: r.window - r.used, free: true });
  return out;
}

export function contextLevel(share: number | null, warn = 0.8): ContextLevel {
  if (share == null) return "ok";
  if (share >= Math.max(warn, 0.95)) return "full";
  return share >= warn ? "warn" : "ok";
}

export function readPoints(v: unknown): ContextPoint[] {
  if (!Array.isArray(v)) return [];
  const out: ContextPoint[] = [];
  for (const p of v) {
    if (!isObj(p)) continue;
    const tRaw = p.t ?? p.at ?? p.time;
    const t = typeof tRaw === "number" ? tRaw : typeof tRaw === "string" ? Date.parse(tRaw) : NaN;
    const ctx = isObj(p.context) ? p.context : p;
    const used = numberOf(ctx.used ?? ctx.tokens);
    if (!Number.isFinite(t) || used == null) continue;
    out.push({ t, used, cost: isObj(p.cost) ? numberOf(p.cost.amount) : numberOf(p.cost) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Adds a reading when it differs from the last one; keeps the newest `max`. */
export function addReading(points: ContextPoint[], p: ContextPoint, max = 240): ContextPoint[] {
  const last = points.at(-1);
  if (last && last.used === p.used && last.cost === p.cost) return points;
  if (last && p.t <= last.t) return points;
  const next = [...points, p];
  return next.length > max ? next.slice(-max) : next;
}

/** Where the used count fell by more than a third: the session was compacted there. */
export function compactions(points: ContextPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < points.length; i++) if (points[i].used < points[i - 1].used * 0.67) out.push(i);
  return out;
}
