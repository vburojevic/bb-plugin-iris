import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { allowedHost, normalizeQuery, photoWidth, plainText, readCommons, readNominatim, readPhoton, tileUrl, USER_AGENT } from "../core/web";
import { WEB_MIGRATIONS, createWebSource } from "../web-source";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function source(routes: Record<string, () => Response>, enabled = true) {
  const db = new Database(":memory:");
  for (const s of WEB_MIGRATIONS) db.exec(s);
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    const hit = Object.entries(routes).find(([prefix]) => u.startsWith(prefix));
    if (!hit) throw new Error(`no route for ${u}`);
    return hit[1]();
  }) as typeof fetch;
  let on = enabled;
  const web = createWebSource({ db, enabled: () => on, fetch: fake });
  return { web, calls, db, setEnabled: (v: boolean) => (on = v) };
}

const json = (body: unknown, type = "application/json") => () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": type } });
const png = () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });

const commonsBody = {
  query: {
    pages: [
      { index: 2, title: "File:Second.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://upload.wikimedia.org/b.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:Second.jpg", extmetadata: {} }] },
      { index: 1, title: "File:Diagram.svg", imageinfo: [{ mime: "image/svg+xml", thumburl: "https://upload.wikimedia.org/a.png", descriptionurl: "https://commons.wikimedia.org/wiki/File:Diagram.svg" }] },
      {
        index: 0,
        title: "File:Lighthouse at dusk.jpg",
        imageinfo: [
          {
            mime: "image/jpeg",
            thumburl: "https://upload.wikimedia.org/thumb/l.jpg",
            thumbwidth: 800,
            thumbheight: 533,
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Lighthouse_at_dusk.jpg",
            extmetadata: {
              Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Ana">Ana P&eacute;rez</a> &amp; friends' },
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
            },
          },
        ],
      },
    ],
  },
};

describe("web allowlist", () => {
  it("allows only https on the listed hosts", () => {
    expect(allowedHost("https://tile.openstreetmap.org/1/0/0.png")).toBe("tile.openstreetmap.org");
    expect(allowedHost("http://tile.openstreetmap.org/1/0/0.png")).toBeNull();
    expect(allowedHost("https://evil.example/tile.openstreetmap.org")).toBeNull();
    expect(allowedHost("https://tile.openstreetmap.org.evil.example/")).toBeNull();
    expect(allowedHost("https://user:pw@upload.wikimedia.org/x")).toBeNull();
    expect(allowedHost("https://upload.wikimedia.org:8443/x")).toBeNull();
    expect(allowedHost("not a url")).toBeNull();
  });

  it("builds tile URLs only for real tiles", () => {
    expect(tileUrl(3, 7, 0)).toBe("https://tile.openstreetmap.org/3/7/0.png");
    expect(tileUrl(3, 8, 0)).toBeNull();
    expect(tileUrl(20, 0, 0)).toBeNull();
    expect(tileUrl(1.5, 0, 0)).toBeNull();
    expect(tileUrl("1", 0, 0)).toBeNull();
  });

  it("normalizes queries and rounds photo widths", () => {
    expect(normalizeQuery("  Ferry   Building ")).toBe("ferry building");
    expect(normalizeQuery("")).toBeNull();
    expect(normalizeQuery("x".repeat(201))).toBeNull();
    expect([undefined, 300, 800, 900, 5000].map(photoWidth)).toEqual([800, 480, 800, 1280, 1280]);
  });
});

describe("provider answers", () => {
  it("reads Photon and Nominatim, rejecting impossible coordinates", () => {
    expect(readPhoton({ features: [{ geometry: { coordinates: [-122.39, 37.79] }, properties: { name: "Ferry Building", city: "San Francisco", country: "United States" } }] })).toEqual({
      lat: 37.79,
      lng: -122.39,
      label: "Ferry Building, San Francisco, United States",
    });
    expect(readPhoton({ features: [{ geometry: { coordinates: [200, 37] } }] })).toBeNull();
    expect(readPhoton({ features: [] })).toBeNull();
    expect(readNominatim([{ lat: "45.81", lon: "15.98", display_name: "Zagreb, Croatia" }])).toEqual({ lat: 45.81, lng: 15.98, label: "Zagreb, Croatia" });
    expect(readNominatim("nope")).toBeNull();
  });

  it("picks the best-ranked Commons bitmap and reads its credit as plain text", () => {
    const pick = readCommons(commonsBody);
    expect(pick?.thumb).toBe("https://upload.wikimedia.org/thumb/l.jpg");
    expect(pick?.title).toBe("Lighthouse at dusk");
    expect(pick?.author).toBe("Ana Pérez & friends");
    expect(pick?.license).toBe("CC BY-SA 4.0");
    expect(pick?.page).toBe("https://commons.wikimedia.org/wiki/File:Lighthouse_at_dusk.jpg");
  });

  it("accepts thumbnails from thumb.wikimedia.org, where Commons now serves them", () => {
    const body = { query: { pages: [{ index: 0, title: "File:x.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://thumb.wikimedia.org/wikipedia/commons/thumb/x.jpg/960px-x.jpg?utm_source=commons.wikimedia.org", descriptionurl: "https://commons.wikimedia.org/wiki/File:x.jpg" }] }] } };
    expect(readCommons(body)?.thumb).toContain("https://thumb.wikimedia.org/");
  });

  it("refuses a Commons answer whose image lives on another host", () => {
    const body = { query: { pages: [{ index: 0, title: "File:x.jpg", imageinfo: [{ mime: "image/jpeg", thumburl: "https://evil.example/x.jpg", descriptionurl: "https://commons.wikimedia.org/wiki/File:x.jpg" }] }] } };
    expect(readCommons(body)).toBeNull();
  });

  it("strips tags and decodes entities", () => {
    expect(plainText("<b>A</b>&nbsp;&#169; &#x263A; <script>x</script>")).toBe("A © ☺ x");
    expect(plainText("")).toBeUndefined();
  });
});

