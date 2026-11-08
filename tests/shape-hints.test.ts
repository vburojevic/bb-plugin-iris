import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { shapeHint } from "../core/shape-hints";

const warnings = (src: string) => check(src).issues.filter((i) => i.severity === "warning").map((i) => i.message);

describe("shape hints", () => {
  it("point a before and after table at Delta, with its own column names", () => {
    const w = warnings('<Table rows={[{ case: "cold start", before: 1840, after: 1210 }, { case: "size", before: 48, after: 51 }]} />');
    expect(w.join("\n")).toContain("<Delta rows={rows.map((r) => ({ label: r.case, before: r.before, after: r.after }))}");
    expect(check('<Table rows={[{ case: "a", before: 1, after: 2 }]} />').ok).toBe(true);
  });
  it("point screenshot pairs at CompareGrid", () => {
    expect(shapeHint("Table", { rows: [{ screen: "Home", before: "b/home.png", after: "a/home.png" }] })).toContain("<CompareGrid pairs={rows.map((r) => ({ ref: r.before, cand: r.after, label: r.screen }))}");
  });
  it("point check, result and basis at Acceptance", () => {
    expect(shapeHint("Table", { rows: [{ check: "Toggle in settings", result: "passed", basis: "shots/toggle.png" }] })).toContain("<Acceptance criteria={rows.map((r) => ({ name: r.check, status: r.result, note: r.basis }))}");
  });
  it("point severity, where and what at Findings", () => {
    expect(shapeHint("Table", { columns: ["severity", "where", "what"], rows: [] })).toContain("<Findings items={rows.map((r) => ({ severity: r.severity, title: r.what, file: r.where }))}");
  });
  it("point color tables at Swatches, and palette options at Variants", () => {
    expect(shapeHint("Table", { rows: [{ name: "Brand", hex: "#4860E2" }] })).toContain("<Swatches");
    expect(shapeHint("Table", { rows: [{ palette: "Ember", background: "#17110E", accent: "#FF7A3D" }, { palette: "Slate", background: "#0F1513", accent: "#2BB3A3" }] })).toContain("<Variants");
  });
  it("leave ordinary tables alone", () => {
    expect(shapeHint("Table", { rows: [{ name: "auth", status: "done", owner: "Ana" }] })).toBeNull();
    expect(shapeHint("Table", { rows: [{ title: "Fix login", priority: "high", owner: "Ben" }] })).toBeNull();
    expect(shapeHint("Table", { rows: [{ route: "/a", from: "/old", to: "/new" }] })).toBeNull();
    expect(shapeHint("Table", { rows: [{ test: "parse", status: "failed" }] })).toBeNull();
  });
  it("point device and theme captions at Screens, and before and after shots at Compare", () => {
    const shots = ["Home, iPhone light", "Home, iPhone dark", "Settings, iPad light"].map((caption, k) => ({ src: `s/${k}.png`, caption }));
    expect(shapeHint("Gallery", { images: shots })).toContain("<Screens");
    expect(shapeHint("Gallery", { images: ["$BB_THREAD_STORAGE/before.png", "$BB_THREAD_STORAGE/after.png"] })).toContain("<Compare");
    expect(shapeHint("Gallery", { images: [{ src: "a.png", caption: "Mood one" }, { src: "b.png", caption: "Mood two" }] })).toBeNull();
  });
});

describe("shape hints stay quiet on look-alikes", () => {
  it("leave trackers, claims with a plain status, and one-word galleries alone", () => {
    expect(shapeHint("Table", { rows: [{ issue: "Login loop", priority: "high", owner: "Ana" }] })).toBeNull();
    expect(shapeHint("Table", { rows: [{ requirement: "SSO", state: "planned" }] })).toBeNull();
    expect(shapeHint("Table", { rows: [{ requirement: "SSO", status: "passed" }, { requirement: "Audit log", status: "failed" }] })).toContain("<Acceptance");
    expect(shapeHint("Table", { rows: [{ priority: "P1", file: "a.ts:3", issue: "leak" }] })).toContain("<Findings");
    expect(shapeHint("Gallery", { images: [{ src: "a.png", caption: "Dark roast" }, { src: "b.png", caption: "Dark chocolate" }] })).toBeNull();
    expect(shapeHint("Gallery", { images: [{ src: "a.png", caption: "Candidate 1" }, { src: "b.png", caption: "Candidate 2" }] })).toBeNull();
  });
});
