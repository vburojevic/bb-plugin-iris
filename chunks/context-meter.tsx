// ContextMeter (chunk "agents"): one session's context window as a bar split
// by category (series colors, free space muted), its fill graded against the
// warn share, cost and model, and a history line where compactions show as
// drops. A list of sessions reads as totals by model and a meter per session.
// Inside a live card it records each new reading it sees. Logic lives in
// core/context.ts.

import { Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useEffect, useMemo, useState } from "react";
import { type ContextModel, type ContextPoint, type ContextRow, addReading, compactions, contextLevel, contextSegments, readContext, readPoints } from "../core/context";
import { isPendingValue } from "../core/evaluate";
import type { ViewProps } from "../ui/render";
import { Caption, Meter, Nothing, Problems, compact, money, pct, tint } from "./agents-kit";
import { useMemory } from "./tools-kit";

type Palette = ReturnType<typeof useEnv>["palette"];
const calm = "color-mix(in oklab, var(--foreground) 55%, transparent)";
const levelColor = (p: Palette, l: ReturnType<typeof contextLevel>) => (l === "full" ? p.tone.bad : l === "warn" ? p.tone.warn : calm);

export function ContextMeterView({ props, node }: ViewProps) {
  const pending = [props.thread, props.points].some(isPendingValue);
  const model = useMemo(() => (pending ? null : readContext(props.thread)), [pending, props.thread]);
  const warn = Math.max(0.05, Math.min(0.99, num(props.warn) ?? 0.8));
  // Readings this card has seen, kept with the card so a scroll or reload keeps the line.
  const [seen, setSeen] = useMemory<ContextPoint[]>(node, "readings", null);
  const single = model?.rows.length === 1 ? model.rows[0] : null;
  useEffect(() => {
    if (!single || props.points != null) return;
    const next = addReading(seen ?? [], { t: Date.now(), used: single.used, cost: single.cost });
    if (next !== seen) setSeen(next);
  }, [single?.used, single?.cost]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!model) return <Shimmer className="h-32" />;
  const points = props.points != null ? readPoints(props.points) : (seen ?? []);
  if (!model.rows.length)
    return (
      <div>
        <Caption title={str(props.title)} />
        <Nothing>No context reading yet</Nothing>
        <Problems items={model.problems} />
      </div>
    );
  return single ? <One row={single} points={points} warn={warn} title={str(props.title)} problems={model.problems} /> : <Many model={model} warn={warn} title={str(props.title)} />;
}

function One({ row, points, warn, title, problems }: { row: ContextRow; points: ContextPoint[]; warn: number; title?: string; problems: string[] }) {
  const { palette } = useEnv();
  const [hover, setHover] = useState<number | null>(null);
  const level = contextLevel(row.share, warn);
  const segs = contextSegments(row);
  const whole = row.window ?? row.used ?? 1;
  const colors = segs.map((s, k) => (s.free ? "var(--muted)" : palette.series[k % palette.series.length]));
  return (
    <div className="min-w-0">
      <Caption title={title ?? row.label}>
        {row.model ? <span>{row.model}</span> : null}
        {row.cost != null ? <span>{money(row.cost, row.currency)}</span> : null}
      </Caption>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span className="text-[26px] font-semibold leading-none tabular-nums" style={level !== "ok" ? { color: levelColor(palette, level) } : undefined}>
          {row.share != null ? pct(row.share) : compact(row.used)}
        </span>
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          {row.window ? `${compact(row.used)} of ${compact(row.window)} tokens${row.estimated ? ", estimated" : ""}` : "tokens used"}
        </span>
        {level !== "ok" ? (
          <span className="text-[12.5px]" style={{ color: levelColor(palette, level) }}>
            {level === "full" ? "Nearly full: compaction is close" : `Past ${pct(warn)}`}
          </span>
        ) : null}
      </div>

      <div className="relative mt-2.5">
        <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-full" role="img" aria-label={segs.map((s) => `${s.label} ${compact(s.tokens)}`).join(", ")}>
          {segs.map((s, k) => (
            <span key={s.label} className={cn("h-full min-w-[2px] transition-opacity", hover != null && hover !== k && "opacity-40")} style={{ flexGrow: s.tokens, flexBasis: 0, background: colors[k] }} onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)} />
          ))}
        </div>
        {row.window ? <span className="absolute -top-1 h-[18px] w-0.5 rounded-full bg-foreground/50" style={{ left: `calc(${warn * 100}% - 1px)` }} title={`Warns at ${pct(warn)}`} aria-hidden /> : null}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] @sm/iris:grid-cols-2 @xl/iris:grid-cols-3">
        {segs.map((s, k) => (
          <li key={s.label} className={cn("flex min-w-0 items-center gap-1.5", hover === k && "text-foreground")} onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)}>
            <span className="size-2 shrink-0 rounded-sm" style={{ background: colors[k], boxShadow: s.free ? "inset 0 0 0 1px var(--border)" : undefined }} aria-hidden />
            <span className={cn("min-w-0 truncate", s.free && "text-muted-foreground")}>{s.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
              {compact(s.tokens)} · {pct(s.tokens / whole)}
            </span>
          </li>
        ))}
      </ul>
      {points.length >= 2 ? <History points={points} window={row.window} warn={warn} currency={row.currency} /> : null}
      <Problems items={problems} />
    </div>
  );
}

