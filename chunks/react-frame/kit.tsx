// The components and helpers an iris-react app imports from "iris". Runs
// inside the sandboxed frame with the frame's own React. Every name here is
// listed in core/react-kit.ts, which documents it for agents.
import { Children, Component, useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  Activity, ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, Ban, Bell, Bolt, Bot, Calculator, Calendar, ChartBar, ChartLine, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Circle, CircleAlert, CircleCheck, CircleX, Clock, Code, Copy, Cpu, Database,
  Download, ExternalLink, Eye, File, Filter, Flag, Flame, Folder, Gauge, GitBranch, GitCommitHorizontal, GitPullRequest, Globe, Heart, House, Info,
  Layers, Lightbulb, List, LoaderCircle, Lock, Mail, Minus, Moon, Package, Pause, Pencil, Play, Plus, RefreshCw, Rocket, RotateCcw, Search, Send,
  Server, Settings, Shield, Shuffle, Sparkles, Star, Sun, Target, Terminal, Timer, Trash2, TrendingDown, TrendingUp, TriangleAlert, Trophy, Upload,
  User, Users, X, Zap,
  type IconNode,
} from "lucide";
import { formatValue, type NumberFormat } from "../../core/format";
import { iconKey } from "../../ui/icon-names";

const CORE: Record<string, IconNode> = {
  Activity, ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, Ban, Bell, Bolt, Bot, Calculator, Calendar, ChartBar, ChartLine, Check,
  ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Circle, CircleAlert, CircleCheck, CircleX, Clock, Code, Copy, Cpu, Database,
  Download, ExternalLink, Eye, File, Filter, Flag, Flame, Folder, Gauge, GitBranch, GitCommitHorizontal, GitPullRequest, Globe, Heart, House, Info,
  Layers, Lightbulb, List, LoaderCircle, Lock, Mail, Minus, Moon, Package, Pause, Pencil, Play, Plus, RefreshCw, Rocket, RotateCcw, Search, Send,
  Server, Settings, Shield, Shuffle, Sparkles, Star, Sun, Target, Terminal, Timer, Trash2, TrendingDown, TrendingUp, TriangleAlert, Trophy, Upload,
  User, Users, X, Zap,
};

type Tone = "neutral" | "info" | "good" | "warn" | "bad";
const TONES = new Set(["neutral", "info", "good", "warn", "bad"]);
const toneVar = (t: unknown) => (typeof t === "string" && TONES.has(t) ? `var(--iris-${t})` : undefined);
const GAP: Record<string, number> = { none: 0, sm: 8, md: 12, lg: 20 };
const gap = (g: unknown, def = "md") => GAP[typeof g === "string" ? g : def] ?? GAP[def];

// ---------- bridge ----------

interface Bridge {
  insert(text: string): void;
  send(text: string): void;
  copy(text: string): void;
  openUrl(url: string): void;
  submit(value?: unknown): void;
}
const w = window as unknown as { iris?: Bridge };
/** The way out of the frame. Each call works only in answer to a click. */
export const iris: Bridge = {
  insert: (t) => w.iris?.insert(t),
  send: (t) => w.iris?.send(t),
  copy: (t) => w.iris?.copy(t),
  openUrl: (u) => w.iris?.openUrl(u),
  submit: (v) => w.iris?.submit(v),
};

export function post(type: string, data: unknown) {
  parent.postMessage({ __iris: true, type, data }, "*");
}

// ---------- icons: a core set here, the rest asked of the parent ----------

const shapes = new Map<string, IconNode | null>(Object.entries(CORE));
const asked = new Set<string>();
const iconListeners = new Set<() => void>();
let iconVersion = 0;

export function receiveIcon(key: unknown, node: unknown) {
  if (typeof key !== "string" || !asked.has(key)) return;
  shapes.set(key, Array.isArray(node) ? (node as IconNode) : null);
  iconVersion++;
  for (const fn of iconListeners) fn();
}

function useIconShape(name: string): IconNode | null | undefined {
  useSyncExternalStore(
    (fn) => (iconListeners.add(fn), () => iconListeners.delete(fn)),
    () => iconVersion,
  );
  const key = iconKey(name);
  const hit = shapes.get(key);
  if (hit === undefined && !asked.has(key) && asked.size < 400) {
    asked.add(key);
    post("icon", key);
  }
  return hit;
}

/** Plain SVG geometry attributes only; never an event handler. */
const SAFE_ATTR = /^(?!on)[a-z][a-z0-9-]*$/i;

