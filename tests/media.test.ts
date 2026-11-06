import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deviceOf,
  displayHost,
  fontStack,
  formatRatio,
  grade,
  normalizeBackgrounds,
  normalizeSizes,
  normalizeSwatches,
  normalizeWeights,
  parseColor,
  screenAspect,
  toHex,
} from "../core/design";
import {
  distanceKm,
  fitView,
  formatDistance,
  normalizeCallouts,
  normalizeGallery,
  normalizeHotspots,
  normalizePlaces,
  percent,
  placeOnFrame,
  project,
  visibleTiles,
  wrapIndex,
  zoomView,
} from "../core/media";
import { referenceSections } from "../core/prompt";
import { CATALOG } from "../core/catalog";

describe("Gallery", () => {
  it("reads paths, URLs and objects, drops entries without a src, names images from their file", () => {
    const g = normalizeGallery(["shots/home.png", { src: "https://x.test/a%20b.jpg?w=2", caption: "A" }, { caption: "no src" }, 42]);
    expect(g).toEqual([
      { src: "shots/home.png", caption: undefined, alt: "home.png" },
      { src: "https://x.test/a%20b.jpg?w=2", caption: "A", alt: "A" },
    ]);
    expect(normalizeGallery(Array(80).fill("a.png"))).toHaveLength(60);
  });
  it("wraps the lightbox index at both ends", () => {
    expect([wrapIndex(0, -1, 3), wrapIndex(2, 1, 3), wrapIndex(1, 1, 3), wrapIndex(0, 1, 0)]).toEqual([2, 0, 2, 0]);
  });
});

describe("Hotspots and Annotate", () => {
  it("reads percents written as numbers, strings and fractions, clamped to the image", () => {
    expect([percent(40), percent("40%"), percent(" 12.5 "), percent(0.25), percent(140), percent(-3), percent("x")]).toEqual([40, 40, 12.5, 25, 100, 0, undefined]);
  });
  it("numbers spots in order and skips ones without a position", () => {
    const s = normalizeHotspots([{ x: 10, y: 20, title: "Desk" }, { title: "lost" }, { x: "50%", y: 50, text: "t" }]);
    expect(s.map((h) => [h.n, h.title, h.x, h.y])).toEqual([
      [1, "Desk", 10, 20],
      [2, "Point 2", 50, 50],
    ]);
  });
  it("keeps boxes inside the image and treats a callout without size as a pin", () => {
    const c = normalizeCallouts([{ x: 80, y: 90, w: 40, h: 30, label: "Edge" }, { x: 5, y: 5, label: "Pin" }]);
    expect(c[0].box).toEqual({ x: 80, y: 90, w: 20, h: 10 });
    expect(c[1].box).toBeNull();
    expect(c[1].n).toBe(2);
  });
});

