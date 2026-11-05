import { useMemo, useState } from "react";
import { toText } from "../../core/evaluate";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Chip, Glyph, cn, num, str } from "./kit";
import { EditableBoardView } from "./lazy";

type Obj = Record<string, unknown>;
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map((x) => (x && typeof x === "object" ? (x as Obj) : { title: x })) : []);

function StatusMark({ status, index }: { status: string; index?: number }) {
  const env = useEnv();
  if (status === "done") {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full" style={{ background: env.palette.tone.good }}>
        <Glyph name="check" size={12} className="text-background" />
      </span>
    );
  }
  if (status === "failed" || status === "blocked") {
    return (
      <span className="grid size-5 shrink-0 place-items-center rounded-full" style={{ background: env.palette.tone.bad }}>
        <Glyph name={status === "failed" ? "x" : "pause"} size={11} className="text-background" />
      </span>
    );
  }
  if (status === "current") {
    return (
      <span className="iris-glyph-alive relative grid size-5 shrink-0 place-items-center rounded-full p-[2px]">
        <span className="grid size-full place-items-center rounded-full bg-card text-[10px] font-semibold">{index ?? ""}</span>
      </span>
    );
  }
  return <span className="grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-muted-foreground ring-[1.5px] ring-border">{index ?? ""}</span>;
}

