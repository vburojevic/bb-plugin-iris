import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupRules, readAudit, wcagFromTags } from "../core/a11y";
import { findRegion, readGeo, stepBounds, stepOf } from "../core/geo";
import { applyMemory, arrangement, memoryOf, moveCard, normalizeKanban, nudge } from "../core/kanban";
import { WORLD_REGIONS, US_REGIONS } from "../core/geo-regions";
import { check } from "../core/check";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("accessibility audit", () => {
  // A real axe-core 4.14 run on a sample checkout page (node boxes added by the runner).
  const axe = fixture("axe-checkout.json");

  it("reads an axe-core result into rules by impact", () => {
    const a = readAudit(axe);
    expect(a.problems).toEqual([]);
    expect(a.engine).toBe("axe-core 4.14.0");
    expect(a.url).toBe("https://shop.example.com/checkout");
    expect(a.counts).toEqual({
      critical: { rules: 2, nodes: 2 },
      serious: { rules: 3, nodes: 5 },
      moderate: { rules: 1, nodes: 1 },
      minor: { rules: 1, nodes: 1 },
    });
    expect(a.review).toBe(1);
    expect(a.passed).toBe(axe.passes.length);
    expect(a.rules[0].impact).toBe("critical");
    const contrast = a.rules.find((r) => r.id === "color-contrast" && r.kind === "violation")!;
    expect(contrast.wcag).toEqual(["1.4.3"]);
    expect(contrast.level).toBe("AA");
    expect(contrast.helpUrl).toMatch(/^https:\/\/dequeuniversity\.com\/rules\/axe\/4\.14\/color-contrast/);
    expect(contrast.nodes.map((n) => n.target)).toEqual([".hint", ".pay", "footer"]);
    expect(contrast.nodes[0].summary).toMatch(/insufficient color contrast of 1\.97/);
    expect(contrast.nodes[1].box).toEqual({ x: 20, y: 364, w: 113, h: 42 });
  });

  it("reads the array @axe-core/cli writes, one result per page", () => {
    const a = readAudit([axe, { ...axe, url: "https://shop.example.com/cart" }]);
    expect(a.url).toBe("2 pages");
    // A rule failing on both pages is one rule with both pages' nodes.
    expect(a.counts.critical).toEqual({ rules: 2, nodes: 4 });
    expect(new Set(a.rules.map((r) => `${r.kind}:${r.id}`)).size).toBe(a.rules.length);
    expect(a.rules.find((r) => r.id === "image-alt")!.nodes.map((n) => n.label)).toEqual(["https://shop.example.com/checkout", "https://shop.example.com/cart"]);
  });

  it("reads a Lighthouse report with its score, links and screenshot boxes", () => {
    const a = readAudit(fixture("lighthouse-checkout.json"));
    expect(a.problems).toEqual([]);
    expect(a.engine).toBe("Lighthouse 12.6.0");
    expect(a.score).toBe(71);
    expect(a.passed).toBe(1);
    expect(a.rules).toHaveLength(7);
    expect(a.counts.serious).toEqual({ rules: 3, nodes: 5 });
    const alt = a.rules.find((r) => r.id === "image-alt")!;
    expect(alt.helpUrl).toBe("https://dequeuniversity.com/rules/axe/4.14/image-alt");
    expect(alt.description).not.toMatch(/Learn more/);
    expect(alt.nodes[0].box).toEqual({ x: 20, y: 16, w: 28, h: 28 });
    expect(a.screenshot).toMatchObject({ width: 640, height: 494 });
    // Also inside the {lhr} wrapper the Node API returns.
    expect(readAudit({ lhr: fixture("lighthouse-checkout.json") }).rules).toHaveLength(7);
  });

  it("explains a report it can't read", () => {
    expect(readAudit({ hello: 1 }).problems[0]).toMatch(/axe-core result/);
    expect(readAudit("nope").problems).toHaveLength(1);
    const perf = readAudit({ lighthouseVersion: "12.6.0", audits: { "is-on-https": { id: "is-on-https", score: 0, scoreDisplayMode: "binary" } }, categories: { performance: {} } });
    expect(perf.rules).toEqual([]);
    expect(perf.problems[0]).toMatch(/no accessibility category/);
  });

  it("reads WCAG criteria and levels from tags", () => {
    expect(wcagFromTags(["cat.color", "wcag2aa", "wcag143", "wcag1411"])).toEqual({ wcag: ["1.4.3", "1.4.11"], level: "AA", bestPractice: false });
    expect(wcagFromTags(["wcag2a", "wcag21aa", "wcag412"]).level).toBe("A");
    expect(wcagFromTags(["best-practice"])).toEqual({ wcag: [], level: null, bestPractice: true });
  });

  it("groups by impact or by WCAG criterion, best practices last", () => {
    const a = readAudit(axe);
    expect(groupRules(a.rules, "impact").map((g) => g.key)).toEqual(["critical", "serious", "moderate", "minor"]);
    const wcag = groupRules(a.rules, "wcag");
    expect(wcag.map((g) => g.key)).toEqual(["1.1.1", "1.4.3", "2.4.4", "3.1.1", "4.1.2", "~"]);
    expect(wcag[1].title).toBe("1.4.3 Contrast (Minimum)");
    expect(wcag.at(-1)!.title).toBe("Best practices");
  });
});

