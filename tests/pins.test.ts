import { describe, expect, it } from "vitest";
import { cardFromFile, cardTitle, MAX_PINS, normalizePins, pinId, removePin, upsertPin, type Pin } from "../core/pins";

const pin = (id: string, by: Pin["by"] = "agent"): Pin => ({ id, title: id, source: `<Card title="${id}" />`, by, at: 1 });

describe("pins", () => {
  it("reads the single pin of earlier versions as the person's", () => {
    const pins = normalizePins({ source: '<Card title="Build 212">x</Card>', title: "Build 212" });
    expect(pins).toEqual([{ id: "build-212", title: "Build 212", source: '<Card title="Build 212">x</Card>', by: "person", at: 0 }]);
    expect(normalizePins({ source: null })).toEqual([]);
  });
  it("drops malformed pins and repeats, and keeps files", () => {
    const pins = normalizePins({ pins: [{ id: "a", source: "<Card />" }, { id: "a", source: "x" }, { title: "Fleet", file: "$BB_THREAD_STORAGE/fleet.iris", by: "agent" }, { id: "bad id!" }, "junk"] });
    expect(pins.map((p) => [p.id, p.by, p.file ?? null])).toEqual([
      ["a", "person", null],
      ["fleet", "agent", "$BB_THREAD_STORAGE/fleet.iris"],
    ]);
  });
  it("replaces by id in place and refuses a pin past the limit", () => {
    const full = Array.from({ length: MAX_PINS }, (_, i) => pin(`p${i}`));
    const replaced = upsertPin(full, { ...pin("p2"), title: "New" });
    expect(replaced.ok && replaced.replaced && replaced.pins[2].title).toBe("New");
    const refused = upsertPin(full, pin("extra"));
    expect(refused.ok).toBe(false);
    expect(removePin(full, "p0").pins).toHaveLength(MAX_PINS - 1);
    expect(removePin(full, "nope").ok).toBe(false);
  });
  it("names cards and unwraps card files", () => {
    expect(cardTitle('<Card title="Fleet status" state="live">')).toBe("Fleet status");
    expect(pinId("Fleet status, live!", "")).toBe("fleet-status-live");
    expect(pinId("", "abc")).toMatch(/^card-[a-z0-9]+$/);
    expect(cardFromFile("```iris\n<Card />\n```\n")).toBe("<Card />");
    expect(cardFromFile("<Card />")).toBe("<Card />");
  });
});

describe("pins RPC", () => {
  it("publishes every schema as JSON Schema, so bb can list the methods", async () => {
    const { z } = await import("zod");
    const { pinsContract } = await import("../shared/pins-rpc");
    for (const [name, m] of Object.entries(pinsContract)) {
      expect(() => z.toJSONSchema(m.input as never), `${name} input`).not.toThrow();
      expect(() => z.toJSONSchema(m.output as never), `${name} output`).not.toThrow();
    }
  });
});
