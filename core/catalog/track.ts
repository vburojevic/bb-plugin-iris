// Spend against a limit and progress forecasts. Math lives in core/budget.ts
// and core/forecast.ts; views in the "track" chunk.
import { component, p } from "./spec";

export const TRACKING = [
  component({
    name: "Budget",
    group: "Tracking",
    summary: "Spend against a limit: a meter per line, the total, a breakdown, the burn rate and when the limit is hit at it.",
    props: {
      lines: p.list("Or a JSON or CSV load()", "{label, spent, limit, unit?, by?, points?, since?}[]"),
      spent: p.num("One line, without lines"),
      limit: p.num("Its cap"),
      by: p.obj("Breakdown", "{category: n}"),
      points: p.list("Readings for the burn rate", "{t, spent}[]"),
      since: p.str("Or when spending began"),
      unit: p.str("tokens, usd, runs, characters, minutes, percent (a share of the line's own limit, never totaled) or any word", { def: "usd" }),
      warn: p.num("Share of the limit that warns", { def: 0.8 }),
      file: p.str("JSON or CSV you rewrite as spend grows; read live"),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Card title="Session spend" icon="wallet">
<Budget lines={[
  { label: "Model tokens", spent: 1240000, limit: 2000000, unit: "tokens",
    points: [{ t: "2026-11-04T09:00", spent: 180000 }, { t: "2026-11-04T10:30", spent: 690000 }, { t: "2026-11-04T12:00", spent: 1240000 }] },
  { label: "API cost", spent: 41.2, limit: 50, by: { Search: 18.4, Chat: 15.1, Embeddings: 7.7 } },
  { label: "CI runs", spent: 23, limit: 20, unit: "runs" },
  { label: "App Store subtitle", spent: 27, limit: 30, unit: "characters" },
]} />
</Card>`,
    aliases: ["Spend", "BudgetMeter", "CostTracker", "Quota"],
    heavy: true,
  }),
  component({
    name: "Forecast",
    group: "Tracking",
    summary: "Done counts over time as an ETA with a band from recent rates, a burn-down or burn-up, scope changes and plain words.",
    props: {
      points: p.list("A new total marks a scope change", "{t, done, total?}[]"),
      dates: p.list("Or one date per finished item", "string[]"),
      total: p.num("Scope, when points carry none"),
      window: p.any('Pace window: days or "6h"; default 7 days or all'),
      chart: p.oneOf(["down", "up"], "Burn-down or burn-up", { def: "down" }),
      deadline: p.str("Target date, judged"),
      unit: p.str('What is counted, e.g. "tasks"'),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<Card title="Migration" icon="calendar-clock">
<Forecast unit="tables" deadline="2026-11-14" points={[
  { t: "2026-10-27", done: 0, total: 40 }, { t: "2026-10-28", done: 3, total: 40 }, { t: "2026-10-29", done: 5, total: 40 },
  { t: "2026-10-30", done: 9, total: 46 }, { t: "2026-10-31", done: 11, total: 46 }, { t: "2026-11-02", done: 16, total: 46 },
  { t: "2026-11-03", done: 21, total: 46 }, { t: "2026-11-04", done: 24, total: 46 },
]} />
</Card>`,
    aliases: ["Burndown", "BurnDown", "Burnup", "ETA", "Projection"],
    heavy: true,
  }),
];
