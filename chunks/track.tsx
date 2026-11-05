// Budget and Forecast (chunk "track"). Budget: a meter per line in one
// sequential meaning (the accent, then warn past the threshold, then bad over
// the limit), totals, a breakdown strip and the burn rate. Forecast: an ETA
// with an 80% band, drawn as a burn-down or burn-up in Chart's look: dashed
// grid, the actual line solid, the projection dashed and the band one flat
// fill. Math lives in core/budget.ts and core/forecast.ts.

import { Chip, Glyph, InlineError, Shimmer, cn, str, tooClose, useEnv } from "@iris/ui";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { IrisError, isPendingValue } from "../core/evaluate";
import { type BudgetLine, type BudgetPart, type BudgetState, amountNumber, formatAmount, formatOf, formatPair, formatRate, formatSpan, isPercentUnit, normalizeBudget } from "../core/budget";
import { type ForecastModel, forecast, forecastWords, formatWhen, projection } from "../core/forecast";
import type { ViewProps } from "../ui/render";
import { useNow, useWidth } from "./tools-kit";

type Palette = ReturnType<typeof useEnv>["palette"];

// Under the warn share a meter is the accent, unless the theme's accent looks
// like the warn or bad tone (an amber or red theme): then it is a quiet neutral,
// so warn and bad still stand out.
const okCache = new WeakMap<object, string>();
function okColor(palette: Palette): string {
  let c = okCache.get(palette);
  if (!c) {
    c = tooClose(palette.accent, palette.tone.warn) || tooClose(palette.accent, palette.tone.bad) ? palette.tone.neutral : palette.accent;
    okCache.set(palette, c);
  }
  return c;
}
const stateColor = (palette: Palette, s: BudgetState) => (s === "over" ? palette.tone.bad : s === "warn" ? palette.tone.warn : okColor(palette));
const pct = (r: number) => `${Math.round(r * 100)}%`;
/** The band: one flat fill of the accent, never a gradient. */
const bandFill = (palette: Palette) => `color-mix(in oklab, ${palette.accent} 20%, transparent)`;

// ---------- live files ----------

type FileState = { status: "loading" } | { status: "missing" } | { status: "error"; error: string } | { status: "ok"; value: unknown };

