import { describe, expect, it } from "vitest";
import { check } from "../core/check";
import { bestSlot, businessSpan, cronProblems, describeCron, nextRuns, normalizeZones, parseCron, readHolidays, resolveZone, slotInHours, wallClock, weeksAndDays, zoneOffset, zonedInstant } from "../core/time";

const say = (expr: string) => {
  const { cron, error } = parseCron(expr);
  if (!cron) throw new Error(error ?? "no cron");
  return describeCron(cron);
};
const iso = (ms: number) => new Date(ms).toISOString();

describe("zones", () => {
  it("resolves names, offsets and local, and refuses unknown zones", () => {
    expect(resolveZone("Europe/Zagreb")).toBe("Europe/Zagreb");
    expect(resolveZone("UTC+2")).toBe("+02:00");
    expect(resolveZone("gmt")).toBe("UTC");
    expect(resolveZone("local")).toBeTruthy();
    expect(resolveZone("Mars/Olympus")).toBeNull();
  });
  it("reads offsets across daylight saving and finds the instant a wall clock shows", () => {
    expect(zoneOffset("Europe/Zagreb", Date.parse("2026-07-01T12:00:00Z"))).toBe(120);
    expect(zoneOffset("Europe/Zagreb", Date.parse("2026-12-01T12:00:00Z"))).toBe(60);
    expect(zoneOffset("Asia/Kolkata", Date.parse("2026-12-01T12:00:00Z"))).toBe(330);
    expect(iso(zonedInstant("2026-11-03", 15 * 60, "America/New_York"))).toBe("2026-11-03T20:00:00.000Z");
    expect(iso(zonedInstant("2026-03-29", 3 * 60, "Europe/Zagreb"))).toBe("2026-03-29T01:00:00.000Z");
    expect(wallClock("Asia/Tokyo", Date.parse("2026-11-03T20:00:00Z"))).toMatchObject({ day: 4, hour: 5, minute: 0, weekday: 3 });
  });
  it("normalizes rows and finds the slot that keeps the most people in working hours", () => {
    const { rows, problems } = normalizeZones([{ label: "Zagreb", tz: "Europe/Zagreb" }, "America/New_York", ["Pune", "Asia/Kolkata"], { tz: "Nope/Nowhere" }]);
    expect(rows.map((r) => r.label)).toEqual(["Zagreb", "New York", "Pune"]);
    expect(problems).toHaveLength(1);
    const dayStart = zonedInstant("2026-11-03", 0, "Europe/Zagreb");
    const best = bestSlot(rows.slice(0, 2), dayStart, 60, 30);
    // 15:00 in Zagreb is 09:00 in New York, the first hour both work.
    expect(best).toBe(15 * 60);
    expect(slotInHours(rows[1], dayStart + best * 60000, 60)).toBe(true);
    expect(slotInHours(rows[2], dayStart + best * 60000, 60)).toBe(false);
  });
});

