import { describe, expect, it } from "vitest";
import { normalizePipeline, pipelineCounts, pipelineStatus, rollUp } from "../core/pipeline";
import {
  epochMs,
  matchesPathFilter,
  parseChangesTarget,
  parseCommitLimit,
  parsePathFilter,
  parseThreadIds,
  pullRequestInfo,
  sortEnvironments,
  sortThreads,
  targetKey,
  type EnvironmentInfo,
  type ThreadRow,
} from "../core/project";
import { changedFileCount, gitPatchKey, isRepositoryPath } from "../project-source";

describe("Changes target", () => {
  it("reads the branch, uncommitted and a sha", () => {
    expect(parseChangesTarget(undefined)).toEqual({ ok: true, value: { kind: "branch" } });
    expect(parseChangesTarget("")).toEqual({ ok: true, value: { kind: "branch" } });
    expect(parseChangesTarget("uncommitted")).toEqual({ ok: true, value: { kind: "uncommitted" } });
    expect(parseChangesTarget("9F3C2A1")).toEqual({ ok: true, value: { kind: "commit", sha: "9f3c2a1" } });
  });
  it("rejects anything else with a readable reason", () => {
    const r = parseChangesTarget("HEAD~1");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("HEAD~1");
    expect(parseChangesTarget(42).ok).toBe(false);
  });
  it("round-trips to the wire form", () => {
    expect(targetKey({ kind: "branch" })).toBeNull();
    expect(targetKey({ kind: "uncommitted" })).toBe("uncommitted");
    expect(targetKey({ kind: "commit", sha: "abc1234" })).toBe("abc1234");
  });
});

describe("path filters", () => {
  it("parses lists and single strings, drops blanks", () => {
    expect(parsePathFilter(undefined)).toEqual({ ok: true, value: null });
    expect(parsePathFilter("core/")).toEqual({ ok: true, value: ["core/"] });
    expect(parsePathFilter(["./ui", " ", "a.ts"])).toEqual({ ok: true, value: ["ui", "a.ts"] });
    expect(parsePathFilter([]).ok && parsePathFilter([])).toEqual({ ok: true, value: null });
    expect(parsePathFilter([1]).ok).toBe(false);
  });
  it("matches exact paths, folders and globs", () => {
    expect(matchesPathFilter("core/parse.ts", null)).toBe(true);
    expect(matchesPathFilter("core/parse.ts", ["core/parse.ts"])).toBe(true);
    expect(matchesPathFilter("core/parse.ts", ["core"])).toBe(true);
    expect(matchesPathFilter("core/parse.ts", ["core/"])).toBe(true);
    expect(matchesPathFilter("corex/parse.ts", ["core"])).toBe(false);
    expect(matchesPathFilter("core/parse.ts", ["*.ts"])).toBe(false);
    expect(matchesPathFilter("core/parse.ts", ["**/*.ts"])).toBe(true);
    expect(matchesPathFilter("parse.ts", ["**/*.ts"])).toBe(true);
    expect(matchesPathFilter("tests/a.test.ts", ["tests/*.test.ts"])).toBe(true);
    expect(matchesPathFilter("tests/deep/a.test.ts", ["tests/*.test.ts"])).toBe(false);
    expect(matchesPathFilter("a.b", ["a?b"])).toBe(true);
  });
});