function useLiveFile(path: string | undefined): FileState | null {
  const env = useEnv();
  if (!path) return null;
  try {
    const v = env.runtime.loadLive(path);
    if (isPendingValue(v)) return { status: "loading" };
    return { status: "ok", value: v };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/file not found/.test(message)) return { status: "missing" };
    return { status: "error", error: e instanceof IrisError ? message.replace(/^load\("[^"]*"\): /, "") : message };
  }
}

/** When the value last changed, for "changed 4 s ago". */
function useChangedAt(value: unknown): number {
  const last = useRef<{ print: string | null; at: number }>({ print: null, at: Date.now() });
  const print = value === undefined ? null : JSON.stringify(value);
  if (print !== last.current.print) last.current = { print, at: Date.now() };
  return last.current.at;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  return `${formatSpan(ms)} ago`;
}

// ---------- Budget ----------

export function BudgetView({ props }: ViewProps) {
  const env = useEnv();
  const file = str(props.file);
  const state = useLiveFile(file);
  const now = useNow(file ? 5000 : 60_000);
  const data = file ? (state?.status === "ok" ? state.value : undefined) : props.lines;
  const pending = [props.lines, props.points, props.by].some(isPendingValue);
  const changedAt = useChangedAt(data);
  const runtimeNow = env.runtime.now();
  const parsed = useMemo(() => (pending || (file && data === undefined) ? null : normalizeBudget(data, props, runtimeNow)), [data, pending, file, props, runtimeNow]);

  if (pending || state?.status === "loading") return <Shimmer className="h-40" />;
  if (state?.status === "missing")
    return (
      <div className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
        <span className="iris-pulse size-1.5 rounded-full" style={{ background: env.palette.accent }} aria-hidden />
        Waiting for {file?.split("/").pop()}
      </div>
    );
  if (state?.status === "error") return <InlineError error={new Error(state.error)} context="<Budget>" />;
  if (!parsed) return <Shimmer className="h-40" />;
  const { model, problems } = parsed;
  if (!model.lines.length) return <InlineError error={new Error(problems[0] ?? "needs spent and limit, or lines")} context="<Budget>" />;
  const title = str(props.title);
  const single = model.lines.length === 1;
  return (
    <div className="min-w-0">
      {problems.length ? <InlineError error={new Error(`${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`)} context="<Budget>" /> : null}
      {title || file ? (
        <div className="mb-2 flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</div>
          {file ? (
            <span className="inline-flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <span className="iris-pulse size-1.5 rounded-full" style={{ background: env.palette.accent }} aria-hidden />
              Changed {ago(now - changedAt)}
            </span>
          ) : null}
        </div>
      ) : null}
      {single ? (
        <Headline line={model.lines[0]} />
      ) : (
        <>
          {model.totals.map((t) => (
            <div key={t.unit} className="mb-3 min-w-0">
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span className="text-[12.5px] text-muted-foreground">{model.totals.length > 1 ? `Total, ${t.unit}` : "Total"}</span>
                <span className="text-[22px] font-semibold leading-tight tracking-[-0.02em] tabular-nums">{t.limit != null ? formatPair(t.spent, t.limit, t.unit)[0] : formatAmount(t.spent, t.unit)}</span>
                {t.limit != null ? (
                  <span className="text-[13px] tabular-nums text-muted-foreground">
                    of {formatPair(t.spent, t.limit, t.unit)[1]} · {pct(t.ratio ?? 0)}
                  </span>
                ) : null}
              </div>
              {t.limit != null ? <Meter ratio={t.ratio ?? 0} warn={t.warn} state={t.state} label={`Total ${formatOf(t.spent, t.limit, t.unit)}`} className="mt-1.5 h-2.5" /> : null}
            </div>
          ))}
          <div className="space-y-3.5">
            {model.lines.map((l, k) => (
              <LineRow key={k} line={l} />
            ))}
          </div>
        </>
      )}
      {model.parts.length ? (
        <div className="mt-3.5 border-t border-border pt-3">
          <div className="mb-1.5 text-[12px] text-muted-foreground">Breakdown</div>
          <Strip parts={model.parts} unit={model.lines[0].unit} lead={single ? model.lines[0].state : (model.totals[0]?.state ?? "ok")} />
        </div>
      ) : null}
    </div>
  );
}

function Headline({ line }: { line: BudgetLine }) {
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-[12.5px] text-muted-foreground">{line.label}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span className="text-[26px] font-semibold leading-tight tracking-[-0.025em] tabular-nums">{line.limit != null ? formatPair(line.spent, line.limit, line.unit)[0] : formatAmount(line.spent, line.unit)}</span>
        {line.limit != null && !(isPercentUnit(line.unit) && line.limit === 100) ? (
          <span className="text-[14px] tabular-nums text-muted-foreground">
            of {formatPair(line.spent, line.limit, line.unit)[1]} · {pct(line.ratio ?? 0)}
          </span>
        ) : null}
      </div>
      {line.limit != null ? <Meter ratio={line.ratio ?? 0} warn={line.warn} state={line.state} label={`${line.label} ${formatOf(line.spent, line.limit, line.unit)}`} className="mt-2 h-2.5" /> : null}
      <Meta line={line} />
      {line.parts.length ? <Strip parts={line.parts} unit={line.unit} lead={line.state} className="mt-3" /> : null}
    </div>
  );
}

