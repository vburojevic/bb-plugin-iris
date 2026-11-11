import { describe, expect, it } from "vitest";
import { ASK_LABEL_MAX, askLabels } from "../core/ask";

describe("iris_ask labels", () => {
  it("keeps a short title whole", () => {
    expect(askLabels("Pick a theme")).toEqual({ pending: "Waiting: Pick a theme", completed: "Answered: Pick a theme" });
  });
  it("fits a long title inside bb's label limit, cut at a word", () => {
    const title = "The ten new pets pages are ready to review: should I make the other 140 pages in exactly this style";
    expect(title.length).toBe(99);
    const { pending, completed } = askLabels(title);
    for (const label of [pending, completed]) {
      expect(label.length).toBeLessThanOrEqual(ASK_LABEL_MAX);
      expect(label.endsWith("…")).toBe(true);
      expect(label).not.toMatch(/\s…$/);
    }
    expect(pending.startsWith("Waiting: The ten new pets pages")).toBe(true);
  });
  it("holds at the longest title iris_ask takes", () => {
    const { pending, completed } = askLabels("x".repeat(120));
    expect(pending.length).toBeLessThanOrEqual(ASK_LABEL_MAX);
    expect(completed.length).toBeLessThanOrEqual(ASK_LABEL_MAX);
  });
});