describe("Commits", () => {
  it("clamps the limit", () => {
    expect(parseCommitLimit(undefined)).toBe(20);
    expect(parseCommitLimit(0)).toBe(1);
    expect(parseCommitLimit("5")).toBe(5);
    expect(parseCommitLimit(10_000)).toBe(200);
  });
  it("reads seconds and milliseconds", () => {
    expect(epochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(epochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe("PullRequest", () => {
  it("maps bb's GitHub PR Status row", () => {
    const pr = pullRequestInfo({
      number: 7,
      title: "Add live components",
      url: "https://github.com/a/b/pull/7",
      state: "open",
      baseRefName: "main",
      headRefName: "project-components",
      updatedAt: "2026-11-03T10:00:00Z",
      autoMerge: false,
      inMergeQueue: null,
      checks: { state: "pending", totalCount: 3, passedCount: 2, failedCount: 0, pendingCount: 1 },
      review: { state: "review_required", reviewRequestCount: 0 },
      mergeability: { state: "mergeable" },
      attention: "checks_pending",
    });
    expect(pr).toMatchObject({ base: "main", head: "project-components", inMergeQueue: false, checks: { passed: 2, pending: 1, total: 3 } });
    expect(pr.updatedAt).toBe(Date.parse("2026-11-03T10:00:00Z"));
  });
});

describe("Threads", () => {
  it("reads ids and thread mentions", () => {
    expect(parseThreadIds(undefined)).toEqual({ ok: true, value: null });
    expect(parseThreadIds(["thr_abc123", "@thread:thr_def456#msg=4", "thr_abc123"])).toEqual({ ok: true, value: ["thr_abc123", "thr_def456"] });
    expect(parseThreadIds(["not-a-thread"]).ok).toBe(false);
  });
  it("puts threads that need the person first, then running ones", () => {
    const base = { found: true as const, title: "", archived: false, branch: null, providerId: "p", background: 0 };
    const rows: ThreadRow[] = [
      { ...base, id: "thr_idle", status: "idle", needsInput: false, updatedAt: 3 },
      { ...base, id: "thr_run", status: "active", needsInput: false, updatedAt: 1 },
      { found: false, id: "thr_gone" },
      { ...base, id: "thr_ask", status: "idle", needsInput: true, updatedAt: 0 },
      { ...base, id: "thr_err", status: "error", needsInput: false, updatedAt: 2 },
    ];
    expect(sortThreads(rows).map((r) => r.id)).toEqual(["thr_ask", "thr_run", "thr_err", "thr_idle", "thr_gone"]);
  });
});

describe("Environments", () => {
  it("puts the current one first, then ones with threads by activity", () => {
    const e = (id: string, extra: Partial<EnvironmentInfo>): EnvironmentInfo => ({
      id, name: null, branch: id, path: null, isWorktree: true, current: false, threads: [], changedFiles: null, ahead: null, pullRequest: null, updatedAt: 0, ...extra,
    });
    const thread = { id: "thr_x", title: "x", status: "idle" as const, needsInput: false };
    const sorted = sortEnvironments([e("old", { updatedAt: 9 }), e("busy", { threads: [thread], updatedAt: 5 }), e("mine", { current: true }), e("busier", { threads: [thread], updatedAt: 8 })]);
    expect(sorted.map((x) => x.id)).toEqual(["mine", "busier", "busy", "old"]);
  });
});

describe("git reads", () => {
  it("builds bb's patch key", () => {
    expect(JSON.parse(gitPatchKey("env_1", { type: "all", mergeBaseBranch: "origin/main" }, "a.ts", "r1"))).toEqual(["env_1", { type: "all", mergeBaseBranch: "origin/main" }, false, "a.ts", "r1"]);
  });
  it("counts a file both committed and edited once", () => {
    const files = (...paths: string[]) => paths.map((path) => ({ path }));
    expect(changedFileCount({ workingTree: { fileCount: 2, files: files("a.ts", "b.ts") }, mergeBase: { fileCount: 2, files: files("b.ts", "c.ts") } })).toBe(3);
    expect(changedFileCount({ workingTree: { fileCount: 1, files: files("a.ts") }, mergeBase: null })).toBe(1);
  });
  it("only asks for repository paths", () => {
    expect(isRepositoryPath("core/a.ts")).toBe(true);
    expect(isRepositoryPath("/etc/passwd")).toBe(false);
    expect(isRepositoryPath("core/../../x")).toBe(false);
    expect(isRepositoryPath("")).toBe(false);
  });
});

describe("Pipeline", () => {
  it("reads gh run view JSON", () => {
    const runs = normalizePipeline({
      name: "CI",
      displayTitle: "Add live components",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/a/b/actions/runs/1",
      jobs: [
        {
          name: "test",
          status: "completed",
          conclusion: "failure",
          startedAt: "2026-11-03T10:00:00Z",
          completedAt: "2026-11-03T10:01:30Z",
          url: "https://github.com/a/b/actions/runs/1/job/2",
          steps: [
            { name: "Set up job", status: "completed", conclusion: "success", number: 1 },
            { name: "Run npm test", status: "completed", conclusion: "failure", number: 2 },
            { name: "Post", status: "completed", conclusion: "skipped", number: 3, startedAt: "0001-01-01T00:00:00Z", completedAt: "0001-01-01T00:00:00Z" },
          ],
        },
        { name: "lint", status: "in_progress", conclusion: "", steps: [] },
        { name: "deploy", status: "queued", conclusion: "" },
      ],
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ name: "CI", title: "Add live components", status: "failed", url: "https://github.com/a/b/actions/runs/1" });
    expect(runs[0].jobs.map((j) => j.status)).toEqual(["failed", "running", "queued"]);
    expect(runs[0].jobs[0].durationMs).toBe(90_000);
    expect(runs[0].jobs[0].steps.map((s) => s.status)).toEqual(["passed", "failed", "skipped"]);
    expect(runs[0].jobs[0].steps[2].durationMs).toBeNull();
  });
  it("reads a written-out list and rolls status up from jobs", () => {
    const runs = normalizePipeline([{ name: "Build", jobs: [{ name: "a", status: "passed" }, { name: "b", status: "running", steps: ["one", "two"] }] }, { name: "Deploy", status: "queued" }]);
    expect(runs.map((r) => r.status)).toEqual(["running", "queued"]);
    expect(runs[0].jobs[1].steps.map((s) => s.name)).toEqual(["one", "two"]);
    expect(pipelineCounts(runs)).toMatchObject({ passed: 1, running: 1, queued: 1 });
  });
  it("reads gh run list output and Buildkite words", () => {
    const runs = normalizePipeline([{ name: "CI", status: "completed", conclusion: "success" }, { workflowName: "Release", status: "in_progress" }]);
    expect(runs.map((r) => [r.name, r.status])).toEqual([["CI", "passed"], ["Release", "running"]]);
    expect(pipelineStatus("canceled")).toBe("cancelled");
    expect(pipelineStatus("scheduled")).toBe("queued");
    expect(pipelineStatus("completed", "timed_out")).toBe("failed");
    expect(rollUp([])).toBe("neutral");
    expect(rollUp(["skipped", "skipped"])).toBe("skipped");
    expect(normalizePipeline(null)).toEqual([]);
  });
});

describe("path filter globs", () => {
  it("match like before", () => {
    expect(matchesPathFilter("core/parse.ts", ["**/*.ts"])).toBe(true);
    expect(matchesPathFilter("parse.ts", ["**/*.ts"])).toBe(true);
    expect(matchesPathFilter("core/parse.ts", ["*.ts"])).toBe(false);
    expect(matchesPathFilter("core/a/b/parse.test.ts", ["core/**/*.test.ts"])).toBe(true);
    expect(matchesPathFilter("core/parse.test.ts", ["core/**/*.test.ts"])).toBe(true);
    expect(matchesPathFilter("core/x.ts", ["core/?.ts"])).toBe(true);
    expect(matchesPathFilter("core/xy.ts", ["core/?.ts"])).toBe(false);
    expect(matchesPathFilter("src/deep/file.md", ["src/**"])).toBe(true);
  });

  it("stay fast on a filter full of wildcards", () => {
    const evil = `${"**?".repeat(300)}Z`;
    const path = `${"a".repeat(60)}/${"b".repeat(60)}.ts`;
    const t = performance.now();
    expect(matchesPathFilter(path, [evil])).toBe(false);
    expect(performance.now() - t).toBeLessThan(200);
  });
});