function LineRow({ line }: { line: BudgetLine }) {
  const { palette } = useEnv();
  return (
    <div className="min-w-0">
      <div className="mb-1 flex min-w-0 items-baseline gap-2 text-[13px]">
        <span className="min-w-0 flex-1 truncate font-medium">{line.label}</span>
        {/* A share of 100% already reads as its ratio; only other amounts need "x of y". */}
        {isPercentUnit(line.unit) && line.limit === 100 ? null : <span className="shrink-0 tabular-nums text-muted-foreground">{formatOf(line.spent, line.limit, line.unit)}</span>}
        {line.ratio != null ? (
          <span className="w-10 shrink-0 text-right text-[12px] font-medium tabular-nums" style={line.state !== "ok" ? { color: stateColor(palette, line.state) } : undefined}>
            {pct(line.ratio)}
          </span>
        ) : null}
      </div>
      {line.limit != null ? <Meter ratio={line.ratio ?? 0} warn={line.warn} state={line.state} label={`${line.label} ${formatOf(line.spent, line.limit, line.unit)}`} /> : null}
      <Meta line={line} />
      {line.parts.length ? <Strip parts={line.parts} unit={line.unit} lead={line.state} className="mt-2" /> : null}
    </div>
  );
}

/** Burn rate, when the limit is hit, how far over, and the note. */
function Meta({ line }: { line: BudgetLine }) {
  const { palette } = useEnv();
  const bits: { text: string; tone?: string; icon?: string }[] = [];
  if (line.state === "over" && line.limit != null) bits.push({ text: `${formatAmount(line.spent - line.limit, line.unit)} over`, tone: palette.tone.bad, icon: "octagon-alert" });
  else if (line.limit != null && line.state === "warn") bits.push({ text: `${formatAmount(Math.max(0, line.limit - line.spent), line.unit)} left`, tone: palette.tone.warn });
  else if (line.limit != null) bits.push({ text: `${formatAmount(line.limit - line.spent, line.unit)} left` });
  if (line.rate) {
    bits.push({ text: formatRate(line.rate, line.unit), icon: "gauge" });
    if (line.rate.limitAt != null) bits.push({ text: `limit in about ${formatSpan(line.rate.limitAt - line.rate.asOf)}, ${formatWhen(line.rate.limitAt, line.rate.asOf)}`, icon: "clock" });
  }
  if (line.note) bits.push({ text: line.note });
  if (!bits.length) return null;
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted-foreground">
      {bits.map((b, k) => (
        <span key={k} className="inline-flex min-w-0 items-center gap-1 tabular-nums" style={b.tone ? { color: b.tone } : undefined}>
          {b.icon ? <Glyph name={b.icon} size={12} /> : null}
          {b.text}
        </span>
      ))}
    </div>
  );
}

/** One bar: fill to spent/limit; a notch at the warn share; over the limit the bar is the spend and the notch marks the limit. */
function Meter({ ratio, warn, state, label, className }: { ratio: number; warn: number; state: BudgetState; label: string; className?: string }) {
  const { palette } = useEnv();
  const over = ratio > 1;
  const fill = over ? 1 : Math.max(0, ratio);
  const notch = over ? 1 / ratio : warn;
  return (
    <div className={cn("relative h-2 overflow-hidden rounded-full bg-muted", className)} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
      <div className="iris-bar h-full rounded-full" style={{ width: `${fill * 100}%`, background: stateColor(palette, state) }} />
      {notch > 0 && notch < 1 ? <span aria-hidden className="absolute inset-y-0 w-[2px] bg-card" style={{ left: `calc(${notch * 100}% - 1px)` }} /> : null}
    </div>
  );
}

