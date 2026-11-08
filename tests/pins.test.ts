import { describe, expect, it } from "vitest";
import { cardFromFile, cardTitle, MAX_PINS, newestPinnedFirst, normalizePins, pinId, removePin, upsertPin, type Pin } from "../core/pins";

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

describe("pins on the home page", () => {
  const pin = (id: string, at: number): Pin => ({ id, title: id, source: `<Card title="${id}" />`, by: "person", at });
  it("puts the most recently pinned thread first, its newest pin first, and drops threads without pins", () => {
    const out = newestPinnedFirst([
      { threadId: "a", title: "A", projectId: null, pins: [pin("old", 1)] },
      { threadId: "b", title: "B", projectId: "p", pins: [pin("x", 5), pin("y", 9)] },
      { threadId: "c", title: "C", projectId: null, pins: [] },
    ]);
    expect(out.map((t) => t.threadId)).toEqual(["b", "a"]);
    expect(out[0].pins.map((p) => p.id)).toEqual(["y", "x"]);
  });
});

describe("pins RPC", () => {
  it("publishes every schema as JSON Schema, so bb can list the methods", async () => {
    const { z } = await import("zod");
    const { cardsContract, pinsContract } = await import("../shared/pins-rpc");
    for (const [name, m] of Object.entries({ ...pinsContract, ...cardsContract })) {
      expect(() => z.toJSONSchema(m.input as never), `${name} input`).not.toThrow();
      expect(() => z.toJSONSchema(m.output as never), `${name} output`).not.toThrow();
    }
  });
});

describe("check", () => {
  it("warns when a required prop comes out empty, naming the fields the data has", async () => {
    const { check, formatReport } = await import("../core/check");
    const r = check('<let f={{ ships: 3, status: "underway" }} />\n<Metric label="Ships" value={f.ship} />');
    expect(r.ok).toBe(true);
    expect(formatReport(r)).toContain('<Metric value> is empty: it has no field "ship"; its fields are ships, status');
  });
});
