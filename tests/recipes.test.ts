import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { RECIPES } from "../core/recipes";
import { exampleFamilies, examplesForGroups } from "../core/prompt";

describe("recipes", () => {
  it("every recipe block passes the check", () => {
    for (const r of RECIPES) {
      for (const [, body] of r.text.matchAll(/```iris\n([\s\S]*?)```/g)) {
        const report = check(body);
        expect(report.issues.filter((i) => i.severity === "error"), r.name).toEqual([]);
      }
    }
  });
  it("come from iris_examples as their own family", () => {
    expect(exampleFamilies().at(-1)).toBe("Recipes");
    const text = examplesForGroups(["Recipes"]);
    expect(text).toContain('::iris{file="$BB_THREAD_STORAGE/status.iris"}');
    expect(text).toContain("<Variants bind=\"pick\"");
  });
});
