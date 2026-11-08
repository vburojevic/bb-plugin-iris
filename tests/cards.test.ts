import { describe, expect, it } from "vitest";
import { cardsInMessage, isCardKey, pendingKey, pendingKeyFor, personInputs, planInputs } from "../core/cards";

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

describe("setting a card's inputs", () => {
  const card = cardsInMessage("m1", '```iris\n<state seats={10} plan="Pro" picks={[]} />\n<Card title="Estimate"><Slider bind="seats" /><Segmented bind="plan" options={["Basic", "Pro"]} /></Card>\n```')[0];
  it("merges values into what the card holds, naming what changed", () => {
    expect(planInputs(card, { seats: 10, plan: "Basic" }, { seats: 30, plan: "Basic" })).toEqual({ ok: true, next: { seats: 30, plan: "Basic" }, changed: ["seats"] });
  });
  it("refuses a name the card doesn't declare, with the nearest one", () => {
    const r = planInputs(card, {}, { seat: 3 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('no input "seat". Did you mean seats?');
  });
  it("keeps each input's type", () => {
    const r = planInputs(card, {}, { seats: "30" });
    expect(!r.ok && r.error).toBe('"seats" holds a number (it starts as 10), not a string');
    expect(planInputs(card, {}, { picks: ["a"] }).ok).toBe(true);
  });
  it("refuses apps and cards without inputs", () => {
    const app = cardsInMessage("m2", "```iris-react\nexport default () => null\n```")[0];
    expect(planInputs(app, {}, { x: 1 }).ok).toBe(false);
    const plain = cardsInMessage("m3", '```iris\n<Card title="A" />\n```')[0];
    expect(!planInputs(plain, {}, { x: 1 }).ok && planInputs(plain, {}, { x: 1 })).toMatchObject({ error: 'card "A" has no <state> inputs' });
  });
  it("finds the pending key from the renderer's state key", () => {
    expect(pendingKeyFor("thr_1:assistant:kind:assistant|turn:t3|parent:root|item:m1#iris#0")).toBe(pendingKey("thr_1", card));
    expect(pendingKeyFor("pinned:thr_1:x:file")).toBeNull();
  });
});
