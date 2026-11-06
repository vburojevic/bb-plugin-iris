// Time tools (chunk "tools"): TimeZones, Cron and DateDiff. Rules live in
// core/time.ts; the person's slot, expression and dates are saved with the card.

import { Chip, Glyph, InlineError, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { isPendingValue } from "../core/evaluate";
import {
  type ZoneRow,
  MONTH_SHORT,
  WEEKDAY_SHORT,
  bestSlot,
  businessSpan,
  clockText,
  cronFields,
  describeCron,
  localZone,
  nextRuns,
  normalizeZones,
  offsetLabel,
  parseCron,
  parseDay,
  readHolidays,
  readHour,
  resolveZone,
  shortDate,
  slotInHours,
  todayIn,
  wallClock,
  weeksAndDays,
  zoneOffset,
  zonedInstant,
} from "../core/time";
import type { ViewProps } from "../ui/render";
import { ErrorLine, FIELD, GHOST_BTN, Header, tint, useMemory, useNow, useWidth } from "./tools-kit";

// ---------- TimeZones ----------

const DAY_MIN = 24 * 60;

export function TimeZonesView({ props, node }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const pending = isPendingValue(props.zones);
  // Props are new arrays on every render; key the work on their content so a drag stays light.
  const zonesKey = pending ? "" : JSON.stringify([props.zones, props.hours]);
  const model = useMemo(() => (pending ? null : normalizeZones(props.zones, props.hours)), [zonesKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = model?.rows ?? [];
  const ref = rows[0]?.tz ?? "UTC";
  const now = useNow(60_000);
  const date = typeof props.date === "string" && parseDay(props.date) ? props.date : nextWeekday(todayIn(ref, now));
  const dayStart = useMemo(() => zonedInstant(date, 0, ref), [date, ref]);
  const duration = Math.max(15, Math.min(12 * 60, num(props.duration) ?? 60));
  const step = Math.max(5, Math.min(120, num(props.step) ?? 30));
  const best = useMemo(() => (rows.length ? bestSlot(rows, dayStart, duration, step) : 9 * 60), [rows, dayStart, duration, step]);
  const given = readHour(props.at);
  // "15:00" is read on the first row's clock, so a daylight-saving day still lands on 15:00.
  const initial = given != null ? Math.round((zonedInstant(date, given * 60, ref) - dayStart) / 60000) : best;
  const [saved, setSaved] = useMemory<number>(node, "slot", [props.zones, props.date ?? "", props.at, duration]);
  const start = clampSlot(saved ?? initial, duration);
  const [box, width] = useWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 560;
  const slotMs = dayStart + start * 60000;

  const inHours = rows.map((r) => slotInHours(r, slotMs, duration));
  const okCount = inHours.filter(Boolean).length;

  const bind = str(props.bind);
  useEffect(() => {
    if (!bind || !env.runtime.hasState(bind) || !rows.length) return;
    const times = Object.fromEntries(rows.map((r) => [r.label, rangeText(r.tz, slotMs, duration)]));
    const value = { start: new Date(slotMs).toISOString(), end: new Date(slotMs + duration * 60000).toISOString(), times, inHours: okCount };
    if (JSON.stringify(env.runtime.getState(bind)) !== JSON.stringify(value)) env.runtime.setState(bind, value);
  }, [bind, slotMs, duration, okCount, rows, env.runtime]);

  if (pending) return <Shimmer className="h-40" />;
  if (!model || !rows.length) return <InlineError error={new Error(model?.problems[0] ?? "needs zones")} context="<TimeZones>" />;

  const move = (minutes: number) => setSaved(clampSlot(minutes, duration));
  const refDay = wallClock(ref, dayStart + 12 * 3600e3);
  const summary = okCount === rows.length ? (rows.length === 1 ? "In working hours" : `All ${rows.length} in working hours`) : `${okCount} of ${rows.length} in working hours`;
  const labelW = narrow ? 0 : Math.min(200, Math.max(150, width * 0.27));
  const trackW = Math.max(0, (narrow ? width : width - labelW - 12) || 0);
  const cell = trackW / 24;
  const every = cell >= 19 ? 1 : cell >= 11 ? 2 : 3;

  return (
    <div ref={box} className="min-w-0">
      <Header
        title={str(props.title)}
        right={
          start !== best ? (
            <button type="button" className={GHOST_BTN} onClick={() => setSaved(best)}>
              <Glyph name="sparkles" size={13} />
              Best time
            </button>
          ) : null
        }
      />
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-[13.5px] font-semibold tabular-nums">
          {WEEKDAY_SHORT[refDay.weekday]}, {MONTH_SHORT[refDay.month - 1]} {refDay.day} · {rangeText(ref, slotMs, duration)}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: okCount === rows.length ? palette.tone.good : palette.tone.warn }}>
          <Glyph name={okCount === rows.length ? "circle-check" : "moon"} size={13} />
          {summary}
        </span>
      </div>
      {model.problems.length ? <ErrorLine className="mb-2">{model.problems[0]}</ErrorLine> : null}
      {width > 0 ? (
        <div className="space-y-1.5">
          {rows.map((r, k) => (
            <ZoneLine key={k} row={r} narrow={narrow} labelW={labelW} trackW={trackW} every={every} dayStart={dayStart} refDay={refDay.day} start={start} duration={duration} step={step} ok={inHours[k]} slotMs={slotMs} onMove={move} />
          ))}
        </div>
      ) : (
        <Shimmer className="h-32" />
      )}
      <div className="mt-2 text-[11.5px] text-muted-foreground">Drag the slot or use the arrow keys. Shaded hours are working hours, Monday to Friday.</div>
    </div>
  );
}

/** Today, or the Monday after when today is a weekend. */
function nextWeekday(date: string): string {
  const d = parseDay(date);
  if (!d) return date;
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d));
  const wd = t.getUTCDay();
  if (wd === 0 || wd === 6) t.setUTCDate(t.getUTCDate() + (wd === 6 ? 2 : 1));
  return t.toISOString().slice(0, 10);
}