export function Icon({ name, size = 16, tone, color, strokeWidth = 2, className, style }: { name: string; size?: number; tone?: Tone; color?: string; strokeWidth?: number; className?: string; style?: CSSProperties }) {
  const shape = useIconShape(String(name ?? ""));
  const drawn = shape ?? (shape === null ? CORE.Circle : null);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`ir-icon${className ? ` ${className}` : ""}`} style={{ color: color ?? toneVar(tone), ...style }}>
      {drawn?.map(([tag, attrs], k) => {
        const Tag = (["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"].includes(tag) ? tag : "path") as "path";
        const safe = Object.fromEntries(Object.entries(attrs as Record<string, string>).filter(([a]) => SAFE_ATTR.test(a)));
        return <Tag key={k} {...safe} />;
      })}
    </svg>
  );
}

/** lucide-react: any icon name as a component. */
const lucideCache = new Map<string, (p: Record<string, unknown>) => ReactNode>();
export const lucideReact = new Proxy({} as Record<string, unknown>, {
  get(_, prop) {
    if (prop === "__esModule") return true;
    if (typeof prop !== "string" || prop === "then") return undefined;
    if (prop === "default") return lucideReact;
    const name = prop.replace(/^Lucide/, "").replace(/Icon$/, "") || prop;
    let C = lucideCache.get(name);
    if (!C) {
      C = ({ size = 24, color, strokeWidth = 2, className, style }: Record<string, unknown>) => (
        <Icon name={name} size={Number(size) || 24} color={typeof color === "string" && color !== "currentColor" ? color : undefined} strokeWidth={Number(strokeWidth) || 2} className={className as string} style={style as CSSProperties} />
      );
      Object.defineProperty(C, "name", { value: name });
      lucideCache.set(name, C);
    }
    return C;
  },
});

// ---------- theme and helpers ----------

const themeListeners = new Set<() => void>();
let themeVersion = 0;
export function themeChanged() {
  themeVersion++;
  for (const fn of themeListeners) fn();
}

function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const v = (n: string) => css.getPropertyValue(n).trim();
  const series = Array.from({ length: 8 }, (_, k) => v(`--iris-${k + 1}`)).filter(Boolean);
  return {
    series: series.length ? series : ["#3b82f6", "#10b981", "#a855f7", "#f59e0b"],
    tone: { neutral: v("--iris-neutral"), info: v("--iris-info"), good: v("--iris-good"), warn: v("--iris-warn"), bad: v("--iris-bad") } as Record<Tone, string>,
    dark: css.getPropertyValue("color-scheme").includes("dark"),
  };
}
let themeCache: { at: number; value: ReturnType<typeof readTheme> } | null = null;

/** The theme's chart colors and tones, live. */
export function useTheme() {
  const at = useSyncExternalStore(
    (fn) => (themeListeners.add(fn), () => themeListeners.delete(fn)),
    () => themeVersion,
  );
  if (!themeCache || themeCache.at !== at) themeCache = { at, value: readTheme() };
  return themeCache.value;
}

export function fmt(value: unknown, format?: NumberFormat): string {
  return formatValue(value, format);
}

/** useState whose value is saved with the card. */
export function useStored<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const k = `iris:${key}`;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(k);
      return raw == null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(k, JSON.stringify(v));
        } catch {
          // Not serializable: kept in memory only.
        }
        return v;
      });
    },
    [k],
  );
  return [value, set];
}

/** Controlled when value is given, otherwise internal. */
function useControl<T>(value: T | undefined, def: T, onChange?: (v: T) => void): [T, (v: T) => void] {
  const [inner, setInner] = useState<T>(def);
  const controlled = value !== undefined;
  const current = controlled ? value : inner;
  const set = (v: T) => {
    if (!controlled) setInner(v);
    onChange?.(v);
  };
  return [current, set];
}

// ---------- layout ----------

