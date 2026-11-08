// EvalReport: eval cases across runs, judged against a baseline. Reads Iris's
// own evals/results/latest.json shape ({at, model, score, byCategory, results:
// [{id, category, score, judge, judgeWhy, error?}]}), promptfoo output
// ({results: {results: [{testCase, success, score, gradingResult}]}}), a flat
// list of {case, run, score, pass?, note?} rows, or a list of any of those.

export type EvalVerdict = "regressed" | "improved" | "same" | "new" | "error";

export interface EvalCase {
  id: string;
  category?: string;
  /** 0 to 100. */
  score: number | null;
  pass: boolean | null;
  note?: string;
  error?: string;
  tags?: string[];
  /** The score was made from pass alone (0 or 100). */
  fromPass?: boolean;
}

export interface EvalRun {
  label: string;
  at?: string;
  model?: string;
  /** The run's own score, or the mean of its cases. */
  score: number | null;
  byCategory: Record<string, number>;
  cases: Map<string, EvalCase>;
}

export interface EvalRow {
  id: string;
  category?: string;
  /** One per run, oldest first; null where the run has no such case. */
  scores: (number | null)[];
  latest: EvalCase | null;
  /** What the latest score is judged against: the baseline's case, else the run before. */
  base: number | null;
  change: number | null;
  verdict: EvalVerdict;
}

export interface EvalCategory {
  name: string;
  score: number | null;
  base: number | null;
  change: number | null;
}

export interface EvalModel {
  runs: EvalRun[];
  rows: EvalRow[];
  score: number | null;
  base: number | null;
  /** Where base came from. */
  baseFrom: "baseline" | "previous run" | null;
  change: number | null;
  /** The latest score dropped below the baseline by more than the tolerance. */
  belowBase: boolean;
  tally: Record<EvalVerdict, number>;
  categories: EvalCategory[];
  problems: string[];
}

export const MAX_EVAL_RUNS = 20;
export const MAX_EVAL_CASES = 500;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : undefined);
const numberOf = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

function passOf(o: Obj): boolean | null {
  for (const k of ["pass", "passed", "success", "ok"]) if (typeof o[k] === "boolean") return o[k] as boolean;
  const s = text(o.status ?? o.result)?.toLowerCase();
  if (s && /^(pass|passed|ok|success)$/.test(s)) return true;
  if (s && /^(fail|failed|error)$/.test(s)) return false;
  return null;
}

function caseOf(item: unknown, k: number): EvalCase | null {
  if (!isObj(item)) return null;
  const tc = isObj(item.testCase) ? item.testCase : {};
  const grading = isObj(item.gradingResult) ? item.gradingResult : {};
  const id = text(item.id ?? item.case ?? item.name ?? item.test ?? item.description ?? tc.description ?? item.prompt) ?? `Case ${k + 1}`;
  const pass = passOf(item);
  const raw = numberOf(item.score ?? item.value ?? grading.score);
  const error = text(item.error);
  const tags = Array.isArray(item.components) ? item.components.filter((c): c is string => typeof c === "string").slice(0, 12) : undefined;
  return {
    id: id.slice(0, 160),
    category: text(item.category ?? item.group ?? item.suite),
    score: raw ?? (pass == null ? null : pass ? 100 : 0),
    fromPass: raw == null && pass != null,
    pass,
    note: text(item.judgeWhy ?? item.why ?? item.note ?? item.reason ?? grading.reason ?? item.comment)?.slice(0, 2000),
    error: error?.slice(0, 1000),
    tags,
  };
}

/** Scores between 0 and 1 (promptfoo) read as percent. */
function scale(cases: EvalCase[]): boolean {
  const scores = cases.filter((c) => c.score != null && !(c.pass != null && numberOfScoreMissing(c))).map((c) => c.score as number);
  if (!scores.length || scores.some((s) => s > 1 || s < 0)) return false;
  for (const c of cases) if (c.score != null && c.score <= 1 && !numberOfScoreMissing(c)) c.score = round1(c.score * 100);
  return true;
}
/** A score made up from pass alone is already 0 or 100. */
const numberOfScoreMissing = (c: EvalCase) => c.fromPass === true;

