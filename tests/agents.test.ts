import { describe, expect, it } from "vitest";
import { evalReport, readEvalRuns } from "../core/evalreport";
import { errorPath, normalizeTrace } from "../core/trace";
import { addReading, compactions, contextLevel, contextSegments, readContext, readPoints } from "../core/context";
import { maybeJson, normalizeToolCall } from "../core/toolcall";

// The shape this repo's own eval runner writes to evals/results/latest.json.
const run = (at: string, score: number, results: { id: string; category: string; score: number; judgeWhy?: string; error?: string }[]) => ({
  at,
  model: "claude-opus-5-5",
  cases: results.length,
  score,
  errored: results.filter((r) => r.error).map((r) => r.id),
  rates: { hasIris: 100 },
  byCategory: {},
  results: results.map((r) => ({ hasIris: true, checkClean: true, expected: true, noTable: true, components: ["Card"], judge: 4, judgeWhy: r.judgeWhy ?? "", ...r })),
});

describe("EvalReport", () => {
  const older = run("2026-11-06T10:00:00Z", 96, [
    { id: "ci-logs", category: "ci", score: 100 },
    { id: "data-csv", category: "data", score: 90 },
    { id: "status-week", category: "status", score: 95 },
  ]);
  const latest = run("2026-11-07T22:41:53Z", 93.3, [
    { id: "ci-logs", category: "ci", score: 90, judgeWhy: "Never read the error first" },
    { id: "data-csv", category: "data", score: 100 },
    { id: "status-week", category: "status", score: 95 },
    { id: "proof-done", category: "proof", score: 0, error: "timeout" },
  ]);

  it("reads latest.json and judges each case against the run before", () => {
    const m = evalReport([latest, older]);
    expect(m.runs.map((r) => r.label)).toHaveLength(2);
    // Dated runs sort oldest first whatever order they came in.
    expect(m.runs[1].score).toBe(93.3);
    expect(m.baseFrom).toBe("previous run");
    expect(m.base).toBe(96);
    expect(m.change).toBe(-2.7);
    expect(m.rows.map((r) => [r.id, r.verdict])).toEqual([
      ["proof-done", "error"],
      ["ci-logs", "regressed"],
      ["data-csv", "improved"],
      ["status-week", "same"],
    ]);
    expect(m.rows[1].latest?.note).toBe("Never read the error first");
    expect(m.rows[1].scores).toEqual([100, 90]);
    expect(m.tally).toMatchObject({ regressed: 1, improved: 1, same: 1, error: 1 });
  });

  it("uses a baseline.json total and categories, and a tolerance", () => {
    const m = evalReport(latest, { score: 95.2, byCategory: { ci: 98, data: 94 } }, 3);
    expect(m.baseFrom).toBe("baseline");
    expect(m.change).toBe(-1.9);
    expect(m.belowBase).toBe(false);
    expect(m.categories.find((c) => c.name === "ci")).toMatchObject({ score: 90, base: 98, change: -8 });
    expect(evalReport(latest, 98).belowBase).toBe(true);
  });

  it("takes per-case baselines from a report or a map", () => {
    const m = evalReport(latest, { "ci-logs": 85, "data-csv": 100 });
    expect(m.rows.find((r) => r.id === "ci-logs")?.verdict).toBe("improved");
    expect(m.rows.find((r) => r.id === "status-week")?.verdict).toBe("new");
  });

  it("reads flat rows and promptfoo scores between 0 and 1", () => {
    const flat = readEvalRuns([
      { case: "a", run: "v1", score: 0.5 },
      { case: "a", run: "v2", score: 0.75, pass: true },
    ]);
    expect(flat.runs.map((r) => r.label)).toEqual(["v1", "v2"]);
    expect(flat.runs[1].cases.get("a")?.score).toBe(75);
    const pf = readEvalRuns({ results: { results: [{ testCase: { description: "greets" }, success: false, score: 0.2, gradingResult: { reason: "too long" } }] } });
    expect(pf.runs[0].cases.get("greets")).toMatchObject({ score: 20, pass: false, note: "too long" });
  });

  it("marks a pass that turned into a fail as a regression even at the same score", () => {
    const m = evalReport([{ label: "a", results: [{ id: "x", pass: true }] }, { label: "b", results: [{ id: "x", pass: false }] }]);
    expect(m.rows[0].verdict).toBe("regressed");
  });

  it("says when there is nothing to read", () => {
    expect(evalReport({ nope: 1 }).problems[0]).toMatch(/no eval cases/);
  });
});

