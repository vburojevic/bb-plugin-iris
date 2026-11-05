// Hostile input that used to make a regex backtrack: each case must finish quickly.
import { describe, expect, it } from "vitest";
import { readAudit } from "../core/a11y";
import { readBytes, normalizeProcesses } from "../core/devservers";
import { svgSize } from "../core/files";
import { placeholders } from "../core/l10n";
import { parse } from "../core/parse";
import { parseCaptions } from "../core/players";
import { highlight } from "../site/editor";

const fast = (fn: () => unknown, ms = 250) => {
  const t = performance.now();
  fn();
  expect(performance.now() - t).toBeLessThan(ms);
};

describe("slow-input guards", () => {
  it("parser holds back a streamed word without rescanning", () => fast(() => parse(`<Card><Text>${"a ".repeat(40_000)}`)));
  it("Lighthouse links with an unclosed bracket", () =>
    fast(() => readAudit({ lighthouseVersion: "12", categories: { accessibility: { auditRefs: [{ id: "x" }] } }, audits: { x: { id: "x", title: "X", score: 0, description: "[".repeat(50_000), details: { items: [] } } } })));
  it("printf placeholders in a long run of digits", () => fast(() => placeholders(`%${"0".repeat(50_000)}`)));
  it("caption tags that never close", () => fast(() => parseCaptions(`WEBVTT\n\n00:00.000 --> 00:01.000\n${"<".repeat(50_000)}\n`)));
  it("port and size strings full of spaces", () => {
    fast(() => normalizeProcesses([{ name: "web", port: `1${" ".repeat(50_000)}x` }]));
    fast(() => readBytes(`1${" ".repeat(50_000)}x`));
    expect(readBytes("12 MB")).toBe(12 * 1024 * 1024);
  });
  it("an SVG opening tag that never ends", () => fast(() => svgSize(`<svg ${"<svg ".repeat(50_000)}`)));
  it("the site highlighter on unclosed strings", () => fast(() => highlight(`"${'a"'.repeat(1)}${'"x'.repeat(30_000)}`)));
});