function clampSlot(m: number, duration: number): number {
  return Math.max(0, Math.min(DAY_MIN - duration, Math.round(m)));
}

function rangeText(tz: string, start: number, duration: number): string {
  const a = wallClock(tz, start);
  const b = wallClock(tz, start + duration * 60000);
  const nextDay = b.day !== a.day ? " +1" : "";
  return `${clockText(a.hour, a.minute)} – ${clockText(b.hour, b.minute)}${nextDay}`;
}

function ZoneLine(p: { row: ZoneRow; narrow: boolean; labelW: number; trackW: number; every: number; dayStart: number; refDay: number; start: number; duration: number; step: number; ok: boolean; slotMs: number; onMove: (m: number) => void }) {
  const { palette } = useEnv();
  const { row, narrow, labelW, trackW, start, duration, step, ok, slotMs, onMove } = p;
  const track = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; start: number } | null>(null);
  const local = wallClock(row.tz, slotMs);
  const offset = zoneOffset(row.tz, slotMs);
  const cells = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) => {
        const t = p.dayStart + h * 3600e3;
        const c = wallClock(row.tz, t);
        const work = c.weekday !== 0 && c.weekday !== 6 && within(row.work, c.hour + c.minute / 60);
        return { c, work, newDay: c.hour === 0 || (h > 0 && c.day !== wallClock(row.tz, t - 3600e3).day) };
      }),
    [row, p.dayStart],
  );
  const toMinutes = (clientX: number) => {
    const el = track.current;
    if (!el) return start;
    const r = el.getBoundingClientRect();
    return ((clientX - r.left) / Math.max(1, r.width)) * DAY_MIN;
  };
  const snap = (m: number) => Math.round(m / step) * step;
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const m = toMinutes(e.clientX);
    const onSlot = m >= start && m <= start + duration;
    drag.current = { x: e.clientX, start: onSlot ? start : snap(m - duration / 2) };
    if (!onSlot) onMove(drag.current.start);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveTo = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !track.current) return;
    const dm = ((e.clientX - d.x) / Math.max(1, track.current.getBoundingClientRect().width)) * DAY_MIN;
    onMove(snap(d.start + dm));
  };
  const up = () => (drag.current = null);
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const by = e.shiftKey ? 60 : step;
    const next = e.key === "ArrowRight" ? start + by : e.key === "ArrowLeft" ? start - by : e.key === "Home" ? 0 : e.key === "End" ? DAY_MIN - duration : null;
    if (next == null) return;
    e.preventDefault();
    onMove(next);
  };
  const label = (
    <div className={cn("min-w-0", narrow ? "flex items-baseline gap-2" : "")} style={narrow ? undefined : { width: labelW }}>
      <div className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium">{row.label}</span>
        {row.note ? <span className="truncate text-[11.5px] text-muted-foreground">{row.note}</span> : null}
      </div>
      <div className={cn("flex min-w-0 items-center gap-1 text-[12px] tabular-nums", narrow && "ml-auto shrink-0")}>
        <span style={ok ? undefined : { color: palette.tone.warn }} className={cn(!ok && "font-medium")}>
          {rangeText(row.tz, slotMs, duration)}
        </span>
        <span className="text-muted-foreground">
          {local.weekday !== wallClock(row.tz, p.dayStart + 12 * 3600e3).weekday || local.day !== p.refDay ? `${WEEKDAY_SHORT[local.weekday]} · ` : ""}
          {offsetLabel(offset)}
        </span>
      </div>
    </div>
  );
  return (
    <div className={cn("min-w-0", narrow ? "space-y-1" : "flex items-center gap-3")}>
      {label}
      <div
        ref={track}
        role="slider"
        tabIndex={0}
        aria-label={`Meeting slot, ${row.label}`}
        aria-valuemin={0}
        aria-valuemax={DAY_MIN - duration}
        aria-valuenow={start}
        aria-valuetext={`${rangeText(row.tz, slotMs, duration)} in ${row.label}${ok ? "" : ", outside working hours"}`}
        onPointerDown={down}
        onPointerMove={moveTo}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
        className="relative h-8 shrink-0 cursor-pointer touch-none select-none overflow-hidden rounded-lg ring-1 ring-border outline-none focus-visible:ring-2 focus-visible:ring-[var(--iris-accent)]"
        style={{ width: trackW }}
      >
        <div className="absolute inset-0 flex">
          {cells.map((x, h) => (
            <div key={h} className={cn("relative flex flex-1 items-center justify-center text-[10.5px] tabular-nums", x.work ? "text-foreground/80" : "text-muted-foreground/70")} style={{ background: x.work ? tint("var(--foreground)", 9) : undefined, borderLeft: x.newDay && h > 0 ? "1px solid var(--border)" : undefined }}>
              {/* Where hours are labeled sparsely, the cells under and beside the slot stay blank, so its outline never cuts a label. */}
              {p.every > 1 && h * 60 < start + duration + 60 && (h + 1) * 60 > start - 60 ? null : x.newDay && p.every <= 2 ? (
                <span className="text-[9.5px] font-semibold uppercase tracking-wide">{WEEKDAY_SHORT[x.c.weekday].slice(0, p.every === 1 ? 3 : 2)}</span>
              ) : h % p.every === 0 ? (
                <span title={x.c.minute ? clockText(x.c.hour, x.c.minute) : undefined}>{x.c.hour}</span>
              ) : null}
            </div>
          ))}
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 rounded-md"
          style={{ left: `${(start / DAY_MIN) * 100}%`, width: `${(duration / DAY_MIN) * 100}%`, background: palette.accentSoft, boxShadow: `inset 0 0 0 2px ${palette.accent}` }}
        />
      </div>
    </div>
  );
}

