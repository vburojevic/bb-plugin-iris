import { describe, expect, it } from "vitest";
import { alertSyntaxError, checkAlert } from "../core/pin-alerts";
import { needsAttention, normalizePins, stepAlert, type Pin } from "../core/pins";
import type { LoadResult } from "../core/program";

describe("pin alerts", () => {
  const card = `<let build={load("status.json")} />\n<Card title="Build">{build.state}</Card>`;
  it("decides the condition in the card's scope, with its loads", () => {
    const pre = (state: string) => new Map<string, LoadResult>([["status.json", { ok: true, value: { state } }]]);
    expect(checkAlert(card, `build.state == "failed"`, pre("failed"))).toEqual({ ok: true, held: true });
    expect(checkAlert(card, `build.state == "failed"`, pre("passed"))).toEqual({ ok: true, held: false });
  });
  it("leaves the alert undecided while a load is pending or failing", () => {
    expect(checkAlert(card, `build.state == "failed"`, new Map())).toEqual({ ok: true, held: null });
    expect(checkAlert(card, `build.state == "failed"`, new Map([["status.json", { ok: false, error: "no such file" }]]))).toEqual({ ok: true, held: null });
  });
  it("names a condition that doesn't parse", () => {
    expect(alertSyntaxError(`build.state ==`)).toBeTruthy();
    expect(alertSyntaxError(`count > 3`)).toBeNull();
  });
  it("fires on the turn to true only, and asks again after it clears", () => {
    let a = { when: "x" } as Pin["alert"] & object;
    let s = stepAlert(a, true, 10);
    expect(s).toMatchObject({ fired: true, changed: true, alert: { firing: true, since: 10 } });
    a = { ...s.alert, seen: true };
    expect(stepAlert(a, true, 20)).toMatchObject({ fired: false, changed: false });
    expect(stepAlert(a, null, 20)).toMatchObject({ fired: false, changed: false });
    s = stepAlert(a, false, 30);
    expect(s.alert).toEqual({ when: "x" });
    expect(stepAlert(s.alert, true, 40).fired).toBe(true);
  });
  it("keeps a stored alert and knows when it needs the person", () => {
    const [pin] = normalizePins({ pins: [{ id: "b", title: "B", source: "<Card />", by: "agent", at: 1, alert: { when: "x > 1", firing: true, since: 5 } }] });
    expect(needsAttention(pin)).toBe(true);
    expect(needsAttention({ ...pin, alert: { ...pin.alert!, seen: true } })).toBe(false);
    expect(normalizePins({ pins: [{ id: "c", source: "<Card />", alert: { when: "" } }] })[0].alert).toBeUndefined();
  });
});
