import { describe, expect, it } from "vitest";
import { cardsInMessage, isCardKey, personInputs } from "../core/cards";

describe("cards", () => {
  it("numbers a message's Iris blocks as the renderer does, skipping other code", () => {
    const cards = cardsInMessage("m1", 'Text\n```ts\nx\n```\n```iris\n<Card title="Budget" />\n```\n```iris-app\n<title>Mock</title>\n```\n');
    expect(cards.map((c) => [c.index, c.language, c.title])).toEqual([
      [0, "iris", "Budget"],
      [1, "iris-app", "Mock"],
    ]);
    expect(isCardKey("state:thr_1:assistant:kind:assistant|turn:t3|parent:root|item:m1#iris#0", cards[0])).toBe(true);
    expect(isCardKey("state:thr_1:...|item:m10#iris#0", cards[0])).toBe(false);
  });
  it("reads back the person's inputs, leaving a component's own progress out", () => {
    expect(personInputs({ budget: 65, "@quiz": { round: 2 } })).toEqual({ budget: 65 });
    expect(personInputs(null)).toEqual({});
  });
});

describe("card fences", () => {
  it("skip a ```iris written inside another code block or mid-line", () => {
    const text = "Use ```iris to start.\n````markdown\n```iris\n<Card title=\"Sample\" />\n```\n````\n```iris\n<Card title=\"Real\" />\n```";
    expect(cardsInMessage("m", text).map((c) => [c.index, c.title])).toEqual([[0, "Real"]]);
  });
});
