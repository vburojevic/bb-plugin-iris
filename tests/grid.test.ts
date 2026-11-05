import { describe, expect, it } from "vitest";
import { columnStats, groupRows, normalizeGrid, parseFilter, pivot, pivotToCsv, query, rowsToCsv, searchIndex } from "../core/grid";

const people = [
  { name: "Ada", team: "core", ms: 120, joined: "2024-02-01", active: true },
  { name: "Bo", team: "ui", ms: 80, joined: "2025-06-12", active: false },
  { name: "Cy", team: "core", ms: 200, joined: "2023-11-30", active: true },
  { name: "Di", team: "ui", ms: null, joined: "2026-01-05", active: true },
];

describe("normalizeGrid", () => {
  it("infers column types and alignment", () => {
    const g = normalizeGrid(people);
    expect(g.cols.map((c) => [c.key, c.type, c.align])).toEqual([
      ["name", "text", "left"],
      ["team", "text", "left"],
      ["ms", "number", "right"],
      ["joined", "date", "left"],
      ["active", "bool", "left"],
    ]);
  });
  it("reads SQL {columns, rows}, Postgres {fields, rows}, lists of lists and CSV text", () => {
    expect(normalizeGrid({ columns: ["a", "b"], rows: [[1, "x"]] }).rows).toEqual([{ a: 1, b: "x" }]);
    expect(normalizeGrid({ fields: [{ name: "a" }], rows: [{ a: 2 }] }).rows).toEqual([{ a: 2 }]);
    expect(normalizeGrid([["a", "b"], [1, 2]]).rows).toEqual([{ a: 1, b: 2 }]);
    expect(normalizeGrid([[1, 2]], ["x", "y"]).rows).toEqual([{ x: 1, y: 2 }]);
    expect(normalizeGrid("a,b\n1,hi\n").rows).toEqual([{ a: 1, b: "hi" }]);
    expect(normalizeGrid("a\tb\n1\t2\n").rows).toEqual([{ a: 1, b: 2 }]);
  });
  it("keeps column specs: label, format, align", () => {
    const g = normalizeGrid(people, ["name", { key: "ms", label: "Time", format: "ms" }]);
    expect(g.cols.map((c) => c.label)).toEqual(["Name", "Time"]);
    expect(g.cols[1].format).toBe("ms");
  });
});

describe("filters", () => {
  it("compares numbers, ranges and dates", () => {
    expect([10, 5, 20].filter(parseFilter(">8", "number")!)).toEqual([10, 20]);
    expect([10, 5, 20].filter(parseFilter("5..10", "number")!)).toEqual([10, 5]);
    expect([10, 5, 20].filter(parseFilter("!=5", "number")!)).toEqual([10, 20]);
    expect(["2024-01-01", "2026-03-01"].filter(parseFilter(">=2025-01-01", "date")!)).toEqual(["2026-03-01"]);
  });
  it("matches text anywhere, exactly with =, and excludes with !", () => {
    expect(["Core", "ui", "score"].filter(parseFilter("core", "text")!)).toEqual(["Core", "score"]);
    expect(["Core", "ui", "score"].filter(parseFilter("=core", "text")!)).toEqual(["Core"]);
    expect(["Core", "ui", "score"].filter(parseFilter("!core", "text")!)).toEqual(["ui"]);
    expect([null, "", "x"].filter(parseFilter("empty", "text")!)).toEqual([null, ""]);
  });
});

