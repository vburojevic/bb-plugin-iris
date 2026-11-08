import { describe, expect, it } from "vitest";
import { type Call, type Case, score } from "../evals/score";

const ask: Case = { id: "a", category: "ask", prompt: "", expect: ["Variants"], tools: ["iris_ask"] };
const picker = '<state pick="a" />\n<Variants bind="pick"><Variant value="a" label="A" /><Variant value="b" label="B" /></Variants>\n<Submit />';

describe("eval scoring", () => {
  it("credits a picker sent through iris_ask, with its components", () => {
    const calls: Call[] = [{ name: "iris_ask", args: { title: "Which?", source: picker }, isError: false }];
    const r = score(ask, "Waiting for your pick.", calls, 5);
    expect(r).toMatchObject({ hasIris: true, checkClean: true, expected: true, noTable: true, score: 100 });
    expect(r.tools).toEqual(["iris_ask"]);
  });
  it("doesn't credit a refused call, or the right component without the tool", () => {
    expect(score(ask, "No card.", [{ name: "iris_ask", args: { source: picker }, isError: true }], 1).hasIris).toBe(false);
    expect(score(ask, "```iris\n" + picker + "\n```", [], 3).expected).toBe(false);
  });
  it("credits a ::iris file card on its own line", () => {
    const file: Case = { id: "f", category: "status", prompt: "", expect: [], tools: ["directive", "iris_pin"] };
    expect(score(file, 'Here it is.\n::iris{file="$BB_THREAD_STORAGE/fleet.iris"}\n', [], 5)).toMatchObject({ hasIris: true, expected: true, tools: ["directive"] });
    expect(score(file, 'Write `::iris{file="x"}` to show it.', [], 5).hasIris).toBe(false);
  });
  it("still marks markdown tables and broken blocks", () => {
    const c: Case = { id: "t", category: "data", prompt: "", expect: ["Table"] };
    const r = score(c, "| a | b |\n|---|---|\n| 1 | 2 |\n```iris\n<Tabel rows={[]} />\n```", [], 2);
    expect(r).toMatchObject({ hasIris: true, checkClean: false, noTable: false });
  });
});

describe("eval scoring of directives", () => {
  it("ignores a directive shown inside a code block", () => {
    const file: Case = { id: "f", category: "status", prompt: "", expect: [], tools: ["directive"] };
    expect(score(file, 'Like this:\n```md\n::iris{file="$BB_THREAD_STORAGE/x.iris"}\n```\n', [], 5).hasIris).toBe(false);
  });
});
