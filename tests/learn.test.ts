import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { normalizeScene, parseShaderLog, prepareShader, readOverrides, themeColor, type ThemeColors } from "../core/graphics";
import {
  deckReviewLearning,
  deckSort,
  deckStart,
  formatClock,
  lineSpan,
  normalizeCards,
  normalizeQuiz,
  normalizeSteps,
  parseDuration,
  quizDone,
  quizRetryMissed,
  quizScore,
  quizStart,
  seeded,
  shuffled,
  timerElapsed,
  timerLap,
  timerToggle,
  TIMER_IDLE,
} from "../core/learn";

describe("Quiz", () => {
  it("reads the shapes agents write and reports the rest", () => {
    const { items, problems } = normalizeQuiz([
      { q: "A?", options: ["x", "y"], answer: 1, why: "because" },
      { question: "B?", choices: ["p", "q", "r"], answer: "r" },
      { q: "C?", options: ["only"] , answer: 0 },
      { q: "D?", options: ["a", "b"], answer: 5 },
    ]);
    expect(items.map((q) => [q.q, q.answer, q.why])).toEqual([
      ["A?", 1, "because"],
      ["B?", 2, null],
    ]);
    expect(problems).toEqual(["Question 3 needs at least two options", "Question 4: answer must be an option index from 0 to 1"]);
  });

  it("scores a round and retries only the missed questions", () => {
    const { items } = normalizeQuiz([
      { q: "1", options: ["a", "b"], answer: 0 },
      { q: "2", options: ["a", "b"], answer: 1 },
      { q: "3", options: ["a", "b"], answer: 0 },
    ]);
    let round = quizStart(3, null);
    round = { ...round, picks: { 0: 0, 1: 0, 2: 1 }, at: 3 };
    expect(quizDone(round)).toBe(true);
    expect(quizScore(items, round)).toEqual({ right: 1, asked: 3, missed: [1, 2] });
    const retry = quizRetryMissed(items, round);
    expect(retry).toEqual({ order: [1, 2], picks: {}, at: 0 });
    expect(quizScore(items, { ...retry, picks: { 1: 1, 2: 0 }, at: 2 })).toEqual({ right: 2, asked: 2, missed: [] });
  });

  it("shuffles the same way for the same seed", () => {
    expect(quizStart(6, seeded(7)).order).toEqual(quizStart(6, seeded(7)).order);
    expect([...quizStart(6, seeded(7)).order].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(shuffled([1, 2, 3], seeded(1))).toHaveLength(3);
  });
});

describe("Flashcards", () => {
  it("accepts objects and pairs", () => {
    const { items, problems } = normalizeCards([{ front: "a", back: "b", hint: "h" }, ["c", "d"], { term: "e", definition: "f" }, { front: "x" }]);
    expect(items).toEqual([
      { front: "a", back: "b", hint: "h" },
      { front: "c", back: "d", hint: null },
      { front: "e", back: "f", hint: null },
    ]);
    expect(problems).toEqual(["Card 4 needs a front and a back"]);
  });

  it("sorts cards into piles and reviews the learning pile", () => {
    let deck = deckStart(3, null);
    deck = deckSort(deck, "known");
    deck = deckSort(deck, "learning");
    deck = deckSort(deck, "learning");
    expect(deck).toEqual({ queue: [], known: [0], learning: [1, 2] });
    expect(deckSort(deck, "known")).toBe(deck);
    expect(deckReviewLearning(deck, null)).toEqual({ queue: [1, 2], known: [0], learning: [] });
  });
});

describe("Walkthrough", () => {
  it("reads steps, code and highlighted lines", () => {
    const { items, problems } = normalizeSteps([
      { title: "One", body: "text", code: "\n\na\nb\n", lang: "ts", lines: "2-3" },
      { body: "no title" },
      {},
    ]);
    expect(items[0]).toMatchObject({ title: "One", code: "a\nb", lang: "ts", lines: { start: 2, end: 3 } });
    expect(items[1].title).toBe("Step 2");
    expect(problems).toEqual(["Step 3 is empty: give it a title, body or code"]);
  });

  it("parses line spans", () => {
    expect(lineSpan(4)).toEqual({ start: 4, end: 4 });
    expect(lineSpan("5-3")).toEqual({ start: 3, end: 5 });
    expect(lineSpan([2, 6])).toEqual({ start: 2, end: 6 });
    expect(lineSpan("x")).toBeNull();
  });
});

describe("Timer", () => {
  it("parses durations", () => {
    expect(parseDuration(90)).toBe(90);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("5m")).toBe(300);
    expect(parseDuration("1h 20m")).toBe(4800);
    expect(parseDuration("1:30")).toBe(90);
    expect(parseDuration("01:02:03")).toBe(3723);
    expect(parseDuration("2 minutes 5 seconds")).toBe(125);
    expect(parseDuration("soon")).toBeNull();
    expect(parseDuration("5m later")).toBeNull();
  });

  it("formats clocks", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(299_001, { up: true })).toBe("5:00");
    expect(formatClock(299_001)).toBe("4:59");
    expect(formatClock(3_723_000)).toBe("1:02:03");
    expect(formatClock(65_430, { tenths: true })).toBe("1:05.4");
    expect(formatClock(-5)).toBe("0:00");
  });

  it("banks time across pauses and records laps", () => {
    let t = timerToggle(TIMER_IDLE, 1000);
    expect(timerElapsed(t, 3500)).toBe(2500);
    t = timerLap(t, 2000);
    t = timerToggle(t, 4000);
    expect(t).toMatchObject({ running: false, banked: 3000, laps: [1000] });
    expect(timerElapsed(t, 99_999)).toBe(3000);
    t = timerToggle(t, 10_000);
    expect(timerElapsed(t, 10_500)).toBe(3500);
  });
});