describe("AgentTrace", () => {
  it("lays out nested spans end to end and rolls up tokens and cost", () => {
    const m = normalizeTrace([
      {
        name: "Fix the login bug",
        kind: "agent",
        children: [
          { name: "claude", kind: "llm", ms: 1200, tokens: { input: 9000, output: 400 }, cost: 0.05 },
          { name: "Read", kind: "tool", ms: 30, input: { path: "src/login.ts" } },
          { name: "Bash", kind: "tool", ms: 4100, error: "exit 1", input: { command: "npm test" } },
          { name: "reviewer", kind: "subagent", children: [{ name: "claude", model: "opus", ms: 800, tokens: 3000, cost: 0.02 }] },
        ],
      },
    ]);
    expect(m.flat.map((s) => [s.name, s.depth, s.start])).toEqual([
      ["Fix the login bug", 0, 0],
      ["claude", 1, 0],
      ["Read", 1, 1200],
      ["Bash", 1, 1230],
      ["reviewer", 1, 5330],
      ["claude", 2, 5330],
    ]);
    expect(m.duration).toBe(6130);
    expect(m.roots[0].duration).toBe(6130);
    expect(m.roots[0].tokens).toBe(12400);
    expect(m.roots[0].tokensRolled).toBe(true);
    expect(m.cost).toBeCloseTo(0.07);
    expect(m).toMatchObject({ errors: 1, tools: 2, llm: 2, agents: 2 });
    expect([...errorPath(m)]).toEqual([m.roots[0].id]);
  });

  it("nests flat spans by parent and keeps real start times", () => {
    const m = normalizeTrace([
      { id: "r", name: "run", start: "2026-11-08T10:00:00.000Z", end: "2026-11-08T10:00:02.000Z" },
      { id: "b", parent: "r", name: "b", start: "2026-11-08T10:00:01.000Z", ms: 500 },
      { id: "a", parent: "r", name: "a", start: "2026-11-08T10:00:00.100Z", ms: 200 },
    ]);
    expect(m.roots).toHaveLength(1);
    expect(m.roots[0].children.map((c) => [c.name, c.start])).toEqual([
      ["a", 100],
      ["b", 1000],
    ]);
    expect(m.duration).toBe(2000);
  });

  it("survives parent loops and very deep chains", () => {
    const loop = normalizeTrace([{ id: "a", parent: "b", name: "a" }, { id: "b", parent: "a", name: "b" }]);
    expect(loop.flat).toHaveLength(2);
    const chain = normalizeTrace(Array.from({ length: 300 }, (_, i) => ({ id: String(i), parent: String(i + 1), name: `s${i}`, ms: 1 })));
    expect(Math.max(...chain.flat.map((s) => s.depth))).toBeLessThanOrEqual(64);
    expect(chain.problems.join()).toMatch(/deeper than 64/);
  });

  it("reads OpenTelemetry JSON with gen_ai attributes", () => {
    const m = normalizeTrace({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                { spanId: "1", name: "invoke_agent", startTimeUnixNano: "1762596000000000000", endTimeUnixNano: "1762596003000000000", attributes: [{ key: "gen_ai.operation.name", value: { stringValue: "invoke_agent" } }] },
                { spanId: "2", parentSpanId: "1", name: "chat", startTimeUnixNano: "1762596000500000000", endTimeUnixNano: "1762596001500000000", attributes: [{ key: "gen_ai.request.model", value: { stringValue: "opus" } }, { key: "gen_ai.usage.input_tokens", value: { intValue: "1200" } }] },
                { spanId: "3", parentSpanId: "1", name: "execute_tool grep", startTimeUnixNano: "1762596002000000000", endTimeUnixNano: "1762596002100000000", status: { code: 2, message: "no match" }, attributes: [{ key: "gen_ai.tool.name", value: { stringValue: "grep" } }] },
              ],
            },
          ],
        },
      ],
    });
    expect(m.flat.map((s) => [s.kind, s.start, s.duration])).toEqual([
      ["agent", 0, 3000],
      ["llm", 500, 1000],
      ["tool", 2000, 100],
    ]);
    expect(m.tokens).toBe(1200);
    expect(m.flat[2].error).toBe("no match");
  });
});

