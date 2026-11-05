// Charts drawn as SVG in the theme's colors. One component, eight kinds, with a
// hover readout, annotations and a table view of the same numbers.

import { toneColor } from "../palette";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isPendingValue, toText } from "../../core/evaluate";
import { useEnv } from "../env";
import { assignColors, type Palette } from "../palette";
import type { ViewProps } from "../render";
import { Shimmer, cn, fmt, num, str } from "./kit";

interface Series {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

interface Model {
  xs: unknown[];
  series: Series[];
}

function buildModel(props: Record<string, unknown>, palette: Palette): Model {
  const overrides = Array.isArray(props.series) ? (props.series as { key?: unknown; label?: unknown; tone?: unknown }[]) : [];
  const override = (key: string) => overrides.find((s) => toText(s.key) === key);
  // Toned series keep their tone; the rest take series colors that never look like one of them.
  const withColors = (keys: string[]) => {
    const colors = assignColors(palette, keys.map((key) => override(key)?.tone));
    return keys.map((key, k) => ({ key, label: str(override(key)?.label) ?? humanize(key), color: colors[k] }));
  };
  if (Array.isArray(props.values)) {
    const values = props.values.map((v) => (v == null ? null : Number(v)));
    const xs = Array.isArray(props.labels) ? props.labels : values.map((_, k) => k + 1);
    return { xs, series: [{ ...withColors(["value"])[0], label: str(props.unit) ?? "Value", values }] };
  }
  const rows = (Array.isArray(props.data) ? props.data : []).filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  const xKey = str(props.x) ?? (rows[0] ? Object.keys(rows[0])[0] : "x");
  let yKeys: string[];
  if (Array.isArray(props.y)) yKeys = props.y.map(toText);
  else if (typeof props.y === "string") yKeys = [props.y];
  else yKeys = rows[0] ? Object.keys(rows[0]).filter((k) => k !== xKey && typeof rows[0][k] === "number") : [];
  return {
    xs: rows.map((r) => r[xKey]),
    series: withColors(yKeys).map((m) => ({ ...m, values: rows.map((r) => (r[m.key] == null || r[m.key] === "" ? null : Number(r[m.key]))) })),
  };
}

function humanize(key: string) {
  const s = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}

/** Round axis ticks. */
function ticks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** A brushed x range: the x values at its ends and every x inside, as a bound <state> holds it. */
export interface BrushRange {
  from: unknown;
  to: unknown;
  xs: unknown[];
}

interface Brush {
  /** Selected indices, inclusive, or null. */
  span: [number, number] | null;
  set: (span: [number, number] | null) => void;
}

const BRUSHABLE = new Set(["line", "area", "bar", "scatter"]);

/** The brush's range lives in the bound <state> when there is one, else in the chart. */
function useBrush(props: Record<string, unknown>, xs: unknown[], type: string): Brush | null {
  const env = useEnv();
  const [local, setLocal] = useState<BrushRange | null>(null);
  const on = props.brush === true && BRUSHABLE.has(type) && xs.length > 1;
  const bindName = str(props.bind);
  const bound = on && bindName != null && env.runtime.hasState(bindName);
  const range = (bound ? env.runtime.getState(bindName) : local) as BrushRange | null | undefined;
  if (!on) return null;
  let span: [number, number] | null = null;
  if (range && typeof range === "object" && "from" in range) {
    const a = xs.findIndex((x) => toText(x) === toText(range.from));
    const b = xs.findIndex((x) => toText(x) === toText(range.to));
    if (a >= 0 && b >= 0) span = [Math.min(a, b), Math.max(a, b)];
  }
  return {
    span,
    set: (next) => {
      const value: BrushRange | null = next ? { from: xs[next[0]], to: xs[next[1]], xs: xs.slice(next[0], next[1] + 1) } : null;
      if (bound) env.runtime.setState(bindName!, value);
      else setLocal(value);
    },
  };
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(220, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function ChartView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const [view, setView] = useState<"chart" | "table">("chart");
  const [ref, width] = useWidth();
  const pending = isPendingValue(props.data) || isPendingValue(props.values);
  const model = useMemo(() => (pending ? { xs: [], series: [] } : buildModel(props, palette)), [props, palette, pending]);
  const type = str(props.type) ?? "line";
  const height = Math.max(120, Math.min(560, num(props.height) ?? 220));
  const brush = useBrush(props, model.xs, type);
  if (pending) return <Shimmer className="h-[220px]" />;
  if (!model.series.length || !model.xs.length) return <div className="rounded-lg bg-muted/40 py-8 text-center text-xs text-muted-foreground">No data to chart</div>;
  const legend = props.legend === true || (props.legend !== false && model.series.length > 1 && type !== "pie" && type !== "donut");
  const span = brush?.span ?? null;
  return (
    <div className="min-w-0">
      {legend ? (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {model.series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-muted-foreground">
              <span className="h-2 w-3 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      ) : null}
      <div ref={ref} className="min-w-0">
        {view === "table" ? (
          <ChartTable model={model} format={props.format} xFormat={props.xFormat} span={span} />
        ) : type === "pie" || type === "donut" ? (
          <Pie model={model} donut={type === "donut"} width={width} height={height} format={props.format} />
        ) : type === "radar" ? (
          <Radar model={model} width={width} height={height} />
        ) : (
          <Cartesian props={props} model={model} type={type} width={width} height={height} brush={brush} />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-2">
        {brush ? (
          span ? (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md py-0.5 pl-2 pr-0.5 text-[11.5px]" style={{ background: palette.accentSoft }}>
              <span className="truncate tabular-nums">
                {fmt(model.xs[span[0]], props.xFormat)}
                {span[1] > span[0] ? ` to ${fmt(model.xs[span[1]], props.xFormat)}` : ""}
              </span>
              <button type="button" aria-label="Clear the selected range" onClick={() => brush.set(null)} className="grid size-4 place-items-center rounded text-muted-foreground hover:bg-state-hover hover:text-foreground">
                <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
                  <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ) : (
            <span className="mr-auto text-[11.5px] text-muted-foreground max-sm:hidden">Drag across the chart to select a range</span>
          )
        ) : null}
        <div className="inline-flex shrink-0 rounded-md bg-muted/70 p-0.5 text-[11.5px]" role="tablist" aria-label="View">
          {(["chart", "table"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("rounded px-2 py-0.5 capitalize", view === v ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}>
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChartTable({ model, format, xFormat, span }: { model: Model; format: unknown; xFormat: unknown; span: [number, number] | null }) {
  const { palette } = useEnv();
  return (
    <div className="iris-scroll-x overflow-x-auto">
      <table className="w-full text-[13px] tabular-nums">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="border-b border-border pb-1 text-left font-medium" />
            {model.series.map((s) => (
              <th key={s.key} className="border-b border-border pb-1 text-right font-medium">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.xs.map((x, k) => (
            <tr key={k} style={span && k >= span[0] && k <= span[1] ? { background: palette.accentSoft } : undefined}>
              <td className="border-b border-border/60 py-1 text-muted-foreground">{fmt(x, xFormat)}</td>
              {model.series.map((s) => (
                <td key={s.key} className="border-b border-border/60 py-1 text-right">
                  {s.values[k] == null ? "" : fmt(s.values[k], format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cartesian({ props, model, type, width, height, brush }: { props: Record<string, unknown>; model: Model; type: string; width: number; height: number; brush: Brush | null }) {
  const env = useEnv();
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hover, setHover] = useState<number | null>(null);
  // A drag across the plot: where it started (index and px) and whether it has moved enough to count.
  const drag = useRef<{ a: number; x0: number; moved: boolean; last: number } | null>(null);
  const brushed = useRef(false);
  const horizontal = type === "hbar";
  const bars = type === "bar" || horizontal;
  const stacked = props.stacked === true && (bars || type === "area");
  const n = model.xs.length;
  // Value range
  let lo = Infinity;
  let hi = -Infinity;
  if (stacked) {
    for (let k = 0; k < n; k++) {
      let pos = 0;
      let neg = 0;
      for (const s of model.series) {
        const v = s.values[k] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    }
  } else {
    for (const s of model.series) for (const v of s.values) if (v != null && Number.isFinite(v)) (lo = Math.min(lo, v)), (hi = Math.max(hi, v));
  }
  if (!Number.isFinite(lo)) (lo = 0), (hi = 1);
  if (bars || type === "area") lo = Math.min(0, lo);
  else {
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.12;
    lo = lo - pad;
    hi = hi + pad;
    if (lo < 0 && Math.min(...model.series.flatMap((s) => s.values.filter((v): v is number => v != null))) >= 0) lo = Math.max(0, lo);
  }
  lo = num(props.yMin) ?? lo;
  hi = num(props.yMax) ?? hi;
  const yt = ticks(lo, hi, height < 180 ? 3 : 4);
  lo = Math.min(lo, yt[0]);
  hi = Math.max(hi, yt[yt.length - 1]);
  const labelW = Math.min(90, Math.max(28, ...yt.map((t) => fmt(t, props.format).length * 6.4 + 8)));
  const xLabelW = horizontal ? Math.min(140, Math.max(40, ...model.xs.map((x) => fmt(x, props.xFormat).length * 6.4 + 8))) : 0;
  const L = horizontal ? xLabelW : labelW;
  const R = 10;
  const T = 10;
  const B = horizontal ? 22 : 24;
  const W = width;
  const H = height;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const val = (v: number) => (horizontal ? L + ((v - lo) / (hi - lo || 1)) * plotW : T + plotH - ((v - lo) / (hi - lo || 1)) * plotH);
  const band = (horizontal ? plotH : plotW) / n;
  const pos = (k: number) => (bars ? (horizontal ? T : L) + band * k + band / 2 : (horizontal ? T : L) + (n === 1 ? (horizontal ? plotH : plotW) / 2 : (k * (horizontal ? plotH : plotW)) / (n - 1)));
  // Label every k-th x so labels never touch: horizontal axes need room for the longest one.
  const labelPx = horizontal ? 23 : Math.max(46, Math.min(14, Math.max(...model.xs.map((x) => fmt(x, props.xFormat).length))) * 6.4 + 14);
  const every = Math.max(1, Math.ceil((n * labelPx) / (horizontal ? plotH : plotW)));
  const highlight = props.highlight != null ? model.xs.findIndex((x) => toText(x) === toText(props.highlight)) : -1;
  const active = hover ?? (highlight >= 0 ? highlight : null);
  const annotations = (Array.isArray(props.annotations) ? props.annotations : []) as { x?: unknown; y?: unknown; label?: unknown; tone?: unknown }[];
  // Labels of x annotations drop to a second (third...) line when they would overlap another label,
  // including a y annotation's label at the right edge; labels with no room left inside the plot are hidden.
  const labelRow = new Map<number, number>();
  /** True when an x annotation's label goes left of its line: when it doesn't fit on the right and the left has room, or more room. */
  const labelLeft = (x: number, w: number) => x + w > W - R && (x - w >= L || x - L > W - R - x);
  /** An x annotation's label, shortened with an ellipsis when it fits on neither side of its line. */
  const xLabel = (x: number, label: string) => {
    let text = truncate(label, 40);
    const room = Math.max(x - L, W - R - x) - 6;
    while (text.length > 4 && textWidth(text) > room) text = `${text.slice(0, -2).trimEnd()}…`;
    return text;
  };
  {
    const ROW = 14;
    const maxRows = Math.max(1, Math.floor((plotH - 10) / ROW));
    const boxes: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const a of annotations) {
      if (a.y == null || horizontal) continue;
      const yv = val(Number(a.y));
      const w = textWidth(truncate(toText(a.label), 40));
      boxes.push({ x0: W - R - w, x1: W - R, y0: yv - 16, y1: yv - 2 });
    }
    annotations
      .map((a, k) => ({ k, idx: a.x != null && !horizontal ? model.xs.findIndex((x) => toText(x) === toText(a.x)) : -1, label: toText(a.label) }))
      .filter((e) => e.idx >= 0)
      .sort((p, q) => p.idx - q.idx)
      .forEach((e) => {
        const x = pos(e.idx);
        const w = textWidth(xLabel(x, e.label)) + 6;
        const [x0, x1] = labelLeft(x, w) ? [x - w, x] : [x, x + w];
        for (let r = 0; r < maxRows; r++) {
          const y0 = T + r * ROW;
          const y1 = y0 + ROW;
          if (boxes.every((b) => x1 + 6 < b.x0 || x0 > b.x1 + 6 || y1 <= b.y0 || y0 >= b.y1)) {
            boxes.push({ x0, x1, y0, y1 });
            labelRow.set(e.k, r);
            return;
          }
        }
        labelRow.set(e.k, -1);
      });
  }

  const nearest = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    // The svg scales to its box; map client px back to viewBox units.
    const p = horizontal ? ((e.clientY - r.top) * H) / (r.height || H) : ((e.clientX - r.left) * W) / (r.width || W);
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < n; k++) {
      const d = Math.abs(pos(k) - p);
      if (d < bestD) (bestD = d), (best = k);
    }
    return best;
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const k = nearest(e);
    setHover(k);
    const d = drag.current;
    if (!d || !brush) return;
    if (!d.moved && Math.abs(e.clientX - d.x0) < 5) return;
    d.moved = true;
    if (k !== d.last || !brush.span) {
      d.last = k;
      brush.set([Math.min(d.a, k), Math.max(d.a, k)]);
    }
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!brush || e.button !== 0) return;
    const k = nearest(e);
    drag.current = { a: k, x0: e.clientX, moved: false, last: -1 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onUp = () => {
    brushed.current = Boolean(drag.current?.moved);
    drag.current = null;
  };
  const span = brush?.span ?? null;
  const inSpan = (k: number) => !span || (k >= span[0] && k <= span[1]);
  // The brushed band reaches halfway to the neighboring x on each side.
  const half = bars ? band / 2 : n > 1 ? plotW / (n - 1) / 2 : plotW / 2;
  const spanX = span ? [Math.max(L, pos(span[0]) - half), Math.min(L + plotW, pos(span[1]) + half)] : null;

  const stackBase = new Array(n).fill(0);
  const stackNeg = new Array(n).fill(0);
  const barW = Math.max(2, Math.min(42, (band * 0.72) / (stacked ? 1 : model.series.length)));

  return (
    <svg
      width="100%"
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="iris-chart block select-none overflow-visible"
      role="img"
      aria-label={`${type} chart of ${model.series.map((s) => s.label).join(", ")}`}
      style={brush ? { touchAction: "pan-y", cursor: "crosshair" } : undefined}
      onPointerMove={onMove}
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={brush ? () => brush.set(null) : undefined}
      onClick={() => {
        if (brushed.current) return void (brushed.current = false);
        if (props.onPointClick != null && active != null) env.run(props.onPointClick, [{ x: model.xs[active], index: active, values: Object.fromEntries(model.series.map((s) => [s.key, s.values[active]])) }]);
      }}
    >
      <defs>
        {model.series.map((s, k) => (
          <linearGradient key={k} id={`${gid}-a${k}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={s.color} stopOpacity={stacked ? 0.42 : 0.1} />
            <stop offset="1" stopColor={s.color} stopOpacity={stacked ? 0.42 : 0.1} />
          </linearGradient>
        ))}
      </defs>
      {/* value grid */}
      {yt.map((t) => (
        <g key={t}>
          {horizontal ? (
            <>
              <line x1={val(t)} x2={val(t)} y1={T} y2={T + plotH} className="stroke-border" strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={val(t)} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
                {fmt(t, props.format)}
              </text>
            </>
          ) : (
            <>
              <line x1={L} x2={W - R} y1={val(t)} y2={val(t)} className="stroke-border" strokeDasharray={t === 0 ? undefined : "2 4"} />
              <text x={L - 8} y={val(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
                {fmt(t, props.format)}
              </text>
            </>
          )}
        </g>
      ))}
      {/* category labels */}
      {model.xs.map((x, k) =>
        k % every === 0 || (k === n - 1 && (n - 1) % every >= every / 2) ? (
          horizontal ? (
            <text key={k} x={L - 8} y={pos(k) + 4} textAnchor="end" className="fill-muted-foreground text-[11px]">
              {truncate(fmt(x, props.xFormat), 22)}
            </text>
          ) : (
            <text key={k} x={pos(k)} y={H - 6} textAnchor={edgeAnchor(pos(k), truncate(fmt(x, props.xFormat), 14).length * 3.3, W)} className="fill-muted-foreground text-[11px]">
              {truncate(fmt(x, props.xFormat), 14)}
            </text>
          )
        ) : null,
      )}
      {/* brushed range */}
      {spanX ? (
        <g pointerEvents="none">
          <rect x={spanX[0]} y={T} width={Math.max(2, spanX[1] - spanX[0])} height={plotH} fill={env.palette.accentSoft} />
          <line x1={spanX[0]} x2={spanX[0]} y1={T} y2={T + plotH} stroke={env.palette.accent} strokeOpacity={0.6} />
          <line x1={spanX[1]} x2={spanX[1]} y1={T} y2={T + plotH} stroke={env.palette.accent} strokeOpacity={0.6} />
        </g>
      ) : null}
      {/* hover band */}
      {active != null ? (
        horizontal ? (
          <rect x={L} y={pos(active) - band / 2} width={plotW} height={band} className="fill-foreground/[0.04]" />
        ) : bars ? (
          <rect x={pos(active) - band / 2} y={T} width={band} height={plotH} className="fill-foreground/[0.04]" />
        ) : (
          <line x1={pos(active)} x2={pos(active)} y1={T} y2={T + plotH} className="stroke-muted-foreground" strokeDasharray="3 3" />
        )
      ) : null}
      {/* annotations */}
      {annotations.map((a, k) => {
        const idx = a.x != null ? model.xs.findIndex((x) => toText(x) === toText(a.x)) : -1;
        const color = toneColor(env.palette, a.tone) ?? "var(--muted-foreground)";
        if (idx >= 0 && !horizontal) {
          const x = pos(idx);
          const shown = xLabel(x, toText(a.label));
          const right = labelLeft(x, textWidth(shown) + 6);
          return (
            <g key={k}>
              <line x1={x} x2={x} y1={T} y2={T + plotH} stroke={color} strokeDasharray="3 3" />
              {(labelRow.get(k) ?? 0) >= 0 ? (
                <text x={right ? x - 6 : x + 6} y={T + 10 + (labelRow.get(k) ?? 0) * 14} textAnchor={right ? "end" : "start"} className="text-[11px]" fill={color}>
                  {shown !== toText(a.label) ? <title>{toText(a.label)}</title> : null}
                  {shown}
                </text>
              ) : (
                <title>{toText(a.label)}</title>
              )}
            </g>
          );
        }
        if (a.y != null) {
          const yv = val(Number(a.y));
          return (
            <g key={k}>
              <line x1={horizontal ? yv : L} x2={horizontal ? yv : W - R} y1={horizontal ? T : yv} y2={horizontal ? T + plotH : yv} stroke={color} strokeDasharray="4 3" />
              <text x={horizontal ? yv + 4 : W - R} y={horizontal ? T + 10 : yv - 5} textAnchor={horizontal ? "start" : "end"} className="text-[11px]" fill={color}>
                {truncate(toText(a.label), 40)}
              </text>
            </g>
          );
        }
        return null;
      })}
      {/* series */}
      {model.series.map((s, si) => {
        if (bars) {
          return (
            <g key={s.key}>
              {s.values.map((v, k) => {
                if (v == null) return null;
                let a: number;
                let b: number;
                if (stacked) {
                  const base = v >= 0 ? stackBase[k] : stackNeg[k];
                  a = val(base);
                  b = val(base + v);
                  if (v >= 0) stackBase[k] += v;
                  else stackNeg[k] += v;
                } else {
                  a = val(Math.max(lo, 0));
                  b = val(v);
                }
                const offset = stacked ? -barW / 2 : -((model.series.length * barW) / 2) + si * barW;
                const c = pos(k) + offset;
                const r = Math.min(4, barW / 2);
                return horizontal ? (
                  <rect key={k} x={Math.min(a, b)} y={c + 1} width={Math.max(1, Math.abs(b - a))} height={Math.max(1, barW - 2)} rx={r} fill={s.color} opacity={active == null || active === k ? 1 : 0.55} className="iris-bar" />
                ) : (
                  <rect key={k} x={c + 1} y={Math.min(a, b)} width={Math.max(1, barW - 2)} height={Math.max(1, Math.abs(b - a))} rx={r} fill={s.color} opacity={!inSpan(k) ? 0.35 : active == null || active === k ? 1 : 0.55} className="iris-bar" />
                );
              })}
            </g>
          );
        }
        if (type === "scatter") {
          return (
            <g key={s.key}>
              {s.values.map((v, k) => (v == null ? null : <circle key={k} cx={pos(k)} cy={val(v)} r={active === k ? 5 : 3.5} fill={s.color} fillOpacity={inSpan(k) ? 0.85 : 0.3} />))}
            </g>
          );
        }
        // line / area
        const pts: [number, number, number][] = [];
        s.values.forEach((v, k) => {
          if (v == null) return;
          let y = v;
          if (stacked) {
            stackBase[k] += v;
            y = stackBase[k];
          }
          pts.push([pos(k), val(y), k]);
        });
        if (!pts.length) return null;
        const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
        const showArea = type === "area" || (model.series.length === 1 && type === "line");
        return (
          <g key={s.key}>
            {showArea ? <path d={`${line} L${pts[pts.length - 1][0]} ${val(Math.max(lo, 0))} L${pts[0][0]} ${val(Math.max(lo, 0))} Z`} fill={`url(#${gid}-a${si})`} /> : null}
            <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {pts.length <= 40
              ? pts.map(([x, y, k]) => <circle key={k} cx={x} cy={y} r={active === k ? 4.5 : 2.75} fill={active === k ? s.color : "var(--card)"} stroke={s.color} strokeWidth={2} />)
              : null}
          </g>
        );
      })}
      {active != null ? <Readout model={model} index={active} x={pos(active)} W={W} T={T} horizontal={horizontal} format={props.format} xFormat={props.xFormat} /> : null}
    </svg>
  );
}

function Readout({ model, index, x, W, T, horizontal, format, xFormat }: { model: Model; index: number; x: number; W: number; T: number; horizontal: boolean; format: unknown; xFormat: unknown }) {
  const lines = model.series.filter((s) => s.values[index] != null);
  const title = fmt(model.xs[index], xFormat);
  const w = Math.max(96, Math.min(220, Math.max(title.length, ...lines.map((s) => s.label.length + fmt(s.values[index], format).length + 3)) * 6.6 + 24));
  const h = 22 + lines.length * 17;
  const left = horizontal ? W - w - 4 : x + 12 + w > W ? x - w - 12 : x + 12;
  const top = horizontal ? Math.max(T, x - h / 2) : T;
  return (
    <g pointerEvents="none" className="iris-readout">
      <rect x={left} y={top} width={w} height={h} rx={8} className="fill-popover stroke-border" />
      <text x={left + 10} y={top + 16} className="fill-foreground text-[11.5px] font-semibold">
        {truncate(title, 28)}
      </text>
      {lines.map((s, k) => (
        <g key={s.key}>
          <rect x={left + 10} y={top + 25 + k * 17} width={8} height={8} rx={2} fill={s.color} />
          <text x={left + 23} y={top + 33 + k * 17} className="fill-muted-foreground text-[11px]">
            {truncate(s.label, 18)}
          </text>
          <text x={left + w - 10} y={top + 33 + k * 17} textAnchor="end" className="fill-foreground text-[11px] font-medium">
            {fmt(s.values[index], format)}
          </text>
        </g>
      ))}
    </g>
  );
}

function Pie({ model, donut, width, height, format }: { model: Model; donut: boolean; width: number; height: number; format: unknown }) {
  const { palette } = useEnv();
  const [hover, setHover] = useState<number | null>(null);
  const s = model.series[0];
  const values = s.values.map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const size = Math.min(height, width < 420 ? width * 0.6 : 220);
  const r = size / 2 - 4;
  const inner = donut ? r * 0.62 : 0;
  let angle = -Math.PI / 2;
  const arcs = values.map((v, k) => {
    const a0 = angle;
    const a1 = angle + (v / total) * Math.PI * 2;
    angle = a1;
    return { k, a0, a1, v };
  });
  const cx = size / 2;
  const path = (a0: number, a1: number, ro: number, ri: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)} ${cx + rr * Math.sin(a)}`;
    if (a1 - a0 >= Math.PI * 2 - 1e-6) a1 = a0 + Math.PI * 2 - 1e-4;
    return ri > 0 ? `M${p(a0, ro)} A${ro} ${ro} 0 ${large} 1 ${p(a1, ro)} L${p(a1, ri)} A${ri} ${ri} 0 ${large} 0 ${p(a0, ri)} Z` : `M${cx} ${cx} L${p(a0, ro)} A${ro} ${ro} 0 ${large} 1 ${p(a1, ro)} Z`;
  };
  const focus = hover ?? null;
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Pie chart: ${model.xs.map((x, k) => `${toText(x)} ${values[k]}`).join(", ")}`}>
        {arcs.map(({ k, a0, a1 }) => (
          <path key={k} d={path(a0, a1, focus === k ? r + 3 : r, inner)} fill={palette.series[k % palette.series.length]} stroke="var(--card)" strokeWidth={2} onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)} />
        ))}
        {donut ? (
          <>
            <text x={cx} y={cx - 2} textAnchor="middle" className="fill-foreground text-[18px] font-semibold">
              {fmt(focus != null ? values[focus] : total, format)}
            </text>
            <text x={cx} y={cx + 15} textAnchor="middle" className="fill-muted-foreground text-[11px]">
              {focus != null ? truncate(toText(model.xs[focus]), 16) : "Total"}
            </text>
          </>
        ) : null}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1 text-[13px]">
        {model.xs.map((x, k) => (
          <li key={k} className={cn("flex items-center gap-2 rounded px-1", focus === k && "bg-state-hover")} onPointerEnter={() => setHover(k)} onPointerLeave={() => setHover(null)}>
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: palette.series[k % palette.series.length] }} />
            <span className="min-w-0 flex-1 truncate">{toText(x)}</span>
            <span className="tabular-nums text-muted-foreground">{fmt(values[k], format)}</span>
            <span className="w-10 text-right tabular-nums text-muted-foreground">{Math.round((values[k] / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Radar({ model, width, height }: { model: Model; width: number; height: number }) {
  const size = Math.min(width, height + 40, 320);
  const c = size / 2;
  const r = c - 36;
  const n = model.xs.length;
  const max = Math.max(1, ...model.series.flatMap((s) => s.values.map((v) => v ?? 0)));
  const point = (k: number, v: number) => {
    const a = -Math.PI / 2 + (k / n) * Math.PI * 2;
    return [c + (v / max) * r * Math.cos(a), c + (v / max) * r * Math.sin(a)] as const;
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto block" role="img" aria-label="Radar chart">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={model.xs.map((_, k) => point(k, f * max).join(",")).join(" ")} className="fill-none stroke-border" />
      ))}
      {model.xs.map((x, k) => {
        const [px, py] = point(k, max * 1.16);
        return (
          <text key={k} x={px} y={py + 4} textAnchor="middle" className="fill-muted-foreground text-[11px]">
            {truncate(toText(x), 14)}
          </text>
        );
      })}
      {model.series.map((s) => (
        <polygon key={s.key} points={s.values.map((v, k) => point(k, v ?? 0).join(",")).join(" ")} fill={s.color} fillOpacity={0.18} stroke={s.color} strokeWidth={2} />
      ))}
    </svg>
  );
}

/** End labels lean inward so they never run past the chart's edge. */
function edgeAnchor(x: number, halfWidth: number, W: number): "start" | "middle" | "end" {
  return x - halfWidth < 0 ? "start" : x + halfWidth > W ? "end" : "middle";
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** The width of an 11 px annotation label in the page's font; an estimate where there is no canvas (tests, server). */
function textWidth(s: string): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== "undefined" ? (document.createElement("canvas").getContext("2d") ?? null) : null;
    if (measureCtx) measureCtx.font = `11px ${getComputedStyle(document.body).fontFamily || "system-ui, sans-serif"}`;
  }
  return measureCtx ? measureCtx.measureText(s).width : s.length * 6.6;
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