describe("kanban", () => {
  const items = [
    { title: "Parser", status: "Done", tag: "core" },
    { title: "Streaming", status: "Doing" },
    { id: "chrome", title: "Card chrome", status: "Todo" },
    { title: "Docs", status: "Todo" },
  ];
  const cols = ["Todo", "Doing", "Done"];

  it("gives cards ids and reports unknown statuses", () => {
    const { board, problems } = normalizeKanban([...items, { title: "Docs", status: "Todo" }, { title: "Lost", status: "Later" }], cols);
    expect(board.order).toEqual({ Todo: ["chrome", "Docs", "Docs 2"], Doing: ["Streaming"], Done: ["Parser"] });
    expect(problems).toEqual(['Card "Lost": status "Later" is not one of the columns (Todo, Doing, Done)']);
  });

  it("moves cards within and between columns", () => {
    const { board } = normalizeKanban(items, cols);
    expect(moveCard(board.order, "Docs", "Todo", 0).Todo).toEqual(["Docs", "chrome"]);
    const moved = moveCard(board.order, "chrome", "Done", 1);
    expect(moved).toEqual({ Todo: ["Docs"], Doing: ["Streaming"], Done: ["Parser", "chrome"] });
    expect(nudge(board.order, cols, "Docs", "right").Doing).toEqual(["Streaming", "Docs"]);
    expect(nudge(board.order, cols, "chrome", "down").Todo).toEqual(["Docs", "chrome"]);
    expect(nudge(board.order, cols, "chrome", "up")).toBe(board.order);
    expect(nudge(board.order, cols, "chrome", "left")).toBe(board.order);
  });

  it("keeps the person's moves, renames and new cards over the agent's board", () => {
    const { board: base } = normalizeKanban(items, cols);
    const edited = {
      ...base,
      order: { ...moveCard(base.order, "chrome", "Doing", 0), Done: ["Parser", "new-1"] },
      cards: { ...base.cards, Docs: { ...base.cards.Docs, title: "Write docs" }, "new-1": { id: "new-1", title: "Release notes", status: "Done", raw: {}, added: true } },
    };
    const memory = memoryOf(base, edited);
    expect(memory.titles).toEqual({ Docs: "Write docs" });
    expect(memory.added).toEqual([{ id: "new-1", title: "Release notes", status: "Done" }]);
    const again = applyMemory(normalizeKanban([...items, { title: "Tests", status: "Todo" }], cols).board, memory);
    expect(again.order).toEqual({ Todo: ["Docs", "Tests"], Doing: ["chrome", "Streaming"], Done: ["Parser", "new-1"] });
    const answer = arrangement(again);
    expect(answer.columns.Doing).toEqual(["chrome", "Streaming"]);
    expect(answer.items).toContainEqual({ id: "chrome", title: "Card chrome", status: "Doing" });
    expect(answer.items).toContainEqual({ title: "Write docs", status: "Todo", id: "Docs" });
    expect(answer.items).toContainEqual({ id: "new-1", title: "Release notes", status: "Done", added: true });
    expect(answer.items.find((i) => i.id === "Parser")).toEqual({ title: "Parser", status: "Done", tag: "core", id: "Parser" });
  });
});

