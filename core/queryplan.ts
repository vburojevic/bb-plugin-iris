// Postgres EXPLAIN (FORMAT JSON) read into a tree QueryPlan can draw: each
// node's own share of the time (or cost), the estimate it was planned with,
// and the warnings a reader looks for first (bad estimates, spills, big
// filtered scans).

import { toText } from "./evaluate";

export interface PlanNode {
  id: number;
  depth: number;
  type: string;
  /** "Seq Scan on users u", "Hash Join (Inner)". */
  label: string;
  /** The relation or index it reads, if any. */
  target?: string;
  cost: { startup: number; total: number } | null;
  /** Its own cost: total minus its children's. */
  selfCost: number;
  planRows: number | null;
  width: number | null;
  actual: { startup: number; total: number; rows: number; loops: number } | null;
  /** Its own time in ms across loops: inclusive minus its children's. */
  selfMs: number;
  /** Inclusive time in ms across loops. */
  totalMs: number;
  details: [string, string][];
  warnings: string[];
  children: PlanNode[];
}

export interface QueryPlanData {
  root: PlanNode | null;
  analyzed: boolean;
  planningMs: number | null;
  executionMs: number | null;
  totalCost: number;
  /** Every node, in tree order. */
  nodes: PlanNode[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Keys that already show elsewhere on the node. */
const SHOWN = new Set([
  "Node Type", "Plans", "Relation Name", "Alias", "Index Name", "Schema", "Parent Relationship", "Join Type", "Strategy", "Partial Mode", "Parallel Aware", "Async Capable",
  "Startup Cost", "Total Cost", "Plan Rows", "Plan Width", "Actual Startup Time", "Actual Total Time", "Actual Rows", "Actual Loops", "Scan Direction", "CTE Name", "Function Name", "Subplan Name",
]);

/** Details a reader wants first, in this order; the rest follow alphabetically. */
const FIRST = ["Filter", "Index Cond", "Recheck Cond", "Hash Cond", "Merge Cond", "Join Filter", "Rows Removed by Filter", "Rows Removed by Join Filter", "Rows Removed by Index Recheck", "Sort Key", "Sort Method", "Sort Space Used", "Sort Space Type", "Group Key", "Hash Buckets", "Hash Batches", "Peak Memory Usage", "Workers Planned", "Workers Launched"];

/** Reads EXPLAIN JSON as psql, pg or an ORM prints it: [{Plan}], {Plan}, [{"QUERY PLAN": [...]}], or the text of any of these. */
export function normalizePlan(input: unknown): { plan: QueryPlanData; problems: string[] } {
  const problems: string[] = [];
  let v = input;
  if (typeof v === "string") {
    const t = v.trim();
    try {
      v = JSON.parse(t);
    } catch {
      problems.push(/^\s*(\w[\w ]*\s+\(cost=|QUERY PLAN)/m.test(t) ? "this is EXPLAIN text; run EXPLAIN (FORMAT JSON) (add ANALYZE, BUFFERS for timings)" : "plan is text that isn't EXPLAIN JSON");
      return { plan: empty(), problems };
    }
  }
  for (let k = 0; k < 4; k++) {
    if (Array.isArray(v)) v = v[0];
    else if (isObj(v) && typeof v["QUERY PLAN"] === "string") {
      try {
        v = JSON.parse(v["QUERY PLAN"] as string);
      } catch {
        problems.push("QUERY PLAN holds text that isn't EXPLAIN JSON; run EXPLAIN (FORMAT JSON)");
        return { plan: empty(), problems };
      }
    } else if (isObj(v) && "QUERY PLAN" in v) v = v["QUERY PLAN"];
    else break;
  }
  if (!isObj(v)) {
    problems.push("plan takes EXPLAIN (FORMAT JSON) output");
    return { plan: empty(), problems };
  }
  const top = v;
  const rootRaw = isObj(top.Plan) ? top.Plan : "Node Type" in top ? top : null;
  if (!rootRaw) {
    problems.push("found no Plan in the EXPLAIN output");
    return { plan: empty(), problems };
  }
  const nodes: PlanNode[] = [];
  let analyzed = false;
  const build = (raw: Obj, depth: number): PlanNode => {
    const type = toText(raw["Node Type"] ?? "Node");
    const relation = raw["Relation Name"] != null ? toText(raw["Relation Name"]) : undefined;
    const alias = raw.Alias != null ? toText(raw.Alias) : undefined;
    const index = raw["Index Name"] != null ? toText(raw["Index Name"]) : undefined;
    const other = raw["CTE Name"] ?? raw["Function Name"] ?? raw["Subplan Name"];
    let label = type;
    if (raw["Join Type"] && !/^(Inner)$/.test(toText(raw["Join Type"]))) label += ` (${toText(raw["Join Type"])})`;
    else if (raw["Join Type"]) label += " (Inner)";
    if (raw.Strategy && /Aggregate|SetOp/.test(type)) label = `${toText(raw.Strategy)} ${label}`.replace(/^Plain /, "");
    if (raw["Parallel Aware"] === true && !label.startsWith("Parallel")) label = `Parallel ${label}`;
    if (index) label += ` using ${index}`;
    if (relation) label += ` on ${relation}${alias && alias !== relation ? ` ${alias}` : ""}`;
    else if (other) label += ` on ${toText(other)}`;
    const startup = num(raw["Startup Cost"]);
    const total = num(raw["Total Cost"]);
    const aTotal = num(raw["Actual Total Time"]);
    const loops = num(raw["Actual Loops"]);
    const actual = aTotal !== null && loops !== null ? { startup: num(raw["Actual Startup Time"]) ?? 0, total: aTotal, rows: num(raw["Actual Rows"]) ?? 0, loops } : null;
    if (actual) analyzed = true;
    const node: PlanNode = {
      id: nodes.length,
      depth,
      type,
      label,
      target: index ?? relation,
      cost: startup !== null && total !== null ? { startup, total } : null,
      selfCost: 0,
      planRows: num(raw["Plan Rows"]),
      width: num(raw["Plan Width"]),
      actual,
      selfMs: 0,
      totalMs: actual ? actual.total * actual.loops : 0,
      details: [],
      warnings: [],
      children: [],
    };
    nodes.push(node);
    const parent = raw["Parent Relationship"] ? toText(raw["Parent Relationship"]) : "";
    if (parent && parent !== "Outer" && parent !== "Inner" && parent !== "Member") node.details.push(["Role", parent === "InitPlan" || parent === "SubPlan" ? `${parent}${raw["Subplan Name"] ? ` (${toText(raw["Subplan Name"])})` : ""}` : parent]);
    const keys = Object.keys(raw).filter((k) => !SHOWN.has(k));
    keys.sort((a, b) => rankKey(a) - rankKey(b) || a.localeCompare(b));
    for (const k of keys) {
      const val = raw[k];
      if (val == null || val === "" || (Array.isArray(val) && !val.length)) continue;
      if (/Blocks$/.test(k) && val === 0) continue;
      node.details.push([k, Array.isArray(val) ? val.map(toText).join(", ") : isObj(val) ? JSON.stringify(val) : toText(val)]);
    }
    for (const c of Array.isArray(raw.Plans) ? raw.Plans : []) if (isObj(c)) node.children.push(build(c, depth + 1));
    node.selfCost = Math.max(0, (total ?? 0) - node.children.reduce((a, c) => a + (c.cost?.total ?? 0), 0));
    node.selfMs = actual ? Math.max(0, node.totalMs - node.children.reduce((a, c) => a + c.totalMs, 0)) : 0;
    node.warnings = warnings(node, raw);
    return node;
  };
  const root = build(rootRaw, 0);
  return {
    plan: {
      root,
      analyzed,
      planningMs: num(top["Planning Time"]),
      executionMs: num(top["Execution Time"]) ?? (analyzed ? root.totalMs : null),
      totalCost: root.cost?.total ?? 0,
      nodes,
    },
    problems,
  };
}

function rankKey(k: string): number {
  const i = FIRST.indexOf(k);
  return i < 0 ? FIRST.length : i;
}

function empty(): QueryPlanData {
  return { root: null, analyzed: false, planningMs: null, executionMs: null, totalCost: 0, nodes: [] };
}

const fmtRows = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

function warnings(n: PlanNode, raw: Obj): string[] {
  const out: string[] = [];
  if (n.actual && n.actual.loops === 0) return ["Never executed"];
  if (n.actual && n.planRows !== null) {
    const est = Math.max(1, n.planRows);
    const got = Math.max(1, n.actual.rows);
    const off = got / est;
    if ((off >= 10 || off <= 0.1) && Math.max(n.planRows, n.actual.rows) >= 100) {
      out.push(`Estimated ${fmtRows(n.planRows)} rows, got ${fmtRows(n.actual.rows)} (${off >= 1 ? `${Math.round(off)}x more` : `${Math.round(1 / off)}x fewer`})`);
    }
  }
  const removed = num(raw["Rows Removed by Filter"]);
  if (/Seq Scan/.test(n.type) && removed !== null && n.actual) {
    const kept = n.actual.rows * Math.max(1, n.actual.loops);
    const dropped = removed * Math.max(1, n.actual.loops);
    if (dropped >= 1000 && dropped > kept * 10) out.push(`Read ${fmtRows(dropped + kept)} rows to keep ${fmtRows(kept)}; an index on the filter may help`);
  }
  const space = toText(raw["Sort Space Type"] ?? "");
  const method = toText(raw["Sort Method"] ?? "");
  if (/disk/i.test(space) || /external/i.test(method)) out.push("Sort spilled to disk; raise work_mem or sort less");
  const batches = num(raw["Hash Batches"]);
  if (batches !== null && batches > 1) out.push(`Hash used ${batches} batches (spilled to disk)`);
  if (n.actual && n.actual.loops >= 1000 && n.depth > 0) out.push(`Ran ${fmtRows(n.actual.loops)} times`);
  return out;
}