/** A SegmentedBar-like strip: the lead part in the line's state color, the rest in quiet neutrals. */
function Strip({ parts, unit, lead, className }: { parts: BudgetPart[]; unit: string; lead: BudgetState; className?: string }) {
  const { palette } = useEnv();
  const sorted = [...parts].sort((a, b) => b.value - a.value);
  const sum = sorted.reduce((s, p) => s + p.value, 0) || 1;
  const color = (k: number) => (k === 0 ? stateColor(palette, lead) : `color-mix(in oklab, ${palette.tone.neutral} ${Math.max(28, 70 - (k - 1) * 14)}%, transparent)`);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={sorted.map((p) => `${p.label} ${formatAmount(p.value, unit)}`).join(", ")}>
        {sorted.map((p, k) => (p.value > 0 ? <div key={k} className="iris-bar h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(p.value / sum) * 100}%`, background: color(k) }} /> : null))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[12px]">
        {sorted.map((p, k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: color(k) }} />
            <span className="text-muted-foreground">{p.label}</span>
            <span className="tabular-nums">{amountNumber(p.value, unit)}</span>
            <span className="tabular-nums text-muted-foreground">{pct(p.value / sum)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------- Forecast ----------

export function ForecastView({ props }: ViewProps) {
  const env = useEnv();
  const pending = [props.points, props.dates, props.total].some(isPendingValue);
  // Completion dates are read as of now; keep "now" moving.
  const tick = useNow(props.dates != null ? 60_000 : 3_600_000);
  const now = props.dates != null ? Math.floor(env.runtime.now() / 60_000) * 60_000 : 0;
  const { model, problems } = useMemo(() => (pending ? { model: null, problems: [] as string[] } : forecast(props, now || env.runtime.now())), [props, pending, now, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (pending) return <Shimmer className="h-64" />;
  if (!model) return <InlineError error={new Error(problems[0] ?? "needs points or dates")} context="<Forecast>" />;
  const unit = str(props.unit) ?? "";
  const chart = props.chart === "up" || model.total == null ? "up" : "down";
  return <ForecastCard model={model} problems={problems} unit={unit} chart={chart} title={str(props.title)} />;
}

function ForecastCard({ model: m, problems, unit, chart, title }: { model: ForecastModel; problems: string[]; unit: string; chart: "up" | "down"; title?: string }) {
  const { palette } = useEnv();
  const words = forecastWords(m, unit);
  const finished = m.total != null && m.remaining === 0;
  const dayLevel = m.periodName === "day";
  const when = (t: number) => formatWhen(t, m.asOf, undefined, dayLevel ? false : undefined);
  const verdict = m.deadline?.verdict;
  const verdictTone = verdict === "late" ? "bad" : verdict === "at risk" ? "warn" : undefined;
  return (
    <div className="min-w-0">
      {problems.length ? <InlineError error={new Error(`${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`)} context="<Forecast>" /> : null}
      {title ? <div className="mb-2 truncate text-[13.5px] font-semibold">{title}</div> : null}
      <div className="flex min-w-0 flex-wrap items-end gap-x-6 gap-y-2">
        <Figure label={finished ? "Finished" : "ETA"} value={finished ? (m.finishedAt != null ? when(m.finishedAt) : "Done") : m.eta ? when(m.eta.at) : "None yet"} />
        {m.eta && when(m.eta.early) !== when(m.eta.late) ? <Figure label="Likely between" value={`${when(m.eta.early)} and ${when(m.eta.late)}`} small /> : null}
        <Figure label="Done" value={m.total != null ? `${count(m.done)} of ${count(m.total)}${unit ? ` ${unit}` : ""}` : `${count(m.done)}${unit ? ` ${unit}` : ""}`} small />
        {m.window > 0 && !finished ? <Figure label="Pace" value={paceShort(m)} small /> : null}
        {m.deadline && verdict ? (
          <div className="pb-0.5">
            <Chip tone={verdictTone} icon={verdict === "on track" ? "circle-check" : verdict === "late" ? "octagon-alert" : "triangle-alert"}>
              {finished ? (verdict === "on track" ? "Made the" : "Missed the") : verdict === "on track" ? "On track for" : verdict === "late" ? "Late for" : "At risk for"} {formatWhen(m.deadline.at, m.asOf, undefined, false)}
              {finished ? " deadline" : ""}
            </Chip>
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-[13px] leading-snug text-muted-foreground">{words}</p>
      <ForecastChart m={m} chart={chart} unit={unit} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <LegendLine color={palette.accent} label={chart === "down" ? "Remaining" : "Done"} />
        {m.eta ? <LegendLine color={palette.accent} dashed label="Projection" /> : null}
        {m.eta && m.spread > 0 ? <LegendSwatch color={bandFill(palette)} label="80% band" /> : null}
        {chart === "up" && m.total != null ? <LegendLine color="var(--muted-foreground)" label="Scope" /> : null}
        {m.scope.length ? <LegendLine color="var(--muted-foreground)" dashed vertical label="Scope change" /> : null}
      </div>
    </div>
  );
}

function count(n: number): string {
  return (Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10).toLocaleString("en-US");
}

function paceShort(m: ForecastModel): string {
  return `${count(m.rate)}/${m.periodName === "day" ? "day" : m.periodName === "hour" ? "h" : "min"}`;
}

function Figure({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
      <div className={cn("truncate font-semibold tabular-nums", small ? "text-[15px] leading-6" : "text-[24px] leading-tight tracking-[-0.025em]")}>{value}</div>
    </div>
  );
}

function LegendLine({ color, label, dashed, vertical }: { color: string; label: string; dashed?: boolean; vertical?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width={vertical ? 6 : 16} height={10} aria-hidden>
        {vertical ? <line x1={3} x2={3} y1={0} y2={10} stroke={color} strokeDasharray="2 2" /> : <line x1={0} x2={16} y1={5} y2={5} stroke={color} strokeWidth={2} strokeDasharray={dashed ? "4 3" : undefined} />}
      </svg>
      {label}
    </span>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-4 rounded-[3px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

/** Round value ticks, as Chart draws them, at whole numbers (these are counts). */
function ticks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, (mag >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10]).map((x) => x * mag).find((s) => s >= raw) ?? raw);
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Time ticks on local clock boundaries, at most `max` of them. */
function timeTicks(a: number, b: number, max: number): { ts: number[]; label: (t: number) => string } {
  const steps = [15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 91 * DAY];
  const step = steps.find((s) => (b - a) / s <= max) ?? 182 * DAY;
  const d = new Date(a);
  if (step >= DAY) d.setHours(0, 0, 0, 0);
  else if (step >= HOUR) d.setHours(d.getHours() - (d.getHours() % (step / HOUR)), 0, 0, 0);
  else d.setMinutes(d.getMinutes() - (d.getMinutes() % (step / MIN)), 0, 0);
  const ts: number[] = [];
  for (let guard = 0; guard < 400 && d.getTime() <= b; guard++) {
    if (d.getTime() >= a) ts.push(d.getTime());
    if (step >= DAY) d.setDate(d.getDate() + Math.round(step / DAY));
    else d.setTime(d.getTime() + step);
  }
  const day = (t: number) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = (t: number) => new Date(t).toLocaleTimeString("en-US", { hour: "numeric", minute: new Date(t).getMinutes() ? "2-digit" : undefined });
  const label = step >= DAY ? day : (t: number) => (new Date(t).getHours() === 0 && new Date(t).getMinutes() === 0 ? day(t) : time(t));
  return { ts, label };
}

function ForecastChart({ m, chart, unit }: { m: ForecastModel; chart: "up" | "down"; unit: string }) {
  const { palette } = useEnv();
  const [box, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const W = Math.max(260, width || 560);
  const H = W < 480 ? 180 : 210;
  const total = m.total;
  const span = Math.max(m.asOf - m.start, HOUR);
  // The x range reaches the late ETA and the deadline, within four times the history.
  const cap = m.asOf + 4 * span;
  const want = Math.max(m.asOf, m.eta ? m.eta.late : m.asOf, m.deadline ? m.deadline.at : m.asOf);
  const x1 = Math.min(want, cap);
  const x0 = m.start;
  const offChart = m.eta != null && m.eta.late > cap;
  const scopeAt = (p: { total: number | null }) => p.total ?? total ?? 0;
  // A value at a reading, as drawn: remaining for a burn-down, done for a burn-up.
  const yOf = (done: number, scope: number) => (chart === "down" ? Math.max(0, scope - done) : done);
  const actual = m.points.map((p) => ({ t: p.t, y: yOf(p.done, scopeAt(p)), done: p.done, scope: scopeAt(p) }));
  if (m.steps || actual[actual.length - 1].t < m.asOf) actual.push({ t: m.asOf, y: yOf(m.done, total ?? 0), done: m.done, scope: total ?? 0 });
  const nowY = yOf(m.done, total ?? 0);
  // The projection and its band, sampled from now to the late ETA (or the chart's edge).
  const bandEnd = m.eta ? Math.min(m.eta.late, x1) : m.asOf;
  const samples: { t: number; mid: number; lo: number; hi: number }[] = [];
  if (m.eta && total != null) {
    for (let k = 0; k <= 48; k++) {
      const t = m.asOf + ((bandEnd - m.asOf) * k) / 48;
      const g = projection(m, t - m.asOf);
      const clampUp = (v: number) => Math.min(total, m.done + v);
      if (chart === "down") samples.push({ t, mid: Math.max(0, total - clampUp(g.mid)), lo: Math.max(0, total - clampUp(g.hi)), hi: Math.max(0, total - clampUp(g.lo)) });
      else samples.push({ t, mid: clampUp(g.mid), lo: clampUp(g.lo), hi: clampUp(g.hi) });
    }
  }
  const scopeMax = Math.max(total ?? 0, ...m.points.map((p) => p.total ?? 0));
  const yMaxRaw = Math.max(1, ...actual.map((a) => a.y), chart === "up" ? scopeMax : 0, ...samples.map((s) => s.hi));
  const yt = ticks(0, yMaxRaw, H < 200 ? 3 : 4);
  const yMax = Math.max(yMaxRaw, yt[yt.length - 1]);
  const labelW = Math.min(64, Math.max(26, ...yt.map((t) => count(t).length * 6.4 + 8)));
  const L = labelW;
  const R = 12;
  const T = 16;
  const B = 24;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const X = (t: number) => L + ((t - x0) / (x1 - x0 || 1)) * plotW;
  const Y = (v: number) => T + plotH - (v / (yMax || 1)) * plotH;
  const xt = timeTicks(x0, x1, Math.max(3, Math.floor(plotW / 70)));
  const path = (pts: { t: number; y: number }[], stepped: boolean) =>
    pts.map((p, k) => (k === 0 ? `M${X(p.t).toFixed(1)} ${Y(p.y).toFixed(1)}` : stepped ? `H${X(p.t).toFixed(1)} V${Y(p.y).toFixed(1)}` : `L${X(p.t).toFixed(1)} ${Y(p.y).toFixed(1)}`)).join(" ");
  const band = samples.length ? `${samples.map((s, k) => `${k ? "L" : "M"}${X(s.t).toFixed(1)} ${Y(s.hi).toFixed(1)}`).join(" ")} ${[...samples].reverse().map((s) => `L${X(s.t).toFixed(1)} ${Y(s.lo).toFixed(1)}`).join(" ")} Z` : null;
  const proj = samples.length ? path(samples.filter((s, k) => k === 0 || s.t <= (m.eta?.at ?? 0)).map((s) => ({ t: s.t, y: s.mid })), false) : null;
  const projEnd = m.eta && m.eta.at <= x1 && total != null ? { t: m.eta.at, y: chart === "down" ? 0 : total } : null;
  // Scope over time, for a burn-up: a step line.
  const scopeLine =
    chart === "up" && total != null
      ? (() => {
          const pts = m.points.map((p) => ({ t: p.t, y: scopeAt(p) }));
          pts.push({ t: x1, y: total });
          return path(pts, true);
        })()
      : null;
  const deadlineColor = m.deadline?.verdict === "late" ? palette.tone.bad : m.deadline?.verdict === "at risk" ? palette.tone.warn : "var(--muted-foreground)";
  const showDeadline = m.deadline && m.deadline.at >= x0 && m.deadline.at <= x1;
  const fmtT = (t: number) => formatWhen(t, m.asOf, undefined, m.periodName === "day" ? false : undefined);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / (r.width || W);
    let best = 0;
    let bestD = Infinity;
    actual.forEach((a, k) => {
      const d = Math.abs(X(a.t) - px);
      if (d < bestD) (bestD = d), (best = k);
    });
    setHover(bestD < 40 ? best : null);
  };
  const hovered = hover != null ? actual[hover] : null;

  return (
    <div ref={box} className="relative mt-3 min-w-0">
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="iris-chart block select-none overflow-visible" role="img" aria-label={forecastWords(m, unit)} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yt.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className="stroke-border" strokeDasharray={t === 0 ? undefined : "2 4"} />
            <text x={L - 8} y={Y(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {count(t)}
            </text>
          </g>
        ))}
        {xt.ts.map((t, k) => {
          const x = X(t);
          const anchor = x < L + 24 ? "start" : x > W - R - 24 ? "end" : "middle";
          return (
            <text key={k} x={x} y={H - 6} textAnchor={anchor} className="fill-muted-foreground text-[11px]">
              {xt.label(t)}
            </text>
          );
        })}
        {band && m.spread > 0 ? <path d={band} fill={bandFill(palette)} stroke="none" /> : null}
        {scopeLine ? <path d={scopeLine} fill="none" stroke="var(--muted-foreground)" strokeOpacity={0.7} strokeWidth={1.5} /> : null}
        {m.scope.map((c, k) => {
          const x = X(c.t);
          const right = x > L + plotW * 0.7;
          return (
            <g key={k}>
              <line x1={x} x2={x} y1={T} y2={T + plotH} stroke="var(--muted-foreground)" strokeOpacity={0.55} strokeDasharray="2 3" />
              <text x={right ? x - 4 : x + 4} y={T - 4} textAnchor={right ? "end" : "start"} className="fill-muted-foreground text-[10.5px]">
                {c.to > c.from ? "+" : "−"}
                {count(Math.abs(c.to - c.from))} scope
              </text>
            </g>
          );
        })}
        {showDeadline ? (
          <g>
            <line x1={X(m.deadline!.at)} x2={X(m.deadline!.at)} y1={T} y2={T + plotH} stroke={deadlineColor} strokeDasharray="5 3" />
            <text x={X(m.deadline!.at) - 4} y={T + 10} textAnchor="end" className="text-[10.5px]" fill={deadlineColor}>
              Deadline
            </text>
          </g>
        ) : null}
        {proj ? <path d={projEnd ? `${proj} L${X(projEnd.t).toFixed(1)} ${Y(projEnd.y).toFixed(1)}` : proj} fill="none" stroke={palette.accent} strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" /> : null}
        <path d={path(actual, m.steps)} fill="none" stroke={palette.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {!m.steps && actual.length <= 40
          ? actual.map((a, k) => <circle key={k} cx={X(a.t)} cy={Y(a.y)} r={hover === k ? 4.5 : 2.75} fill={hover === k ? palette.accent : "var(--card)"} stroke={palette.accent} strokeWidth={2} />)
          : null}
        <circle cx={X(m.asOf)} cy={Y(nowY)} r={4} fill={palette.accent} />
        {projEnd ? <circle cx={X(projEnd.t)} cy={Y(projEnd.y)} r={4} fill="var(--card)" stroke={palette.accent} strokeWidth={2} /> : null}
        {hovered ? <line x1={X(hovered.t)} x2={X(hovered.t)} y1={T} y2={T + plotH} className="stroke-muted-foreground" strokeDasharray="3 3" /> : null}
      </svg>
      {hovered ? (
        <div className="pointer-events-none absolute top-0 rounded-lg bg-popover px-2 py-1 text-[11.5px] tabular-nums text-popover-foreground shadow-sm ring-1 ring-border" style={readoutStyle(X(hovered.t), W)}>
          <span className="text-muted-foreground">{fmtT(hovered.t)}</span> · {count(hovered.done)}
          {hovered.scope ? ` of ${count(hovered.scope)}` : ""} done
        </div>
      ) : null}
      {offChart ? <div className="mt-1 text-right text-[11px] text-muted-foreground">The late end, {fmtT(m.eta!.late)}, is past the chart.</div> : null}
    </div>
  );
}

function readoutStyle(x: number, W: number): CSSProperties {
  const left = (x / W) * 100;
  return left > 60 ? { right: `${100 - left}%`, marginRight: 8 } : { left: `${left}%`, marginLeft: 8 };
}

