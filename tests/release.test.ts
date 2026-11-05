import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { SAMPLE_RELEASE, normalizeRelease, overallStatus, platformIcon, readStatus } from "../core/release";

describe("release dashboard data", () => {
  it("maps status words from CI and App Store Connect to tones", () => {
    expect(readStatus("passed")?.tone).toBe("good");
    expect(readStatus("WAITING_FOR_REVIEW")).toMatchObject({ tone: "warn", label: "Waiting for review" });
    expect(readStatus("in_progress")).toMatchObject({ tone: "info", running: true });
    expect(readStatus("failure")?.tone).toBe("bad");
    expect(readStatus("READY_FOR_SALE")?.tone).toBe("good");
    expect(readStatus("odd thing")).toMatchObject({ tone: "neutral", label: "Odd thing" });
    expect(readStatus(true)?.label).toBe("Passed");
  });
  it("reads lists, keyed objects and a single store object", () => {
    const { model, problems } = normalizeRelease({ version: "1.2", platforms: { ios: "passed", mac: { status: "building", build: "7" } }, store: { name: "TestFlight", state: "testing" }, blockers: ["Crash on launch"], timeline: [{ time: "10:00", title: "Tagged", status: "done" }] });
    expect(problems).toEqual([]);
    expect(model.platforms.map((p) => [p.name, p.status?.tone, p.build])).toEqual([["ios", "good", undefined], ["mac", "info", "7"]]);
    expect(model.store[0]).toMatchObject({ name: "TestFlight", status: { tone: "good" } });
    expect(model.blockers[0].title).toBe("Crash on launch");
    expect(overallStatus(model).tone).toBe("bad");
    expect(normalizeRelease({ platforms: "x" }).problems.join()).toMatch(/version/);
  });
  it("derives the overall state and platform icons", () => {
    const { model } = normalizeRelease({ ...SAMPLE_RELEASE, blockers: [] });
    expect(overallStatus(model)).toMatchObject({ tone: "info", running: true });
    expect(platformIcon("watchOS")).toBe("watch");
    expect(platformIcon("macOS")).toBe("monitor");
    expect(check(`<Release release={{ version: "1.0", platforms: [{ name: "iOS", status: "ready" }] }} />`).ok).toBe(true);
    expect(check(`<Release release={{ platforms: 3 }} />`).ok).toBe(false);
  });
});

describe("review fixes", () => {
  it("reads a GitHub check's conclusion before its status", () => {
    const { model } = normalizeRelease({ version: "1", checks: [{ name: "build", status: "completed", conclusion: "failure" }, { name: "lint", status: "completed", conclusion: "timed_out" }, { name: "e2e", status: "in_progress", conclusion: null }] });
    expect(model.checks.map((c) => c.status?.tone)).toEqual(["bad", "bad", "info"]);
    expect(overallStatus(model).tone).toBe("bad");
    expect(readStatus("PENDING_APPLE_RELEASE")?.tone).toBe("good");
    expect(readStatus("VALID")?.tone).toBe("good");
  });
});
