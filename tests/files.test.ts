import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { assetKind, buildTree, changesUnder, filterTree, iconSetLabels, nextZoom, onlyChanged, openPaths, parsePages, svgSize, visibleRows } from "../core/files";
import { collectionStart, fontSignature, hexCode, mapTables, readFont, sfntTables, visibleCodepoint, woff2Directory, woffDirectory } from "../core/font";
import {
  activeIndex,
  chapterSpans,
  computePeaks,
  formatTime,
  mediaName,
  normalizeChapters,
  normalizeNotes,
  normalizeTranscript,
  parseCaptions,
  parseTime,
  snapSpeed,
  stepFrame,
} from "../core/players";
import { findComponent } from "../core/catalog";
import { referenceSections } from "../core/prompt";

describe("player times", () => {
  it("reads seconds, clocks, SRT commas and unit strings", () => {
    expect([parseTime(83), parseTime("83"), parseTime("1:23"), parseTime("1:23.5"), parseTime("01:02:03"), parseTime("00:01:23,500"), parseTime("1m 23s"), parseTime("2h"), parseTime("x"), parseTime(-1)]).toEqual([
      83, 83, 83, 83.5, 3723, 83.5, 83, 7200, null, null,
    ]);
  });
  it("formats times, with frames or tenths", () => {
    expect([formatTime(0), formatTime(83.4), formatTime(3723), formatTime(4.5, { fps: 24 }), formatTime(4.55, { tenths: true })]).toEqual(["0:00", "1:23", "1:02:03", "0:04:12", "0:04.5"]);
  });
  it("steps one frame on frame boundaries without drifting", () => {
    let t = 1;
    for (let k = 0; k < 24; k++) t = stepFrame(t, 24, 1, 10);
    expect(Math.round(t * 24)).toBe(48);
    expect(stepFrame(0, 30, -1, 10)).toBeCloseTo(0.001, 5);
    expect(stepFrame(9.99, 30, 1, 10)).toBe(10);
  });
  it("snaps speeds to the offered steps", () => {
    expect([snapSpeed(1.3), snapSpeed("2x"), snapSpeed(9), snapSpeed(0), snapSpeed("fast")]).toEqual([1.25, 2, 2, 1, 1]);
  });
});

