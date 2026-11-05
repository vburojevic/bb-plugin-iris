import { describe, expect, it } from "vitest";
import {
  acceptanceStatus,
  compareMode,
  diffPixels,
  diffSize,
  evidenceTarget,
  normalizeAcceptance,
  normalizeCompareImages,
  normalizeProvenance,
  sameFact,
  showFact,
  stageTone,
} from "../core/evidence";
import { referenceSections } from "../core/prompt";

describe("Acceptance", () => {
  it("reads statuses people write, and never reads an unknown one as passed", () => {
    expect(["passed", "PASS", "ok", "done", true].map(acceptanceStatus)).toEqual(["passed", "passed", "passed", "passed", "passed"]);
    expect(["failed", "error", "no", false].map(acceptanceStatus)).toEqual(["failed", "failed", "failed", "failed"]);
    expect(acceptanceStatus("blocked on review")).toBe("blocked");
    expect(acceptanceStatus("claimed")).toBe("claimed");
    expect(acceptanceStatus("asserted by the agent")).toBe("claimed");
    expect(["not run", "not tested", "pending", "", undefined, "maybe"].map(acceptanceStatus)).toEqual(Array(6).fill("untested"));
  });

  it("is done only when every criterion passed", () => {
    expect(normalizeAcceptance([{ name: "a", status: "passed" }, { name: "b", status: "passed" }]).verdict).toBe("done");
    expect(normalizeAcceptance([{ name: "a", status: "passed" }, { name: "b", status: "claimed" }]).verdict).toBe("unproven");
    expect(normalizeAcceptance([{ name: "a", status: "untested" }, { name: "b", status: "blocked" }]).verdict).toBe("not done");
    expect(normalizeAcceptance([]).verdict).toBe("empty");
  });

  it("builds a matrix: missing cells are untested, a row status fills its columns, rows show their worst cell", () => {
    const m = normalizeAcceptance(
      [
        { name: "Sync", cells: { iPhone: "passed", Mac: { status: "failed", note: "lost edit", evidence: "a.swift:3" } } },
        { name: "Export", status: "blocked" },
        { name: "Widget", cells: { iPad: "passed" } },
      ],
      ["iPhone", "iPad", "Mac"],
    );
    expect(m.columns).toEqual(["iPhone", "iPad", "Mac"]);
    expect(m.rows[0].cells.map((c) => c.status)).toEqual(["passed", "untested", "failed"]);
    expect(m.rows[0].cells[1].missing).toBe(true);
    expect(m.rows[0].cells[2]).toMatchObject({ note: "lost edit", evidence: "a.swift:3" });
    expect(m.rows[0].status).toBe("failed");
    expect(m.rows[1].cells.map((c) => c.status)).toEqual(["blocked", "blocked", "blocked"]);
    expect(m.counts).toEqual({ passed: 2, failed: 1, blocked: 3, untested: 3, claimed: 0 });
    expect(m.verdict).toBe("not done");
  });

  it("gathers columns from the cells when none are given", () => {
    const m = normalizeAcceptance([{ name: "a", cells: { web: "passed", ios: "passed" } }, { name: "b", cells: { android: "claimed", web: "passed" } }]);
    expect(m.columns).toEqual(["web", "ios", "android"]);
    expect(m.rows[0].cells[2].status).toBe("untested");
  });

  it("never reads hedged text as passed", () => {
    expect(["Done (claimed by agent)", "done but not verified", "supposedly works"].map(acceptanceStatus)).toEqual(["claimed", "claimed", "claimed"]);
    expect(["passes locally only", "ok, untested on iPad", "verified? no"].map(acceptanceStatus)).toEqual(["untested", "untested", "untested"]);
    expect(["passes", "Passed", "OK", "verified"].map(acceptanceStatus)).toEqual(Array(4).fill("passed"));
  });

  it("does not let a row status stand for columns its cells leave out", () => {
    const m = normalizeAcceptance([{ name: "a", status: "passed", cells: { iPhone: "passed" } }], ["iPhone", "iPad", "Mac"]);
    expect(m.rows[0].cells.map((c) => c.status)).toEqual(["passed", "untested", "untested"]);
    expect(m.verdict).toBe("unproven");
  });

  it("keeps cells outside the given columns and matches columns case-insensitively", () => {
    const m = normalizeAcceptance([{ name: "a", cells: { iPhone: "passed", Mac: "failed" } }], ["iPhone"]);
    expect(m.columns).toEqual(["iPhone", "Mac"]);
    expect(m.verdict).toBe("not done");
    const n = normalizeAcceptance([{ name: "a", cells: { iphone: "failed" } }], ["iPhone"]);
    expect(n.columns).toEqual(["iPhone"]);
    expect(n.rows[0].cells[0].status).toBe("failed");
  });

  it("opens evidence as a URL or a file with a line", () => {
    expect(evidenceTarget("https://example.com/run/4")).toEqual({ kind: "url", url: "https://example.com/run/4" });
    expect(evidenceTarget("tests/a.test.ts:42")).toEqual({ kind: "file", path: "tests/a.test.ts", line: 42 });
    expect(evidenceTarget("$BB_THREAD_STORAGE/shot.png")).toEqual({ kind: "file", path: "$BB_THREAD_STORAGE/shot.png", line: null });
    expect(evidenceTarget("README.md:3")).toEqual({ kind: "file", path: "README.md", line: 3 });
    expect(evidenceTarget("localhost:3000")).toEqual({ kind: "file", path: "localhost:3000", line: null });
  });
});