describe("query", () => {
  const g = normalizeGrid(people);
  it("searches, filters and sorts with empty values last", () => {
    expect(query(g, { search: "core" }).map((i) => g.rows[i].name)).toEqual(["Ada", "Cy"]);
    expect(query(g, { filters: { ms: ">100" } }).map((i) => g.rows[i].name)).toEqual(["Ada", "Cy"]);
    expect(query(g, { sort: { key: "ms", dir: -1 } }).map((i) => g.rows[i].name)).toEqual(["Cy", "Ada", "Bo", "Di"]);
    expect(query(g, { sort: { key: "ms", dir: 1 } }).map((i) => g.rows[i].name)).toEqual(["Bo", "Ada", "Cy", "Di"]);
  });
  it("stays fast on 50,000 rows", () => {
    const rows = Array.from({ length: 50_000 }, (_, k) => ({ id: k, team: `team-${k % 40}`, ms: (k * 7919) % 1000, ok: k % 3 === 0 }));
    const big = normalizeGrid(rows);
    const t0 = performance.now();
    const index = searchIndex(big.rows, big.cols);
    const ids = query(big, { search: "team-1", filters: { ms: ">500" }, sort: { key: "ms", dir: -1 } }, index);
    const groups = groupRows(big, ids, "team");
    const p = pivot(big, ids, { rows: "team", columns: "ok", value: "ms", agg: "mean" });
    for (const c of big.cols) columnStats(big.rows, c, ids);
    const took = performance.now() - t0;
    expect(ids.length).toBeGreaterThan(1000);
    expect(groups.length).toBe(11);
    expect(p.colLabels).toEqual(["false", "true"]);
    expect(took).toBeLessThan(1500);
  });
});

describe("stats, groups, pivots, CSV", () => {
  const g = normalizeGrid(people);
  const all = query(g, {});
  it("summarizes a number column", () => {
    const s = columnStats(g.rows, g.cols[2], all);
    expect(s).toMatchObject({ count: 3, empty: 1, distinct: 3, min: 80, max: 200, sum: 400 });
    expect(s.mean).toBeCloseTo(133.33, 1);
  });
  it("counts distinct text values with the most common first", () => {
    expect(columnStats(g.rows, g.cols[1], all).top[0]).toEqual({ value: "core", count: 2 });
  });
  it("groups with counts and sums", () => {
    const groups = groupRows(g, all, "team");
    expect(groups.map((x) => [x.label, x.ids.length, x.sums.ms])).toEqual([
      ["core", 2, 320],
      ["ui", 2, 80],
    ]);
  });
  it("pivots with totals", () => {
    const p = pivot(g, all, { rows: "team", columns: "active", value: "ms", agg: "sum" });
    expect(p.rowLabels).toEqual(["core", "ui"]);
    expect(p.colLabels).toEqual(["false", "true"]);
    expect(p.cells).toEqual([
      [null, 320],
      [80, 0],
    ]);
    expect(p.total).toBe(400);
    expect(pivot(g, all, { rows: "team" }).cells).toEqual([[2], [2]]);
    expect(pivotToCsv(p, "Team").split("\n")[0]).toBe("Team,false,true,Total");
  });
  it("folds pivot columns past the cap into Other", () => {
    const rows = Array.from({ length: 60 }, (_, k) => ({ r: "x", c: `c${k}` }));
    const p = pivot(normalizeGrid(rows), query(normalizeGrid(rows), {}), { rows: "r", columns: "c" });
    expect(p.colLabels.length).toBe(24);
    expect(p.colLabels.at(-1)).toBe("Other");
    expect(p.folded).toBe(37);
  });
  it("quotes CSV cells", () => {
    const d = normalizeGrid([{ a: 'say "hi"', b: "x,y", c: 3 }]);
    expect(rowsToCsv(d, [0])).toBe('A,B,C\n"say ""hi""","x,y",3');
  });
});

describe("suggestGroupKey", () => {
  it("picks the column with the fewest distinct values above one", async () => {
    const { suggestGroupKey } = await import("../core/grid");
    expect(suggestGroupKey(normalizeGrid(people))).toBe("team");
  });
});

describe("pivot mean", () => {
  it("averages only rows that have a number", () => {
    const g = normalizeGrid([{ team: "a", ms: 10 }, { team: "a", ms: null }, { team: "b", ms: 4 }]);
    const p = pivot(g, query(g, {}), { rows: "team", value: "ms", agg: "mean" });
    expect(p.cells).toEqual([[10], [4]]);
    expect(p.total).toBe(7);
  });
});