describe("chapters, notes and transcripts", () => {
  it("sorts chapters and reports the unreadable ones", () => {
    const c = normalizeChapters([{ at: "0:08", title: "C" }, [0, "A"], { title: "lost" }, { at: 4 }]);
    expect(c.items).toEqual([
      { at: 0, title: "A" },
      { at: 4, title: "Chapter 4" },
      { at: 8, title: "C" },
    ]);
    expect(c.problems).toEqual(["chapter 3 has no readable at"]);
    expect(chapterSpans(c.items, 12)).toEqual([
      { from: 0, to: 1 / 3, title: "A" },
      { from: 1 / 3, to: 2 / 3, title: "Chapter 4" },
      { from: 2 / 3, to: 1, title: "C" },
    ]);
  });
  it("needs text on a note", () => {
    const n = normalizeNotes([{ at: 2, text: "Logo late" }, { at: 3 }, { at: "0:06", text: "Keyboard", tone: "bad" }]);
    expect(n.items.map((x) => [x.at, x.text, x.tone])).toEqual([
      [2, "Logo late", undefined],
      [6, "Keyboard", "bad"],
    ]);
    expect(n.problems).toEqual(["note 2 has no text"]);
  });
  it("finds the line playing now, honoring each line's end", () => {
    const lines = [{ at: 0, end: 2 }, { at: 3 }, { at: 6.5 }];
    expect([activeIndex(lines, 1), activeIndex(lines, 2.5), activeIndex(lines, 3), activeIndex(lines, 100), activeIndex([], 1)]).toEqual([0, -1, 1, 2, -1]);
  });
  it("reads WebVTT with voices and SRT with names", () => {
    const vtt = `WEBVTT\n\n00:00.000 --> 00:03.100\n<v Ana>Sync shipped <b>last night</b>.\n\nnote\n00:00:03.200 --> 00:00:06.000\nBen: Two crash reports.`;
    expect(parseCaptions(vtt).items).toEqual([
      { at: 0, end: 3.1, text: "Sync shipped last night.", speaker: "Ana" },
      { at: 3.2, end: 6, text: "Two crash reports.", speaker: "Ben" },
    ]);
    const srt = "1\r\n00:00:01,000 --> 00:00:02,500\r\nHello there\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nSecond line\r\nwraps";
    expect(normalizeTranscript(srt).items.map((l) => [l.at, l.end, l.text])).toEqual([
      [1, 2.5, "Hello there"],
      [3, 4, "Second line wraps"],
    ]);
    expect(normalizeTranscript("no cues here").problems).toHaveLength(1);
    expect(normalizeTranscript([[1, "a"], { at: 0, text: "b", speaker: "S", end: 0.5 }]).items.map((l) => [l.at, l.text, l.end])).toEqual([
      [0, "b", 0.5],
      [1, "a", null],
    ]);
  });
  it("computes peaks across channels, loudest bar at 1", () => {
    const left = Float32Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0.1 : 0.5) * Math.sin(i));
    const right = Float32Array.from({ length: 1000 }, (_, i) => (i > 900 ? -0.8 : 0));
    const peaks = computePeaks([left, right], 10);
    expect(peaks).toHaveLength(10);
    expect(Math.max(...peaks)).toBe(1);
    expect(peaks[0]).toBeLessThan(peaks[6]);
    expect(computePeaks([new Float32Array(100)], 4)).toEqual([0, 0, 0, 0]);
    expect(computePeaks([], 3)).toEqual([0, 0, 0]);
  });
  it("names media from paths and URLs", () => {
    expect([mediaName("$BB_THREAD_STORAGE/a/demo%20cut.mp4"), mediaName("https://x.test/v/clip.webm?t=3")]).toEqual(["demo cut.mp4", "clip.webm"]);
  });
});

describe("FileTree", () => {
  const sizes = new Map([
    ["src/a.ts", 100],
    ["src/lib/b.ts", 300],
    ["README.md", 50],
  ]);
  it("builds folders first with summed sizes and counts unknown sizes", () => {
    const t = buildTree(["README.md", "src/lib/b.ts", "src/a.ts", "src/lib/c.ts"], sizes, new Map());
    expect(t.children.map((c) => c.name)).toEqual(["src", "README.md"]);
    const src = t.children[0];
    expect(src.kind === "dir" && [src.size, src.files, src.unknown]).toEqual([400, 3, 1]);
    expect(t.size).toBe(450);
    expect(buildTree(["a", "b"], new Map([["a", 1], ["b", 9]]), new Map(), "size").children.map((c) => c.name)).toEqual(["b", "a"]);
  });
  it("marks changes under the listed folder and shows deleted files as ghosts", () => {
    const changed = [
      { path: "core/a.ts", kind: "modified" as const, untracked: false },
      { path: "core/gone.ts", kind: "deleted" as const, untracked: false },
      { path: "core/new.ts", kind: "added" as const, untracked: true },
      { path: "ui/x.tsx", kind: "modified" as const, untracked: false },
    ];
    const m = changesUnder(changed, "core");
    expect([...m]).toEqual([
      ["a.ts", "M"],
      ["gone.ts", "D"],
      ["new.ts", "U"],
    ]);
    expect(changesUnder(changed, "").get("ui/x.tsx")).toBe("M");
    const t = buildTree(["a.ts", "b.ts", "new.ts"], new Map(), m);
    const gone = t.children.find((c) => c.name === "gone.ts");
    expect(gone?.kind === "file" && [gone.gone, gone.marker]).toEqual([true, "D"]);
    expect(t.changed).toBe(3);
    expect(onlyChanged(t).children.map((c) => c.name)).toEqual(["a.ts", "gone.ts", "new.ts"]);
  });
  it("filters by path, opens levels and lists visible rows", () => {
    const t = buildTree(["src/lib/b.ts", "src/a.ts", "docs/x.md"], sizes, new Map());
    expect(visibleRows(filterTree(t, "LIB"), new Set(), true).map((r) => r.node.path)).toEqual(["src", "src/lib", "src/lib/b.ts"]);
    expect([...openPaths(t, 1)]).toEqual(["docs", "src"]);
    expect(visibleRows(t, new Set(["src"])).map((r) => [r.node.path, r.depth])).toEqual([
      ["docs", 0],
      ["src", 0],
      ["src/lib", 1],
      ["src/a.ts", 1],
    ]);
  });
});

