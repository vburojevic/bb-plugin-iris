// TestHistory: pass and fail per test across runs, with flaky tests marked.
// Each run is anything Tests reads (vitest or jest JSON, JUnit XML, a list of
// {name, status}), oldest first; or one flat list of {test, run, status} rows.
// A test that flips between pass and fail more than once is flaky; one that
// failed and then passed for good is fixed; one failing now is failing.

import { normalizeTests, type TestCase } from "./reports";

export type TestKind = "flaky" | "failing" | "fixed" | "passing" | "skipped";
export type RunStatus = TestCase["status"] | null;

export interface HistoryRun {
  label: string;
  passed: number;
  failed: number;
  skipped: number;
}

export interface HistoryTest {
  key: string;
  name: string;
  file?: string;
  line?: number;
  /** One per run, oldest first; null where the run did not have the test. */
  results: RunStatus[];
  durations: (number | null)[];
  kind: TestKind;
  /** Pass and fail changes from one run to the next. */
  flips: number;
  /** Failed runs over runs that ran it (skips left out). */
  failRate: number;
  /** The run it started failing in, for a failing test. */
  since: number | null;
  message?: string;
}

export interface HistoryModel {
  runs: HistoryRun[];
  tests: HistoryTest[];
  tally: Record<TestKind, number>;
  problems: string[];
}

export const MAX_HISTORY_RUNS = 30;
export const MAX_HISTORY_TESTS = 2000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);

function statusOf(v: unknown, o?: Obj): TestCase["status"] {
  if (o && typeof o.passed === "boolean") return o.passed ? "passed" : "failed";
  const t = String(v ?? "").toLowerCase();
  if (/fail|error|broken/.test(t)) return "failed";
  if (/skip|pending|todo|disabled|ignored/.test(t)) return "skipped";
  return "passed";
}

function runLabel(report: unknown, k: number, labels: unknown): string {
  if (Array.isArray(labels) && labels[k] != null) return String(labels[k]).slice(0, 40);
  if (isObj(report)) {
    const named = text(report.label ?? report.name ?? report.run ?? report.sha ?? report.commit);
    if (named) return named.slice(0, 40);
    const at = typeof report.startTime === "number" ? report.startTime : typeof report.at === "string" ? Date.parse(report.at) : NaN;
    if (Number.isFinite(at)) {
      const d = new Date(at);
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
  }
  return `#${k + 1}`;
}

/** Runs as lists of test cases, from reports or flat rows. */
function readRuns(input: unknown, labels: unknown): { names: string[]; runs: TestCase[][] } {
  const list = Array.isArray(input) ? input : input == null ? [] : [input];
  const flat = list.length > 0 && list.every((r) => isObj(r) && r.run != null && (r.test != null || r.name != null) && !Array.isArray(r.testResults));
  if (flat) {
    const by = new Map<string, TestCase[]>();
    for (const r of list as Obj[]) {
      const run = String(r.run);
      by.set(run, [
        ...(by.get(run) ?? []),
        { name: String(r.test ?? r.name), status: statusOf(r.status ?? r.result, r), file: text(r.file), message: text(r.message ?? r.error), duration: typeof r.duration === "number" ? r.duration : undefined },
      ]);
    }
    return { names: [...by.keys()].map((n, k) => (Array.isArray(labels) && labels[k] != null ? String(labels[k]) : n).slice(0, 40)), runs: [...by.values()] };
  }
  // A run given as an object with its own `tests` or `results` list keeps its label.
  const runs = list.map((r) => (isObj(r) && Array.isArray(r.results) && !Array.isArray(r.testResults) ? normalizeTests(r.results) : normalizeTests(r)));
  return { names: list.map((r, k) => runLabel(r, k, labels)), runs };
}

export function testHistory(input: unknown, labels?: unknown): HistoryModel {
  const problems: string[] = [];
  let { names, runs } = readRuns(input, labels);
  if (runs.length > MAX_HISTORY_RUNS) {
    problems.push(`showing the last ${MAX_HISTORY_RUNS} of ${runs.length} runs`);
    names = names.slice(-MAX_HISTORY_RUNS);
    runs = runs.slice(-MAX_HISTORY_RUNS);
  }
  if (input != null && runs.every((r) => !r.length)) problems.push("found no tests in the runs: give vitest or jest JSON, JUnit XML or [{name, status}] per run");
  const tests = new Map<string, HistoryTest>();
  runs.forEach((cases, k) => {
    for (const c of cases) {
      const key = `${c.file ?? ""}::${c.name}`;
      let t = tests.get(key);
      if (!t) {
        if (tests.size >= MAX_HISTORY_TESTS) continue;
        t = { key, name: c.name, file: c.file, line: c.line, results: runs.map(() => null), durations: runs.map(() => null), kind: "passing", flips: 0, failRate: 0, since: null };
        tests.set(key, t);
      }
      // A test listed twice in one run (a retry) fails the run only if every try failed.
      const prev = t.results[k];
      t.results[k] = prev === "passed" || c.status === "passed" ? "passed" : prev === "failed" || c.status === "failed" ? "failed" : "skipped";
      if (prev === "failed" && c.status === "passed") t.flips += 0.5;
      t.durations[k] = c.duration ?? t.durations[k];
      if (c.status === "failed" && c.message) t.message = c.message;
    }
  });
  if (tests.size >= MAX_HISTORY_TESTS) problems.push(`showing the first ${MAX_HISTORY_TESTS} tests`);
  for (const t of tests.values()) classify(t);
  const order: Record<TestKind, number> = { flaky: 0, failing: 1, fixed: 2, passing: 3, skipped: 4 };
  const sorted = [...tests.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.failRate - a.failRate || a.name.localeCompare(b.name));
  const tally: Record<TestKind, number> = { flaky: 0, failing: 0, fixed: 0, passing: 0, skipped: 0 };
  for (const t of sorted) tally[t.kind] += 1;
  return {
    runs: runs.map((cases, k) => ({
      label: names[k] ?? `#${k + 1}`,
      passed: sorted.filter((t) => t.results[k] === "passed").length,
      failed: sorted.filter((t) => t.results[k] === "failed").length,
      skipped: sorted.filter((t) => t.results[k] === "skipped").length,
    })),
    tests: sorted,
    tally,
    problems,
  };
}

function classify(t: HistoryTest): void {
  const known = t.results.map((r, k) => [r, k] as const).filter(([r]) => r === "passed" || r === "failed");
  // A pass on retry inside one run already counted half a flip; it makes the test flaky.
  const retryFlaky = t.flips > 0;
  let flips = 0;
  for (let i = 1; i < known.length; i++) if (known[i][0] !== known[i - 1][0]) flips += 1;
  t.flips = flips + (retryFlaky ? 1 : 0);
  const failed = known.filter(([r]) => r === "failed").length;
  t.failRate = known.length ? failed / known.length : 0;
  if (!known.length) t.kind = "skipped";
  else if (flips >= 2 || retryFlaky) t.kind = "flaky";
  else if (known.at(-1)?.[0] === "failed") {
    t.kind = "failing";
    let k = known.length - 1;
    while (k > 0 && known[k - 1][0] === "failed") k -= 1;
    t.since = known[k][1];
  } else t.kind = failed ? "fixed" : "passing";
}
