// Compute cells, time tools and the release dashboard. Rules live in
// core/compute.ts, core/time.ts and core/release.ts; views in the "tools" chunk.
import { component, p } from "./spec";

const optionalBind = (doc: string) => p.bind(doc, { required: false });

export const COMPUTE = [
  component({
    name: "Cells",
    group: "Compute",
    summary:
      "A notebook-like stack of named cells run by Iris's sandboxed interpreter, each showing its value (number, text, list, table or component). Later cells read earlier ones by name, plus states, lets and helpers; errors show per cell. The person can edit, add and reset cells.",
    props: {
      cells: p.list("Run top to bottom; format applies to numbers", "({name?, expr, label?, format?, note?} | \"name = expr\")[]", { required: true }),
      bind: optionalBind("A <state> that receives {name: value} for every named cell that ran, for other components to read"),
      title: p.str("Caption above the cells"),
      editable: p.bool("The person can edit, add and reset cells", { def: true }),
    },
    children: "none",
    example: `<state seats={12} calc={{}} />
<Card title="Pricing model" icon="calculator">
<Slider bind="seats" min={1} max={50} label="Seats" />
<Cells bind="calc" cells={[
  { name: "price", expr: "29", format: "usd" },
  { name: "monthly", expr: "price * seats", format: "usd" },
  { name: "annual", expr: "monthly * 12 * 0.85", format: "usd", note: "15% off when paid yearly" },
  "tiers = [5, 10, 25].map((n) => ({ seats: n, monthly: n * price }))",
]} />
<Metric label="Annual" value={calc.annual} format="usd" />
</Card>`,
    aliases: ["Notebook", "ComputeCells", "Calc"],
    heavy: true,
  }),
];

export const TIME = [
  component({
    name: "TimeZones",
    group: "Time",
    summary:
      "A meeting planner across time zones: rows of people or places on a shared 24-hour scale, working hours shaded, and a slot the person drags (or moves with arrow keys) showing each local time.",
    props: {
      zones: p.list("IANA names (\"Asia/Tokyo\"), \"UTC+2\" or \"local\"; the first row sets the scale", "(string | {label?, tz, hours?: [start, end], note?})[]", { required: true }),
      date: p.str("Day to plan, YYYY-MM-DD; default today, or Monday on a weekend"),
      at: p.any("Slot start on the first row's clock (\"15:00\" or 15); default the best overlap"),
      duration: p.num("Slot length in minutes", { def: 60 }),
      hours: p.list("Working hours for every row; a row's own hours win", "[start, end]"),
      step: p.num("Drag snaps to this many minutes", { def: 30 }),
      bind: optionalBind("A <state> that receives {start, end, times: {label: \"15:00\"}, inHours}"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Card title="Design review" icon="globe">
<TimeZones date="2026-11-10" zones={[
  { label: "Vedran", tz: "Europe/Zagreb" },
  { label: "Maya", tz: "America/New_York", note: "Remote" },
  { label: "Kenji", tz: "Asia/Tokyo", hours: [10, 19] },
  { label: "Priya", tz: "Asia/Kolkata" },
]} />
</Card>`,
    aliases: ["TimeZonePlanner", "MeetingPlanner", "WorldClock"],
    heavy: true,
  }),
  component({
    name: "Cron",
    group: "Time",
    summary: "A cron schedule read as plain words, each field explained, and the next runs listed with how far away they are.",
    props: {
      expr: p.str("Five fields (minute hour day month weekday), names like MON or JAN, or @hourly, @daily, @weekly, @monthly, @yearly", { required: true }),
      tz: p.str("Zone the schedule runs in; runs also show in the person's own zone", { def: "UTC" }),
      count: p.num("How many next runs to list", { def: 5 }),
      editable: p.bool("The person can edit the expression to try others", { def: true }),
      title: p.str("Caption, e.g. the job's name"),
    },
    children: "none",
    example: `<Card title="Scheduled jobs">
<Cron expr="*/15 9-17 * * 1-5" tz="Europe/Zagreb" title="Sync inbox" />
</Card>`,
    aliases: ["CronExplainer", "Crontab", "CronSchedule"],
    heavy: true,
  }),
  component({
    name: "DateDiff",
    group: "Time",
    summary: "Business days between two dates: working days, calendar days, weeks, weekends and the holidays skipped, over a day strip of the range. The person can change the dates.",
    props: {
      from: p.str("Start, YYYY-MM-DD", { required: true }),
      to: p.str("End, YYYY-MM-DD", { required: true }),
      holidays: p.list("Days off that aren't weekends", "(string | {date, name?})[]"),
      weekend: p.list("Weekday numbers off, 0 = Sunday; default [0, 6]", "number[]"),
      inclusive: p.bool("Count both ends; false skips the start day", { def: true }),
      editable: p.bool("The person can change the dates", { def: true }),
      bind: optionalBind("A <state> that receives {from, to, businessDays, calendarDays}"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Card title="Until code freeze">
<DateDiff from="2026-11-03" to="2026-12-18" holidays={[{ date: "2026-11-26", name: "Thanksgiving" }, { date: "2026-11-27", name: "Day after" }]} />
</Card>`,
    aliases: ["BusinessDays", "DateRange", "WorkingDays"],
    heavy: true,
  }),
];

export const RELEASE = [
  component({
    name: "Release",
    group: "Release",
    summary:
      "One card for a release: version, build, overall state, platforms, checks, store or TestFlight state, blockers and a timeline. CI and App Store Connect status words work as they are (passed, running, WAITING_FOR_REVIEW).",
    props: {
      file: p.str("A JSON file you rewrite as the release moves ($BB_THREAD_STORAGE/release.json); re-read every 2 s while on screen"),
      release: p.obj(
        "The same data inline",
        "{app?, version, build?, channel?, status?, commit?, updated?, progress?: {done, total, label?}, platforms?: {name, status, build?, detail?}[], checks?: {name, status, detail?, url?}[], store?: {name, status, detail?}[], blockers?: (string | {title, owner?, detail?})[], timeline?: {time, title, status?}[]}",
      ),
      title: p.str("Caption; default the app name"),
    },
    children: "none",
    example: `<Card title="Release">
<Release file="$BB_THREAD_STORAGE/release.json" />
</Card>`,
    aliases: ["ReleaseDashboard", "ReleaseStatus", "Ship"],
    heavy: true,
  }),
];
