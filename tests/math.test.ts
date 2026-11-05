import { describe, expect, it } from "vitest";
import { hasDelimiters, splitMath } from "../core/math";
import { etaSeconds, formatEta, logLines, rate, readProgress, tailText } from "../core/live";

describe("splitMath", () => {
  it("finds inline and display parts", () => {
    expect(splitMath("Roots of $ax^2$ are $$x = 1$$ done")).toEqual([
      { kind: "text", value: "Roots of " },
      { kind: "inline", tex: "ax^2" },
      { kind: "text", value: " are " },
      { kind: "display", tex: "x = 1" },
      { kind: "text", value: " done" },
    ]);
    expect(splitMath("\\(a\\) and \\[b\\]").map((p) => p.kind)).toEqual(["inline", "text", "display"]);
  });
  it("keeps escaped and unmatched dollars as text", () => {
    expect(splitMath("costs \\$5 and $x$")).toEqual([
      { kind: "text", value: "costs $5 and " },
      { kind: "inline", tex: "x" },
    ]);
    expect(splitMath("just $5")).toEqual([{ kind: "text", value: "just $5" }]);
    expect(hasDelimiters("\\frac{a}{b}")).toBe(false);
    expect(hasDelimiters("a $b$")).toBe(true);
  });
});

describe("live helpers", () => {
  it("tails at a line boundary", () => {
    expect(tailText("one\ntwo\nthree\n", 9)).toEqual({ text: "three\n", truncated: true });
    expect(tailText("short", 9)).toEqual({ text: "short", truncated: false });
  });
  it("keeps what follows a carriage return, like a terminal", () => {
    expect(logLines("a\r\nload 10%\rload 50%\rload 100%\nb\n")).toEqual(["a", "load 100%", "b"]);
  });
  it("reads progress files in their common shapes", () => {
    expect(readProgress({ done: 3, total: 10, label: "Tests", eta: 40 })).toEqual([{ done: 3, total: 10, label: "Tests", eta: 40 }]);
    expect(readProgress({ percent: 0.5 })).toEqual([{ done: 50, total: 100 }]);
    expect(readProgress({ tasks: [{ name: "a", completed: 1, total: 2 }, { name: "b", done: 2, total: 2 }] }).map((t) => t.label)).toEqual(["a", "b"]);
    expect(readProgress("nope")).toEqual([]);
  });
  it("computes rate and time left", () => {
    expect(rate([{ at: 0, done: 0 }, { at: 10_000, done: 50 }])).toBe(5);
    expect(rate([{ at: 0, done: 5 }])).toBeNull();
    expect(etaSeconds("2026-01-01T00:01:00Z", Date.parse("2026-01-01T00:00:00Z"))).toBe(60);
    expect(formatEta(42)).toBe("about 45 s");
    expect(formatEta(3 * 3600 + 300)).toBe("about 3 h 5 min");
  });
});