describe("web source", () => {
  it("fetches a tile once with Iris's User-Agent, then serves it from the cache", async () => {
    const { web, calls } = source({ "https://tile.openstreetmap.org/": png });
    const a = await web.tile(2, 1, 1);
    const b = await web.tile(2, 1, 1);
    expect(a).toEqual({ ok: true, dataUrl: `data:image/png;base64,${PNG.toString("base64")}` });
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://tile.openstreetmap.org/2/1/1.png");
    expect((calls[0].init?.headers as Record<string, string>)["user-agent"]).toBe(USER_AGENT);
    expect(calls[0].init?.redirect).toBe("manual");
  });

  it("does nothing when lookups are off", async () => {
    const { web, calls } = source({ "https://": png }, false);
    expect(await web.tile(0, 0, 0)).toMatchObject({ ok: false, code: "off" });
    expect(await web.geocode(["Paris"])).toMatchObject({ ok: false, code: "off" });
    expect(await web.photo("cat", 800)).toMatchObject({ ok: false, code: "off" });
    expect(calls).toHaveLength(0);
  });

  it("rejects wrong content types, redirects and oversized bodies", async () => {
    const { web } = source({
      "https://tile.openstreetmap.org/0/": () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }),
      "https://tile.openstreetmap.org/1/": () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
      "https://tile.openstreetmap.org/2/": () => new Response(new Uint8Array(600 * 1024), { status: 200, headers: { "content-type": "image/png" } }),
    });
    expect(await web.tile(0, 0, 0)).toMatchObject({ ok: false, error: expect.stringContaining("text/html") });
    expect(await web.tile(1, 0, 0)).toMatchObject({ ok: false, error: expect.stringContaining("redirect") });
    expect(await web.tile(2, 0, 0)).toMatchObject({ ok: false, error: expect.stringContaining("more than 512 KB") });
  });

  it("geocodes through Photon, falls back to Nominatim, and caches misses too", async () => {
    let photonUp = true;
    const { web, calls } = source({
      "https://photon.komoot.io/": () =>
        photonUp
          ? json({ features: [{ geometry: { coordinates: [15.98, 45.81] }, properties: { name: "Zagreb", country: "Croatia" } }] }, "application/geo+json")()
          : new Response("down", { status: 503, headers: { "content-type": "text/plain" } }),
      "https://nominatim.openstreetmap.org/": json([]),
    });
    const r = await web.geocode(["Zagreb", " zagreb "]);
    expect(r).toEqual({ ok: true, results: [{ lat: 45.81, lng: 15.98, label: "Zagreb, Croatia" }, { lat: 45.81, lng: 15.98, label: "Zagreb, Croatia" }] });
    expect(calls).toHaveLength(1);
    photonUp = false;
    const miss = await web.geocode(["Nowhere at all"]);
    expect(miss).toEqual({ ok: true, results: [null] });
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["photon.komoot.io", "photon.komoot.io", "nominatim.openstreetmap.org"]);
    await web.geocode(["Nowhere at all"]);
    expect(calls).toHaveLength(3);
  });

  it("caps how many places one call may name", async () => {
    const { web } = source({});
    expect(await web.geocode(Array.from({ length: 26 }, (_, k) => `p${k}`))).toMatchObject({ ok: false, code: "invalid" });
  });

  it("finds a Commons photo, fetches its thumbnail from upload.wikimedia.org and caches both", async () => {
    const { web, calls } = source({
      "https://commons.wikimedia.org/w/api.php": json(commonsBody),
      "https://upload.wikimedia.org/": () => new Response(PNG, { status: 200, headers: { "content-type": "image/jpeg" } }),
    });
    const r = await web.photo("Lighthouse at dusk", 800);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.photo.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(r.photo).toMatchObject({ title: "Lighthouse at dusk", author: "Ana Pérez & friends", license: "CC BY-SA 4.0" });
    const again = await web.photo("lighthouse  at dusk", 760);
    expect(again).toEqual(r);
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["commons.wikimedia.org", "upload.wikimedia.org"]);
    expect(new URL(calls[0].url).searchParams.get("gsrsearch")).toBe("lighthouse at dusk filetype:bitmap");
  });

  it("says so when Commons has nothing, and refuses an image that is not a bitmap", async () => {
    const { web } = source({
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&generator=search&gsrnamespace=6&gsrsearch=none": json({ batchcomplete: true }),
      "https://commons.wikimedia.org/": json(commonsBody),
      "https://upload.wikimedia.org/": () => new Response("<svg/>", { status: 200, headers: { "content-type": "image/svg+xml" } }),
    });
    expect(await web.photo("none", 800)).toMatchObject({ ok: false, code: "not_found" });
    expect(await web.photo("lighthouse", 800)).toMatchObject({ ok: false, error: expect.stringContaining("image/svg+xml") });
  });
});
