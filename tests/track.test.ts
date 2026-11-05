import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { describeLine, formatAmount, formatOf, formatRate, normalizeBudget, readUnit } from "../core/budget";
import { doneAt, forecast, forecastWords, readSpan, readTime } from "../core/forecast";

const H = 3_600_000;
const D = 86_400_000;
const T0 = Date.parse("2026-11-04T09:00:00Z");

describe("Budget", () => {
  it("formats amounts in each unit", () => {
    expect(formatAmount(41.2, "usd")).toBe("$41.20");
    expect(formatAmount(1_240_000, "tokens")).toBe("1.2M tokens");
    expect(formatAmount(8400, "tokens")).toBe("8,400 tokens");
    expect(formatAmount(1, "runs")).toBe("1 run");
    expect(formatAmount(3812, "characters")).toBe("3,812 characters");
    expect(formatAmount(72, "minutes")).toBe("1 h 12 min");
    expect(formatAmount(12, "credits")).toBe("12 credits");
    expect(formatOf(41.2, 60, "usd")).toBe("$41.20 of $60.00");
    expect(formatOf(1_200_000, 2_000_000, "tokens")).toBe("1.2M of 2M tokens");
    expect(formatOf(86, 100, "usd")).toBe("$86 of $100");
    expect(formatAmount(353_300, "tokens")).toBe("353K tokens");
    expect(formatAmount(18_400, "tokens")).toBe("18.4K tokens");
    expect(readUnit("$")).toBe("usd");
    expect(readUnit("Tokens")).toBe("tokens");
  });

  it("colors by state: under, warn past the threshold, over the limit", () => {
    const { model, problems } = normalizeBudget([
      { label: "A", spent: 10, limit: 100 },
      { label: "B", spent: 85, limit: 100 },
      { label: "C", spent: 120, limit: 100 },
      { label: "D", spent: 50, limit: 100, warn: 40 },
    ]);
    expect(problems).toEqual([]);
    expect(model.lines.map((l) => l.state)).toEqual(["ok", "warn", "over", "warn"]);
    expect(model.totals).toMatchObject([{ unit: "usd", spent: 265, limit: 400, lines: 4 }]);
    expect(describeLine(model.lines[2])).toMatch(/\$20 over/);
  });

  it("reads the burn rate from timed points and says when the limit is reached", () => {
    const { model } = normalizeBudget(null, { spent: 400_000, limit: 1_000_000, unit: "tokens", points: [{ t: T0, spent: 100_000 }, { t: T0 + 2 * H, spent: 400_000 }] });
    const line = model.lines[0];
    expect(line.rate?.per).toBe("h");
    expect(formatRate(line.rate!, "tokens")).toBe("150K tokens/h");
    expect(line.rate?.limitAt).toBe(T0 + 6 * H);
    expect(describeLine(line, "UTC")).toBe("400K of 1M tokens (40%), 150K tokens/h, limit in about 4 h (3:00 PM)");
  });

  it("uses since when there are no points, and no ETA when over or idle", () => {
    const { model } = normalizeBudget({ spent: 30, limit: 60, since: T0 }, {}, T0 + 3 * H);
    expect(model.lines[0].rate?.perMs).toBeCloseTo(10 / H);
    expect(model.lines[0].rate?.limitAt).toBe(T0 + 6 * H);
    const over = normalizeBudget({ spent: 70, limit: 60, points: [{ t: T0, spent: 10 }, { t: T0 + H, spent: 70 }] }).model.lines[0];
    expect(over.rate?.limitAt).toBeNull();
    const idle = normalizeBudget({ spent: 10, limit: 60, points: [{ t: T0, spent: 10 }, { t: T0 + H, spent: 10 }] }).model.lines[0];
    expect(idle.rate?.limitAt).toBeNull();
  });

  it("reads CSV rows: timed readings per line and categories", () => {
    const rows = [
      { line: "API", t: "2026-11-04T09:00:00Z", spent: 2, limit: 20, unit: "usd" },
      { line: "API", t: "2026-11-04T10:00:00Z", spent: 5 },
      { line: "API", category: "Search", spent: 3 },
      { line: "API", category: "Chat", spent: 2 },
      { line: "Runs", spent: 4, limit: 10, unit: "runs" },
    ];
    const { model, problems } = normalizeBudget(rows);
    expect(problems).toEqual([]);
    expect(model.lines.map((l) => [l.label, l.spent, l.limit, l.unit])).toEqual([["API", 5, 20, "usd"], ["Runs", 4, 10, "runs"]]);
    expect(model.lines[0].parts).toEqual([{ label: "Search", value: 3 }, { label: "Chat", value: 2 }]);
    expect(model.lines[0].rate?.perMs).toBeCloseTo(3 / H);
  });

  it("reads {lines, by} files and reports bad data", () => {
    const { model } = normalizeBudget({ lines: [{ label: "x", spent: 1, limit: 2 }], by: { Build: 1 }, unit: "minutes" });
    expect(model.lines[0].unit).toBe("minutes");
    expect(model.parts).toEqual([{ label: "Build", value: 1 }]);
    expect(normalizeBudget([{ label: "x", limit: 2 }]).problems.join()).toMatch(/needs spent/);
    expect(normalizeBudget({ spent: "lots", limit: 2 }).problems.join()).toMatch(/not a number/);
    expect(check(`<Budget spent={41.2} limit={60} unit="usd" />`).ok).toBe(true);
    expect(check(`<Budget lines={[{ label: "x", limit: 3 }]} />`).ok).toBe(false);
  });
});

