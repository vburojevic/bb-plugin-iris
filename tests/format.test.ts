import { describe, expect, it } from "vitest";
import { formatValue } from "../core/format";

describe("percent format", () => {
  it("never rounds a near miss up to 100% or down to 0%", () => {
    expect(formatValue(0.996, "percent")).toBe("99.6%");
    expect(formatValue(99.96, "percent")).toBe("99.96%");
    expect(formatValue(0.0004, "percent")).toBe("0.04%");
  });

  it("keeps whole and exact values short", () => {
    expect(formatValue(1, "percent")).toBe("100%");
    expect(formatValue(0, "percent")).toBe("0%");
    expect(formatValue(0.47, "percent")).toBe("47%");
    expect(formatValue(0.053, "percent")).toBe("5.3%");
  });

  it("follows decimals when the card sets them", () => {
    expect(formatValue(0.996, { style: "percent", decimals: 0 })).toBe("100%");
  });
});