function within([a, b]: [number, number], h: number): boolean {
  return a < b ? h >= a && h < b : h >= a || h < b;
}

// ---------- Cron ----------

export function CronView({ props, node }: ViewProps) {
  const given = str(props.expr) ?? "";
  const [saved, setSaved] = useMemory<string>(node, "expr", given);
  const expr = saved ?? given;
  const [draft, setDraft] = useState(expr);
  useEffect(() => setDraft(expr), [expr]);
  const zone = props.tz === undefined ? "UTC" : resolveZone(props.tz);
  const here = localZone();
  const now = useNow(30_000);
  const { cron, error } = useMemo(() => parseCron(expr), [expr]);
  const count = Math.max(1, Math.min(20, Math.round(num(props.count) ?? 5)));
  const runs = useMemo(() => (cron && zone ? nextRuns(cron, now, count, zone) : []), [cron, zone, now, count]);
  const editable = props.editable !== false;
  const commit = () => {
    const t = draft.trim();
    if (t && t !== expr) setSaved(t === given ? null : t);
  };
  return (
    <div className="min-w-0">
      <Header title={str(props.title)} right={zone ? <Chip icon="globe">{zone}</Chip> : null} />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {editable ? (
          <input
            value={draft}
            spellCheck={false}
            aria-label="Cron expression"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(expr);
            }}
            className={cn(FIELD, "h-9 min-w-0 flex-1 basis-[12rem] text-[14px] tracking-wide")}
          />
        ) : (
          <code className="font-mono text-[14px] tracking-wide">{expr}</code>
        )}
        {saved !== null && editable ? (
          <button type="button" className={GHOST_BTN} onClick={() => setSaved(null)}>
            <Glyph name="rotate-ccw" size={13} />
            Reset
          </button>
        ) : null}
      </div>
      {!zone ? <ErrorLine className="mt-2">"{String(props.tz)}" is not a time zone</ErrorLine> : null}
      {error ? <ErrorLine className="mt-2">{error}</ErrorLine> : null}
      {cron ? (
        <>
          <div className="mt-2.5 text-[15px] font-semibold leading-snug tracking-[-0.01em]">{describeCron(cron)}</div>
          {/* Five tiles side by side; on a phone, one row per field so every meaning reads in full. */}
          <dl className="mt-3 grid grid-cols-5 gap-1.5 @max-lg/iris:grid-cols-1 @max-lg/iris:gap-0 @max-lg/iris:overflow-hidden @max-lg/iris:rounded-lg @max-lg/iris:ring-1 @max-lg/iris:ring-border @max-lg/iris:[&>div+div]:border-t @max-lg/iris:[&>div+div]:border-border">
            {cronFields(cron).map((f) => (
              <div key={f.label} className="min-w-0 rounded-lg px-2 py-1.5 ring-1 ring-border @max-lg/iris:grid @max-lg/iris:grid-cols-[4rem_3.5rem_minmax(0,1fr)] @max-lg/iris:items-baseline @max-lg/iris:gap-2 @max-lg/iris:rounded-none @max-lg/iris:px-3 @max-lg/iris:ring-0">
                <dt className="truncate text-[10.5px] text-muted-foreground @max-lg/iris:text-[11.5px]">{f.label}</dt>
                <dd className="truncate font-mono text-[13px] font-medium">{f.raw}</dd>
                <dd className="text-[11px] leading-snug text-muted-foreground @max-lg/iris:text-[12px]">{f.meaning}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 text-[11.5px] font-medium text-muted-foreground">Next runs</div>
          {runs.length ? (
            <ol className="mt-1 [&>li+li]:border-t [&>li+li]:border-border/60">
              {runs.map((t, k) => {
                const w = wallClock(zone ?? "UTC", t);
                const mine = here !== zone ? wallClock(here, t) : null;
                return (
                  <li key={t} className="flex min-w-0 items-baseline gap-3 py-1.5 text-[13px]">
                    <span className={cn("w-[6.5rem] shrink-0 tabular-nums", k === 0 && "font-medium")}>
                      {WEEKDAY_SHORT[w.weekday]}, {MONTH_SHORT[w.month - 1]} {w.day}
                    </span>
                    <span className={cn("shrink-0 tabular-nums", k === 0 && "font-semibold")}>{clockText(w.hour, w.minute)}</span>
                    {mine ? (
                      <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground @min-[420px]/iris:inline">
                        {clockText(mine.hour, mine.minute)} your time{mine.day !== w.day ? `, ${WEEKDAY_SHORT[mine.weekday]}` : ""}
                      </span>
                    ) : null}
                    <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">{relative(t - now)}</span>
                  </li>
                );
              })}
            </ol>
          ) : zone ? (
            <div className="mt-1 text-[12.5px] text-muted-foreground">No run in the next five years</div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function relative(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return "now";
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} h`;
  return `in ${Math.round(h / 24)} days`;
}

// ---------- DateDiff ----------

export function DateDiffView({ props, node }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const givenFrom = str(props.from) ?? "";
  const givenTo = str(props.to) ?? "";
  const [saved, setSaved] = useMemory<{ from: string; to: string }>(node, "range", [givenFrom, givenTo]);
  const from = saved?.from ?? givenFrom;
  const to = saved?.to ?? givenTo;
  const pending = [props.from, props.to, props.holidays].some(isPendingValue);
  const holidays = useMemo(() => (pending ? { list: [], problems: [] } : readHolidays(props.holidays)), [pending, props.holidays]);
  const weekend = Array.isArray(props.weekend) ? props.weekend.map(Number).filter((n) => n >= 0 && n <= 6) : undefined;
  const inclusive = props.inclusive !== false;
  const result = useMemo(() => {
    try {
      return { span: businessSpan(from, to, { holidays: holidays.list, weekend, inclusive }), error: null };
    } catch (e) {
      return { span: null, error: e instanceof Error ? e.message : String(e) };
    }
  }, [from, to, holidays.list, weekend?.join(), inclusive]); // eslint-disable-line react-hooks/exhaustive-deps
  const span = result.span;

  const bind = str(props.bind);
  useEffect(() => {
    if (!bind || !span || !env.runtime.hasState(bind)) return;
    const value = { from, to, businessDays: span.businessDays, calendarDays: span.calendarDays };
    if (JSON.stringify(env.runtime.getState(bind)) !== JSON.stringify(value)) env.runtime.setState(bind, value);
  }, [bind, span, from, to, env.runtime]);

  if (pending) return <Shimmer className="h-28" />;
  const editable = props.editable !== false;
  const setDate = (which: "from" | "to", v: string) => {
    if (!parseDay(v)) return;
    const next = { from, to, [which]: v };
    setSaved(next.from === givenFrom && next.to === givenTo ? null : next);
  };
  const dateField = (which: "from" | "to", v: string) =>
    editable ? (
      <input type="date" value={parseDay(v) ? v : ""} aria-label={which === "from" ? "Start date" : "End date"} onChange={(e) => setDate(which, e.target.value)} className={cn(FIELD, "iris-field h-8 w-full min-w-0 font-sans text-[13px] tabular-nums")} style={{ colorScheme: palette.dark ? "dark" : "light" }} />
    ) : (
      <span className="text-[13.5px] font-medium tabular-nums">{shortDate(v, true)}</span>
    );
  return (
    <div className="min-w-0">
      <Header
        title={str(props.title)}
        right={
          saved && editable ? (
            <button type="button" className={GHOST_BTN} onClick={() => setSaved(null)}>
              <Glyph name="rotate-ccw" size={13} />
              Reset
            </button>
          ) : null
        }
      />
      {/* From, arrow, to on one row at every width: the fields share it instead of wrapping apart. */}
      <div className="grid max-w-[26rem] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 @max-[20rem]/iris:grid-cols-1 @max-[20rem]/iris:justify-items-start">
        {dateField("from", from)}
        <Glyph name="arrow-right" size={14} className="text-muted-foreground @max-[20rem]/iris:ml-3 @max-[20rem]/iris:rotate-90" />
        {dateField("to", to)}
      </div>
      {holidays.problems.length ? <ErrorLine className="mt-2">{holidays.problems[0]}</ErrorLine> : null}
      {result.error ? <ErrorLine className="mt-2">{result.error}</ErrorLine> : null}
      {span ? (
        <>
          <div className="mt-3 flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-[30px] font-semibold leading-none tracking-[-0.03em] tabular-nums">{span.businessDays}</span>
            <span className="text-[14px] text-muted-foreground">{Math.abs(span.businessDays) === 1 ? "business day" : "business days"}{span.backwards ? ", counting back" : ""}</span>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 @min-[480px]/iris:grid-cols-4">
            <Fact label="Calendar days" value={String(Math.abs(span.calendarDays))} note={weeksAndDays(span.calendarDays)} />
            <Fact label="Weekend days" value={String(span.weekendDays)} />
            <Fact label="Holidays" value={String(span.holidays.length)} note={span.holidays.length ? "on working days" : undefined} />
            <Fact label="Counted" value={inclusive ? "Both ends" : "After start"} />
          </dl>
          {span.cells.length ? <DayStrip span={span} accent={palette.accent} holiday="var(--muted-foreground)" /> : <div className="mt-3 text-[12px] text-muted-foreground">The range is too long to draw day by day.</div>}
          {span.holidays.length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {span.holidays.map((h) => (
                <Chip key={h.date} icon="calendar-off">
                  {shortDate(h.date)}
                  {h.name ? ` ${h.name}` : ""}
                </Chip>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[11.5px] text-muted-foreground">{label}</dt>
      <dd className="truncate text-[14px] font-medium tabular-nums">
        {value}
        {note ? <span className="ml-1.5 text-[11.5px] font-normal text-muted-foreground">{note}</span> : null}
      </dd>
    </div>
  );
}

function DayStrip({ span, accent, holiday }: { span: NonNullable<ReturnType<typeof businessSpan>>; accent: string; holiday: string }) {
  const months = useMemo(() => {
    const out: { key: string; label: string; cells: typeof span.cells }[] = [];
    for (const c of span.cells) {
      const key = c.date.slice(0, 7);
      let m = out[out.length - 1];
      if (!m || m.key !== key) {
        const d = parseDay(c.date)!;
        m = { key, label: `${MONTH_SHORT[d.m - 1]}${out.length === 0 || d.m === 1 ? ` ${d.y}` : ""}`, cells: [] };
        out.push(m);
      }
      m.cells.push(c);
    }
    return out;
  }, [span]);
  return (
    <div className="mt-3.5 min-w-0">
      <div className="flex min-w-0 flex-wrap gap-x-3 gap-y-2">
        {months.map((m) => (
          <div key={m.key} className="min-w-0">
            <div className="mb-1 text-[10.5px] font-medium text-muted-foreground">{m.label}</div>
            <div className="flex flex-wrap gap-[3px]" style={{ maxWidth: 31 * 13 }}>
              {m.cells.map((c) => (
                <span
                  key={c.date}
                  title={`${shortDate(c.date)} ${WEEKDAY_SHORT[c.weekday]}${c.name ? `, ${c.name}` : c.kind === "weekend" ? ", weekend" : ""}`}
                  className="size-[10px] rounded-[3px]"
                  style={c.kind === "work" ? { background: accent } : c.kind === "holiday" ? { boxShadow: `inset 0 0 0 1.5px ${holiday}` } : { background: tint("var(--foreground)", 10) }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
        <Legend style={{ background: accent }}>Business day</Legend>
        <Legend style={{ background: tint("var(--foreground)", 10) }}>Weekend</Legend>
        {span.holidays.length ? <Legend style={{ boxShadow: `inset 0 0 0 1.5px ${holiday}` }}>Holiday</Legend> : null}
      </div>
    </div>
  );
}

function Legend({ style, children }: { style: CSSProperties; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-[9px] rounded-[2px]" style={style} />
      {children}
    </span>
  );
}
