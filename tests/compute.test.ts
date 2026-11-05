import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { cellProblems, cellValues, normalizeCells, runCells, splitCell } from "../core/compute";
import { compile, CardRuntime } from "../core/program";

const runtime = (src = `<state seats={10} />`) => new CardRuntime(compile(src));

describe("compute cells", () => {
  it("reads cells as objects, name = expr strings and bare expressions", () => {
    const { cells, problems } = normalizeCells([{ name: "a", expr: "1 + 1" }, "b = a * 3", "a == 2", { name: "1x", expr: "2" }, { name: "a", expr: "3" }, { nope: 1 }]);
    expect(cells.map((c) => c.name)).toEqual(["a", "b", "", "1x", "a"]);
    expect(problems.join("\n")).toMatch(/not a name/);
    expect(problems.join("\n")).toMatch(/used twice/);
    expect(problems.join("\n")).toMatch(/needs an expr/);
    expect(splitCell("x == 3").name).toBe("");
  });
  it("runs top to bottom with state, globals and earlier cells in scope", () => {
    const rt = runtime();
    const { cells } = normalizeCells(["price = 29", "total = price * seats", "rows = range(3).map((i) => ({ i, sq: i * i }))", "sum(rows, \"sq\")", "fee = (x) => x * 0.03", "fee(total)"]);
    const out = runCells(cells, rt.interp, rt.globals);
    expect(out.map((r) => r.error)).toEqual([null, null, null, null, null, null]);
    expect(out[1].value).toBe(290);
    expect(out[3].value).toBe(5);
    expect(out[5].value).toBeCloseTo(8.7);
    expect(Object.keys(cellValues(out))).toEqual(["price", "total", "rows"]);
  });
  it("fails a cell alone and names the cause in cells that read it", () => {
    const rt = runtime();
    const out = runCells(normalizeCells(["a = nope + 1", "b = a * 2", "c = d + 1", "d = 4", "e = (", "f = 1"]).cells, rt.interp, rt.globals);
    expect(out[0].error).toMatch(/nope is not defined/);
    expect(out[1].error).toBe("a has an error");
    expect(out[2].error).toMatch(/later cell/);
    expect(out[4].error).toMatch(/can't read this/);
    expect(out[5].value).toBe(1);
  });
  it("never reaches host objects and stops runaway loops", () => {
    const rt = runtime();
    const out = runCells(normalizeCells(["x = ({}).constructor", "y = range(1000).map(() => range(1000).map((j) => j))"]).cells, rt.interp, rt.globals);
    expect(out[0].value).toBeUndefined();
    expect(out[1].error).toMatch(/too much work/);
  });
  it("reports parse problems through check()", () => {
    expect(cellProblems(["a = 1", "b = (a"])).toHaveLength(1);
    expect(check(`<state calc={{}} />\n<Cells bind="calc" cells={["a = 1", "b = a +"]} />`).ok).toBe(false);
    expect(check(`<state calc={{}} />\n<Cells bind="calc" cells={["a = 1", "b = a + 1"]} />\n<Metric label="b" value={calc.b} />`).ok).toBe(true);
  });
});

describe("review fixes", () => {
  it("keeps functions and blocked names out of bind, and refuses cells that read the bound state", () => {
    const rt = runtime(`<state calc={{}} />`);
    const out = runCells(normalizeCells(["rate = 0.5", "fee = (x) => x * rate", "n = (calc.n ?? 0) + 1", "s = \"calc\""]).cells, rt.interp, rt.globals, "calc");
    expect(Object.keys(cellValues(out))).toEqual(["rate", "s"]);
    expect(out[2].error).toMatch(/reads calc/);
    expect(normalizeCells([{ name: "__proto__", expr: "{}" }]).problems[0]).toMatch(/reserved/);
  });
});

describe("review round 2", () => {
  it("keeps values with functions inside out of bind, and ignores the bound name in template strings", () => {
    const rt = runtime(`<state calc={{}} />`);
    const out = runCells(normalizeCells(["rate = 0.5", "obj = { f: (x) => x * rate }", "list = [(x) => x]", "t = `calc`"]).cells, rt.interp, rt.globals, "calc");
    expect(Object.keys(cellValues(out))).toEqual(["rate", "t"]);
  });
});
