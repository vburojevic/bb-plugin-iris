import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { findComponent } from "../core/catalog";
import {
  type GridItem,
  type PairDiff,
  catchUp,
  filterItems,
  folderPair,
  gridCounts,
  matchFolders,
  normalizePairs,
  normalizeVideos,
  offsetText,
  pairStatus,
  readFilter,
  readSort,
  shareText,
  sortItems,
  sourceName,
  timeline,
  videoTime,
} from "../core/compare";
import { referenceSections } from "../core/prompt";

const ok = (changed: number, total = 10_000, sizesDiffer = false): PairDiff => ({ status: "ok", changed, total, sizesDiffer, bounds: null });

describe("CompareGrid pairs", () => {
  it("reads pairs in every common shape and names them by file", () => {
    const { pairs, problems } = normalizePairs([
      { ref: "shots/main/home.png", cand: "shots/branch/home.png" },
      { before: "a/settings.png", after: "b/settings.png", label: "Settings" },
      ["x/profile.png", "y/profile.png"],
      { reference: { src: "r/billing.png" }, candidate: null },
      { cand: "https://example.com/img/share.png?v=2" },
      {},
    ]);
    expect(pairs.map((p) => [p.label, p.ref, p.cand])).toEqual([
      ["home.png", "shots/main/home.png", "shots/branch/home.png"],
      ["Settings", "a/settings.png", "b/settings.png"],
      ["profile.png", "x/profile.png", "y/profile.png"],
      ["billing.png", "r/billing.png", null],
      ["share.png", null, "https://example.com/img/share.png?v=2"],
    ]);
    expect(problems).toEqual(["pair 6 has neither a ref nor a cand"]);
    expect(normalizePairs("nope").problems).toEqual(["pairs must be a list"]);
  });

  it("keeps keys unique when names repeat", () => {
    const { pairs } = normalizePairs([
      ["a/home.png", "b/home.png"],
      ["c/home.png", "d/home.png"],
    ]);
    expect(pairs.map((p) => [p.key, p.label])).toEqual([
      ["home.png", "home.png"],
      ["home.png#2", "home.png (2)"],
    ]);
  });

  it("names data images and odd paths", () => {
    expect(sourceName("data:image/png;base64,AAAA")).toBe("image");
    expect(sourceName("$BB_THREAD_STORAGE/shots/a%20b.png")).toBe("a b.png");
    expect(sourceName("C:\\shots\\x.png")).toBe("x.png");
  });

  it("matches two folders by path, case aside, images only, in natural order", () => {
    const m = matchFolders(["home.png", "Settings.png", "step-10.png", "step-2.png", "notes.txt", "old/only.png"], ["home.png", "settings.png", "step-2.png", "step-10.png", "new.png"]);
    expect(m.map((x) => [x.key, x.ref, x.cand])).toEqual([
      ["home.png", "home.png", "home.png"],
      ["new.png", null, "new.png"],
      ["old/only.png", "old/only.png", null],
      ["Settings.png", "Settings.png", "settings.png"],
      ["step-2.png", "step-2.png", "step-2.png"],
      ["step-10.png", "step-10.png", "step-10.png"],
    ]);
    expect(folderPair({ before: "a", after: "b" })).toEqual({ ref: "a", cand: "b" });
    expect(folderPair({ ref: "a" })).toBeNull();
  });

  it("gives each pair a status; a size change counts as changed", () => {
    const both = { ref: "a.png", cand: "b.png" };
    expect(pairStatus(both, undefined)).toBe("pending");
    expect(pairStatus(both, ok(0))).toBe("same");
    expect(pairStatus(both, ok(12))).toBe("changed");
    expect(pairStatus(both, ok(0, 100, true))).toBe("changed");
    expect(pairStatus(both, { status: "error", error: "x" })).toBe("error");
    expect(pairStatus({ ref: "a.png", cand: null }, undefined)).toBe("missing");
    expect(pairStatus({ ref: null, cand: "b.png" }, ok(0))).toBe("missing");
  });

  it("sorts most changed first, then missing, failed, running and same; filters and counts", () => {
    const item = (label: string, index: number, status: GridItem["status"], diff?: PairDiff): GridItem => ({ pair: { key: label, label, ref: "r", cand: "c" }, status, diff, index });
    const items = [
      item("a", 0, "same", ok(0)),
      item("b", 1, "changed", ok(10)),
      item("c", 2, "missing"),
      item("d", 3, "changed", ok(900)),
      item("e", 4, "pending"),
      item("f", 5, "error", { status: "error", error: "x" }),
    ];
    expect(sortItems(items, "change").map((i) => i.pair.label)).toEqual(["d", "b", "c", "f", "e", "a"]);
    expect(sortItems(items, "name").map((i) => i.pair.label)).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(sortItems([...items].reverse(), "order").map((i) => i.index)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(filterItems(items, "changed").map((i) => i.pair.label)).toEqual(["b", "d"]);
    expect(gridCounts(items)).toEqual({ all: 6, changed: 2, missing: 1, same: 1, pending: 1, error: 1 });
    expect([readSort("name"), readSort("bogus"), readFilter("same"), readFilter(3)]).toEqual(["name", "change", "same", "all"]);
  });

  it("words the share of changed pixels as Compare does", () => {
    expect([shareText(0, 100), shareText(1, 1_000_000), shareText(42, 10_000), shareText(250, 1000)]).toEqual(["0%", "under 0.01%", "0.42%", "25.0%"]);
  });
});

describe("VideoCompare timing", () => {
  it("takes two videos, reference first, with default labels", () => {
    expect(normalizeVideos(["a.mp4", { src: "b.mp4", label: "After" }, "c.mp4"])).toEqual([
      { src: "a.mp4", label: "Reference" },
      { src: "b.mp4", label: "After" },
    ]);
    expect(normalizeVideos([{ label: "x" }])).toEqual([]);
  });

  it("spans both videos on one timeline, whatever the offset", () => {
    expect(timeline(0, 10, 8)).toEqual({ lo: 0, hi: 10 });
    // The second video's moments come 2 s later: its first 2 s play before the first video starts.
    expect(timeline(2, 10, 12)).toEqual({ lo: -2, hi: 10 });
    // They come 3 s earlier: the second video starts 3 s in and runs past the first.
    expect(timeline(-3, 10, 10)).toEqual({ lo: 0, hi: 13 });
    expect(timeline(1, 0, 5)).toEqual({ lo: -1, hi: 4 });
    expect(timeline(1, 6, 0)).toEqual({ lo: 0, hi: 6 });
  });

  it("puts each video at its own time, clamped, and says when it is outside", () => {
    expect(videoTime(4, 0.5, 10)).toEqual({ time: 4.5, inside: true, before: false });
    expect(videoTime(-1, 0, 10)).toEqual({ time: 0, inside: false, before: true });
    expect(videoTime(11, -0.5, 10)).toEqual({ time: 10, inside: false, before: false });
  });

  it("catches a follower up by rate for small drift and by a seek for large", () => {
    expect(catchUp(5.01, 5, 1)).toEqual({ seek: false, rate: 1 });
    const behind = catchUp(4.9, 5, 1);
    expect(behind.seek).toBe(false);
    expect(behind.rate).toBeGreaterThan(1);
    expect(behind.rate).toBeLessThanOrEqual(1.08);
    expect(catchUp(5.1, 5, 2).rate).toBeLessThan(2);
    expect(catchUp(6, 5, 1)).toEqual({ seek: true, rate: 1 });
  });

  it("reads offsets with a sign", () => {
    expect([offsetText(0), offsetText(0.5), offsetText(-1.25), offsetText(1 / 30)]).toEqual(["0 s", "+0.50 s", "-1.25 s", "+0.03 s"]);
  });
});

describe("CompareGrid and VideoCompare in the catalog", () => {
  it("each example checks clean and the aliases resolve", () => {
    for (const name of ["CompareGrid", "VideoCompare"]) {
      const c = findComponent(name);
      expect(c?.name).toBe(name);
      expect(check(c!.example).ok, name).toBe(true);
    }
    expect(findComponent("VisualRegression")?.name).toBe("CompareGrid");
    expect(findComponent("VideoDiff")?.name).toBe("VideoCompare");
  });
  it("a pairs grid checks clean too", () => {
    expect(check(`<CompareGrid sort="name" pairs={[{ ref: "a/home.png", cand: "b/home.png" }, ["a/x.png", "b/x.png", "X"]]} />`).ok).toBe(true);
  });
  it("keeps every reference section under bb's cap", () => {
    for (const s of referenceSections()) expect(s.text.length).toBeLessThanOrEqual(4096);
  });
});