describe("AssetGallery", () => {
  it("sorts images, SVGs and app icons apart", () => {
    expect(
      ["App/Assets.xcassets/AppIcon.appiconset/1024.png", "public/favicon.ico", "res/mipmap-hdpi/ic_launcher.png", "img/hero.webp", "icons/sync.svg", "Icon.icon/Assets/glyph.svg", "notes.md"].map(assetKind),
    ).toEqual(["icon", "icon", "icon", "image", "svg", "icon", null]);
  });
  it("labels icon set slots from Contents.json", () => {
    const labels = iconSetLabels({
      images: [
        { filename: "a.png", idiom: "universal", platform: "ios", size: "1024x1024" },
        { filename: "b.png", idiom: "iphone", size: "60x60", scale: "3x" },
        { filename: "c.png", idiom: "universal", size: "1024x1024", appearances: [{ appearance: "luminosity", value: "dark" }] },
        { idiom: "mac", size: "16x16" },
      ],
    });
    expect([...labels]).toEqual([
      ["a.png", "iOS 1024pt"],
      ["b.png", "iPhone 60pt @3x"],
      ["c.png", "iOS 1024pt dark"],
    ]);
    expect(iconSetLabels(null).size).toBe(0);
  });
  it("reads an SVG's size from width and height or its viewBox", () => {
    expect(svgSize(`<svg xmlns="x" width="24px" height="24">`)).toEqual({ width: 24, height: 24 });
    expect(svgSize(`<?xml?><svg viewBox="0 0 120 60">`)).toEqual({ width: 120, height: 60 });
    expect(svgSize(`<svg width="200" viewBox="0 0 100 50">`)).toEqual({ width: 200, height: 100 });
    expect(svgSize(`<svg width="100%" height="100%">`)).toBeNull();
    expect(svgSize("not svg")).toBeNull();
  });
});

describe("PdfViewer", () => {
  it("reads page lists", () => {
    expect([parsePages("1-3, 5", 10), parsePages("8-", 10), parsePages([4, 2, 2, 99], 10), parsePages(3, 2), parsePages(null, 3), parsePages("x", 3)]).toEqual([[1, 2, 3, 5], [8, 9, 10], [2, 4], [], [1, 2, 3], []]);
  });
  it("zooms in steps and stops at the ends", () => {
    expect([nextZoom(1, 1), nextZoom(1, -1), nextZoom(3, 1), nextZoom(0.5, -1), nextZoom(1.1, 1)]).toEqual([1.25, 0.75, 3, 0.5, 1.25]);
  });
});

