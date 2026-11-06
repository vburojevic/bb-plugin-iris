import { describe, expect, it } from "vitest";
import { markFromDrag, moveMark, nextMarkNumber, normalizeMarks } from "../core/markup";

describe("MarkUp marks", () => {
  it("turns drags into marks in image pixels, boxes with a positive size", () => {
    expect(markFromDrag("box", 120.4, 80, 20, 30.6, 1)).toEqual({ n: 1, kind: "box", x: 20, y: 31, w: 100, h: 49, note: "" });
    expect(markFromDrag("arrow", 10, 10, 50.5, 60, 2)).toEqual({ n: 2, kind: "arrow", x: 10, y: 10, x2: 51, y2: 60, note: "" });
    expect(markFromDrag("pin", 0, 0, 7, 9, 3)).toEqual({ n: 3, kind: "pin", x: 7, y: 9, note: "" });
  });
  it("reads marks back from state and drops malformed ones", () => {
    const marks = normalizeMarks([
      { n: 1, kind: "box", x: 1, y: 2, w: 3, h: 4, note: "Too tight" },
      { n: 2, kind: "arrow", x: 1, y: 2 },
      { kind: "pin", x: 5, y: 6 },
      "junk",
      { kind: "laser", x: 1, y: 1 },
    ]);
    expect(marks.map((m) => [m.n, m.kind])).toEqual([
      [1, "box"],
      [2, "pin"],
      [3, "pin"],
    ]);
    expect(marks[0].note).toBe("Too tight");
  });
  it("numbers past the highest, so numbers stay put when one is deleted", () => {
    expect(nextMarkNumber([{ n: 1, kind: "pin", x: 0, y: 0, note: "" }, { n: 4, kind: "pin", x: 0, y: 0, note: "" }])).toBe(5);
    expect(nextMarkNumber([])).toBe(1);
  });
  it("renumbers repeated or odd numbers from the agent's starting state", () => {
    const marks = normalizeMarks([
      { n: 1, kind: "pin", x: 0, y: 0 },
      { n: 1, kind: "pin", x: 1, y: 1 },
      { n: -2, kind: "pin", x: 2, y: 2 },
      { n: 2.5, kind: "pin", x: 3, y: 3 },
    ]);
    expect(marks.map((m) => m.n)).toEqual([1, 2, 3, 4]);
  });
  it("keeps a moved mark on the image", () => {
    expect(moveMark({ n: 1, kind: "pin", x: 90, y: 5, note: "" }, 50, -50, 100, 100)).toMatchObject({ x: 100, y: 0 });
    expect(moveMark({ n: 1, kind: "box", x: 70, y: 10, w: 20, h: 10, note: "" }, 50, 0, 100, 100)).toMatchObject({ x: 80, w: 20 });
    expect(moveMark({ n: 1, kind: "arrow", x: 10, y: 10, x2: 40, y2: 20, note: "" }, -30, 0, 100, 100)).toMatchObject({ x: 0, x2: 30 });
  });
});
