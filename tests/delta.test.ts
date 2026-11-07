import { describe, expect, it } from "vitest";
import { deltaRows, deltaTally } from "../core/delta";

describe("Delta", () => {
  it("reads the change and whether it went the right way", () => {
    const rows = deltaRows(
      [
        { label: "Cold start", before: 1840, after: 1210, better: "down" },
        { label: "Bundle", before: "512", after: 530 },
        { label: "Score", before: 88, after: 91, better: "up" },
        { label: "Tests", before: 517, after: 517 },
        { label: "Engine", before: "v8", after: "JSC" },
      ],
      "down",
    );
    expect(rows.map((r) => r.verdict)).toEqual(["better", "worse", "better", "same", "changed"]);
    expect(rows[0].change).toBe(-630);
    expect(rows[0].ratio).toBeCloseTo(-0.3424, 3);
    expect(rows[4].change).toBeNull();
    expect(deltaTally(rows)).toEqual({ better: 2, worse: 1, same: 1, changed: 1 });
  });
  it("gives no verdict when better is none, and no ratio from zero", () => {
    const [r] = deltaRows([{ label: "Count", before: 0, after: 4 }]);
    expect(r.verdict).toBe("changed");
    expect(r.ratio).toBeNull();
  });
  it("ignores rounding noise, treats empty values alike and compares objects by content", () => {
    const rows = deltaRows([
      { label: "Sum", before: 0.30000000000000004, after: 0.3, better: "up" },
      { label: "Note", before: null, after: "" },
      { label: "Config", before: { a: 1, b: 2 }, after: { b: 2, a: 1 } },
      { name: "Huge", before: -1e308, after: 1e308 },
    ]);
    expect(rows.map((r) => r.verdict)).toEqual(["same", "same", "same", "changed"]);
    expect(rows[3].label).toBe("Huge");
    expect(rows[3].change).toBeNull();
  });
});