describe("ContextMeter", () => {
  const thread = { id: "thr_1", title: "Ship it", status: "active", context: { used: 412_000, window: 1_000_000, percent: 41.2, model: "claude-opus", categories: [{ label: "Messages", tokens: 301_000 }, { label: "Tools", tokens: 64_000 }, { label: "System", tokens: 40_000 }] }, cost: { amount: 4.82, currency: "USD" } };

  it("reads bb:thread and splits the window into categories, other and free", () => {
    const m = readContext(thread);
    expect(m.rows[0]).toMatchObject({ label: "Ship it", model: "claude-opus", used: 412_000, share: 0.412, cost: 4.82, currency: "USD" });
    expect(contextSegments(m.rows[0])).toEqual([
      { label: "Messages", tokens: 301_000 },
      { label: "Tools", tokens: 64_000 },
      { label: "System", tokens: 40_000 },
      { label: "Other", tokens: 7_000 },
      { label: "Free", tokens: 588_000, free: true },
    ]);
  });

  it("totals a bb:threads list by model and skips sessions without a reading", () => {
    const m = readContext([thread, { ...thread, title: "B", context: { used: 100_000, window: 200_000, model: "claude-sonnet" }, cost: { amount: 1, currency: "USD" } }, { title: "C", context: null, cost: null }]);
    expect(m.rows).toHaveLength(2);
    expect(m.byModel.map((x) => [x.model, x.used, x.sessions])).toEqual([
      ["claude-opus", 412_000, 1],
      ["claude-sonnet", 100_000, 1],
    ]);
    expect(m.cost).toBeCloseTo(5.82);
    expect(readContext({ title: "x", context: null }).problems[0]).toMatch(/no context reading/);
  });

  it("grades the fill and finds compactions in the history", () => {
    expect([contextLevel(0.5), contextLevel(0.85), contextLevel(0.97), contextLevel(null)]).toEqual(["ok", "warn", "full", "ok"]);
    const pts = readPoints([{ t: "2026-11-08T10:00", used: 100 }, { t: "2026-11-08T11:00", used: 800 }, { t: "2026-11-08T12:00", used: 200 }, { nope: 1 }]);
    expect(pts.map((p) => p.used)).toEqual([100, 800, 200]);
    expect(compactions(pts)).toEqual([2]);
    let r = addReading([], { t: 1, used: 5, cost: null });
    r = addReading(r, { t: 2, used: 5, cost: null });
    r = addReading(r, { t: 3, used: 6, cost: null });
    expect(r.map((p) => p.t)).toEqual([1, 3]);
  });
});

describe("ToolCall", () => {
  it("splits an MCP name and reads an MCP result as parsed text", () => {
    const m = normalizeToolCall({ name: "mcp__github__create_issue", args: '{"title":"Crash on launch","labels":["bug"]}', result: { content: [{ type: "text", text: '{"number": 812}' }] }, ms: 640 });
    expect(m).toMatchObject({ server: "github", name: "create_issue", status: "ok", result: { number: 812 }, ms: 640 });
    expect(m.preview).toBe('title: "Crash on launch", labels: [1]');
  });

  it("takes isError from the result and counts retries", () => {
    const m = normalizeToolCall({ name: "fetch", result: { isError: true, content: [{ type: "text", text: "rate limited" }] }, retries: 2 });
    expect(m.status).toBe("error");
    expect(m.error).toBe("rate limited");
    expect(m.attempts.map((a) => a.error)).toEqual(["failed", "failed", "rate limited"]);
  });

  it("sums attempt times and keeps plain text results as text", () => {
    const m = normalizeToolCall({ name: "Bash", args: { command: "ls" }, result: "a\nb", attempts: [{ ms: 100, error: "timeout" }, { ms: 50 }] });
    expect(m.ms).toBe(150);
    expect(m.resultText).toBe("a\nb");
    expect(m.status).toBe("ok");
    expect(normalizeToolCall({ name: "x", status: "running" }).status).toBe("running");
    expect(maybeJson("{broken")).toBe("{broken");
  });
});
