import { describe, expect, it } from "vitest";
import { anchorComments, blockQuote, docBlocks, normalizeReview } from "../core/docreview";

describe("DocReview", () => {
  it("splits markdown into blocks, keeping fences whole and headings alone", () => {
    const md = "# Plan\nIntro line one\nline two\n\n- a\n- b\n\n```ts\nconst x = 1;\n\nconst y = 2;\n```\n## Risks\nNone yet";
    expect(docBlocks(md)).toEqual(["# Plan", "Intro line one\nline two", "- a\n- b", "```ts\nconst x = 1;\n\nconst y = 2;\n```", "## Risks", "None yet"]);
  });
  it("quotes a block in plain words", () => {
    expect(blockQuote("## Ship **Variants** first, then [ColorInput](x.md)")).toBe("Ship Variants first, then ColorInput");
    expect(blockQuote("word ".repeat(40), 20)).toHaveLength(20);
  });
  it("reads state back, dropping malformed and repeated comments", () => {
    expect(
      normalizeReview({ verdict: "changes", comments: [{ block: 2, quote: "Intro", note: "Too long" }, { block: 2, note: "again" }, { block: 0 }, "x"] }),
    ).toEqual({ verdict: "changes", comments: [{ block: 2, quote: "Intro", note: "Too long" }] });
    expect(normalizeReview(null)).toEqual({ verdict: null, comments: [] });
  });
  it("keeps indentation, closes fences only on a bare fence line", () => {
    expect(docBlocks("    indented code\n    more")).toEqual(["    indented code\n    more"]);
    expect(docBlocks("```\n```js\nstill code\n```\nafter")).toEqual(["```\n```js\nstill code\n```", "after"]);
  });
  it("re-anchors comments by quote when the text moves, and keeps the rest as orphans", () => {
    const before = docBlocks("# Plan\n\nShip it\n\nRisks here");
    const c1 = { block: 3, quote: blockQuote(before[2]), note: "Name the risks" };
    const c2 = { block: 2, quote: blockQuote(before[1]), note: "When?" };
    const after = docBlocks("# Plan\n\nNew intro\n\nRisks here");
    const { at, orphans } = anchorComments(after, [c1, c2]);
    expect(at.get(3)?.note).toBe("Name the risks");
    expect(orphans.map((c) => c.note)).toEqual(["When?"]);
  });
});
