// Math: TeX typeset by KaTeX, loaded on demand. FunctionPlot: y = f(x) curves
// drawn as SVG, sampled through the interpreter, with sliders for parameters.

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { isFnValue, isPendingValue, toText } from "../../core/evaluate";
import { hasDelimiters, splitMath } from "../../core/math";
import { loadChunk, loadStyle } from "../chunks";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Shimmer, cn, fmt, num, str } from "./kit";

type Katex = typeof import("../../chunks/katex");

let katexReady: Katex | null = null;

function useKatex(): { katex: Katex | null; error: string | null } {
  const [state, setState] = useState<{ katex: Katex | null; error: string | null }>({ katex: katexReady, error: null });
  useEffect(() => {
    if (katexReady) return;
    let live = true;
    Promise.all([loadChunk<Katex>("katex"), loadStyle("katex")]).then(
      ([k]) => {
        katexReady = k;
        if (live) setState({ katex: k, error: null });
      },
      (e: unknown) => live && setState({ katex: null, error: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

function macrosOf(v: unknown): Record<string, string> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.startsWith("\\") ? k : `\\${k}`, toText(x)]));
}

function Tex({ tex, display, katex, macros }: { tex: string; display: boolean; katex: Katex | null; macros?: Record<string, string> }) {
  const out = useMemo(() => (katex ? katex.renderTex(tex, display, macros) : null), [katex, tex, display, macros]);
  if (!out) return <code className={cn("font-mono text-[12.5px] text-muted-foreground", display && "block py-1 text-center")}>{tex}</code>;
  if (out.error)
    return (
      <span className={cn("inline-flex max-w-full flex-col gap-0.5 rounded-md bg-destructive/[0.07] px-2 py-1 align-middle text-xs", display && "flex")} role="alert">
        <span className="text-destructive">TeX error: {out.error}</span>
        <code className="truncate font-mono text-[11.5px] text-muted-foreground">{tex}</code>
      </span>
    );
  // KaTeX output with trust off: markup KaTeX builds itself, never the author's HTML.
  return display ? <div className="iris-math-display min-w-0 overflow-x-auto overflow-y-hidden py-1" dangerouslySetInnerHTML={{ __html: out.html }} /> : <span className="iris-math-inline" dangerouslySetInnerHTML={{ __html: out.html }} />;
}

export function MathView({ props, text }: ViewProps) {
  const env = useEnv();
  const { katex, error } = useKatex();
  const source = (str(props.tex) ?? text ?? "").trim();
  const macros = useMemo(() => macrosOf(props.macros), [props.macros]);
  const label = str(props.label);
  if (!source) return env.streaming ? <Shimmer className="h-10" /> : null;
  if (error) return <code className="block font-mono text-[12.5px] text-muted-foreground" title={error}>{source}</code>;
  if (props.inline === true) return <Tex tex={source} display={false} katex={katex} macros={macros} />;
  let body: ReactNode;
  if (hasDelimiters(source)) {
    body = (
      <div className="min-w-0 text-[14px] leading-relaxed">
        {splitMath(source).map((part, k) =>
          part.kind === "text" ? (
            <span key={k} className="whitespace-pre-line">
              {part.value}
            </span>
          ) : (
            <Tex key={k} tex={part.tex} display={part.kind === "display"} katex={katex} macros={macros} />
          ),
        )}
      </div>
    );
  } else body = <Tex tex={source} display katex={katex} macros={macros} />;
  return (
    <div className="iris-math flex min-w-0 items-center gap-3">
      <div className="min-w-0 flex-1">{body}</div>
      {label ? <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{label}</span> : null}
    </div>
  );
}

// ---------- FunctionPlot ----------

interface Curve {
  label: string;
  color: string;
  dashed: boolean;
  fn: unknown;
}

const NAMES = ["f", "g", "h", "p", "q", "r"];

function niceTicks(lo: number, hi: number, count: number): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** Axis numbers, with a real minus sign. */
function tick(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  const t = a >= 1e5 || a < 1e-3 ? a.toExponential(1).replace("e+", "e") : String(Number(a.toPrecision(4)));
  return v < 0 ? `−${t}` : t;
}

function pair(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2) return null;
  const a = num(v[0]);
  const b = num(v[1]);
  return a != null && b != null && b > a ? [a, b] : null;
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

const SPOTS = [
  { dx: 8, dy: -8, anchor: "start" },
  { dx: -8, dy: -8, anchor: "end" },
  { dx: 8, dy: 16, anchor: "start" },
  { dx: -8, dy: 16, anchor: "end" },
] as const;
type Spot = (typeof SPOTS)[number];

export function FunctionPlotView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const clip = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [ref, width] = useWidth();
  const [hoverX, setHoverX] = useState<number | null>(null);
  const height = Math.max(160, Math.min(640, num(props.height) ?? 280));
  const [x0, x1] = pair(props.domain) ?? [-10, 10];

  const curves: Curve[] = (Array.isArray(props.fns) ? props.fns : props.fns != null ? [props.fns] : []).map((f, k) => {
    const o: Record<string, unknown> = f && typeof f === "object" && !isFnValue(f) ? (f as Record<string, unknown>) : { fn: f };
    const tone = typeof o.tone === "string" && o.tone in palette.tone ? palette.tone[o.tone as keyof typeof palette.tone] : undefined;
    return { fn: o.fn ?? o.f ?? o.y, label: str(o.label) ?? `${NAMES[k] ?? `f${k + 1}`}(x)`, color: tone ?? palette.series[k % palette.series.length], dashed: o.dashed === true };
  });

  const L = 44;
  const R = 12;
  const T = 10;
  const B = props.xLabel ? 38 : 24;
  const plotW = width - L - R;
  const plotH = height - T - B;
  const samples = Math.max(40, Math.min(2000, num(props.samples) ?? Math.round(plotW / 1.5)));

  // Sampling reads state through each function's scope, so it reruns on every change.
  const sampled = useMemo(() => {
    const interp = env.runtime.interp;
    return curves.map((c) => {
      const ys: number[] = new Array(samples + 1);
      let error: string | null = null;
      if (!isFnValue(c.fn)) return { ys: [], error: `${c.label} is not a function: write (x) => ...` };
      // One step budget per curve, so a costly function fails with a message instead of freezing.
      interp.steps = 0;
      for (let i = 0; i <= samples; i++) {
        const x = x0 + ((x1 - x0) * i) / samples;
        try {
          const y = interp.call(c.fn, [x]);
          ys[i] = typeof y === "number" ? y : Number(y);
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          break;
        }
      }
      return { ys, error };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.fns, x0, x1, samples, env.runtime.version, palette]);

  const [y0, y1] = useMemo((): [number, number] => {
    const given = pair(props.range);
    if (given) return given;
    const all = sampled.flatMap((s) => s.ys.filter((y) => Number.isFinite(y))).sort((a, b) => a - b);
    if (!all.length) return [-1, 1];
    // Fit the bulk of the curve, not an asymptote's tail.
    const q = (p: number) => all[Math.min(all.length - 1, Math.max(0, Math.round(p * (all.length - 1))))];
    let lo = all[0];
    let hi = all[all.length - 1];
    const qlo = q(0.02);
    const qhi = q(0.98);
    if (hi - lo > 8 * (qhi - qlo || 1)) (lo = qlo), (hi = qhi);
    if (hi - lo < 1e-9) (lo -= 1), (hi += 1);
    const pad = (hi - lo) * 0.08;
    return [lo - pad, hi + pad];
  }, [sampled, props.range]);

  const sx = (x: number) => L + ((x - x0) / (x1 - x0)) * plotW;
  const sy = (y: number) => T + plotH - ((y - y0) / (y1 - y0)) * plotH;
  const xt = niceTicks(x0, x1, Math.max(3, Math.min(10, Math.floor(plotW / 70))));
  const yt = niceTicks(y0, y1, Math.max(3, Math.min(8, Math.floor(plotH / 44))));

  const paths = sampled.map((s) => {
    let d = "";
    let pen = false;
    const span = y1 - y0;
    for (let i = 0; i < s.ys.length; i++) {
      const y = s.ys[i];
      const prev = s.ys[i - 1];
      const ok = Number.isFinite(y) && y > y0 - span * 4 && y < y1 + span * 4;
      // A jump across most of the view between neighbors is an asymptote: lift the pen.
      const jump = pen && Number.isFinite(prev) && Math.abs(y - prev) > span * 1.5 && Math.sign(y) !== Math.sign(prev);
      if (!ok || jump) {
        pen = false;
        if (!ok) continue;
      }
      const x = x0 + ((x1 - x0) * i) / samples;
      d += `${pen ? "L" : "M"}${sx(x).toFixed(1)},${sy(Math.max(y0 - span * 4, Math.min(y1 + span * 4, y))).toFixed(1)}`;
      pen = true;
    }
    return d;
  });

  const valueAt = (c: Curve, x: number): number | null => {
    if (!isFnValue(c.fn)) return null;
    try {
      env.runtime.interp.steps = 0;
      const y = Number(env.runtime.interp.call(c.fn, [x]));
      return Number.isFinite(y) ? y : null;
    } catch {
      return null;
    }
  };

  const points = (Array.isArray(props.points) ? props.points : []).flatMap((p) => {
    if (!p || typeof p !== "object") return [];
    const o = p as Record<string, unknown>;
    const x = num(o.x);
    if (x == null) return [];
    const y = num(o.y) ?? (curves[0] ? valueAt(curves[0], x) : null);
    if (y == null) return [];
    const tone = typeof o.tone === "string" && o.tone in palette.tone ? palette.tone[o.tone as keyof typeof palette.tone] : "var(--foreground)";
    return [{ x, y, label: str(o.label), color: tone }];
  });

  // A point's label takes the spot around it that no curve crosses and that stays in the plot.
  // Computed once per data change, not on every hover move, and only when a point has a label.
  const labelSpots = useMemo(() => {
    const labelled = points.filter((p) => p.label);
    if (!labelled.length) return new Map<number, Spot>();
    // Curve pixels, with steep stretches filled in so a near-vertical line still counts.
    const px: [number, number][] = [];
    for (const s of sampled) {
      let prev: [number, number] | null = null;
      for (let i = 0; i < s.ys.length; i++) {
        const y = s.ys[i];
        if (!Number.isFinite(y) || y < y0 || y > y1) {
          prev = null;
          continue;
        }
        const cur: [number, number] = [sx(x0 + ((x1 - x0) * i) / samples), sy(y)];
        if (prev) {
          const steps = Math.min(60, Math.floor(Math.abs(cur[1] - prev[1]) / 4));
          for (let k = 1; k < steps; k++) px.push([prev[0] + ((cur[0] - prev[0]) * k) / steps, prev[1] + ((cur[1] - prev[1]) * k) / steps]);
        }
        px.push(cur);
        prev = cur;
      }
    }
    const out = new Map<number, Spot>();
    points.forEach((p, k) => {
      if (!p.label) return;
      const [ax, ay] = [sx(p.x), sy(p.y)];
      const w = p.label.length * 6.3 + 4;
      let best: Spot = SPOTS[0];
      let bestScore = Infinity;
      for (const spot of SPOTS) {
        const left = spot.anchor === "start" ? ax + spot.dx - 2 : ax + spot.dx - w + 2;
        const top = ay + spot.dy - 11;
        const box = { l: left - 3, r: left + w + 3, t: top - 3, b: top + 17 };
        let score = 0;
        for (const [cx, cy] of px) if (cx >= box.l && cx <= box.r && cy >= box.t && cy <= box.b) score++;
        if (box.l < L || box.r > L + plotW || box.t < T || box.b > T + plotH) score += 1000;
        if (score < bestScore) (best = spot), (bestScore = score);
      }
      out.set(k, best);
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sampled, y0, y1, x0, x1, samples, width, height, JSON.stringify(points)]);

  const errors = sampled.map((s, k) => (s.error ? `${curves[k].label}: ${s.error}` : null)).filter(Boolean);
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    if (px < L || px > L + plotW) return setHoverX(null);
    setHoverX(x0 + ((px - L) / plotW) * (x1 - x0));
  };
  const hover = hoverX != null ? curves.map((c) => ({ c, y: valueAt(c, hoverX) })) : null;
  const tipLeft = hoverX != null && sx(hoverX) > L + plotW * 0.62;

  if (isPendingValue(props.fns)) return <Shimmer className="h-[280px]" />;
  return (
    <div className="min-w-0">
      {curves.length > 1 || curves.some((c) => !/^\w\(x\)$/.test(c.label)) ? (
        <div className="mb-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {curves.map((c, k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <svg width="16" height="6" aria-hidden>
                <line x1="1" x2="15" y1="3" y2="3" stroke={c.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c.dashed ? "3 3" : undefined} />
              </svg>
              {c.label}
            </span>
          ))}
        </div>
      ) : null}
      <div ref={ref} className="relative min-w-0">
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} className="block touch-pan-y select-none" role="img" aria-label={`Plot of ${curves.map((c) => c.label).join(", ")} for x from ${tick(x0)} to ${tick(x1)}`} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHoverX(null)}>
          <defs>
            <clipPath id={`${clip}-c`}>
              <rect x={L} y={T} width={plotW} height={plotH} />
            </clipPath>
          </defs>
          {xt.map((t) => (
            <g key={`x${t}`}>
              <line x1={sx(t)} x2={sx(t)} y1={T} y2={T + plotH} className="stroke-border" strokeOpacity={0.6} />
              <text x={sx(t)} y={T + plotH + 15} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
                {tick(t)}
              </text>
            </g>
          ))}
          {yt.map((t) => (
            <g key={`y${t}`}>
              <line x1={L} x2={L + plotW} y1={sy(t)} y2={sy(t)} className="stroke-border" strokeOpacity={0.6} />
              <text x={L - 7} y={sy(t) + 4} textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
                {tick(t)}
              </text>
            </g>
          ))}
          {/* The axes through zero, when zero is in view. */}
          {x0 < 0 && x1 > 0 ? <line x1={sx(0)} x2={sx(0)} y1={T} y2={T + plotH} className="stroke-muted-foreground" strokeOpacity={0.7} /> : null}
          {y0 < 0 && y1 > 0 ? <line x1={L} x2={L + plotW} y1={sy(0)} y2={sy(0)} className="stroke-muted-foreground" strokeOpacity={0.7} /> : null}
          <g clipPath={`url(#${clip}-c)`}>
            {paths.map((d, k) => (
              <path key={k} d={d} fill="none" stroke={curves[k].color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={curves[k].dashed ? "6 5" : undefined} />
            ))}
            {points.map((p, k) => {
              const spot = labelSpots.get(k) ?? null;
              return (
                <g key={`p${k}`}>
                  <circle cx={sx(p.x)} cy={sy(p.y)} r={4} fill="var(--card)" stroke={p.color} strokeWidth={2} />
                  {p.label && spot ? (
                    <text x={sx(p.x) + spot.dx} y={sy(p.y) + spot.dy} textAnchor={spot.anchor} stroke="var(--card)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke" className="fill-foreground text-[11px] font-medium">
                      {p.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
            {hover && hoverX != null ? (
              <g>
                <line x1={sx(hoverX)} x2={sx(hoverX)} y1={T} y2={T + plotH} className="stroke-muted-foreground" strokeDasharray="3 3" />
                {hover.map(({ c, y }, k) => (y != null && y >= y0 && y <= y1 ? <circle key={k} cx={sx(hoverX)} cy={sy(y)} r={3.5} fill={c.color} stroke="var(--card)" strokeWidth={1.5} /> : null))}
              </g>
            ) : null}
          </g>
          {props.xLabel ? (
            <text x={L + plotW / 2} y={height - 4} textAnchor="middle" className="fill-muted-foreground text-[11.5px]">
              {str(props.xLabel)}
            </text>
          ) : null}
          {props.yLabel ? (
            <text x={12} y={T + plotH / 2} textAnchor="middle" transform={`rotate(-90 12 ${T + plotH / 2})`} className="fill-muted-foreground text-[11.5px]">
              {str(props.yLabel)}
            </text>
          ) : null}
        </svg>
        {hover && hoverX != null ? (
          <div className="pointer-events-none absolute top-2 rounded-md bg-popover/95 px-2 py-1 text-[11.5px] tabular-nums text-popover-foreground shadow-[0_0_0_1px_var(--border),0_6px_18px_-10px_rgb(0_0_0/0.5)]" style={tipLeft ? { right: width - sx(hoverX) + 10 } : { left: sx(hoverX) + 10 }}>
            <div className="text-muted-foreground">x = {tick(hoverX)}</div>
            {hover.map(({ c, y }, k) => (
              <div key={k} className="flex items-center gap-1.5 whitespace-nowrap">
                <span className="size-2 rounded-full" style={{ background: c.color }} />
                {c.label} = {y == null ? "undefined" : tick(y)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {errors.length ? <div className="mt-1 text-xs text-destructive">{errors.join("; ")}</div> : null}
      <Params params={props.params} />
    </div>
  );
}

function Params({ params }: { params: unknown }) {
  const env = useEnv();
  const list = (Array.isArray(params) ? params : []).filter((p): p is Record<string, unknown> => !!p && typeof p === "object");
  if (!list.length) return null;
  return (
    <div className="mt-3 grid gap-x-5 gap-y-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 12rem), 1fr))" }}>
      {list.map((p, k) => {
        const bind = str(p.bind ?? p.name);
        if (!bind || !env.runtime.hasState(bind)) return <div key={k} className="text-xs text-destructive">Parameter {bind ?? k + 1} needs a {"<state "}{bind ?? "name"}{"={...} />"}</div>;
        const value = num(env.runtime.getState(bind)) ?? 0;
        const min = num(p.min) ?? Math.min(0, value);
        const max = num(p.max) ?? Math.max(10, value);
        // Whole-number bounds around a whole value step by 1; anything else in 100 steps.
        const whole = Number.isInteger(min) && Number.isInteger(max) && Number.isInteger(value);
        const step = num(p.step) ?? (whole || (max - min) / 100 > 1 ? 1 : Number(((max - min) / 100).toPrecision(1)));
        const pct = ((value - min) / (max - min || 1)) * 100;
        return (
          <label key={bind} className="min-w-0">
            <span className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
              <span className="text-muted-foreground">{str(p.label) ?? bind}</span>
              <output className="font-medium tabular-nums">{fmt(value, p.format ?? { style: "number", decimals: step < 1 ? Math.min(4, String(step).split(".")[1]?.length ?? 1) : 0 })}</output>
            </span>
            <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => env.runtime.setState(bind, Number(e.target.value))} className="iris-range w-full" style={{ ["--iris-fill" as string]: `${pct}%` }} aria-label={str(p.label) ?? bind} />
          </label>
        );
      })}
    </div>
  );
}
