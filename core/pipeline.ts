// Pipeline's run prop in every form agents have at hand: a list of runs
// written out ([{name, status, jobs?: [{name, status, steps?}]}]), one run,
// `gh run view --json name,displayTitle,status,conclusion,jobs,url`, or
// `gh run list --json ...`. All of them become one shape with one status vocabulary.

export type PipelineStatus = "passed" | "failed" | "running" | "queued" | "cancelled" | "skipped" | "neutral";

export interface PipelineStep {
  name: string;
  status: PipelineStatus;
  durationMs: number | null;
}

export interface PipelineJob {
  name: string;
  status: PipelineStatus;
  url: string | null;
  durationMs: number | null;
  steps: PipelineStep[];
}

export interface PipelineRun {
  name: string;
  /** gh's displayTitle: the commit or PR title the run is for. */
  title: string | null;
  status: PipelineStatus;
  url: string | null;
  durationMs: number | null;
  jobs: PipelineJob[];
}

const WORDS: [RegExp, PipelineStatus][] = [
  [/^(pass|passed|success|succeeded|successful|ok|green|done|complete|completed|finished)$/, "passed"],
  [/^(fail|failed|failure|failing|error|errored|broken|red|timed[_ ]?out|timeout|startup[_ ]?failure|action[_ ]?required)$/, "failed"],
  [/^(running|in[_ ]?progress|active|started|building|executing)$/, "running"],
  [/^(queued|pending|waiting|scheduled|requested|blocked|created|not[_ ]?started|todo)$/, "queued"],
  [/^(cancelled|canceled|cancelling|canceling|aborted|stopped|stale)$/, "cancelled"],
  [/^(skipped|skip|ignored|not[_ ]?run)$/, "skipped"],
  [/^(neutral|unknown|none)$/, "neutral"],
];

function word(value: unknown): PipelineStatus | null {
  if (typeof value === "boolean") return value ? "passed" : "failed";
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  for (const [re, status] of WORDS) if (re.test(v)) return status;
  return null;
}

/** gh reports status "completed" with the outcome in conclusion. */
export function pipelineStatus(status: unknown, conclusion?: unknown): PipelineStatus | null {
  const s = typeof status === "string" ? status.trim().toLowerCase() : status;
  const c = word(conclusion);
  if ((s === "completed" || s === "complete" || s == null || s === "") && c) return c;
  return word(status) ?? c;
}

/** A parent's status from its children: any failure fails it, then running, queued, cancelled. */
export function rollUp(children: PipelineStatus[]): PipelineStatus {
  if (!children.length) return "neutral";
  for (const s of ["failed", "running", "queued", "cancelled"] as const) if (children.includes(s)) return s;
  if (children.every((c) => c === "skipped")) return "skipped";
  return children.some((c) => c === "passed") ? "passed" : "neutral";
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;
}

function duration(o: Record<string, unknown>): number | null {
  const d = o.durationMs ?? o.duration;
  if (typeof d === "number" && Number.isFinite(d) && d >= 0) return d;
  const start = typeof o.startedAt === "string" ? Date.parse(o.startedAt) : NaN;
  const end = typeof o.completedAt === "string" ? Date.parse(o.completedAt) : NaN;
  // gh sends 0001-01-01 for steps that never ran.
  if (Number.isFinite(start) && Number.isFinite(end) && end >= start && start > 0) return end - start;
  return null;
}

function step(v: unknown, k: number): PipelineStep {
  if (typeof v === "string") return { name: v, status: "neutral", durationMs: null };
  const o = obj(v) ?? {};
  return { name: text(o.name) ?? text(o.label) ?? `Step ${k + 1}`, status: pipelineStatus(o.status ?? o.state, o.conclusion) ?? "neutral", durationMs: duration(o) };
}

function job(v: unknown, k: number): PipelineJob {
  if (typeof v === "string") return { name: v, status: "neutral", url: null, durationMs: null, steps: [] };
  const o = obj(v) ?? {};
  const steps = Array.isArray(o.steps) ? o.steps.map(step) : [];
  const own = pipelineStatus(o.status ?? o.state, o.conclusion);
  return {
    name: text(o.name) ?? text(o.label) ?? `Job ${k + 1}`,
    status: own ?? (steps.length ? rollUp(steps.map((s) => s.status)) : "neutral"),
    url: text(o.url) ?? text(o.html_url) ?? text(o.web_url),
    durationMs: duration(o),
    steps,
  };
}

function run(v: unknown, k: number): PipelineRun {
  const o = obj(v) ?? {};
  const jobs = Array.isArray(o.jobs) ? o.jobs.map(job) : Array.isArray(o.stages) ? o.stages.map(job) : [];
  const own = pipelineStatus(o.status ?? o.state, o.conclusion);
  const name = text(o.name) ?? text(o.workflowName) ?? text(o.pipeline) ?? text(o.displayTitle) ?? `Run ${k + 1}`;
  const title = text(o.displayTitle);
  return {
    name,
    title: title && title !== name ? title : null,
    status: own ?? rollUp(jobs.map((j) => j.status)),
    url: text(o.url) ?? text(o.html_url) ?? text(o.web_url),
    durationMs: duration(o),
    jobs,
  };
}

/** Every accepted form of the run prop, as a list of runs. */
export function normalizePipeline(input: unknown): PipelineRun[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input.map(run);
  const o = obj(input);
  if (!o) return [];
  if (Array.isArray(o.runs)) return o.runs.map(run);
  if (Array.isArray(o.workflow_runs)) return o.workflow_runs.map(run);
  return [run(o, 0)];
}

export function pipelineCounts(runs: PipelineRun[]): Record<PipelineStatus, number> {
  const counts: Record<PipelineStatus, number> = { passed: 0, failed: 0, running: 0, queued: 0, cancelled: 0, skipped: 0, neutral: 0 };
  for (const r of runs) {
    if (r.jobs.length) for (const j of r.jobs) counts[j.status] += 1;
    else counts[r.status] += 1;
  }
  return counts;
}