describe("Compare", () => {
  const rgba = (pixels: number[][]) => Uint8ClampedArray.from(pixels.flat());

  it("counts changed pixels and boxes them", () => {
    const a = rgba([[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]]);
    const b = rgba([[0, 0, 0, 255], [255, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 200, 255]]);
    const d = diffPixels(a, b, 3, 2);
    expect(d.changed).toBe(2);
    expect(d.total).toBe(6);
    expect([...d.mask]).toEqual([0, 1, 0, 0, 0, 1]);
    expect(d.bounds).toEqual({ x: 1, y: 0, width: 2, height: 2 });
  });

  it("ignores noise under the threshold and counts alpha changes", () => {
    const a = rgba([[100, 100, 100, 255], [10, 10, 10, 255]]);
    const b = rgba([[110, 92, 100, 255], [10, 10, 10, 0]]);
    expect(diffPixels(a, b, 2, 1).changed).toBe(1);
    expect(diffPixels(a, b, 2, 1, 4).changed).toBe(2);
    const same = diffPixels(a, a, 2, 1);
    expect(same.changed).toBe(0);
    expect(same.bounds).toBeNull();
  });

  it("refuses buffers smaller than the size", () => {
    expect(() => diffPixels(new Uint8ClampedArray(4), new Uint8ClampedArray(8), 2, 1)).toThrow();
  });

  it("caps the diff size at a pixel budget, keeping the aspect", () => {
    expect(diffSize(360, 220)).toEqual({ width: 360, height: 220, scale: 1 });
    const big = diffSize(4000, 3000, 3_000_000);
    expect(big.width * big.height).toBeLessThanOrEqual(3_000_000 + 4000);
    expect(big.width / big.height).toBeCloseTo(4 / 3, 2);
  });

  it("names images reference first and picks a mode", () => {
    expect(normalizeCompareImages(["a.png", { src: "b.png" }]).map((i) => i.label)).toEqual(["Reference", "Current"]);
    expect(normalizeCompareImages(["a.png", { src: "b.png", label: "Build 9" }, "c.png", { label: "no src" }]).map((i) => i.label)).toEqual(["Reference", "Build 9", "Image 3"]);
    expect(compareMode(undefined, 2)).toBe("wipe");
    expect(compareMode(undefined, 3)).toBe("side");
    expect(compareMode("diff", 2)).toBe("diff");
    expect(compareMode("nope", 2)).toBe("wipe");
  });
});

describe("Provenance", () => {
  it("flags only stages whose facts differ from expected", () => {
    const m = normalizeProvenance(
      [
        { name: "main", facts: { branch: "main", sha: "4f2c9e1a7d03" } },
        { name: "CI", status: "passed", facts: { sha: "4F2C9E1", build: "212", version: "v2.4.0" } },
        { name: "TestFlight", facts: { build: "212" } },
        { name: "Phone", facts: { build: "211", device: "iPhone" } },
        { name: "Docs" },
      ],
      { sha: "4f2c9e1", build: "212", version: "2.4.0" },
    );
    expect(m.stages.map((s) => s.mismatches.length)).toEqual([0, 0, 0, 1, 0]);
    expect(m.stages[3].mismatches[0]).toEqual({ fact: "build", actual: "211", expected: "212" });
    expect(m.differing).toBe(1);
    expect(m.checked).toBe(4);
    expect(m.stages[0].facts).toEqual([["branch", "main"], ["sha", "4f2c9e1a7d03"]]);
  });

  it("compares shas by prefix and versions without a leading v", () => {
    expect(sameFact("sha", "4f2c9e1a7d", "4f2c9e1")).toBe(true);
    expect(sameFact("sha", "4f2c9e1", "4f2c9e2")).toBe(false);
    expect(sameFact("sha", "4", "4f2c9e1")).toBe(false);
    expect(sameFact("sha", "abc", "ABC")).toBe(true);
    expect(sameFact("version", "v2.4.0", "2.4.0")).toBe(true);
    expect(sameFact("build", "212", "2120")).toBe(false);
  });

  it("reads stage tones and shortens shas", () => {
    expect(["installed", "failed", "running", "stale", "not deployed", "no errors", undefined].map(stageTone)).toEqual(["good", "bad", "info", "warn", "warn", "good", "neutral"]);
    expect(showFact("sha", "4f2c9e1a7d03")).toBe("4f2c9e1");
    expect(showFact("build", "4f2c9e1a7d03")).toBe("4f2c9e1a7d03");
  });
});

describe("prompt sections", () => {
  it("give every section its own tool", () => {
    const tools = referenceSections().map((s) => s.tool);
    expect(new Set(tools).size).toBe(tools.length);
  });
});
