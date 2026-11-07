import { describe, expect, it } from "vitest";
import { environmentChangeMatters, projectChangeMatters, threadChangeMatters } from "../core/live-events";

describe("live card events", () => {
  it("follows the listed threads' visible changes, never their streaming output", () => {
    const watch = { threads: ["thr_a"] };
    expect(threadChangeMatters(watch, { id: "thr_a", changes: ["status-changed"] })).toBe(true);
    expect(threadChangeMatters(watch, { id: "thr_a", changes: ["title-changed"] })).toBe(true);
    expect(threadChangeMatters(watch, { id: "thr_a", changes: ["interactions-changed"] })).toBe(true);
    expect(threadChangeMatters(watch, { id: "thr_a", changes: ["events-appended"] })).toBe(false);
    expect(threadChangeMatters(watch, { id: "thr_a", changes: ["events-appended"], metadata: { backgroundActivityChanged: true } })).toBe(true);
    expect(threadChangeMatters(watch, { id: "thr_b", changes: ["status-changed"] })).toBe(false);
    expect(threadChangeMatters(watch, { changes: ["status-changed"] })).toBe(false);
  });

  it("hears a new or moved thread only when the card lists threads it doesn't know yet", () => {
    expect(threadChangeMatters({ newThreads: true }, { id: "thr_new", changes: ["thread-created"] })).toBe(true);
    expect(threadChangeMatters({ newThreads: true }, { id: "thr_new", changes: ["parent-changed"] })).toBe(true);
    expect(threadChangeMatters({ newThreads: true }, { id: "thr_new", changes: ["status-changed"] })).toBe(false);
    expect(threadChangeMatters({ threads: ["thr_a"] }, { id: "thr_new", changes: ["thread-created"] })).toBe(false);
    expect(projectChangeMatters({ newThreads: true }, { changes: ["threads-changed"] })).toBe(true);
    expect(projectChangeMatters({ newThreads: true }, { changes: ["project-updated"] })).toBe(false);
    expect(projectChangeMatters({}, { changes: ["threads-changed"] })).toBe(false);
  });

  it("follows the listed environments' checkout and state", () => {
    const watch = { environments: ["env_a"] };
    for (const change of ["work-status-changed", "git-refs-changed", "status-changed", "metadata-changed"]) {
      expect(environmentChangeMatters(watch, { id: "env_a", changes: [change] })).toBe(true);
    }
    expect(environmentChangeMatters(watch, { id: "env_a", changes: ["git-branches-changed"] })).toBe(false);
    expect(environmentChangeMatters(watch, { id: "env_b", changes: ["work-status-changed"] })).toBe(false);
    expect(environmentChangeMatters({ newThreads: true }, { id: "env_new", changes: ["environment-created"] })).toBe(true);
    expect(environmentChangeMatters({}, { id: "env_a", changes: ["work-status-changed"] })).toBe(false);
  });
});