export function PlanView({ props }: ViewProps) {
  const env = useEnv();
  const steps = list(props.steps);
  const riskColor = (r: string) => (r === "high" ? env.palette.tone.bad : r === "medium" ? env.palette.tone.warn : env.palette.tone.neutral);
  const title = str(props.title);
  return (
    <div className="min-w-0">
      <ol className="[&>li+li]:border-t [&>li+li]:border-border/70">
        {steps.map((s, k) => {
          const files = Array.isArray(s.files) ? s.files.map(toText) : [];
          const risk = str(s.risk);
          return (
            <li key={k} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] gap-x-3 py-2.5">
              <StatusMark status={str(s.status) ?? "todo"} index={k + 1} />
              <div className="min-w-0">
                <div className={cn("text-[13.5px] font-medium", s.status === "done" && "text-muted-foreground")}>{toText(s.title)}</div>
                {str(s.detail) ? <div className="text-[12.5px] text-muted-foreground">{str(s.detail)}</div> : null}
                {files.length ? (
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    {files.map((f) => (
                      <button key={f} type="button" onClick={() => env.perform([{ $iris: "action", kind: "openFile", args: [f, null] }])} className="truncate font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:underline">
                        {f}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="text-right text-xs tabular-nums text-muted-foreground">
                {str(s.estimate)}
                {risk ? (
                  <div className="mt-0.5" style={{ color: riskColor(risk) }}>
                    {risk[0].toUpperCase() + risk.slice(1)} risk
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      {props.approve ? (
        <div className="mt-2 flex flex-wrap justify-end gap-2">
          <button type="button" className="h-8 rounded-full px-3.5 text-[13px] font-medium ring-1 ring-border hover:bg-state-hover" onClick={() => env.perform([{ $iris: "action", kind: "insert", args: [`Change the plan${title ? ` "${title}"` : ""}: `] }])}>
            Change a step
          </button>
          <button
            type="button"
            className="h-8 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background hover:opacity-90"
            onClick={() => (env.submit ? env.submit({ approved: true }) : env.perform([{ $iris: "action", kind: "insert", args: [`Approved${title ? `: ${title}` : ""}. Go ahead.`] }]))}
          >
            Approve plan
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function StepsView({ props }: ViewProps) {
  const items = list(props.items);
  const horizontal = props.orientation === "horizontal";
  if (horizontal) {
    return (
      <ol className="iris-scroll-x flex min-w-0 items-start overflow-x-auto">
        {items.map((s, k) => (
          <li key={k} className="flex min-w-[7rem] flex-1 flex-col items-center gap-1.5 text-center">
            <div className="flex w-full items-center">
              <span className={cn("h-px flex-1", k ? "bg-border" : "")} />
              <StatusMark status={str(s.status) ?? "todo"} index={k + 1} />
              <span className={cn("h-px flex-1", k < items.length - 1 ? "bg-border" : "")} />
            </div>
            <div className="px-1 text-[12.5px] font-medium">{toText(s.title)}</div>
            {str(s.detail) ? <div className="px-1 text-[11.5px] text-muted-foreground">{str(s.detail)}</div> : null}
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className="min-w-0">
      {items.map((s, k) => (
        <li key={k} className="relative grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 pb-3 last:pb-0">
          {k < items.length - 1 ? <span className="absolute left-[9.5px] top-6 bottom-0 w-px bg-border" aria-hidden /> : null}
          <StatusMark status={str(s.status) ?? "todo"} index={k + 1} />
          <div className="min-w-0 pt-px">
            <div className={cn("text-[13.5px]", s.status === "current" && "font-medium")}>{toText(s.title)}</div>
            {str(s.detail) ? <div className="text-[12.5px] text-muted-foreground">{str(s.detail)}</div> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function TimelineView({ props }: ViewProps) {
  const env = useEnv();
  let items = list(props.items);
  if (props.order === "newest") items = [...items].reverse();
  return (
    <ol className="min-w-0">
      {items.map((e, k) => {
        const color = typeof e.tone === "string" && e.tone in env.palette.tone ? env.palette.tone[e.tone as keyof typeof env.palette.tone] : "var(--muted-foreground)";
        return (
          <li key={k} className="relative grid grid-cols-[4.5rem_0.75rem_minmax(0,1fr)] gap-x-3 pb-3 last:pb-0">
            <time className="pt-px text-right text-xs tabular-nums text-muted-foreground">{toText(e.time)}</time>
            <span className="relative flex justify-center">
              <span className="relative z-[1] mt-1.5 size-2.5 rounded-full ring-[3px] ring-card" style={{ background: color }} />
              {k < items.length - 1 ? <span className="absolute top-3 bottom-[-0.75rem] w-px bg-border" /> : null}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[13.5px]">
                {e.icon ? <Glyph name={e.icon} size={14} color={color} /> : null}
                {toText(e.title)}
              </div>
              {str(e.detail) ? <div className="text-[12.5px] text-muted-foreground">{str(e.detail)}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function DecisionView({ props }: ViewProps) {
  const env = useEnv();
  const criteria = Array.isArray(props.criteria) ? props.criteria.map(toText) : [];
  const options = list(props.options);
  const [weights, setWeights] = useState<number[]>(() => criteria.map((_, k) => (Array.isArray(props.weights) ? Number(props.weights[k] ?? 3) : 3)));
  const scored = useMemo(() => {
    const max = 5 * weights.reduce((a, b) => a + b, 0) || 1;
    return options
      .map((o) => {
        const scores = Array.isArray(o.scores) ? o.scores.map(Number) : [];
        const total = criteria.reduce((s, _, k) => s + (scores[k] ?? 0) * weights[k], 0);
        return { o, scores, pct: Math.round((total / max) * 100) };
      })
      .sort((a, b) => b.pct - a.pct);
  }, [options, weights, criteria]);
  const bind = str(props.bind);
  const update = (k: number, v: number) => {
    const next = weights.map((w, j) => (j === k ? v : w));
    setWeights(next);
    if (bind && env.runtime.hasState(bind)) env.runtime.setState(bind, { weights: Object.fromEntries(criteria.map((c, j) => [c, next[j]])), ranking: scored.map((s) => toText(s.o.name)) });
  };
  return (
    <div className="min-w-0">
      <ol className="space-y-1.5">
        {scored.map(({ o, scores, pct }, k) => (
          <li key={toText(o.name)} className={cn("rounded-xl px-3 py-2.5 ring-1 ring-border transition-shadow", k === 0 && "iris-top-pick")}>
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-medium">
                  {toText(o.name)}
                  {k === 0 ? <Chip tone="good" className="shrink-0">Top pick</Chip> : null}
                </div>
                {str(o.note) ? <div className="truncate text-xs text-muted-foreground">{str(o.note)}</div> : null}
              </div>
              <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted max-sm:w-16">
                <div className="iris-bar h-full rounded-full" style={{ width: `${pct}%`, background: k === 0 ? env.palette.accent : "var(--muted-foreground)" }} />
              </div>
              <span className="w-8 text-right text-[13px] font-semibold tabular-nums">{pct}</span>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted-foreground">
              {criteria.map((c, j) => (
                <span key={c}>
                  {c} <span className="tabular-nums text-foreground">{scores[j] ?? "?"}</span>/5
                </span>
              ))}
            </div>
            {Array.isArray(o.pros) || Array.isArray(o.cons) ? (
              <div className="mt-1.5 grid gap-x-4 gap-y-0.5 text-[12px] sm:grid-cols-2">
                <ul className="space-y-0.5">
                  {((o.pros as unknown[] | undefined) ?? []).map((p, j) => (
                    <li key={j} className="flex gap-1.5">
                      <Glyph name="plus" size={12} className="mt-0.5" color={env.palette.tone.good} />
                      {toText(p)}
                    </li>
                  ))}
                </ul>
                <ul className="space-y-0.5">
                  {((o.cons as unknown[] | undefined) ?? []).map((p, j) => (
                    <li key={j} className="flex gap-1.5">
                      <Glyph name="minus" size={12} className="mt-0.5" color={env.palette.tone.bad} />
                      {toText(p)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="mt-3 grid grid-cols-[max-content_minmax(0,1fr)_1.25rem] items-center gap-x-3 gap-y-1.5 text-[12.5px]">
        {criteria.map((c, k) => (
          <WeightRow key={c} label={c} value={weights[k]} onChange={(v) => update(k, v)} />
        ))}
      </div>
    </div>
  );
}

function WeightRow({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <>
      <label className="text-muted-foreground">{label}</label>
      <input type="range" min={0} max={5} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} className="iris-range w-full" style={{ ["--iris-fill" as string]: `${(value / 5) * 100}%` }} aria-label={`Weight of ${label}`} />
      <output className="text-right tabular-nums text-muted-foreground">{value}</output>
    </>
  );
}

export function BoardView(view: ViewProps) {
  // Editable boards (drag, keyboard moves, add, rename) load on demand.
  if (view.props.editable === true) return <EditableBoardView {...view} />;
  return <ReadOnlyBoard {...view} />;
}

function ReadOnlyBoard({ props }: ViewProps) {
  const env = useEnv();
  const items = list(props.items);
  const columns = Array.isArray(props.columns) ? props.columns.map(toText) : [...new Set(items.map((i) => toText(i.status)))];
  return (
    <div className="iris-scroll-x -mx-1 flex min-w-0 gap-2.5 overflow-x-auto px-1 pb-1">
      {columns.map((col) => {
        const cards = items.filter((i) => toText(i.status) === col);
        return (
          <div key={col} className="flex min-w-[11rem] max-w-[18rem] flex-1 basis-0 flex-col gap-1.5 rounded-xl bg-muted/50 p-2">
            <div className="flex items-center justify-between px-1 text-xs font-medium">
              {col}
              <span className="tabular-nums text-muted-foreground">{cards.length}</span>
            </div>
            {cards.map((c, k) => {
              const color = typeof c.tone === "string" && c.tone in env.palette.tone ? env.palette.tone[c.tone as keyof typeof env.palette.tone] : undefined;
              return (
                <div key={k} className="rounded-lg bg-card px-2.5 py-2 text-[13px] shadow-[0_0_0_1px_var(--border)]" style={color ? { boxShadow: `inset 3px 0 0 ${color}, 0 0 0 1px var(--border)` } : undefined}>
                  <div className="leading-snug">{toText(c.title)}</div>
                  {str(c.detail) ? <div className="mt-0.5 text-xs text-muted-foreground">{str(c.detail)}</div> : null}
                  {str(c.tag) || str(c.assignee) ? (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      {str(c.tag) ? <Chip tone={c.tone}>{str(c.tag)}</Chip> : null}
                      {str(c.assignee) ? <span className="ml-auto text-[11px] text-muted-foreground">{str(c.assignee)}</span> : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {!cards.length ? <div className="px-1 py-3 text-center text-xs text-muted-foreground">Empty</div> : null}
          </div>
        );
      })}
    </div>
  );
}

const day = (s: unknown) => {
  const t = Date.parse(`${toText(s).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
};
const DAY = 86_400_000;

export function RoadmapView({ props }: ViewProps) {
  const env = useEnv();
  const items = list(props.items).map((i) => ({ ...i, s: day(i.start), e: day(i.end ?? i.start) })).filter((i) => i.s !== null) as (Obj & { s: number; e: number })[];
  if (!items.length) return null;
  const min = Math.min(...items.map((i) => i.s));
  const max = Math.max(...items.map((i) => i.e)) + DAY;
  const span = max - min || DAY;
  const lanes = [...new Set(items.map((i) => toText(i.lane ?? "")))];
  const x = (t: number) => `${((t - min) / span) * 100}%`;
  const now = Date.now();
  const months: { t: number; label: string }[] = [];
  const weeks = span / DAY > 60;
  for (let t = min; t <= max; t += DAY) {
    const d = new Date(t);
    if (weeks ? d.getUTCDate() === 1 : d.getUTCDay() === 1) months.push({ t, label: d.toLocaleDateString("en-US", { month: "short", day: weeks ? undefined : "numeric", timeZone: "UTC" }) });
  }
  return (
    <div className="min-w-0">
      <div className="relative ml-[7rem] h-5 text-[11px] text-muted-foreground max-sm:ml-0">
        {months.map((m) => (
          <span key={m.t} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: x(m.t) }}>
            {m.label}
          </span>
        ))}
      </div>
      <div className="space-y-2">
        {lanes.map((lane) => (
          <div key={lane} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-2 max-sm:grid-cols-1">
            <div className="truncate pt-1 text-xs font-medium text-muted-foreground">{lane}</div>
            <div className="relative space-y-1 rounded-lg bg-muted/40 py-1.5">
              {now >= min && now <= max ? <span className="absolute inset-y-0 w-px" style={{ left: x(now), background: env.palette.tone.bad }} aria-label="Today" /> : null}
              {items
                .filter((i) => toText(i.lane ?? "") === lane)
                .map((i, k) =>
                  i.milestone ? (
                    <div key={k} className="relative h-6">
                      <span className="absolute top-1 size-3.5 -translate-x-1/2 rotate-45 rounded-[3px]" style={{ left: x(i.s), background: env.palette.accent }} />
                      <span className="absolute top-0.5 whitespace-nowrap pl-3 text-[12px]" style={{ left: x(i.s) }}>
                        {toText(i.title)}
                      </span>
                    </div>
                  ) : (
                    <div key={k} className="relative h-6">
                      <div
                        className="absolute inset-y-0 flex items-center overflow-hidden rounded-md px-2 text-[12px] font-medium"
                        style={{ left: x(i.s), width: `max(1.5rem, ${((i.e + DAY - i.s) / span) * 100}%)`, background: `color-mix(in oklab, ${env.palette.accent} ${i.status === "done" ? 12 : 22}%, transparent)`, boxShadow: `inset 2px 0 0 ${env.palette.accent}` }}
                        title={`${toText(i.title)}: ${toText(i.start)} to ${toText(i.end ?? i.start)}`}
                      >
                        <span className="truncate">{toText(i.title)}</span>
                      </div>
                    </div>
                  ),
                )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EstimateView({ props }: ViewProps) {
  const unit = str(props.unit) ?? "h";
  const tasks = list(props.tasks).map((t) => {
    const low = num(t.low) ?? 0;
    const high = num(t.high) ?? low;
    const likely = num(t.likely) ?? (low + high) / 2;
    const mean = (low + 4 * likely + high) / 6;
    const sd = (high - low) / 6;
    return { title: toText(t.title), low, high, likely, mean, sd };
  });
  const mean = tasks.reduce((s, t) => s + t.mean, 0);
  const sd = Math.sqrt(tasks.reduce((s, t) => s + t.sd ** 2, 0));
  const p50 = mean;
  const p90 = mean + 1.2816 * sd;
  const max = Math.max(1, ...tasks.map((t) => t.high));
  const r = (v: number) => `${v.toFixed(v < 10 && v % 1 ? 1 : 0)} ${unit}`;
  return (
    <div className="min-w-0">
      <div className="mb-3 flex gap-6">
        <div>
          <div className="text-xs text-muted-foreground">Likely (P50)</div>
          <div className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{r(p50)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Safe (P90)</div>
          <div className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{r(p90)}</div>
        </div>
      </div>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li key={t.title} className="grid grid-cols-[minmax(0,1fr)_minmax(80px,40%)_4.5rem] items-center gap-3 text-[12.5px]">
            <span className="truncate">{t.title}</span>
            <span className="relative h-2 rounded-full bg-muted">
              <span className="absolute inset-y-0 rounded-full bg-muted-foreground/35" style={{ left: `${(t.low / max) * 100}%`, width: `${((t.high - t.low) / max) * 100}%` }} />
              <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" style={{ left: `${(t.likely / max) * 100}%` }} />
            </span>
            <span className="text-right tabular-nums text-muted-foreground">
              {t.low}-{t.high} {unit}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CalendarView({ props }: ViewProps) {
  const env = useEnv();
  const events = list(props.events);
  const first = str(props.month) ?? toText(events[0]?.date ?? new Date().toISOString()).slice(0, 7);
  const [y, m] = first.split("-").map(Number);
  const start = Date.UTC(y, (m || 1) - 1, 1);
  const lead = (new Date(start).getUTCDay() + 6) % 7; // weeks start Monday
  const daysIn = new Date(Date.UTC(y, m || 1, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, k) => k - lead + 1);
  const label = new Date(start).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="min-w-0">
      <div className="mb-2 text-[13px] font-semibold">{label}</div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg bg-border text-[11.5px]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="bg-card px-1.5 py-1 text-muted-foreground">
            {d}
          </div>
        ))}
        {cells.map((d, k) => {
          const date = d >= 1 && d <= daysIn ? `${first}-${String(d).padStart(2, "0")}` : null;
          const evs = date ? events.filter((e) => toText(e.date).slice(0, 10) === date) : [];
          return (
            <div key={k} className={cn("min-h-[3.75rem] bg-card p-1", !date && "bg-muted/40")}>
              {date ? <div className={cn("mb-0.5 inline-grid size-5 place-items-center rounded-full tabular-nums", date === today ? "bg-foreground text-background" : "text-muted-foreground")}>{d}</div> : null}
              {evs.slice(0, 3).map((e, j) => {
                const color = typeof e.tone === "string" && e.tone in env.palette.tone ? env.palette.tone[e.tone as keyof typeof env.palette.tone] : env.palette.accent;
                return (
                  <div key={j} className="mb-0.5 truncate rounded px-1 py-px text-[11px]" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)` }} title={toText(e.title)}>
                    {toText(e.title)}
                  </div>
                );
              })}
              {evs.length > 3 ? <div className="text-[10.5px] text-muted-foreground">+{evs.length - 3}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const STATUS_TONE: Record<string, string> = { "on-track": "good", "at-risk": "warn", "off-track": "bad", blocked: "bad", "not-started": "neutral", done: "info" };
const STATUS_LABEL: Record<string, string> = { "on-track": "On track", "at-risk": "At risk", "off-track": "Off track", blocked: "Blocked", "not-started": "Not started", done: "Done" };

export function StatusView({ props }: ViewProps) {
  const env = useEnv();
  const items = list(props.items);
  return (
    <ul className="[&>li+li]:border-t [&>li+li]:border-border/70">
      {items.map((i, k) => {
        const status = toText(i.status);
        const tone = STATUS_TONE[status] ?? "neutral";
        const progress = num(i.progress);
        return (
          <li key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-2">
            <div className="min-w-0">
              <div className="truncate text-[13.5px] font-medium">{toText(i.name)}</div>
              <div className="truncate text-xs text-muted-foreground">{[str(i.owner), str(i.due) ? `due ${str(i.due)}` : undefined, str(i.note)].filter(Boolean).join(", ")}</div>
            </div>
            <Chip tone={tone}>{STATUS_LABEL[status] ?? status}</Chip>
            {progress != null ? (
              <div className="col-span-2 h-1 overflow-hidden rounded-full bg-muted">
                <div className="iris-bar h-full rounded-full" style={{ width: `${Math.min(100, progress)}%`, background: env.palette.tone[tone as keyof typeof env.palette.tone] }} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