describe("Map", () => {
  it("reads names, [lat, lng] pairs and objects; coordinates skip the lookup", () => {
    const p = normalizePlaces(["Zagreb", [45.81, 15.98], { name: "Coit Tower", query: "Coit Tower, San Francisco" }, { name: "Here", lat: "37.8", lng: -122.4 }, { note: "nothing" }, [200, 0]]);
    expect(p.map((x) => [x.n, x.name, x.query, x.at])).toEqual([
      [1, "Zagreb", "Zagreb", null],
      [2, "45.8100, 15.9800", undefined, { lat: 45.81, lng: 15.98 }],
      [3, "Coit Tower", "Coit Tower, San Francisco", null],
      [4, "Here", undefined, { lat: 37.8, lng: -122.4 }],
    ]);
    expect(normalizePlaces(Array(40).fill("x"))).toHaveLength(25);
  });

  it("projects like OSM tiles: the null island is the middle of the world", () => {
    expect(project(0, 0, 0)).toEqual({ x: 128, y: 128 });
    expect(project(0, 180, 1).x).toBe(512);
    expect(project(85.05112878, -180, 2).y).toBeCloseTo(0, 3);
  });

  it("fits every place at the closest zoom and centers on their bounds", () => {
    const sf = [
      { lat: 37.7955, lng: -122.3937 },
      { lat: 37.8024, lng: -122.4058 },
      { lat: 37.8029, lng: -122.4484 },
    ];
    const v = fitView(sf, 600, 320, 40);
    expect(v.z).toBe(13);
    const frame = sf.map((p) => placeOnFrame(p, v, 600, 320));
    for (const f of frame) {
      expect(f.left).toBeGreaterThanOrEqual(40 - 0.001);
      expect(f.left).toBeLessThanOrEqual(560 + 0.001);
      expect(f.top).toBeGreaterThanOrEqual(40 - 0.001);
      expect(f.top).toBeLessThanOrEqual(280 + 0.001);
    }
    // A wider spread zooms out.
    expect(fitView([sf[0], { lat: 45.81, lng: 15.98 }], 600, 320).z).toBeLessThan(4);
    // One place gets a street-level zoom.
    expect(fitView([sf[0]], 600, 320).z).toBe(14);
  });

  it("zooms around the center and lists the tiles that cover the frame, wrapping the date line", () => {
    const v = { z: 3, cx: 1024, cy: 1024 };
    const z = zoomView(v, 1);
    expect(z).toEqual({ z: 4, cx: 2048, cy: 2048 });
    expect(zoomView({ z: 18, cx: 1, cy: 1 }, 1).z).toBe(18);
    const tiles = visibleTiles(v, 512, 256);
    expect(tiles.map((t) => [t.x, t.y])).toEqual([
      [3, 3],
      [4, 3],
      [3, 4],
      [4, 4],
    ]);
    expect(tiles[0]).toMatchObject({ left: 0, top: -128 });
    const wrap = visibleTiles({ z: 1, cx: 0, cy: 256 }, 256, 256);
    expect(wrap.map((t) => t.x)).toEqual([1, 0, 1, 0]);
    expect(visibleTiles({ z: 10, cx: 5000, cy: 5000 }, 4000, 4000)).toHaveLength(64);
  });

  it("measures legs as the crow flies", () => {
    expect(distanceKm({ lat: 45.81, lng: 15.98 }, { lat: 43.51, lng: 16.44 })).toBeCloseTo(258, -1);
    expect([formatDistance(0.42), formatDistance(3.456), formatDistance(1234.4)]).toEqual(["420 m", "3.5 km", "1,234 km"]);
  });
});

describe("Swatches", () => {
  it("parses hex, rgb() and hsl(); leaves theme tokens to the browser", () => {
    expect(parseColor("#4860E2")).toEqual([72, 96, 226]);
    expect(parseColor("#fff")).toEqual([255, 255, 255]);
    expect(parseColor("#11223380")).toEqual([17, 34, 51]);
    expect(parseColor("rgb(10 20 30 / 50%)")).toEqual([10, 20, 30]);
    expect(parseColor("rgba(255, 0, 0, 0.5)")).toEqual([255, 0, 0]);
    expect(parseColor("hsl(120, 100%, 25%)")).toEqual([0, 128, 0]);
    expect(parseColor("var(--primary)")).toBeNull();
    expect(parseColor("#12345")).toBeNull();
    expect(toHex([72, 96, 226])).toBe("#4860E2");
  });

  it("computes WCAG contrast and grades it without rounding a fail into a pass", () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
    // #767676 on white is the classic 4.54:1 AA pass.
    const g = grade(parseColor("#767676")!, [255, 255, 255]);
    expect(formatRatio(g.ratio)).toBe("4.54:1");
    expect(g).toMatchObject({ aa: true, aaa: false, aaLarge: true, aaaLarge: true });
    // #777777 is just under 4.5 and must fail AA.
    const near = grade(parseColor("#777777")!, [255, 255, 255]);
    expect(near.ratio).toBeLessThan(4.5);
    expect(near.aa).toBe(false);
    expect(formatRatio(4.4999)).toBe("4.49:1");
  });

  it("reads swatches and backgrounds, defaulting to white and black", () => {
    expect(normalizeSwatches(["#fff", { name: "Brand", value: "#4860E2", note: "Buttons" }, { name: "empty" }])).toEqual([
      { name: "#fff", value: "#fff", note: undefined },
      { name: "Brand", value: "#4860E2", note: "Buttons" },
    ]);
    expect(normalizeBackgrounds(undefined).map((b) => b.value)).toEqual(["#FFFFFF", "#000000"]);
    expect(normalizeBackgrounds(["#111", { name: "Card", value: "var(--card)" }])).toEqual([
      { name: "#111", value: "#111" },
      { name: "Card", value: "var(--card)" },
    ]);
  });
});