export function Card({ title, subtitle, icon, tone, status, live, footer, children }: { title?: ReactNode; subtitle?: ReactNode; icon?: string; tone?: Tone; status?: ReactNode; live?: boolean; footer?: ReactNode; children?: ReactNode }) {
  const color = toneVar(tone);
  const head = Boolean(title || subtitle || icon || status);
  return (
    <section className="ir-card" data-live={live ? "" : undefined} aria-label={typeof title === "string" ? title : undefined}>
      <i className="ir-edge" aria-hidden style={color ? { background: color } : undefined} />
      {head ? (
        <header className="ir-head">
          {icon ? (
            <span className="ir-glyph">
              <span>
                <Icon name={icon} size={15} color={color} />
              </span>
            </span>
          ) : null}
          <div className="ir-titles">
            {title ? <h3 className="ir-title">{title}</h3> : null}
            {subtitle ? <p className="ir-subtitle">{subtitle}</p> : null}
          </div>
          {status ? (
            <span className="ir-status">
              <i aria-hidden />
              {status}
            </span>
          ) : null}
        </header>
      ) : null}
      <div className="ir-body">{children}</div>
      {footer ? <footer className="ir-foot">{footer}</footer> : null}
    </section>
  );
}

const ALIGN: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" };
const JUSTIFY: Record<string, string> = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" };

export function Row({ gap: g, align = "center", justify = "start", wrap = true, children }: { gap?: string; align?: string; justify?: string; wrap?: boolean; children?: ReactNode }) {
  return (
    <div className="ir-row" style={{ gap: gap(g), alignItems: ALIGN[align] ?? "center", justifyContent: JUSTIFY[justify] ?? "flex-start", flexWrap: wrap ? "wrap" : "nowrap" }}>
      {children}
    </div>
  );
}

export function Stack({ gap: g, align = "stretch", children }: { gap?: string; align?: string; children?: ReactNode }) {
  return (
    <div className="ir-stack" style={{ gap: gap(g), alignItems: ALIGN[align] ?? "stretch" }}>
      {children}
    </div>
  );
}

export function Grid({ min = 150, cols, gap: g, children }: { min?: number; cols?: number; gap?: string; children?: ReactNode }) {
  const template = cols ? `repeat(${Math.max(1, Math.floor(cols))}, minmax(0, 1fr))` : `repeat(auto-fit, minmax(min(${Math.max(60, min)}px, 100%), 1fr))`;
  return (
    <div className="ir-grid" style={{ gap: gap(g), gridTemplateColumns: template }}>
      {children}
    </div>
  );
}

// ---------- content ----------

export function Text({ size = "md", muted, bold, mono, tone, as = "p", children }: { size?: string; muted?: boolean; bold?: boolean; mono?: boolean; tone?: Tone; as?: "p" | "span" | "div" | "h2" | "h3"; children?: ReactNode }) {
  const Tag = (["p", "span", "div", "h2", "h3"].includes(as) ? as : "p") as "p";
  return (
    <Tag className="ir-text" data-size={size} data-muted={muted ? "" : undefined} data-bold={bold ? "" : undefined} data-mono={mono ? "" : undefined} style={toneVar(tone) ? { color: toneVar(tone) } : undefined}>
      {children}
    </Tag>
  );
}