describe("cron", () => {
  it("reads common schedules in plain words", () => {
    expect(say("30 9 * * 1-5")).toBe("At 09:30, Monday through Friday");
    expect(say("*/15 9-17 * * 1-5")).toBe("Every 15 minutes, between 09:00 and 17:59, Monday through Friday");
    expect(say("0 * * * *")).toBe("Every hour, on the hour");
    expect(say("@daily")).toBe("At 00:00");
    expect(say("0 0 1 * *")).toBe("At 00:00, on the 1st of the month");
    expect(say("0 9,17 * * SAT,SUN")).toBe("At 09:00 and 17:00, on weekends");
    expect(say("0 */2 * * *")).toBe("Every 2 hours");
    expect(say("5 4 * JAN,APR,JUL,OCT 1")).toBe("At 04:05, on Mondays, in January, April, July and October");
    expect(say("* * * * *")).toBe("Every minute");
    expect(say("0 12 1,15 * 5")).toBe("At 12:00, on the 1st and 15th of the month, and every Friday");
  });
  it("refuses what it can't read", () => {
    expect(parseCron("0 9 * *").error).toMatch(/five/);
    expect(parseCron("0 0 9 * * *").error).toMatch(/seconds/);
    expect(parseCron("61 * * * *").error).toMatch(/outside/);
    expect(parseCron("0 0 L * *").error).toMatch(/aren't supported/);
    expect(cronProblems("0 0 30 2 *", "UTC")[0]).toMatch(/never runs/);
    expect(cronProblems("0 9 * * *", "Nope/X")[0]).toMatch(/not a time zone/);
  });
  it("lists the next runs on a zone's clocks, through daylight saving", () => {
    const { cron } = parseCron("30 9 * * 1-5");
    const runs = nextRuns(cron!, Date.parse("2026-11-06T12:00:00Z"), 3, "Europe/Zagreb");
    expect(runs.map(iso)).toEqual(["2026-11-09T08:30:00.000Z", "2026-11-10T08:30:00.000Z", "2026-11-11T08:30:00.000Z"]);
    const dst = nextRuns(parseCron("0 2 * * *").cron!, Date.parse("2026-03-28T12:00:00Z"), 2, "Europe/Zagreb");
    // 02:00 doesn't exist on 29 March in Zagreb; the next run is the 30th.
    expect(dst.map(iso)).toEqual(["2026-03-30T00:00:00.000Z", "2026-03-31T00:00:00.000Z"]);
    const either = nextRuns(parseCron("0 12 13 * 5").cron!, Date.parse("2026-11-01T00:00:00Z"), 3, "UTC");
    expect(either.map((t) => iso(t).slice(0, 10))).toEqual(["2026-11-06", "2026-11-13", "2026-11-20"]);
  });
});

describe("business days", () => {
  it("counts working days, weekends and holidays, both ends included by default", () => {
    const { list } = readHolidays([{ date: "2026-12-25", name: "Christmas" }, "2026-12-26"]);
    const s = businessSpan("2026-12-21", "2027-01-01", { holidays: list });
    expect(s.calendarDays).toBe(11);
    expect(s.businessDays).toBe(9);
    expect(s.weekendDays).toBe(2);
    expect(s.holidays.map((h) => h.date)).toEqual(["2026-12-25"]);
    expect(businessSpan("2026-11-02", "2026-11-06", { inclusive: false }).businessDays).toBe(4);
    expect(businessSpan("2026-11-06", "2026-11-02").businessDays).toBe(-5);
    expect(businessSpan("2026-11-06", "2026-11-08", { weekend: [5, 6] }).businessDays).toBe(1);
    expect(() => businessSpan("2026-02-30", "2026-03-01")).toThrow(/not a date/);
    expect(weeksAndDays(23)).toBe("3 weeks 2 days");
  });
});

describe("check() on time tools", () => {
  it("passes the examples and flags bad input", () => {
    expect(check(`<Cron expr="0 9 * * 1-5" tz="Europe/Zagreb" />`).ok).toBe(true);
    expect(check(`<Cron expr="0 9 * *" />`).issues[0].message).toMatch(/five/);
    expect(check(`<TimeZones zones={["Europe/Zagreb", "Mars/Base"]} />`).issues[0].message).toMatch(/not a time zone/);
    expect(check(`<DateDiff from="2026-11-03" to="2026-13-01" />`).ok).toBe(false);
  });
});

describe("review fixes", () => {
  it("only says every n when n divides the range, and reads */1 as every", () => {
    expect(say("*/45 * * * *")).toBe("At minutes 0 and 45 past every hour");
    expect(say("0 */7 * * *")).toBe("At 00:00, 07:00, 14:00 and 21:00");
    expect(say("*/1 * * * *")).toBe("Every minute");
    expect(say("*/20 * * * *")).toBe("Every 20 minutes");
  });
  it("treats a day field that starts with * as narrowing the other, like Vixie cron", () => {
    const runs = nextRuns(parseCron("0 0 */2 * 1").cron!, Date.parse("2026-11-01T00:00:00Z"), 3, "UTC");
    // Odd days that are Mondays: Nov 9, Nov 23, Dec 7.
    expect(runs.map((t) => iso(t).slice(0, 10))).toEqual(["2026-11-09", "2026-11-23", "2026-12-07"]);
    expect(say("0 0 */2 * 1")).toMatch(/when it falls on Mondays/);
  });
  it("names unknown words instead of blaming L and W", () => {
    expect(parseCron("0 0 * WED *").error).toMatch(/"WED" is not a month/);
    expect(parseCron("0 0 LW * *").error).toMatch(/aren't supported/);
  });
  it("falls back to working hours when nobody works that day", () => {
    const { rows } = normalizeZones(["Europe/Zagreb", "America/New_York"]);
    const saturday = zonedInstant("2026-11-07", 0, "Europe/Zagreb");
    expect(bestSlot(rows, saturday, 60, 30)).toBe(9 * 60);
  });
  it("skips the start day when counting back without inclusive", () => {
    expect(businessSpan("2026-11-09", "2026-11-07", { inclusive: false }).businessDays).toBe(0);
    expect(businessSpan("2026-11-10", "2026-11-07", { inclusive: false }).businessDays).toBe(-1);
  });
});

describe("review round 2", () => {
  it("names a whole unknown word", () => {
    expect(parseCron("0 0 * * MONDAY").error).toMatch(/"MONDAY" is not a weekday/);
    expect(say("0 9 * * MON-FRI")).toBe("At 09:00, Monday through Friday");
  });
});