function History({ points, window, warn, currency }: { points: ContextPoint[]; window: number | null; warn: number; currency: string }) {
  const { palette } = useEnv();
  const W = 600;
  const H = 64;
  const t0 = points[0].t;
  const t1 = points.at(-1)!.t;
  const top = Math.max(window ?? 0, ...points.map((p) => p.used)) || 1;
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (u: number) => H - (u / top) * (H - 4);
  const line = points.map((p, k) => `${k ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.used).toFixed(1)}`).join(" ");
  const drops = compactions(points);
  const span = t1 - t0;
  const spanText = span >= 3_600_000 ? `${Math.floor(span / 3_600_000)} h ${Math.round((span % 3_600_000) / 60_000)} min` : `${Math.max(1, Math.round(span / 60_000))} min`;
  const first = points.find((p) => p.cost != null)?.cost;
  const last = [...points].reverse().find((p) => p.cost != null)?.cost;
  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-[11.5px] text-muted-foreground">
        <span>
          Over {spanText}
          {drops.length ? ` · compacted ${drops.length === 1 ? "once" : `${drops.length} times`}` : ""}
        </span>
        {first != null && last != null ? (
          <span className="tabular-nums">
            {money(first, currency)} → {money(last, currency)}
          </span>
        ) : null}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-16 w-full overflow-visible" role="img" aria-label={`Context used over ${spanText}`}>
        {window ? <line x1={0} x2={W} y1={y(window * warn)} y2={y(window * warn)} stroke="var(--border)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" /> : null}
        <path d={`${line} L${x(t1).toFixed(1)},${H} L0,${H} Z`} fill={tint(palette.accent, 14)} />
        <path d={line} fill="none" stroke={palette.accent} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {drops.map((i) => (
          <line key={i} x1={x(points[i].t)} x2={x(points[i].t)} y1={0} y2={H} stroke="var(--muted-foreground)" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
    </div>
  );
}

function Many({ model, warn, title }: { model: ContextModel; warn: number; title?: string }) {
  const { palette } = useEnv();
  const max = Math.max(...model.byModel.map((m) => m.used), 1);
  const rows = [...model.rows].sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
  return (
    <div className="min-w-0">
      <Caption title={title}>
        <span>
          {model.rows.length} sessions · {compact(model.used)} tokens
        </span>
        {model.cost != null ? <span>{money(model.cost, model.currency)}</span> : null}
      </Caption>
      {model.byModel.length > 1 || model.byModel[0]?.model !== "Unknown model" ? (
        <div className="mb-3 space-y-1.5" aria-label="By model">
          {model.byModel.map((m) => (
            <div key={m.model} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-2 text-[12.5px]">
              <span className="truncate" title={m.model}>
                {m.model}
              </span>
              <Meter share={m.used / max} color={palette.accent} />
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {compact(m.used)}
                {m.cost != null ? ` · ${money(m.cost, model.currency)}` : ""}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      <ul className="divide-y divide-border">
        {rows.map((r, k) => {
          const level = contextLevel(r.share, warn);
          return (
            <li key={k} className="py-1.5">
              <div className="flex min-w-0 items-baseline gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate" title={r.label}>
                  {r.label}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {r.share != null ? pct(r.share) : compact(r.used)}
                  {r.cost != null ? ` · ${money(r.cost, r.currency)}` : ""}
                </span>
              </div>
              <Meter share={r.share ?? 0} color={levelColor(palette, level)} className="mt-1" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
