import { describe, expect, it } from "vitest";
import { parse, parseExpression } from "../core/parse";
import { compile } from "../core/program";
import { CATALOG } from "../core/catalog";
import { check } from "../core/check";

describe("parse", () => {
  it("parses nested tags, attributes and text", () => {
    const r = parse(`<Card title="Hi" n={1 + 2}>\n  Hello **world**\n  <Badge tone="good">Ok</Badge>\n</Card>`);
    expect(r.error).toBeNull();
    expect(r.incomplete).toBe(false);
    const card = r.nodes[0];
    expect(card.kind === "element" && card.name).toBe("Card");
    if (card.kind !== "element") return;
    expect(card.attrs.map((a) => a.name)).toEqual(["title", "n"]);
    expect(card.children.filter((c) => c.kind === "element").length).toBe(1);
  });

  it("builds a partial tree while streaming", () => {
    const src = `<Card title="Tests">\n  <Metric label="Passed" value={409} />\n  <Metric label="Fai`;
    const r = parse(src);
    expect(r.error).toBeNull();
    expect(r.incomplete).toBe(true);
    const card = r.nodes[0];
    if (card.kind !== "element") throw new Error();
    expect(card.closed).toBe(false);
    expect(card.children.filter((c) => c.kind === "element").length).toBe(1);
  });

  it("reads raw tags verbatim", () => {
    const r = parse(`<Diagram>\nflowchart LR\n  A{ok?} --> B[<b>x</b>]\n</Diagram>`);
    expect(r.error).toBeNull();
    const d = r.nodes[0];
    if (d.kind !== "element") throw new Error();
    expect(d.children[0].kind === "text" && d.children[0].value).toContain("A{ok?} --> B[<b>x</b>]");
  });

  it("parses JSX inside expressions", () => {
    const r = parse(`<Stack>{rows.map((r) => <Text>{r.name}</Text>)}</Stack>`);
    expect(r.error).toBeNull();
  });

  it("reports a mismatched closing tag with a line", () => {
    const r = parse(`<Card>\n  <Row>\n  </Card>`);
    expect(r.error?.message).toContain("</Row>");
    expect(r.error?.line).toBe(3);
  });

  it("treats a lone < in prose as text", () => {
    const r = parse(`<Text>a < b and 3 <= 4</Text>`);
    expect(r.error).toBeNull();
  });

  it("parses arrow functions, ternaries, templates and assignment", () => {
    for (const src of [
      "(a, b) => a + b",
      "x => x * 2",
      "() => { count += 1; send(`n=${count}`) }",
      "plan == 'Pro' ? 29 : 12",
      "rows.filter((r) => r.ok).map(({ name, ms = 0 }) => name + ms)",
      "a?.b?.[0] ?? 'none'",
      "{ ...base, x: 1, [k]: v, short }",
      "-x ** 2",
      "todos[i].done = !todos[i].done",
    ]) {
      expect(() => parseExpression(src), src).not.toThrow();
    }
  });
});

describe("catalog examples", () => {
  for (const c of CATALOG) {
    it(`${c.name} example passes check`, () => {
      const report = check(c.example);
      const errors = report.issues.filter((i) => i.severity === "error");
      expect(errors, JSON.stringify(report.issues)).toEqual([]);
    });
  }
});

describe("compile", () => {
  it("collects state and let declarations", () => {
    const p = compile(`<state a={1} b="x" />\n<let c={a * 2} />\n<Text>{c}</Text>`);
    expect(p.states.map((s) => s.name)).toEqual(["a", "b"]);
    expect(p.lets.map((s) => s.name)).toEqual(["c"]);
  });
});