function categoriesOf(cases: EvalCase[]): Record<string, number> {
  const by = new Map<string, number[]>();
  for (const c of cases) if (c.category && c.score != null && !c.error) by.set(c.category, [...(by.get(c.category) ?? []), c.score]);
  return Object.fromEntries([...by].map(([k, v]) => [k, mean(v) as number]));
}

function numberMap(v: unknown): Record<string, number> {
  if (!isObj(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(v)) {
    const n = numberOf(x);
    if (n != null) out[k] = n;
  }
  return out;
}

function runOf(report: unknown, k: number): EvalRun | null {
  let items: unknown[] | null = null;
  let meta: Obj = {};
  if (Array.isArray(report)) items = report;
  else if (isObj(report)) {
    meta = report;
    if (Array.isArray(report.results)) items = report.results;
    else if (isObj(report.results) && Array.isArray(report.results.results)) items = report.results.results;
    else if (Array.isArray(report.cases)) items = report.cases;
  }
  if (!items) return null;
  const cases = items.slice(0, MAX_EVAL_CASES).map(caseOf).filter((c): c is EvalCase => !!c);
  const scaled = scale(cases);
  const map = new Map<string, EvalCase>();
  for (const c of cases) if (!map.has(c.id)) map.set(c.id, c);
  const own = numberOf(meta.score);
  const scored = [...map.values()].filter((c) => c.score != null && !c.error).map((c) => c.score as number);
  const at = text(meta.at ?? meta.timestamp ?? meta.createdAt ?? meta.date);
  const label = text(meta.label ?? meta.name ?? meta.run) ?? (at ? shortDate(at) : `Run ${k + 1}`);
  const byCategory = { ...categoriesOf([...map.values()]), ...numberMap(meta.byCategory) };
  return { label: label.slice(0, 40), at, model: text(meta.model), score: own != null ? (scaled && own <= 1 ? round1(own * 100) : own) : mean(scored), byCategory, cases: map };
}

function shortDate(at: string): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return at.slice(0, 16);
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Runs from one report, a list of reports, or flat rows that say which run they belong to. */
export function readEvalRuns(input: unknown): { runs: EvalRun[]; problems: string[] } {
  const problems: string[] = [];
  let reports: unknown[];
  if (Array.isArray(input)) {
    const objs = input.filter(isObj);
    const isReports = objs.length > 0 && objs.every((o) => Array.isArray(o.results) || isObj(o.results) || Array.isArray(o.cases));
    if (isReports) reports = objs;
    else if (objs.some((o) => o.run != null)) {
      // Flat rows: group by run, in order of first appearance.
      const by = new Map<string, Obj[]>();
      for (const o of objs) {
        const r = text(o.run) ?? "Run";
        by.set(r, [...(by.get(r) ?? []), o]);
      }
      reports = [...by].map(([label, results]) => ({ label, results }));
    } else reports = [input];
  } else reports = input == null ? [] : [input];
  let runs = reports.map(runOf).filter((r): r is EvalRun => !!r);
  if (reports.length && !runs.length) problems.push("found no eval cases: give a report with results, or rows of {case, score}");
  // Dated runs read oldest first, whatever order they came in.
  if (runs.length > 1 && runs.every((r) => r.at && Number.isFinite(Date.parse(r.at)))) runs = [...runs].sort((a, b) => Date.parse(a.at as string) - Date.parse(b.at as string));
  if (runs.length > MAX_EVAL_RUNS) {
    problems.push(`showing the last ${MAX_EVAL_RUNS} of ${runs.length} runs`);
    runs = runs.slice(-MAX_EVAL_RUNS);
  }
  return { runs, problems };
}

interface Baseline {
  score: number | null;
  cases: Map<string, number>;
  byCategory: Record<string, number>;
}

function readBaseline(v: unknown): Baseline | null {
  if (v == null) return null;
  const n = numberOf(v);
  if (n != null) return { score: n, cases: new Map(), byCategory: {} };
  if (!isObj(v) && !Array.isArray(v)) return null;
  const run = runOf(v, 0);
  if (run) return { score: run.score, cases: new Map([...run.cases].filter(([, c]) => c.score != null && !c.error).map(([id, c]) => [id, c.score as number])), byCategory: run.byCategory };
  if (isObj(v) && ("score" in v || "byCategory" in v)) return { score: numberOf(v.score), cases: new Map(), byCategory: numberMap(v.byCategory) };
  // {caseId: score}
  return { score: null, cases: new Map(Object.entries(numberMap(v))), byCategory: {} };
}

const ORDER: Record<EvalVerdict, number> = { error: 0, regressed: 1, new: 2, improved: 3, same: 4 };

export function evalReport(runsInput: unknown, baselineInput?: unknown, toleranceInput?: unknown): EvalModel {
  const { runs, problems } = readEvalRuns(runsInput);
  const tolerance = Math.max(0, numberOf(toleranceInput) ?? 0);
  const baseline = readBaseline(baselineInput);
  if (baselineInput != null && !baseline) problems.push("the baseline isn't a score, a report or {case: score}");
  const latest = runs.at(-1) ?? null;
  const previous = runs.length > 1 ? runs[runs.length - 2] : null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const r of [...runs].reverse()) for (const id of r.cases.keys()) if (!seen.has(id)) (seen.add(id), ids.push(id));

  const rows: EvalRow[] = ids.slice(0, MAX_EVAL_CASES).map((id) => {
    const scores = runs.map((r) => r.cases.get(id)?.score ?? null);
    const now = latest?.cases.get(id) ?? null;
    const anyCase = now ?? runs.map((r) => r.cases.get(id)).findLast((c) => !!c) ?? null;
    const prev = previous?.cases.get(id);
    const base = baseline?.cases.size ? (baseline.cases.get(id) ?? null) : prev && !prev.error ? prev.score : null;
    const score = now && !now.error ? now.score : null;
    const change = score != null && base != null ? round1(score - base) : null;
    const flippedToFail = now?.pass === false && prev?.pass === true && !baseline?.cases.size;
    let verdict: EvalVerdict;
    if (!now) verdict = "same";
    else if (now.error) verdict = "error";
    else if (base == null) verdict = baseline?.cases.size || previous ? "new" : "same";
    else if (flippedToFail || (change != null && change < -tolerance)) verdict = "regressed";
    else if (change != null && change > tolerance) verdict = "improved";
    else verdict = "same";
    return { id, category: anyCase?.category, scores, latest: now, base, change, verdict };
  });
  rows.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict] || (a.change ?? 0) - (b.change ?? 0) || a.id.localeCompare(b.id));

  const score = latest?.score ?? null;
  const baseFrom: EvalModel["baseFrom"] = baseline?.score != null || baseline?.cases.size ? "baseline" : previous ? "previous run" : null;
  const base = baseline ? (baseline.score ?? mean([...baseline.cases.values()])) : (previous?.score ?? null);
  const change = score != null && base != null ? round1(score - base) : null;
  const tally: Record<EvalVerdict, number> = { regressed: 0, improved: 0, same: 0, new: 0, error: 0 };
  for (const r of rows) if (r.latest) tally[r.verdict] += 1;

  const baseCats = baseline ? baseline.byCategory : (previous?.byCategory ?? {});
  const catNames = [...new Set([...Object.keys(latest?.byCategory ?? {}), ...Object.keys(baseCats)])].sort();
  const categories = catNames.map((name) => {
    const s = latest?.byCategory[name] ?? null;
    const b = baseCats[name] ?? null;
    return { name, score: s, base: b, change: s != null && b != null ? round1(s - b) : null };
  });
  return { runs, rows, score, base, baseFrom, change, belowBase: change != null && change < -tolerance, tally, categories, problems };
}