describe("FontPreview", () => {
  const ttf = new Uint8Array(readFileSync(new URL("../assets/samples/sample-font.ttf", import.meta.url)));
  it("reads a TrueType font's names, metrics and cmap", () => {
    expect(fontSignature(ttf)).toBe("sfnt");
    const info = readFont(sfntTables(ttf), "TrueType");
    expect(info.family).toBe("KaTeX_Main");
    expect(info.style).toBe("Regular");
    expect(info.glyphs).toBeGreaterThan(100);
    expect(info.unitsPerEm).toBe(1000);
    expect(info.codepoints).toContain("A".codePointAt(0));
    expect(info.codepoints).toEqual([...(info.codepoints ?? [])].sort((a, b) => a - b));
    expect(info.axes).toEqual([]);
  });
  it("reads the same tables back out of a WOFF wrapper", () => {
    // Wrap the TTF's tables the way WOFF 1 does, each zlib-compressed.
    const v = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
    const count = v.getUint16(4);
    const tables = Array.from({ length: count }, (_, i) => {
      const rec = 12 + i * 16;
      const tag = String.fromCharCode(...ttf.subarray(rec, rec + 4));
      const data = ttf.subarray(v.getUint32(rec + 8), v.getUint32(rec + 8) + v.getUint32(rec + 12));
      return { tag, data, comp: new Uint8Array(deflateSync(data)) };
    });
    let size = 44 + count * 20;
    const offsets = tables.map((t) => {
      const o = size;
      size += (t.comp.length + 3) & ~3;
      return o;
    });
    const woff = new Uint8Array(size);
    const w = new DataView(woff.buffer);
    woff.set([0x77, 0x4f, 0x46, 0x46]);
    w.setUint16(12, count);
    tables.forEach((t, i) => {
      const rec = 44 + i * 20;
      woff.set([...t.tag].map((c) => c.charCodeAt(0)), rec);
      w.setUint32(rec + 4, offsets[i]);
      w.setUint32(rec + 8, t.comp.length);
      w.setUint32(rec + 12, t.data.length);
      woff.set(t.comp, offsets[i]);
    });
    expect(fontSignature(woff)).toBe("woff");
    const dir = woffDirectory(woff);
    expect(dir.map((t) => t.tag)).toEqual(tables.map((t) => t.tag));
    const map = new Map(tables.map((t) => [t.tag, t.data] as [string, Uint8Array]));
    expect(readFont(mapTables(map), "WOFF").family).toBe("KaTeX_Main");
  });
  it("reads a WOFF2 directory with known tags, custom tags and transforms", () => {
    const b = new Uint8Array(80);
    const v = new DataView(b.buffer);
    b.set([0x77, 0x4f, 0x46, 0x32]);
    v.setUint16(12, 3);
    v.setUint32(20, 999);
    // cmap (flag 0) length 300; glyf (flag 10, version 0: transformed) orig 5000 transformed 4000; custom tag "ABCD" (63) length 2.
    b.set([0, 0x82, 0x2c, 10, 0xa7, 0x08, 0x9f, 0x20, 63, 0x41, 0x42, 0x43, 0x44, 2], 48);
    const dir = woff2Directory(b);
    expect(dir?.tables).toEqual([
      { tag: "cmap", offset: 0, length: 300, transformed: false },
      { tag: "glyf", offset: 300, length: 4000, transformed: true },
      { tag: "ABCD", offset: 4300, length: 2, transformed: false },
    ]);
    expect(dir?.dataOffset).toBe(62);
    expect(dir?.compressedLength).toBe(999);
  });
  it("finds a collection's first font and names code points", () => {
    const ttc = new Uint8Array(16);
    new DataView(ttc.buffer).setUint32(12, 1234);
    ttc.set([0x74, 0x74, 0x63, 0x66]);
    expect([fontSignature(ttc), collectionStart(ttc)]).toEqual(["ttcf", 1234]);
    expect([hexCode(65), hexCode(0x1f600), visibleCodepoint(0x20), visibleCodepoint(0x41), visibleCodepoint(0xad)]).toEqual(["U+0041", "U+1F600", false, true, false]);
  });
});

describe("players and files in the catalog", () => {
  it("each example checks clean and FileTree is its own component now", () => {
    for (const name of ["VideoPlayer", "AudioPlayer", "FileTree", "AssetGallery", "PdfViewer", "FontPreview"]) {
      const c = findComponent(name);
      expect(c?.name).toBe(name);
      expect(check(c!.example).ok, name).toBe(true);
    }
    expect(findComponent("Video")?.name).toBe("VideoPlayer");
    expect(findComponent("Tree")?.aliases).not.toContain("FileTree");
  });
  it("keeps every reference section under bb's cap", () => {
    for (const s of referenceSections()) expect(s.text.length).toBeLessThanOrEqual(4096);
  });
});
