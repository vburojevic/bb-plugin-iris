import { describe, expect, it } from "vitest";
import { filterDecisions, markdownRows, normalizeDecisions } from "../core/decisions";
import { fontStack, readTheme, safeCss, themeStyle } from "../core/themepreview";

describe("DecisionLog", () => {
  it("reads rows with any common column names, newest first", () => {
    const m = normalizeDecisions([
      { Topic: "Storage", Decision: "SQLite on device", "Decided by": "Maya", Rationale: "Offline first", Date: "2026-10-02" },
      { area: "Auth", choice: "Passkeys only", owner: "Vedran", why: "No passwords to leak", when: "2026-11-01" },
      { topic: "Storage", decision: "Postgres", by: "Maya", status: "superseded", date: "2026-09-12" },
      { decision: "No analytics SDKs" },
    ]);
    expect(m.rows.map((r) => [r.decision, r.by, r.status])).toEqual([
      ["Passkeys only", "Vedran", "active"],
      ["SQLite on device", "Maya", "active"],
      ["Postgres", "Maya", "superseded"],
      ["No analytics SDKs", undefined, "active"],
    ]);
    expect(m.rows[1].why).toBe("Offline first");
    expect(m.topics).toEqual([
      { name: "Storage", count: 2 },
      { name: "Auth", count: 1 },
    ]);
  });

  it("reads the Markdown table agents keep, struck rows as superseded", () => {
    const md = `# Decisions\n\n| Date | Topic | Decision | Who | Why |\n|------|:-----:|----------|-----|-----|\n| 2026-11-03 | API | **REST, not GraphQL** | Kenji | Fewer moving parts |\n| 2026-10-20 | API | ~~GraphQL~~ | Kenji | |\n`;
    expect(markdownRows(md)).toHaveLength(2);
    const m = normalizeDecisions(md);
    expect(m.rows.map((r) => [r.decision, r.status])).toEqual([
      ["REST, not GraphQL", "active"],
      ["GraphQL", "superseded"],
    ]);
    expect(normalizeDecisions("no table here").problems[0]).toMatch(/no Markdown table/);
  });

  it("filters by topic and every word", () => {
    const m = normalizeDecisions([{ topic: "Auth", decision: "Passkeys only", why: "No passwords" }, { topic: "Storage", decision: "SQLite", why: "Offline" }]);
    expect(filterDecisions(m.rows, "pass words", null)).toHaveLength(1);
    expect(filterDecisions(m.rows, "", "Storage").map((r) => r.decision)).toEqual(["SQLite"]);
  });
});

describe("ThemePreview", () => {
  it("maps names to tokens and falls back to the bb theme", () => {
    const m = readTheme({ brand: "#4F46E5", "--radius": 12, fontFamily: "Inter Tight" });
    expect(m.values.primary).toMatchObject({ value: "#4F46E5", given: true });
    expect(m.values.radius.value).toBe("12px");
    expect(m.values.font.value).toBe('"Inter Tight", system-ui, sans-serif');
    expect(m.values.background).toMatchObject({ value: "var(--background)", given: false });
    expect(m.problems).toEqual([]);
  });

  it("refuses values that could leave the declaration or fetch", () => {
    for (const bad of ["red; background: blue", "url(https://x.test/a.png)", "red} body{color:red", "image-set('a.png' 1x)", "calc(1px", "\\72 ed"]) expect(safeCss(bad), bad).toBe(false);
    for (const ok of ["#fff", "oklch(0.7 0.15 250)", "color-mix(in oklab, #fff 20%, transparent)", "12px", '"SF Pro", system-ui']) expect(safeCss(ok), ok).toBe(true);
    const m = readTheme({ primary: "url(x)", nope: "1" });
    expect(m.values.primary.given).toBe(false);
    expect(m.problems).toHaveLength(2);
  });

  it("writes prefixed custom properties with an ink for the primary", () => {
    const style = themeStyle(readTheme({ primary: "#111111" }), () => "#ffffff");
    expect(style["--tp-primary"]).toBe("#111111");
    expect(style["--tp-primary-foreground"]).toBe("#ffffff");
    expect(style["--tp-accent"]).toBe("var(--tp-primary)");
    expect(style["--tp-muted-foreground"]).toBe("var(--muted-foreground)");
    expect(fontStack("ui-rounded")).toBe("ui-rounded");
  });
});