export function Badge({ tone, variant = "soft", icon, children }: { tone?: Tone; variant?: "soft" | "solid" | "outline"; icon?: string; children?: ReactNode }) {
  const color = toneVar(tone);
  const style: CSSProperties | undefined = color
    ? variant === "solid"
      ? { background: color, color: "var(--background)" }
      : variant === "outline"
        ? { background: "transparent", boxShadow: `inset 0 0 0 1px ${color}`, color }
        : { background: `color-mix(in oklab, ${color} 14%, transparent)`, color }
    : undefined;
  return (
    <span className="ir-badge" data-variant={variant} style={style}>
      {icon ? <Icon name={icon} size={11} /> : null}
      {children}
    </span>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const id = useId();
  const width = 120;
  const height = 26;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, k) => [(k / (values.length - 1)) * (width - 2) + 1, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const line = pts.map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ marginTop: 6, display: "block" }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.12" />
          <stop offset="1" stopColor={color} stopOpacity="0.12" />
        </linearGradient>
      </defs>
      <path d={`${line} L${last[0]} ${height} L${pts[0][0]} ${height} Z`} fill={`url(#${CSS.escape(id)})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2" fill={color} />
    </svg>
  );
}

export function Metric({ label, value, format, unit, delta, deltaFormat = "number", better = "up", tone, note, trend }: { label: ReactNode; value: number | string; format?: NumberFormat; unit?: string; delta?: number; deltaFormat?: NumberFormat; better?: "up" | "down"; tone?: Tone; note?: ReactNode; trend?: number[] }) {
  const color = toneVar(tone);
  const d = typeof delta === "number" && Number.isFinite(delta) ? delta : undefined;
  const good = d === undefined || d === 0 ? null : better === "down" ? d < 0 : d > 0;
  const points = Array.isArray(trend) ? trend.map(Number).filter(Number.isFinite) : [];
  return (
    <div className="ir-metric">
      <div className="ir-metric-label">{label}</div>
      <div className="ir-metric-line">
        <span className="ir-metric-value" style={color ? { color } : undefined}>
          {fmt(value, format)}
          {unit ? <span className="ir-metric-unit">{unit}</span> : null}
        </span>
        {d !== undefined ? (
          <span className="ir-delta" style={{ color: good === null ? "var(--iris-neutral)" : good ? "var(--iris-good)" : "var(--iris-bad)" }}>
            <Icon name={d > 0 ? "arrow-up-right" : d < 0 ? "arrow-down-right" : "arrow-right"} size={13} />
            {fmt(Math.abs(d), deltaFormat)}
          </span>
        ) : null}
      </div>
      {note ? <div className="ir-metric-note">{note}</div> : null}
      {points.length > 1 ? <Spark values={points} color={color ?? "var(--iris-accent)"} /> : null}
    </div>
  );
}

const TONE_ICON: Record<string, string> = { info: "info", good: "circle-check", warn: "triangle-alert", bad: "circle-x", neutral: "lightbulb" };

export function Callout({ tone = "info", title, icon, children }: { tone?: Tone; title?: ReactNode; icon?: string; children?: ReactNode }) {
  const color = toneVar(tone) ?? "var(--iris-info)";
  return (
    <div className="ir-callout" role="note" style={{ background: `color-mix(in oklab, ${color} 9%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 22%, transparent)` }}>
      <Icon name={icon ?? TONE_ICON[tone] ?? "info"} size={16} color={color} style={{ marginTop: 3 }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        {title ? <div className="ir-callout-title">{title}</div> : null}
        {children}
      </div>
    </div>
  );
}

export function Progress({ value, max, label, tone, showValue = true }: { value: number; max?: number; label?: ReactNode; tone?: Tone; showValue?: boolean }) {
  const v = Number(value) || 0;
  const total = max == null ? 1 : Number(max) || 1;
  const ratio = Math.max(0, Math.min(1, v / total));
  return (
    <div style={{ minWidth: 0 }}>
      {label || showValue ? (
        <div className="ir-progress-top">
          <span>{label}</span>
          {showValue ? <span>{max == null ? `${Math.round(ratio * 100)}%` : `${v.toLocaleString("en-US")} of ${total.toLocaleString("en-US")}`}</span> : null}
        </div>
      ) : null}
      <div className="ir-track" role="progressbar" aria-valuenow={v} aria-valuemin={0} aria-valuemax={total}>
        <div className="ir-fill" style={{ width: `${ratio * 100}%`, background: toneVar(tone) ?? "var(--iris-accent)" }} />
      </div>
    </div>
  );
}

// ---------- data ----------

type Row = Record<string, unknown>;
interface Column {
  key: string;
  label?: ReactNode;
  align?: "left" | "right" | "center";
  format?: NumberFormat;
  render?: (row: Row) => ReactNode;
}

function cellText(v: unknown, format?: NumberFormat): ReactNode {
  if (v == null) return "";
  if (format) return fmt(v, format);
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "object") return Array.isArray(v) ? v.join(", ") : JSON.stringify(v);
  return String(v);
}

export function Table({ rows, columns, onRowClick, dense, maxRows = 50 }: { rows: Row[]; columns?: (string | Column)[]; onRowClick?: (row: Row) => void; dense?: boolean; maxRows?: number }) {
  const list = Array.isArray(rows) ? rows : [];
  const cols: Column[] = (columns ?? Object.keys(list[0] ?? {})).map((c) => (typeof c === "string" ? { key: c } : c));
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    if (!sort) return list;
    return [...list].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (typeof x === "number" && typeof y === "number") return (x - y) * sort.dir;
      return String(x ?? "").localeCompare(String(y ?? ""), "en", { numeric: true }) * sort.dir;
    });
  }, [list, sort]);
  const per = Math.max(1, maxRows);
  const pages = Math.ceil(sorted.length / per);
  const p = Math.min(page, Math.max(0, pages - 1));
  const shown = sorted.slice(p * per, p * per + per);
  const label = (c: Column) => (c.label !== undefined ? c.label : c.key.replace(/[_-]+/g, " ").replace(/^./, (m) => m.toUpperCase()));
  return (
    <div style={{ minWidth: 0 }}>
      <div className="ir-scroll-x">
        <table className="ir-table" data-dense={dense ? "" : undefined}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" style={{ textAlign: c.align ?? "left" }} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                  <button type="button" data-on={sort?.key === c.key ? "" : undefined} onClick={() => setSort(sort?.key === c.key ? (sort.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}>
                    {label(c)}
                    {sort?.key === c.key ? <Icon name={sort.dir === 1 ? "arrow-up" : "arrow-down"} size={11} /> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, k) => (
              <tr key={k} data-click={onRowClick ? "" : undefined} onClick={onRowClick ? () => onRowClick(r) : undefined}>
                {cols.map((c) => (
                  <td key={c.key} style={{ textAlign: c.align ?? (typeof r[c.key] === "number" ? "right" : "left") }}>
                    {c.render ? c.render(r) : cellText(r[c.key], c.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length ? <div className="ir-empty">No rows</div> : null}
      {pages > 1 ? (
        <div className="ir-pager">
          <span style={{ marginRight: 8 }}>
            Page {p + 1} of {pages}
          </span>
          <Button size="sm" variant="ghost" icon="chevron-left" disabled={p === 0} onClick={() => setPage(p - 1)} />
          <Button size="sm" variant="ghost" icon="chevron-right" disabled={p >= pages - 1} onClick={() => setPage(p + 1)} />
        </div>
      ) : null}
    </div>
  );
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.floor(min / step) * step; v <= max + step * 0.001; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

export function Chart({ data, x, y, type = "line", stacked = false, height = 180, format, labels }: { data: Row[]; x: string; y: string | string[]; type?: "line" | "area" | "bar"; stacked?: boolean; height?: number; format?: NumberFormat; labels?: Record<string, string> }) {
  const theme = useTheme();
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(560);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rows = Array.isArray(data) ? data : [];
  const keys = (Array.isArray(y) ? y : [y]).filter((k) => typeof k === "string");
  const colorOf = (k: number) => theme.series[k % theme.series.length];
  const val = (r: Row, key: string) => {
    const n = Number(r[key]);
    return Number.isFinite(n) ? n : 0;
  };
  const stack = stacked && type !== "line";
  const tops = rows.map((r) => keys.reduce((acc, key) => acc + val(r, key), 0));
  const all = stack ? tops : rows.flatMap((r) => keys.map((key) => val(r, key)));
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all, lo + 1);
  const ticks = niceTicks(lo, hi);
  const top = ticks[ticks.length - 1] ?? hi;
  const bottom = ticks[0] ?? lo;
  const tickText = ticks.map((t) => fmt(t, format ?? "compact"));
  const left = Math.min(64, 8 + Math.max(...tickText.map((t) => t.length)) * 6.4);
  const pad = { l: left, r: 8, t: 8, b: 22 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = Math.max(40, height);
  const sy = (v: number) => pad.t + ih - ((v - bottom) / (top - bottom || 1)) * ih;
  const n = rows.length;
  const band = n ? iw / n : iw;
  const sx = (i: number) => (type === "bar" ? pad.l + band * i + band / 2 : pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2));
  const xLabel = (i: number) => String(rows[i]?.[x] ?? "");
  const every = Math.max(1, Math.ceil((n * 48) / iw));
  const base = rows.map(() => 0);
  const layers = keys.map((key) => {
    const from = [...base];
    const to = rows.map((r, i) => (stack ? (base[i] += val(r, key)) : val(r, key)));
    return { key, from, to };
  });
  const pick = (clientX: number) => {
    const el = box.current;
    if (!el || !n) return;
    const px = clientX - el.getBoundingClientRect().left - pad.l;
    const i = type === "bar" ? Math.floor(px / band) : Math.round((px / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const total = pad.t + ih + pad.b;
  return (
    <div className="ir-chart" ref={box} onPointerMove={(e) => pick(e.clientX)} onPointerLeave={() => setHover(null)}>
      <svg height={total} viewBox={`0 0 ${width} ${total}`} role="img" aria-label={`${type} chart of ${keys.join(", ")} by ${x}`}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={pad.l} x2={pad.l + iw} y1={sy(t)} y2={sy(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "2 3"} />
            <text x={pad.l - 6} y={sy(t) + 3.5} textAnchor="end">
              {tickText[k]}
            </text>
          </g>
        ))}
        {rows.map((_, i) =>
          i % every === 0 ? (
            <text key={i} x={sx(i)} y={pad.t + ih + 15} textAnchor="middle">
              {xLabel(i).length > 12 ? `${xLabel(i).slice(0, 11)}…` : xLabel(i)}
            </text>
          ) : null,
        )}
        {type === "bar"
          ? layers.map((l, s) =>
              rows.map((_, i) => {
                const bw = stack ? band * 0.62 : (band * 0.72) / keys.length;
                const bx = stack ? pad.l + band * i + band * 0.19 : pad.l + band * i + band * 0.14 + bw * s;
                const y0 = sy(stack ? l.from[i] : 0);
                const y1 = sy(l.to[i]);
                return <rect key={`${s}-${i}`} x={bx} y={Math.min(y0, y1)} width={Math.max(1, bw - 2)} height={Math.max(0, Math.abs(y0 - y1))} rx={Math.min(3, bw / 4)} fill={colorOf(s)} opacity={hover === null || hover === i ? 1 : 0.55} />;
              }),
            )
          : layers.map((l, s) => {
              const line = l.to.map((v, i) => `${i ? "L" : "M"}${sx(i).toFixed(1)} ${sy(v).toFixed(1)}`).join(" ");
              const under = stack ? l.from.map((v, i) => [sx(i), sy(v)] as const).reverse() : [[sx(n - 1), sy(Math.max(bottom, 0))] as const, [sx(0), sy(Math.max(bottom, 0))] as const];
              return (
                <g key={l.key}>
                  {type === "area" ? <path d={`${line} ${under.map(([a, b]) => `L${a.toFixed(1)} ${b.toFixed(1)}`).join(" ")} Z`} fill={colorOf(s)} opacity={0.16} /> : null}
                  <path d={line} fill="none" stroke={colorOf(s)} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
                  {hover !== null ? <circle cx={sx(hover)} cy={sy(l.to[hover])} r={3.2} fill="var(--card)" stroke={colorOf(s)} strokeWidth={1.8} /> : null}
                </g>
              );
            })}
        {hover !== null && type !== "bar" ? <line x1={sx(hover)} x2={sx(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--muted-foreground)" strokeOpacity={0.35} /> : null}
      </svg>
      {hover !== null && rows[hover] ? (
        <div className="ir-tip" style={{ left: Math.min(Math.max(0, sx(hover) + 10), width - 140) }}>
          <div style={{ color: "var(--muted-foreground)", marginBottom: 2 }}>{xLabel(hover)}</div>
          {keys.map((key, s) => (
            <div key={key}>
              <i style={{ background: colorOf(s) }} />
              {labels?.[key] ?? key}
              <b>{fmt(val(rows[hover], key), format)}</b>
            </div>
          ))}
        </div>
      ) : null}
      {keys.length > 1 ? (
        <div className="ir-legend">
          {keys.map((key, s) => (
            <span key={key}>
              <i style={{ background: colorOf(s) }} />
              {labels?.[key] ?? key}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------- inputs ----------

export function Button({ onClick, variant = "secondary", size = "md", icon, disabled, children }: { onClick?: () => void; variant?: "primary" | "secondary" | "ghost" | "destructive"; size?: "sm" | "md"; icon?: string; disabled?: boolean; children?: ReactNode }) {
  const iconOnly = icon && Children.count(children) === 0;
  return (
    <button type="button" className="ir-btn" data-variant={variant} data-size={size} disabled={disabled} onClick={onClick} style={iconOnly ? { padding: 0, width: size === "sm" ? 28 : 32 } : undefined}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </button>
  );
}

function Field({ label, id, right, children }: { label?: ReactNode; id: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="ir-field">
      {label || right ? (
        <label className="ir-label" htmlFor={id}>
          <span>{label}</span>
          {right}
        </label>
      ) : null}
      {children}
    </div>
  );
}

export function Slider({ value, defaultValue, onChange, min = 0, max = 100, step = 1, label, format }: { value?: number; defaultValue?: number; onChange?: (v: number) => void; min?: number; max?: number; step?: number; label?: ReactNode; format?: NumberFormat }) {
  const id = useId();
  const [v, set] = useControl<number>(value, defaultValue ?? min, onChange);
  const pct = ((v - min) / (max - min || 1)) * 100;
  return (
    <Field label={label} id={id} right={<output>{fmt(v, format)}</output>}>
      <input id={id} type="range" className="ir-range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} style={{ ["--fill" as string]: `${pct}%` }} />
    </Field>
  );
}

export function Toggle({ checked, defaultChecked = false, onChange, label, detail }: { checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; label?: ReactNode; detail?: ReactNode }) {
  const id = useId();
  const [on, set] = useControl<boolean>(checked, defaultChecked, onChange);
  return (
    <label className="ir-toggle" htmlFor={id}>
      <span>
        <span style={{ display: "block" }}>{label}</span>
        {detail ? <small>{detail}</small> : null}
      </span>
      <button id={id} type="button" role="switch" aria-checked={on} className="ir-switch" onClick={() => set(!on)}>
        <i />
      </button>
    </label>
  );
}

export function Input({ value, defaultValue = "", onChange, onEnter, label, placeholder, type = "text" }: { value?: string; defaultValue?: string; onChange?: (v: string) => void; onEnter?: (v: string) => void; label?: ReactNode; placeholder?: string; type?: string }) {
  const id = useId();
  const [v, set] = useControl<string>(value, defaultValue, onChange);
  return (
    <Field label={label} id={id}>
      <input id={id} className="ir-input" type={["text", "number", "email", "search"].includes(type) ? type : "text"} value={v} placeholder={placeholder} onChange={(e) => set(e.target.value)} onKeyDown={(e) => (e.key === "Enter" ? onEnter?.(v) : undefined)} />
    </Field>
  );
}

type Option = string | { value: string; label?: string; icon?: string };
const optionOf = (o: Option) => (typeof o === "string" ? { value: o, label: o } : { value: String(o.value), label: o.label ?? String(o.value), icon: o.icon });

export function Select({ options, value, defaultValue, onChange, label }: { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void; label?: ReactNode }) {
  const id = useId();
  const opts = (Array.isArray(options) ? options : []).map(optionOf);
  const [v, set] = useControl<string>(value, defaultValue ?? opts[0]?.value ?? "", onChange);
  return (
    <Field label={label} id={id}>
      <div className="ir-select-wrap">
        <select id={id} className="ir-select" value={v} onChange={(e) => set(e.target.value)}>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Icon name="chevrons-up-down" size={14} />
      </div>
    </Field>
  );
}

export function Segmented({ options, value, defaultValue, onChange }: { options: Option[]; value?: string; defaultValue?: string; onChange?: (v: string) => void }) {
  const opts = (Array.isArray(options) ? options : []).map(optionOf);
  const [v, set] = useControl<string>(value, defaultValue ?? opts[0]?.value ?? "", onChange);
  return (
    <div role="radiogroup" className="ir-seg ir-scroll-x">
      {opts.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === v} onClick={() => set(o.value)}>
          {o.icon ? <Icon name={o.icon} size={14} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ tabs, value, defaultValue = 0, onChange }: { tabs: { label: ReactNode; icon?: string; badge?: ReactNode; content?: ReactNode }[]; value?: number; defaultValue?: number; onChange?: (i: number) => void }) {
  const list = Array.isArray(tabs) ? tabs : [];
  const [active, set] = useControl<number>(value, defaultValue, onChange);
  const k = Math.max(0, Math.min(list.length - 1, active));
  return (
    <div style={{ minWidth: 0 }}>
      <div role="tablist" className="ir-tablist ir-scroll-x">
        {list.map((t, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === k} onClick={() => set(i)}>
            {t.icon ? <Icon name={t.icon} size={14} /> : null}
            {t.label}
            {t.badge != null ? <em>{t.badge}</em> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="ir-panel">
        {list[k]?.content}
      </div>
    </div>
  );
}

// ---------- the frame's own error boundary ----------

export class Boundary extends Component<{ onError: (error: unknown, stack: string | null) => void; children: ReactNode }, { error: Error | null; attempt: number }> {
  state: { error: Error | null; attempt: number } = { error: null, attempt: 0 };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    this.props.onError(error, info.componentStack ?? null);
  }
  render() {
    if (!this.state.error) return <Fragmentless key={this.state.attempt}>{this.props.children}</Fragmentless>;
    return (
      <div className="ir-stopped" role="alert">
        <Icon name="circle-alert" size={15} color="var(--iris-bad)" />
        <span style={{ flex: 1 }}>The app stopped. The error is shown below it.</span>
        <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
          Restart
        </Button>
      </div>
    );
  }
}

function Fragmentless({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