describe("Forecast", () => {
  const daily = (counts: number[], total?: number) => counts.map((done, k) => ({ t: T0 + k * D, done, total }));

  it("projects an ETA with a band from the spread of recent daily rates", () => {
    const { model } = forecast({ points: daily([0, 3, 5, 9, 11, 14, 18, 20], 40) });
    expect(model).not.toBeNull();
    const m = model!;
    expect(m.periodName).toBe("day");
    expect(m.rate).toBeCloseTo(20 / 7);
    expect(m.remaining).toBe(20);
    expect(m.eta!.at).toBeCloseTo(m.asOf + (20 / (20 / 7)) * D);
    expect(m.eta!.early).toBeLessThan(m.eta!.at);
    expect(m.eta!.late).toBeGreaterThan(m.eta!.at);
    expect(forecastWords(m, "tasks", "UTC")).toMatch(/^At the last 7 days' pace \(2\.9 a day\), done Nov \d+, between Nov \d+ and Nov \d+\.$/);
  });

  it("a steady pace has no band", () => {
    const m = forecast({ points: daily([0, 2, 4, 6, 8], 16) }).model!;
    expect(m.spread).toBe(0);
    expect(m.eta!.early).toBeCloseTo(m.eta!.late);
  });

  it("marks scope changes and handles zero progress and finished work", () => {
    const m = forecast({ points: [{ t: T0, done: 0, total: 10 }, { t: T0 + D, done: 2, total: 10 }, { t: T0 + 2 * D, done: 4, total: 16 }, { t: T0 + 3 * D, done: 5, total: 16 }] }).model!;
    expect(m.scope).toEqual([{ t: T0 + 2 * D, from: 10, to: 16 }]);
    expect(forecastWords(m)).toMatch(/Scope grew by 6\./);
    const idle = forecast({ points: daily([4, 4, 4], 10) }).model!;
    expect(idle.eta).toBeNull();
    expect(forecastWords(idle)).toMatch(/^No progress over the last 2 days, so no ETA yet/);
    const done = forecast({ points: daily([0, 5, 10, 10], 10) }).model!;
    expect(done.remaining).toBe(0);
    expect(done.finishedAt).toBe(T0 + 2 * D);
    expect(forecastWords(done, "", "UTC")).toMatch(/^Done Nov 6/);
  });

  it("turns completion dates into a step count, read as of now", () => {
    const dates = ["2026-11-01T10:00:00Z", "2026-11-01T15:00:00Z", "2026-11-02T11:00:00Z", "2026-11-03T09:00:00Z"];
    const now = Date.parse("2026-11-04T12:00:00Z");
    const m = forecast({ dates, total: 10, window: 3 }, now).model!;
    expect(m.steps).toBe(true);
    expect(m.done).toBe(4);
    expect(doneAt(m.points, Date.parse("2026-11-01T12:00:00Z"), true)).toBe(1);
    expect(m.rate).toBeCloseTo(1);
    expect(forecastWords(m, "", "UTC")).toMatch(/^At the last 3 days' pace/);
  });

  it("works in hours for short work, and judges a deadline", () => {
    const points = [0, 10, 25, 33, 48].map((done, k) => ({ t: T0 + k * 15 * 60_000, done }));
    const m = forecast({ points, total: 120, deadline: "2026-11-04T10:30:00Z" }, 0, "UTC").model!;
    expect(m.basis).toBe("since 9:00 AM");
    expect(m.periodName).toBe("hour");
    expect(m.deadline?.verdict).toBe("late");
    expect(forecastWords(m, "files", "UTC")).toMatch(/^At the pace since 9:00 AM \(48 an hour\), done 11:30 AM, between 11:\d\d AM and 11:\d\d AM\./);
    expect(forecastWords(m, "files", "UTC")).toMatch(/Late for/);
    const ok = forecast({ points, total: 60, deadline: "2026-11-05" }).model!;
    expect(ok.deadline?.verdict).toBe("on track");
  });

  it("reads spans and times, and reports bad input", () => {
    expect(readSpan("6h")).toBe(6 * H);
    expect(readSpan(7)).toBe(7 * D);
    expect(readSpan("soon")).toBeNull();
    expect(readTime(1_700_000_000)).toBe(1_700_000_000_000);
    expect(forecast({ points: [{ t: "x", done: 1 }] }).problems.join()).toMatch(/needs a time/);
    expect(forecast({}).problems.join()).toMatch(/needs points/);
    expect(check(`<Forecast points={[{ t: "2026-11-01", done: 0 }, { t: "2026-11-02", done: 3 }]} total={10} />`).ok).toBe(true);
    expect(check(`<Forecast points={[{ t: "2026-11-01", done: 0 }]} window="soon" />`).ok).toBe(false);
  });

  it("review fixes: finish after a scope change, short work with a long window, slow short work, shared first times", () => {
    const grown = forecast({ deadline: "2026-11-05", points: [{ t: T0, done: 0, total: 10 }, { t: T0 + D, done: 10, total: 10 }, { t: T0 + 2 * D, done: 12, total: 16 }, { t: T0 + 4 * D, done: 16, total: 16 }] }).model!;
    expect(grown.finishedAt).toBe(T0 + 4 * D);
    const short = Array.from({ length: 7 }, (_, k) => ({ t: T0 + k * 30 * 60_000, done: k * 20 }));
    const long = forecast({ points: short, total: 400, window: 7 }).model!;
    expect(long.periodName).not.toBe("day");
    expect(long.periods).toBeGreaterThan(1);
    const slow = forecast({ points: [0, 1, 2, 2, 3, 4, 5].map((done, k) => ({ t: T0 + k * 30 * 60_000, done })), total: 12 }).model!;
    expect(slow.periodName).toBe("hour");
    expect(slow.rate).toBeCloseTo(5 / 3);
    const crawl = forecast({ points: [{ t: T0, done: 0 }, { t: T0 + 30 * H, done: 1 }], total: 5 }).model!;
    expect(forecastWords(crawl)).toMatch(/\(0\.8 a day\)/);
    expect(forecast({ points: [{ t: T0, done: 2 }, { t: T0, done: 4 }], total: 10 }).model!.done).toBe(4);
    const one = forecast({ dates: ["2026-11-04T10:00:00Z"], total: 10 }, Date.parse("2026-11-04T12:00:00Z")).model!;
    expect(one.rate).toBeGreaterThan(0);
  });
});
