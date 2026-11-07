import { describe, expect, it } from "vitest";
import { heatGrid, heatPosition } from "../core/heatmap";

describe("Heatmap", () => {
  it("builds the grid from cells in first-seen order, last value winning", () => {
    const g = heatGrid([
      { row: "parser", column: "run 1", value: 90 },
      { row: "parser", column: "run 2", value: 70 },
      { row: "export", column: "run 1", value: "100" },
      { row: "parser", column: "run 2", value: 75 },
      { row: "export", column: "run 3" },
    ]);
    expect(g.rows).toEqual(["parser", "export"]);
    expect(g.columns).toEqual(["run 1", "run 2", "run 3"]);
    expect(g.values).toEqual([
      [90, 75, null],
      [100, null, null],
    ]);
    expect([g.min, g.max]).toEqual([75, 100]);
  });
  it("reads a matrix and honors named orders", () => {
    const g = heatGrid({ rows: ["a", "b"], columns: ["x", "y"], values: [[1, 2], [3]] }, ["b"], ["y", "x"]);
    expect(g.rows).toEqual(["b", "a"]);
    expect(g.columns).toEqual(["y", "x"]);
    expect(g.values).toEqual([
      [null, 3],
      [2, 1],
    ]);
  });
  it("places values on the scale", () => {
    expect(heatPosition(5, 0, 10)).toBe(0.5);
    expect(heatPosition(20, 0, 10)).toBe(1);
    expect(heatPosition(3, 3, 3)).toBe(0.5);
  });
});