describe("geo heatmap", () => {
  it("matches ISO codes, numeric codes and names in any case or accent", () => {
    for (const key of ["DE", "deu", "276", "Germany", "germany"]) expect(findRegion("world", key)?.id, key).toBe("DE");
    expect(findRegion("world", "Côte d'Ivoire")?.id).toBe("CI");
    expect(findRegion("world", "Ivory Coast")?.id).toBe("CI");
    expect(findRegion("world", "USA")?.name).toBe("United States");
    expect(findRegion("world", "UK")?.id).toBe("GB");
    expect(findRegion("world", "Singapore")).toEqual({ id: "SG", name: "Singapore", drawn: false });
    expect(findRegion("us", "CA")?.name).toBe("California");
    expect(findRegion("us", "06")?.id).toBe("CA");
    expect(findRegion("us", "new york")?.id).toBe("NY");
    expect(findRegion("us", "Washington, D.C.")?.id).toBe("DC");
    expect(findRegion("world", "Atlantis")).toBeNull();
  });

  it("ships every region with a code", () => {
    expect(WORLD_REGIONS.length).toBeGreaterThan(170);
    // The 50 states and DC (Albers USA draws no territories).
    expect(US_REGIONS).toHaveLength(51);
    const ids = WORLD_REGIONS.map((r) => r[0]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("reads rows or a {region: value} object, adding repeats and naming unknown keys", () => {
    const g = readGeo([{ country: "DE", users: 10 }, { country: "Germany", users: 5 }, { country: "FR", users: 20 }, { country: "Narnia", users: 3 }]);
    expect(g.keyField).toBe("country");
    expect(g.valueField).toBe("users");
    expect(g.values.get("DE")!.value).toBe(15);
    expect(g.values.get("DE")!.rows).toHaveLength(2);
    expect([g.min, g.max]).toEqual([15, 20]);
    expect(g.unknown).toEqual(["Narnia"]);
    expect(g.problems[0]).toMatch(/"Narnia" name no country/);
    const o = readGeo({ CA: 3, TX: "4" }, { map: "us" });
    expect(o.problems).toEqual([]);
    expect(o.values.get("TX")!.value).toBe(4);
  });

  it("splits values into steps, linear or by quantile", () => {
    const b = stepBounds([], 0, 100, 5);
    expect(b).toEqual([0, 20, 40, 60, 80, 100]);
    expect([0, 19, 20, 99, 100, 140, -3].map((v) => stepOf(v, b))).toEqual([0, 0, 1, 4, 4, 4, 0]);
    const skewed = [1, 1, 2, 2, 3, 3, 4, 5, 900, 1000];
    const q = stepBounds(skewed, 1, 1000, 5, "quantile");
    expect(skewed.map((v) => stepOf(v, q))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe("checking brushed charts and editable boards", () => {
  it("tries a brushed range on filters that read it", () => {
    const ok = check(`<state picked={null} />
<let rows={[{ day: "Mon", n: 3 }, { day: "Tue", n: 5 }, { day: "Wed", n: 2 }]} />
<Chart type="bar" data={rows} x="day" y="n" brush bind="picked" />
<Table rows={picked ? rows.filter((r) => picked.xs.includes(r.day)) : rows} />`);
    expect(ok.issues).toEqual([]);
    const bad = check(`<state picked={null} />
<Chart type="line" values={[1, 2, 3]} brush bind="picked" />
<Text>{picked.from}</Text>`);
    expect(bad.ok).toBe(false);
  });

  it("tries a bound board's arrangement and reports cards outside the columns", () => {
    const r = check(`<state plan={null} />
<Board editable bind="plan" columns={["Todo", "Done"]} items={[{ title: "A", status: "Todo" }, { title: "B", status: "Later" }]} />
<Text>{plan ? plan.columns.Todo.length : 0} to do</Text>`);
    expect(r.issues.map((i) => i.message)).toEqual(['<Board> Card "B": status "Later" is not one of the columns (Todo, Done)']);
  });
});
