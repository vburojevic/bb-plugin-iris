import { describe, expect, it } from "vitest";
import { CardRuntime, compile } from "../core/program";
import { parseExpression } from "../core/parse";
import { check } from "../core/check";

function run(expr: string, decl = "") {
  const rt = new CardRuntime(compile(decl));
  rt.interp.steps = 0;
  return { value: rt.interp.eval(parseExpression(expr), rt.globals), rt };
}

describe("interpreter", () => {
  it("computes with state and lets", () => {
    const rt = new CardRuntime(compile(`<state seats={10} plan="Pro" />\n<let price={(plan == "Pro" ? 29 : 12) * seats} />`));
    expect(rt.getLet("price")).toBe(290);
    rt.setState("plan", "Basic");
    expect(rt.getLet("price")).toBe(120);
  });

  it("supports array methods with arrow functions", () => {
    expect(run("[3, 1, 2].sort((a, b) => a - b).map((x) => x * 10).join(',')").value).toBe("10,20,30");
    expect(run("sum([{ ms: 2 }, { ms: 3 }], 'ms')").value).toBe(5);
    expect(run("sortBy([{ n: 'b' }, { n: 'a' }], 'n').map((x) => x.n)").value).toEqual(["a", "b"]);
  });

  it("blocks prototype access", () => {
    expect(() => run("({}).constructor").value).toThrow();
    expect(() => run("[].__proto__").value).toThrow();
    expect(() => run("'x'.constructor").value).toThrow();
  });

  it("stops runaway loops", () => {
    expect(() => run("range(10000).map((i) => range(1000).map((j) => j))").value).toThrow(/too much work/);
  });

  it("handlers change state and produce actions", () => {
    const rt = new CardRuntime(compile(`<state count={0} todos={[{ done: false }]} />`));
    const fn = rt.interp.eval(parseExpression("() => { count += 1; todos[0].done = true; send(`count ${count}`) }"), rt.globals);
    const actions = rt.interp.runHandler(fn);
    expect(rt.getState("count")).toBe(1);
    expect(rt.getState("todos")).toEqual([{ done: true }]);
    expect(actions.map((a) => a.kind)).toEqual(["send"]);
    expect(actions[0].args[0]).toBe("count 1");
  });

  it("refuses to assign to something that is not state", () => {
    const rt = new CardRuntime(compile(""));
    const fn = rt.interp.eval(parseExpression("() => { x = 1 }"), rt.globals);
    expect(() => rt.interp.runHandler(fn)).toThrow(/not state/);
  });

  it("formats", () => {
    expect(run("usd(1234)").value).toBe("$1,234");
    expect(run("fmt(486, 'ms')").value).toBe("486 ms");
    expect(run("fmt(102000, 'duration')").value).toBe("1m 42s");
    expect(run("pct(0.42)").value).toBe("42%");
    expect(run("bytes(1532000)").value).toBe("1.5 MB");
  });

  it("suggests a name for a typo", () => {
    expect(() => run("seets", "<state seats={1} />").value).toThrow();
  });
});

describe("check", () => {
  it("flags unknown components with a suggestion", () => {
    const r = check(`<Crad title="x" />`);
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain("Card");
  });
  it("flags HTML tags", () => {
    const r = check(`<div>hi</div>`);
    expect(r.issues[0].message).toContain("Stack or Row");
  });
  it("flags a bind without state", () => {
    const r = check(`<Slider bind="seats" />`);
    expect(r.issues.some((i) => i.message.includes("no <state seats"))).toBe(true);
  });
  it("finds errors that only appear when an input moves", () => {
    const r = check(`<state n={1} />\n<Slider bind="n" min={0} max={3} />\n<Text>{[1, 2, 3][n].toFixed(1)}</Text>`);
    expect(r.issues.some((i) => i.when?.includes("n = 3"))).toBe(true);
  });
  it("flags a bad enum value", () => {
    const r = check(`<Badge tone="sparkly">ok</Badge>`);
    expect(r.issues[0].message).toContain("good");
  });
  it("reads tone synonyms as their tone", () => {
    for (const t of ["success", "warning", "danger", "error", "information"]) expect(check(`<Badge tone="${t}">ok</Badge>`).issues.filter((i) => i.severity === "error"), t).toEqual([]);
  });
});

describe("sandbox", () => {
  const escapes = [
    `first(pluck([sum], "constructor"))`,
    `first(keys(groupBy([sum], "constructor")))`,
    `first(unique([sum], "constructor"))`,
    `sortBy([sum, sum], "constructor")[0]`,
    `sum([sum], "constructor")`,
  ];
  for (const e of escapes) {
    it(`no host Function from ${e}`, () => {
      const rt = new CardRuntime(compile(""));
      let v: unknown;
      try {
        v = rt.interp.eval(parseExpression(e), rt.globals);
      } catch {
        v = undefined;
      }
      expect(v).not.toBe(Function);
      expect(typeof v === "function" && v.toString().includes("[native code]") && (v as { name?: string }).name === "Function").toBe(false);
    });
  }
  it("refuses to call a native function it didn't create", () => {
    const rt = new CardRuntime(compile(""));
    rt.globals.vars.set("leak", Function);
    expect(() => rt.interp.eval(parseExpression(`leak("return 1")()`), rt.globals)).toThrow(/can't be called/);
  });
  it("check() can't run code through the reviewer's escape", () => {
    const r = check(`<let F={first(pluck([sum], "constructor"))} />\n<let out={F("return 42")()} />\n<Text>{out}</Text>`);
    expect(r.outline).not.toContain("42");
  });
});

describe("loading data", () => {
  it("keeps chains over load() pending instead of failing", () => {
    const rt = new CardRuntime(compile(""), { load: () => new Promise(() => undefined) });
    for (const e of [`load("a.json").filter((r) => r.ok).map((r) => r.name)`, `sum(load("a.json"), "ms")`, `len(load("a.json"))`]) {
      const v = rt.interp.eval(parseExpression(e), rt.globals) as { $iris?: string };
      expect(v.$iris, e).toBe("pending");
    }
  });
});

describe("layout hints", () => {
  const warnings = (src: string) => check(src).issues.filter((i) => i.severity === "warning").map((i) => i.message);
  it("warns when a card won't fit the chat column", () => {
    expect(warnings(`<Row>${'<Metric label="a" value={1} />'.repeat(6)}</Row>`).join(" ")).toContain("6 items side by side");
    expect(warnings(`<Table rows={[{a:1,b:2,c:3,d:4,e:5,f:6,g:7,h:8}]} />`).join(" ")).toContain("8 columns");
    expect(warnings(`<Metric label="Status" value="Waiting on the review from the platform team" />`).join(" ")).toContain("long for a Metric");
  });
  it("stays quiet on cards that fit", () => {
    expect(warnings(`<Card title="Release"><Row><Metric label="a" value={1} /><Metric label="b" value={2} /></Row><Table rows={[{a:1,b:2}]} /></Card>`)).toEqual([]);
  });
});
