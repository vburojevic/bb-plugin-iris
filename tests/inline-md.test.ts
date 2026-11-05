import { describe, expect, it } from "vitest";
import { hasInlineMarkdown, inlineParts } from "../ui/views/inline-md";

describe("inline Markdown", () => {
  it("keeps the character before an italic mark", () => {
    expect(inlineParts("a *b* c")).toEqual(["a ", { kind: "em", text: "b" }, " c"]);
    expect(inlineParts("(_note_)")).toEqual(["(", { kind: "em", text: "note" }, ")"]);
    expect(inlineParts("*lead* off")).toEqual([{ kind: "em", text: "lead" }, " off"]);
  });

  it("leaves snake_case and 2*3*4 alone", () => {
    expect(inlineParts("set max_retry_count to 2*3*4")).toEqual(["set max_retry_count to 2*3*4"]);
  });

  it("reads bold, code and https links, and nothing else as a link", () => {
    expect(inlineParts("**Fix** `parse.ts`, see [docs](https://example.com/a)")).toEqual([
      { kind: "strong", text: "Fix" },
      " ",
      { kind: "code", text: "parse.ts" },
      ", see ",
      { kind: "link", text: "docs", url: "https://example.com/a" },
    ]);
    expect(inlineParts("[x](javascript:alert(1))")).toEqual(["[x](javascript:alert(1))"]);
  });

  it("answers the same twice in a row", () => {
    expect([hasInlineMarkdown("a *b*"), hasInlineMarkdown("a *b*"), hasInlineMarkdown("plain")]).toEqual([true, true, false]);
  });
});
