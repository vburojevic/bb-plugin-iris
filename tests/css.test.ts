import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// An unclosed block nests every rule after it (browsers accept nesting now), so the
// stylesheet still loads while those rules apply only inside the block. Catch that here.
describe("app.css", () => {
  it("closes every block it opens", () => {
    const css = readFileSync(new URL("../app.css", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/"[^"\n]*"|'[^'\n]*'/g, "");
    let depth = 0;
    let line = 1;
    let unclosedAt = 0;
    for (const c of css) {
      if (c === "\n") line += 1;
      if (c === "{") depth += 1;
      if (c === "}") depth -= 1;
      expect(depth, `a stray } near line ${line}`).toBeGreaterThanOrEqual(0);
      // A top-level rule starts at depth 0; @media and @supports may nest one level.
      if (depth > 3 && !unclosedAt) unclosedAt = line;
    }
    expect(unclosedAt, `blocks nest too deep from line ${unclosedAt}`).toBe(0);
    expect(depth).toBe(0);
  });
});
