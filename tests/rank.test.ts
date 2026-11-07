import { describe, expect, it } from "vitest";
import { moveItem, rankOrder } from "../core/rank";

const same = (a: unknown, b: unknown) => a === b;

describe("Rank", () => {
  it("orders by the state, then appends options it doesn't name", () => {
    expect(rankOrder(["a", "b", "c", "d"], ["c", "x", "a", "c"], same)).toEqual(["c", "a", "b", "d"]);
    expect(rankOrder(["a", "b"], null, same)).toEqual(["a", "b"]);
  });
  it("moves an item and clamps the ends", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], 2, -5)).toEqual(["c", "a", "b"]);
    expect(moveItem(["a"], 0, 3)).toEqual(["a"]);
  });
});
