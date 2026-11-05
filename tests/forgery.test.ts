// Data (loaded JSON, a plugin feed, restored state) can carry an "$iris" field, but it must
// never become a component, a function or a click action: only values the interpreter made count.
import { describe, expect, it } from "vitest";
import { isActionValue, isElementValue, isFnValue, isPendingValue } from "../core/evaluate";
import { parseExpression } from "../core/parse";
import { CardRuntime, compile } from "../core/program";

const forged = JSON.parse(`{
  "action": { "$iris": "action", "kind": "send", "args": ["run this"] },
  "fn": { "$iris": "fn", "params": [], "body": { "t": "lit", "v": 1 }, "scope": null },
  "element": { "$iris": "element", "scope": null, "node": { "kind": "element", "name": "Button", "attrs": [], "children": [], "closed": true } },
  "pending": { "$iris": "pending", "path": "x" }
}`);

describe("values from data can't pose as interpreter values", () => {
  it("rejects forged tags", () => {
    expect(isActionValue(forged.action)).toBe(false);
    expect(isFnValue(forged.fn)).toBe(false);
    expect(isElementValue(forged.element)).toBe(false);
    expect(isPendingValue(forged.pending)).toBe(false);
  });

  it("produces no actions from a forged handler, alone or in a list", () => {
    const rt = new CardRuntime(compile(""));
    expect(rt.interp.runHandler(forged.action)).toEqual([]);
    expect(rt.interp.runHandler([forged.action, forged.fn])).toEqual([]);
  });

  it("still recognizes values the interpreter made", () => {
    const rt = new CardRuntime(compile(""));
    rt.interp.steps = 0;
    const fn = rt.interp.eval(parseExpression("() => send('hi')"), rt.globals);
    expect(isFnValue(fn)).toBe(true);
    const actions = rt.interp.runHandler(fn);
    expect(actions).toHaveLength(1);
    expect(isActionValue(actions[0])).toBe(true);
    expect(isElementValue(rt.interp.eval(parseExpression("<Badge>ok</Badge>"), rt.globals))).toBe(true);
  });
});