describe("DeviceFrame and TypeSpecimen", () => {
  it("reads device names people write and turns phones for landscape", () => {
    expect(["iPhone", "tablet", "desktop", "web", "nonsense"].map(deviceOf)).toEqual(["iphone", "ipad", "mac", "browser", "iphone"]);
    expect(screenAspect("iphone", true)).toBeGreaterThan(1);
    expect(screenAspect("mac", true)).toBe(16 / 10);
    expect(displayHost("https://studio.example.com/a?token=secret")).toBe("studio.example.com/a");
    expect(displayHost("studio.example.com")).toBe("studio.example.com");
  });

  it("reads sizes and weights, sorted and deduped, with defaults", () => {
    expect(normalizeSizes([17, "34px", { size: 13, label: "Footnote" }, 17, 400, 2])).toEqual([{ size: 13, label: "Footnote" }, { size: 17, label: undefined }, { size: 34, label: undefined }]);
    expect(normalizeSizes(undefined).length).toBe(6);
    expect(normalizeWeights(["bold", "Regular", 600, "semi-bold", 1000])).toEqual([400, 600, 700]);
  });

  it("builds a font stack that can't break out of the declaration", () => {
    expect(fontStack("Inter, system-ui")).toBe('"Inter", system-ui');
    expect(fontStack('SF Pro"; background: url(x)')).toBe('"SF Pro background urlx", system-ui');
    expect(fontStack(undefined)).toBe("system-ui");
  });
});

describe("catalog", () => {
  it("has the media and design components with examples, inside the prompt's section limits", () => {
    for (const name of ["Gallery", "Hotspots", "Map", "PhotoSearch", "DeviceFrame", "Swatches", "TypeSpecimen", "Annotate"]) {
      expect(CATALOG.find((c) => c.name === name)?.example).toBeTruthy();
    }
    for (const s of referenceSections()) expect(s.text.length).toBeLessThanOrEqual(4096);
  });
});

describe("Screens", () => {
  it("lays shots out as screens by columns, in order, and counts the gaps", async () => {
    const { screenMatrix } = await import("../core/media");
    const m = screenMatrix(
      [
        { screen: "Home", column: "iPhone", src: "a.png" },
        { screen: "Home", column: "Mac", src: "b.png", status: "changed" },
        { screen: "Settings", column: "iPhone", src: "c.png" },
        { screen: "Settings", device: "iPad", src: "d.png" },
        { column: "Mac" },
      ],
      ["Mac"],
    );
    expect(m.screens).toEqual(["Home", "Settings"]);
    expect(m.columns).toEqual(["Mac", "iPhone", "iPad"]);
    expect(m.cells).toEqual([
      [1, 0, -1],
      [-1, 2, 3],
    ]);
    expect(m.missing).toBe(2);
    expect(m.shots[1].status).toBe("changed");
  });
  it("treats a repeated screen and column as a retake, and repeated column names as one", async () => {
    const { screenMatrix } = await import("../core/media");
    const m = screenMatrix(
      [
        { screen: "Home", column: "iPhone", src: "old.png" },
        { screen: "Home", column: "iPhone", src: "new.png" },
      ],
      ["iPhone", "iPhone"],
    );
    expect(m.shots.map((s) => s.src)).toEqual(["new.png"]);
    expect(m.columns).toEqual(["iPhone"]);
    expect(m.missing).toBe(0);
  });
});
