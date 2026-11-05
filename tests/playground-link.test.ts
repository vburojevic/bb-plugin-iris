import { describe, expect, it } from "vitest";
import { decode, encode, playLink, PLAYGROUND_URL } from "../shared/playground";

describe("playground links", () => {
  it("round-trips any card source, Unicode included", () => {
    const source = '<Card title="Résumé · 日本語 ✓">\n  <Metric label="Δ p95" value={-12} format="ms" />\n</Card>';
    const code = encode(source);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(code)).toBe(source);
  });

  it("builds a fragment the playground reads, so the source never reaches a server", () => {
    const link = PLAYGROUND_URL + playLink("<Badge>ok</Badge>");
    const url = new URL(link);
    expect(url.search).toBe("");
    expect(url.hash.startsWith("#/play?c=")).toBe(true);
    expect(decode(url.hash.slice("#/play?c=".length))).toBe("<Badge>ok</Badge>");
  });

  it("gives null for a broken code", () => {
    expect(decode("%%%")).toBeNull();
  });
});
