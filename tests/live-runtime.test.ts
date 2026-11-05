import { describe, expect, it } from "vitest";
import { CardRuntime, compile, type LoadResult } from "../core/program";

const flush = () => new Promise((r) => setTimeout(r, 0));

function runtime(files: Record<string, unknown>) {
  const calls: string[] = [];
  const r = new CardRuntime(compile(`<Card />`), {
    load: async (path, raw, tail): Promise<LoadResult> => {
      calls.push(`${tail ? "tail:" : raw ? "raw:" : ""}${path}`);
      return { ok: true, value: structuredClone(files[path]) };
    },
  });
  return { r, calls, files };
}

describe("live refresh", () => {
  it("keeps the same value object when a re-read changed nothing", async () => {
    const { r } = runtime({ "a.json": [{ x: 1 }] });
    r.load("a.json");
    await flush();
    const first = r.load("a.json");
    const v = r.version;
    r.reloadFiles();
    await flush();
    expect(r.load("a.json")).toBe(first);
    expect(r.version).toBe(v);
  });
  it("re-renders when a re-read changed the file", async () => {
    const { r, files } = runtime({ "p.json": { done: 1, total: 4 } });
    r.load("p.json");
    await flush();
    files["p.json"] = { done: 2, total: 4 };
    r.reloadFiles();
    await flush();
    expect(r.load("p.json")).toEqual({ done: 2, total: 4 });
  });
  it("re-reads only what live components watch when no Card is live", async () => {
    const { r, calls } = runtime({ "big.csv": [1], "job.log": { text: "a", size: 1, truncated: false } });
    r.load("big.csv");
    expect(r.isWatching()).toBe(false);
    r.loadLive("job.log", { tail: true });
    expect(r.isWatching()).toBe(true);
    await flush();
    calls.length = 0;
    r.reloadFiles("watched");
    await flush();
    expect(calls).toEqual(["tail:job.log"]);
    r.reloadFiles("all");
    await flush();
    expect(calls.sort()).toEqual(["big.csv", "tail:job.log", "tail:job.log"].sort());
  });
});
