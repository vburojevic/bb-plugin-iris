import { describe, expect, it } from "vitest";
import { CardRuntime, compile } from "../core/program";
import { loadPluginData, parsePluginAnswer, parsePluginSource, pluginDataPath } from "../core/plugin-data";

describe("plugin data contract", () => {
  it("reads a plugin id, a name and a query", () => {
    const r = parsePluginSource("plugin:my-plugin/fleet/status?scope=open&limit=5");
    expect(r.ok && r.source).toEqual({ pluginId: "my-plugin", name: "fleet/status", query: [["scope", "open"], ["limit", "5"]] });
  });

  it("refuses ids and names that could reach outside the iris/ prefix", () => {
    for (const bad of ["plugin:../x/y", "plugin:Up/y", "plugin:ok", "plugin:ok/", "plugin:ok/../secret", "plugin:ok/a%2F..", "plugin:ok/a b", "plugin:ok/x?thread=other"]) {
      expect(parsePluginSource(bad).ok, bad).toBe(false);
    }
  });

  it("always reads under the plugin's iris/ route and passes the thread", () => {
    const r = parsePluginSource("plugin:notes/today?tag=a%20b");
    if (!r.ok) throw new Error(r.error);
    expect(pluginDataPath(r.source, "thr_1")).toBe("/api/v1/plugins/notes/http/iris/today?tag=a+b&thread=thr_1");
    expect(pluginDataPath(r.source, null)).toBe("/api/v1/plugins/notes/http/iris/today?tag=a+b");
  });

  it("parses by content type", () => {
    expect(parsePluginAnswer("x", "application/json; charset=utf-8", '{"a":1}', false)).toEqual({ ok: true, value: { a: 1 } });
    expect(parsePluginAnswer("x", "text/csv", "a,b\n1,2\n", false)).toMatchObject({ ok: true });
    expect(parsePluginAnswer("x", "application/json", '{"a":1}', true)).toEqual({ ok: true, value: '{"a":1}' });
  });

  it("explains a missing route, a failure and an oversize answer", async () => {
    const answer = (status: number, body = "", headers: Record<string, string> = {}) => (async () => new Response(body, { status, headers })) as unknown as typeof fetch;
    expect(await loadPluginData("plugin:p/x", "thr_1", false, answer(404), "http://h")).toMatchObject({ ok: false, error: expect.stringContaining("has no Iris data named") });
    expect(await loadPluginData("plugin:p/x", "thr_1", false, answer(500), "http://h")).toMatchObject({ ok: false, error: expect.stringContaining("answered 500") });
    expect(await loadPluginData("plugin:p/x", "thr_1", false, answer(200, "{}", { "content-length": String(10 * 1024 * 1024) }), "http://h")).toMatchObject({ ok: false });
    expect(await loadPluginData("plugin:p/x", "thr_1", false, answer(200, '{"n":3}', { "content-type": "application/json" }), "http://h")).toEqual({ ok: true, value: { n: 3 } });
  });

  it("only ever requests GET on the iris/ prefix", async () => {
    let seen = "";
    let method = "";
    const spy = (async (url: string, init: RequestInit) => ((seen = url), (method = String(init.method)), new Response("[]", { headers: { "content-type": "application/json" } }))) as unknown as typeof fetch;
    await loadPluginData("plugin:p/a/b", "thr_9", false, spy, "http://h");
    expect(seen).toBe("http://h/api/v1/plugins/p/http/iris/a/b?thread=thr_9");
    expect(method).toBe("GET");
  });

  it("keeps everything after the first = and reads + as a space", () => {
    const r = parsePluginSource("plugin:p/x?q=a=b&name=two+words");
    expect(r.ok && r.source.query).toEqual([["q", "a=b"], ["name", "two words"]]);
  });

  it("stops reading a body without a length once it passes the cap", async () => {
    const big = new ReadableStream({
      start(c) {
        const chunk = new Uint8Array(1024 * 1024).fill(32);
        for (let k = 0; k < 6; k++) c.enqueue(chunk);
        c.close();
      },
    });
    const f = (async () => new Response(big, { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    expect(await loadPluginData("plugin:p/x", null, false, f, "http://h")).toMatchObject({ ok: false, error: expect.stringContaining("more than 4 MB") });
  });
});


describe("load cap", () => {
  it("never cycles when renders read more than 32 sources in a changing order", () => {
    let t = 0;
    const asked: string[] = [];
    const rt = new CardRuntime(compile(""), { load: (p) => (asked.push(p), new Promise(() => undefined)), now: () => t });
    const keys = Array.from({ length: 40 }, (_, k) => `plugin:p/x?k=${k}`);
    for (let render = 0; render < 2000; render++) {
      t += 16;
      for (const k of render % 2 ? [...keys].reverse() : keys) {
        try {
          rt.load(k);
        } catch {
          // Past the cap: the card shows an error.
        }
      }
    }
    expect(asked.length).toBeLessThan(80);
  });

  it("lets a new source replace one nothing read for a while", () => {
    let t = 0;
    const asked: string[] = [];
    const rt = new CardRuntime(compile(""), { load: (p) => (asked.push(p), new Promise(() => undefined)), now: () => t });
    for (let k = 0; k < 32; k++) rt.load(`plugin:p/x?k=${k}`);
    expect(() => rt.load("plugin:p/x?k=99")).toThrow(/at most 32/);
    t += 6000;
    rt.load("plugin:p/x?k=99");
    expect(asked.length).toBe(33);
    expect((rt as unknown as { loads: Map<string, unknown> }).loads.size).toBe(32);
  });
});

import { literalStrings } from "../ui/files";
describe("web image literals", () => {
  it("accepts only complete string literals", () => {
    const src = `<Image src="https://cdn.example.com/a.png" />\n<let u={"https://evil.tld/aaaaaaaa".slice(0, 20)} />`;
    const set = literalStrings(src);
    expect(set.has("https://cdn.example.com/a.png")).toBe(true);
    expect(set.has("https://evil.tld/aaaa")).toBe(false);
    expect(set.has("https://evil.tld/aaaaaaaa")).toBe(true);
  });
});
