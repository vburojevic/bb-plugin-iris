import { describe, expect, it } from "vitest";
import { normalizeBench, normalizeCoverage, normalizeFindings, normalizeTests } from "../core/reports";
import { delimited, parseDataFile } from "../core/data";
import { mainInstructions, CODE_WORK_INSTRUCTIONS, referenceSections, SECTION_LIMIT } from "../core/prompt";
import { CATALOG } from "../core/catalog";

describe("reports", () => {
  it("reads a vitest JSON report", () => {
    const t = normalizeTests({
      testResults: [{ name: "/repo/core/parse.test.ts", assertionResults: [{ fullName: "parses", status: "passed" }, { fullName: "breaks", status: "failed", failureMessages: ["expected 1 to be 2"], location: { line: 9 } }] }],
    });
    expect(t.map((x) => x.status)).toEqual(["passed", "failed"]);
    expect(t[1].file).toBe("core/parse.test.ts");
    expect(t[1].line).toBe(9);
  });
  it("reads JUnit XML", () => {
    const t = normalizeTests(`<testsuite><testcase name="a" classname="S" time="0.5"/><testcase name="b"><failure message="boom">trace</failure></testcase><testcase name="c"><skipped/></testcase></testsuite>`);
    expect(t.map((x) => x.status)).toEqual(["passed", "failed", "skipped"]);
    expect(t[1].message).toBe("boom");
    expect(t[0].duration).toBe(500);
  });
  it("reads eslint JSON and tsc text", () => {
    expect(normalizeFindings([{ filePath: "/r/src/a.ts", messages: [{ severity: 2, message: "no", line: 3, ruleId: "x" }] }])[0]).toMatchObject({ severity: "high", line: 3, rule: "x" });
    expect(normalizeFindings("src/a.ts(4,2): error TS2322: Type 'x' is not assignable.")[0]).toMatchObject({ file: "src/a.ts", line: 4, rule: "TS2322" });
  });
  it("reads SARIF", () => {
    const f = normalizeFindings({ runs: [{ results: [{ level: "error", message: { text: "bad" }, ruleId: "r1", locations: [{ physicalLocation: { artifactLocation: { uri: "a.ts" }, region: { startLine: 7 } } }] }] }] });
    expect(f[0]).toMatchObject({ severity: "high", file: "a.ts", line: 7 });
  });
  it("reads lcov", () => {
    const c = normalizeCoverage("SF:/r/core/a.ts\nLF:10\nLH:8\nend_of_record\n");
    expect(c[0]).toMatchObject({ file: "core/a.ts", lines: 80 });
  });
  it("reads hyperfine", () => {
    const b = normalizeBench({ results: [{ command: "old", mean: 0.2 }, { command: "new", mean: 0.1 }] });
    expect(b[1]).toMatchObject({ name: "new", before: 200, after: 100 });
  });
});

describe("data files", () => {
  it("parses CSV with quotes and numbers", () => {
    expect(delimited('name,ms\n"a, b",12\nc,3.5\n', ",")).toEqual([{ name: "a, b", ms: 12 }, { name: "c", ms: 3.5 }]);
  });
  it("parses JSONL and leaves logs as text", () => {
    expect(parseDataFile("x.jsonl", '{"a":1}\n{"a":2}\n')).toEqual({ ok: true, value: [{ a: 1 }, { a: 2 }] });
    expect(parseDataFile("build.log", "hello")).toEqual({ ok: true, value: "hello" });
  });
});

describe("prompt", () => {
  it("keeps every section under bb's 4,096-character cap", () => {
    expect(mainInstructions("eager").length).toBeLessThanOrEqual(SECTION_LIMIT);
    expect(CODE_WORK_INSTRUCTIONS.length).toBeLessThanOrEqual(SECTION_LIMIT);
    for (const s of referenceSections()) expect(s.text.length, s.tool).toBeLessThanOrEqual(SECTION_LIMIT);
  });
  it("documents every component", () => {
    const all = referenceSections().map((s) => s.text).join("\n");
    for (const c of CATALOG) expect(all, c.name).toContain(`<${c.name}>`);
  });
});