const THEME: ThemeColors = {
  series: ["#111111", "#222222", "#333333"],
  tone: { neutral: "#999999", info: "#0000ff", good: "#00ff00", warn: "#ffaa00", bad: "#ff0000" },
  foreground: "#eeeeee",
  muted: "#777777",
};

describe("Scene", () => {
  it("normalizes objects with defaults and reports bad ones", () => {
    const { objects, problems } = normalizeScene([
      { id: "a", type: "cube", size: 2, at: [1, 2, 3], scale: 2 },
      { type: "plane" },
      { type: "text", text: "Hi" },
      { type: "cone" },
      { type: "gltf" },
      { id: "a", type: "sphere" },
    ]);
    expect(objects.map((o) => o.id)).toEqual(["a", "plane2", "text3", "a_"]);
    expect(objects[0]).toMatchObject({ type: "box", size: [2, 2, 2], at: [1, 2, 3], scale: [2, 2, 2] });
    expect(objects[1].rotation).toEqual([-90, 0, 0]);
    expect(objects[2].text).toBe("Hi");
    expect(problems).toEqual([
      'Object 4: type "cone" is not one of box, sphere, cylinder, torus, plane, text, gltf',
      "Object 5: a gltf needs src, a .glb or .gltf path in the workspace",
    ]);
  });

  it("merges what animate returns, by id or by position", () => {
    const { objects } = normalizeScene([{ id: "a" }, { id: "b" }]);
    const byId = readOverrides(objects, { a: { rotation: [0, 90, 0], opacity: 2 }, zzz: { at: [1, 1, 1] } });
    expect([...byId.keys()]).toEqual(["a"]);
    expect(byId.get("a")).toEqual({ rotation: [0, 90, 0], opacity: 1 });
    const byIndex = readOverrides(objects, [null, { at: [1, 2, 3], scale: 3 }]);
    expect(byIndex.get("b")).toEqual({ at: [1, 2, 3], scale: [3, 3, 3] });
    expect(readOverrides(objects, 5).size).toBe(0);
  });

  it("uses theme colors only", () => {
    expect(themeColor(THEME, "good", 0)).toBe("#00ff00");
    expect(themeColor(THEME, "accent", 2)).toBe("#111111");
    expect(themeColor(THEME, 2, 0)).toBe("#222222");
    expect(themeColor(THEME, "series-3", 0)).toBe("#333333");
    expect(themeColor(THEME, "#abcdef", 1)).toBe("#222222");
    expect(themeColor(THEME, null, 4)).toBe("#222222");
    expect(themeColor(THEME, "foreground", 0)).toBe("#eeeeee");
  });
});

describe("Shader", () => {
  it("wraps mainImage and keeps the person's line numbers", () => {
    const p = prepareShader("void mainImage(out vec4 c, in vec2 f) {\n  c = vec4(1.0);\n}");
    expect(p.mode).toBe("shadertoy");
    expect(p.source).toContain("#line 1\nvoid mainImage");
    expect(p.source).toContain("uniform vec3 iPalette[4];");
    expect(prepareShader("#version 300 es\nvoid main(){}").mode).toBe("full");
  });

  it("maps driver errors to lines", () => {
    const p = prepareShader("x");
    const issues = parseShaderLog("ERROR: 0:2: 'foo' : undeclared identifier\nERROR: 0:40: 'mainImage' : no matching overloaded function found\n2 compilation errors", p, 3);
    expect(issues).toEqual([
      { line: 2, message: "'foo' : undeclared identifier" },
      { line: null, message: "'mainImage' : no matching overloaded function found" },
    ]);
  });
});

describe("check() on learning and graphics", () => {
  it("flags a quiz answer past its options", () => {
    const r = check(`<Quiz questions={[{ q: "A?", options: ["x", "y"], answer: 2 }]} />`);
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain("answer must be an option index");
  });

  it("calls Scene animate once and reports what breaks", () => {
    const bad = check(`<Scene objects={[{ id: "a", type: "box" }]} animate={(t) => ({ a: { at: [t.nope.x, 0, 0] } })} />`);
    expect(bad.ok).toBe(false);
    expect(bad.issues.some((i) => i.message.includes("<Scene animate> fails when called with (0)"))).toBe(true);
    const good = check(`<Scene objects={[{ id: "a", type: "box" }]} animate={(t) => ({ a: { rotation: [0, t * 90, 0] } })} />`);
    expect(good.ok).toBe(true);
  });

  it("flags an unknown scene object type", () => {
    const r = check(`<Scene objects={[{ type: "cone" }]} />`);
    expect(r.issues[0].message).toContain('type "cone"');
  });

  it("reads Shader content verbatim, comparisons included", () => {
    const r = check(`<Shader>\nvoid mainImage(out vec4 c, in vec2 f) { c = vec4(f.x < 2.0 ? 1.0 : 0.0); }\n</Shader>`);
    expect(r.ok).toBe(true);
  });
});

describe("picker answers", () => {
  it("leave out components' own progress", async () => {
    const { CardRuntime, compile } = await import("../core/program");
    const rt = new CardRuntime(compile(`<state pick="a" />\n<Quiz questions={[{ q: "A?", options: ["x", "y"], answer: 0 }]} />`));
    rt.setState("@Quiz:30:round:abc", { order: [0], picks: { 0: 1 }, at: 1 });
    expect(rt.answers()).toEqual({ pick: "a" });
    expect(Object.keys(rt.snapshot())).toContain("@Quiz:30:round:abc");
  });
});
