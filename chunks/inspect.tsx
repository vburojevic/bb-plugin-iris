// API and schema inspector views (chunk "inspect"): HttpExchange, Waterfall,
// ErDiagram and QueryPlan. Parsing lives in core/http.ts, core/schema.ts and
// core/queryplan.ts; these views only draw. Colors come from the palette.

import { Chip, Glyph, InlineError, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { isPendingValue, toText } from "../core/evaluate";
import { formatBytes } from "../core/format";
import { type Exchange, type Phase, type PhaseKind, PHASES, RESOURCE_TYPES, type ResourceType, type WaterfallRow, isSecretHeader, mask, maskUrl, normalizeExchange, normalizeWaterfall, readBody, statusTone, ticks, toCurl } from "../core/http";
import { type PlanNode, normalizePlan } from "../core/queryplan";
import { type ErRelation, type ErTable, parseSchema, rankTables } from "../core/schema";
import type { ViewProps } from "../ui/render";

const BTN =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--iris-accent)_45%,transparent)]";

function Problems({ list, what }: { list: string[]; what: string }) {
  if (!list.length) return null;
  return <InlineError error={new Error(`${list[0]}${list.length > 1 ? ` (and ${list.length - 1} more)` : ""}`)} context={what} />;
}

function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function ms(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  const a = Math.abs(n);
  if (a === 0) return "0 ms";
  if (a < 1) return `${n.toFixed(2).replace(/0$/, "")} ms`;
  if (a < 10) return `${n.toFixed(1).replace(/\.0$/, "")} ms`;
  if (a < 1000) return `${Math.round(n)} ms`;
  if (a < 60_000) return `${(n / 1000).toFixed(a < 10_000 ? 2 : 1).replace(/\.?0+$/, "")} s`;
  return `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;
}

const count = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}k` : String(Math.round(n)));

function Segments<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string }) {
  return (
    <div className="iris-scroll-x flex max-w-full shrink-0 overflow-x-auto rounded-full bg-muted/70 p-0.5 text-[12px]" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn("inline-flex h-7 shrink-0 items-center rounded-full px-2.5", FOCUS, value === o.id ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- JSON tree ----------

function JsonTree({ value, open = 2 }: { value: unknown; open?: number }) {
  const [all, setAll] = useState<{ open: boolean; gen: number } | null>(null);
  return (
    <div className="relative min-w-0">
      <div className="absolute top-1.5 right-1.5 z-[1] flex gap-1">
        <button type="button" className={cn(BTN, "h-6 bg-card px-2 text-[11.5px]")} onClick={() => setAll({ open: true, gen: (all?.gen ?? 0) + 1 })} title="Expand every level">
          Expand all
        </button>
        <button type="button" className={cn(BTN, "h-6 bg-card px-2 text-[11.5px]")} onClick={() => setAll({ open: false, gen: (all?.gen ?? 0) + 1 })} title="Collapse to the top level">
          Collapse
        </button>
      </div>
      <div className="max-h-[360px] min-w-0 overflow-auto rounded-lg bg-muted/40 p-2.5 font-mono text-[12px] leading-relaxed ring-1 ring-border">
        <JsonNode key={all?.gen ?? 0} value={value} depth={0} open={all ? (all.open ? 99 : 0) : open} />
      </div>
    </div>
  );
}

function JsonNode({ value, depth, open, name }: { value: unknown; depth: number; open: number; name?: string }) {
  const { palette } = useEnv();
  const [expanded, setExpanded] = useState(depth < open);
  const label = name !== undefined ? <span className="text-muted-foreground">{name}: </span> : null;
  if (value === null || typeof value !== "object") {
    // Theme-derived ink, readable in light and dark: strings good, numbers info, the rest a series hue.
    const color = typeof value === "string" ? palette.tone.good : typeof value === "number" ? palette.tone.info : palette.series[2];
    const text = typeof value === "string" ? JSON.stringify(value) : String(value);
    return (
      <div className="flex min-w-0 items-center gap-1" title={text.length > 80 ? text : undefined}>
        <span className="w-[11px] shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {label}
          <span style={{ color }}>{text}</span>
        </span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, k) => [String(k), v] as const) : Object.entries(value);
  const brackets = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <div>
      <button type="button" onClick={() => setExpanded(!expanded)} className="inline-flex items-center gap-1 rounded hover:text-foreground" aria-expanded={expanded}>
        <Glyph name="chevron-right" size={11} className={cn("text-muted-foreground transition-transform", expanded && "rotate-90")} />
        {label}
        <span className="text-muted-foreground">
          {brackets[0]}
          {!expanded ? ` ${entries.length} ${Array.isArray(value) ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"} ${brackets[1]}` : ""}
        </span>
      </button>
      {expanded ? (
        <>
          <div className="ml-[5px] border-l border-border pl-2.5">
            {entries.slice(0, 500).map(([k, v]) => (
              <JsonNode key={k} name={k} value={v} depth={depth + 1} open={open} />
            ))}
            {entries.length > 500 ? <div className="pl-[15px] text-muted-foreground">{entries.length - 500} more</div> : null}
          </div>
          <div className="pl-[15px] text-muted-foreground">{brackets[1]}</div>
        </>
      ) : null}
    </div>
  );
}

// ---------- HttpExchange ----------

/** Load is the page's finish line, in the accent; DOMContentLoaded is a quieter line. */
function markColor(label: string, palette: { accent: string }): string {
  return label === "Load" ? palette.accent : "color-mix(in oklab, var(--muted-foreground) 70%, transparent)";
}

/** Phases are distinct series of one chart, so they take series colors; queueing stays neutral. */
function phaseColor(kind: PhaseKind, palette: { series: string[] }): string {
  const s = palette.series;
  switch (kind) {
    case "wait":
      return s[0];
    case "receive":
      return s[1 % s.length];
    case "dns":
      return s[2 % s.length];
    case "connect":
      return s[3 % s.length];
    case "tls":
      return s[4 % s.length];
    case "send":
      return s[5 % s.length];
    default:
      return "color-mix(in oklab, var(--muted-foreground) 45%, transparent)";
  }
}

function PhaseBar({ phases, total }: { phases: Phase[]; total: number }) {
  const { palette } = useEnv();
  if (!phases.length || !(total > 0)) return null;
  return (
    <div className="min-w-0">
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={phases.map((p) => `${label(p.kind)} ${ms(p.ms)}`).join(", ")}>
        {phases.map((p, k) => (
          <div key={k} style={{ width: `${(p.ms / total) * 100}%`, background: phaseColor(p.kind, palette) }} title={`${label(p.kind)} ${ms(p.ms)}`} />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        {phases.map((p, k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: phaseColor(p.kind, palette) }} />
            {label(p.kind)} <span className="tabular-nums text-foreground">{ms(p.ms)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const label = (k: PhaseKind) => PHASES.find((p) => p.kind === k)?.label ?? k;

function UrlText({ url }: { url: string }) {
  let host = "";
  let rest = url;
  try {
    const u = new URL(url);
    host = `${u.protocol}//${u.host}`;
    rest = `${u.pathname}${u.search}${u.hash}`;
  } catch {
    // A path without a host.
  }
  return (
    <span className="min-w-0 truncate font-mono text-[12.5px]" title={url}>
      {host ? <span className="text-muted-foreground">{host}</span> : null}
      {rest}
    </span>
  );
}

function Headers({ list, reveal }: { list: [string, string][]; reveal: boolean }) {
  if (!list.length) return <div className="px-1 py-2 text-xs text-muted-foreground">No headers</div>;
  return (
    <dl className="grid min-w-0 grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[12px]">
      {list.map(([k, v], i) => (
        <Fragment key={i}>
          <dt className="truncate text-muted-foreground" title={k}>
            {k}
          </dt>
          <dd className="min-w-0 break-all">{!reveal && isSecretHeader(k) ? <span className="text-muted-foreground">{mask(v)}</span> : v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Body({ text, mime, empty }: { text: string | null; mime: string; empty: string }) {
  const body = useMemo(() => readBody(text, mime), [text, mime]);
  if (body.kind === "empty") return <div className="px-1 py-2 text-xs text-muted-foreground">{empty}</div>;
  if (body.kind === "json") return <JsonTree value={body.json} />;
  const shown = body.text!.length > 20000 ? `${body.text!.slice(0, 20000)}\n… ${body.text!.length - 20000} more characters` : body.text!;
  return <pre className="max-h-[360px] min-w-0 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/40 p-2.5 font-mono text-[12px] leading-relaxed ring-1 ring-border">{shown}</pre>;
}

type ExTab = "body" | "headers" | "request";

function ExchangeDetail({ ex, compact }: { ex: Exchange; compact?: boolean }) {
  const env = useEnv();
  const [tab, setTab] = useState<ExTab>(ex.resBody != null || ex.status !== null ? "body" : "request");
  const [reveal, setReveal] = useState(false);
  const secrets = [...ex.reqHeaders, ...ex.resHeaders].some(([k]) => isSecretHeader(k));
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Segments<ExTab>
          value={tab}
          onChange={setTab}
          label="Part"
          options={[
            { id: "body", label: "Response" },
            { id: "headers", label: `Headers${ex.resHeaders.length ? ` ${ex.resHeaders.length}` : ""}` },
            { id: "request", label: "Request" },
          ]}
        />
        <div className="ml-auto flex gap-1.5">
          {secrets ? (
            <button type="button" className={BTN} onClick={() => setReveal(!reveal)} aria-pressed={reveal} title={reveal ? "Mask secret headers" : "Show secret headers"}>
              <Glyph name={reveal ? "eye-off" : "eye"} size={13} />
              {compact ? null : reveal ? "Hide secrets" : "Secrets"}
            </button>
          ) : null}
          <button type="button" className={BTN} onClick={() => env.perform([{ $iris: "action", kind: "copy", args: [toCurl(ex, reveal)] }])} title="Copy the request as a curl command">
            <Glyph name="terminal" size={13} />
            curl
          </button>
        </div>
      </div>
      {tab === "body" ? <Body text={ex.resBody} mime={ex.resMime} empty="No response body" /> : null}
      {tab === "headers" ? <Headers list={ex.resHeaders} reveal={reveal} /> : null}
      {tab === "request" ? (
        <div className="flex min-w-0 flex-col gap-3">
          <Headers list={ex.reqHeaders} reveal={reveal} />
          {ex.reqBody != null ? <Body text={ex.reqBody} mime={ex.reqHeaders.find(([k]) => /content-type/i.test(k))?.[1] ?? ""} empty="" /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ExchangeHead({ ex }: { ex: Exchange }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
      <Chip className="font-mono">
        {ex.method}
      </Chip>
      <div className="flex min-w-0 flex-1 basis-56">
        <UrlText url={ex.url ? maskUrl(ex.url) : "(no URL)"} />
      </div>
      <div className="flex shrink-0 items-center gap-2.5 text-[12px] tabular-nums text-muted-foreground">
        {ex.status !== null ? (
          <Chip tone={statusTone(ex.status)} variant="soft">
            {`${ex.status}${ex.statusText ? ` ${ex.statusText}` : ""}`}
          </Chip>
        ) : null}
        {ex.ms !== null ? (
          <span className="inline-flex items-center gap-1">
            <Glyph name="timer" size={12} />
            {ms(ex.ms)}
          </span>
        ) : null}
        {ex.size !== null ? <span>{formatBytes(ex.size)}</span> : null}
        {ex.version ? <span className="hidden font-mono sm:inline">{ex.version}</span> : null}
      </div>
    </div>
  );
}

export function HttpExchangeView({ props }: ViewProps) {
  const pending = [props.request, props.response, props.entry].some(isPendingValue);
  const { exchange, problems } = useMemo(
    () => (pending ? { exchange: null, problems: [] } : normalizeExchange({ request: props.request, response: props.response, entry: props.entry, ms: props.ms })),
    [pending, props.request, props.response, props.entry, props.ms],
  );
  if (pending || !exchange) return <Shimmer className="h-40" />;
  const title = str(props.title);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Problems list={problems} what="<HttpExchange>" />
      {title ? <div className="truncate text-[13.5px] font-semibold">{title}</div> : null}
      <ExchangeHead ex={exchange} />
      <PhaseBar phases={exchange.phases} total={exchange.phases.reduce((a, p) => a + p.ms, 0)} />
      <ExchangeDetail ex={exchange} />
    </div>
  );
}

// ---------- Waterfall ----------

export function WaterfallView({ props }: ViewProps) {
  const { palette } = useEnv();
  const pending = isPendingValue(props.har);
  const { data, problems } = useMemo(() => (pending ? { data: null, problems: [] } : normalizeWaterfall(props.har)), [pending, props.har]);
  const [type, setType] = useState<ResourceType | "all">("all");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [box, width] = useWidth<HTMLDivElement>();
  if (pending || !data) return <Shimmer className="h-48" />;
  const compact = width > 0 && width < 560;
  const present = new Set(data.rows.map((r) => r.type));
  const q = search.trim().toLowerCase();
  const rows = data.rows.filter((r) => (type === "all" || r.type === type) && (!q || r.url.toLowerCase().includes(q))).slice(0, 2000);
  const total = data.total || 1;
  const axis = ticks(total, compact ? 3 : 5);
  const maxH = Math.max(160, Math.min(1200, num(props.height) ?? 420));
  const title = str(props.title);
  const failed = data.rows.filter((r) => (r.status ?? 0) >= 400).length;
  const nameW = compact ? 120 : 220;
  const meta = compact ? 0 : 176;

  const track = (className: string, children?: ReactNode) => (
    <div className={cn("relative min-w-0 flex-1", className)}>
      {axis.map((t) => (
        <i key={t} aria-hidden className="absolute inset-y-0 w-px bg-border/60" style={{ left: `${(t / total) * 100}%` }} />
      ))}
      {data.marks.map((m) => (
        <i key={m.label} aria-hidden className="absolute inset-y-0 w-px" style={{ left: `${(m.at / total) * 100}%`, background: markColor(m.label, palette) }} />
      ))}
      {children}
    </div>
  );

  return (
    <div ref={box} className="flex min-w-0 flex-col gap-2.5">
      <Problems list={problems} what="<Waterfall>" />
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        {title ? <div className="truncate text-[13.5px] font-semibold">{title}</div> : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] tabular-nums text-muted-foreground">
          <span>
            <span className="text-foreground">{data.rows.length}</span> {data.rows.length === 1 ? "request" : "requests"}
          </span>
          {data.bytes ? <span>{formatBytes(data.bytes)}</span> : null}
          <span>
            finished <span className="text-foreground">{ms(Math.max(0, ...data.rows.map((r) => r.start + r.ms)))}</span>
          </span>
          {data.marks.map((m) => (
            <span key={m.label} className="inline-flex items-center gap-1">
              <span className="h-3 w-0.5 rounded-full" style={{ background: markColor(m.label, palette) }} />
              {m.label} <span className="text-foreground">{ms(m.at)}</span>
            </span>
          ))}
          {failed ? <span style={{ color: palette.tone.bad }}>{failed} failed</span> : null}
        </div>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Segments<ResourceType | "all"> value={type} onChange={(v) => (setType(v), setOpen(null))} label="Type" options={[{ id: "all", label: "All" }, ...RESOURCE_TYPES.filter((t) => present.has(t.id))]} />
        <label className="flex h-8 min-w-[9rem] flex-1 items-center gap-2 rounded-full bg-muted/60 px-3 text-[13px] ring-1 ring-border focus-within:ring-foreground/30">
          <Glyph name="search" size={14} className="text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by URL" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" aria-label="Filter requests by URL" />
        </label>
      </div>

      <div className="min-w-0 overflow-auto rounded-lg ring-1 ring-border" style={{ maxHeight: maxH }}>
        <div className="sticky top-0 z-[1] flex h-7 items-center border-b border-border bg-muted/90 text-[11px] text-muted-foreground backdrop-blur-sm">
          <div className="shrink-0 px-2.5" style={{ width: nameW }}>
            Name
          </div>
          {meta ? (
            <div className="flex shrink-0 gap-2 pr-2 text-right" style={{ width: meta }}>
              <span className="w-10">Status</span>
              <span className="flex-1">Size</span>
              <span className="w-14">Time</span>
            </div>
          ) : null}
          {track(
            "h-full",
            axis.slice(1).map((t) => (
              <span key={t} className="absolute top-1.5 -translate-x-1/2 whitespace-nowrap tabular-nums" style={{ left: `${(t / total) * 100}%` }}>
                {ms(t)}
              </span>
            )),
          )}
          <div className="w-2.5 shrink-0" />
        </div>
        {rows.map((r) => (
          <Fragment key={r.id}>
            <button
              type="button"
              onClick={() => setOpen(open === r.id ? null : r.id)}
              onMouseEnter={() => setHover(r.id)}
              onMouseLeave={() => setHover(null)}
              aria-expanded={open === r.id}
              className={cn("flex h-7 w-full min-w-0 items-center border-b border-border/50 text-left text-[12px] hover:bg-state-hover", FOCUS, open === r.id && "bg-state-hover")}
            >
              <div className="flex shrink-0 items-center gap-1.5 truncate px-2.5" style={{ width: nameW, color: (r.status ?? 0) >= 400 ? palette.tone.bad : undefined }} title={maskUrl(r.url)}>
                {r.method !== "GET" ? <span className="font-mono text-[10.5px] text-muted-foreground">{r.method}</span> : null}
                <span className="truncate">{r.name}</span>
              </div>
              {meta ? (
                <div className="flex shrink-0 gap-2 pr-2 text-right tabular-nums text-muted-foreground" style={{ width: meta }}>
                  <span className="w-10" style={{ color: (r.status ?? 0) >= 400 ? palette.tone.bad : undefined }}>
                    {r.status ?? "(failed)"}
                  </span>
                  <span className="flex-1 whitespace-nowrap">{r.size !== null ? formatBytes(r.size) : ""}</span>
                  <span className="w-14 text-foreground">{ms(r.ms)}</span>
                </div>
              ) : null}
              {track(
                "h-full",
                <>
                <div className="absolute top-1/2 flex h-2.5 -translate-y-1/2 overflow-hidden rounded-[3px]" style={{ left: `${(r.start / total) * 100}%`, width: `max(2px, ${(r.ms / total) * 100}%)` }}>
                  {r.phases.map((p, k) => (
                    <div key={k} className="h-full" style={{ width: `${(p.ms / Math.max(1e-9, r.phases.reduce((a, x) => a + x.ms, 0))) * 100}%`, background: phaseColor(p.kind, palette) }} />
                  ))}
                </div>
                {hover === r.id && !compact ? (
                  <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 pl-1.5 text-[11px] tabular-nums text-muted-foreground" style={{ left: `${((r.start + r.ms) / total) * 100}%` }}>
                    {ms(r.ms)}
                  </span>
                ) : null}
                </>,
              )}
              <div className="w-2.5 shrink-0" />
            </button>
            {open === r.id ? <WaterfallDetail row={r} /> : null}
          </Fragment>
        ))}
        {!rows.length ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">No requests match</div> : null}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        {PHASES.map((p) => (
          <span key={p.kind} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: phaseColor(p.kind, palette) }} />
            {p.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function WaterfallDetail({ row }: { row: WaterfallRow }) {
  const ex = useMemo(() => normalizeExchange({ entry: row.entry && typeof row.entry === "object" && "request" in (row.entry as object) ? row.entry : { request: { method: row.method, url: row.url }, response: row.status !== null ? { status: row.status } : undefined, time: row.ms } }).exchange, [row]);
  return (
    <div className="flex min-w-0 flex-col gap-2.5 border-b border-border bg-muted/25 px-3 py-3">
      <ExchangeHead ex={{ ...ex, ms: row.ms, size: row.size ?? ex.size }} />
      <PhaseBar phases={row.phases} total={row.phases.reduce((a, p) => a + p.ms, 0)} />
      <ExchangeDetail ex={ex} compact />
    </div>
  );
}

// ---------- ErDiagram ----------

const T_W = 232;
const T_HEAD = 34;
const T_ROW = 24;
const T_PAD = 6;
const GAP_X = 72;
const GAP_Y = 20;

interface Placed {
  table: ErTable;
  x: number;
  y: number;
  h: number;
  col: number;
}

export function ErDiagramView({ props }: ViewProps) {
  const { palette } = useEnv();
  const pending = [props.schema, props.tables, props.relations].some(isPendingValue);
  const { schema, problems } = useMemo(
    () => (pending ? { schema: null, problems: [] } : parseSchema({ schema: props.schema, format: str(props.format) === "auto" ? undefined : props.format, tables: props.tables, relations: props.relations })),
    [pending, props.schema, props.format, props.tables, props.relations],
  );
  const [focus, setFocus] = useState<{ table: string; pinned: boolean } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [box, width] = useWidth<HTMLDivElement>();

  // On a phone the tables stack in one column, links curving out to the right, instead of a wide
  // row zoomed below reading size.
  const stacked = width > 0 && width < 520;
  const layout = useMemo(() => {
    if (!schema) return null;
    const ranks = stacked ? [rankTables(schema).flat()] : rankTables(schema);
    const byName = new Map(schema.tables.map((t) => [t.name, t]));
    const heights = ranks.map((col) => col.reduce((a, n) => a + T_HEAD + byName.get(n)!.columns.length * T_ROW + T_PAD + GAP_Y, -GAP_Y));
    const tallest = Math.max(0, ...heights);
    const placed = new Map<string, Placed>();
    ranks.forEach((col, k) => {
      let y = 0; // top-aligned columns share one top edge
      for (const n of col) {
        const t = byName.get(n)!;
        const h = T_HEAD + t.columns.length * T_ROW + T_PAD;
        placed.set(n, { table: t, x: k * (T_W + GAP_X), y, h, col: k });
        y += h + GAP_Y;
      }
    });
    return { placed, w: ranks.length * (T_W + GAP_X) - GAP_X + (stacked ? 64 : 0), h: tallest };
  }, [schema, stacked]);

  if (pending || !schema || !layout) return <Shimmer className="h-56" />;
  const title = str(props.title);
  const maxH = Math.max(200, Math.min(1400, num(props.height) ?? 520));
  const PAD = 16;
  const fit = width > 0 ? Math.min(1, (width - 2) / (layout.w + PAD * 2)) : 1;
  // Fit to width, but never so small the names can't be read; narrow screens scroll instead.
  const scale = zoom ?? Math.max(0.75, fit);
  const related = (t: string) => !focus || focus.table === t || schema.relations.some((r) => (r.from.table === focus.table && r.to.table === t) || (r.to.table === focus.table && r.from.table === t));
  const live = (r: ErRelation) => !focus || r.from.table === focus.table || r.to.table === focus.table;
  const rowY = (p: Placed, column: string) => {
    const i = p.table.columns.findIndex((c) => c.name === column);
    return p.y + T_HEAD + (i < 0 ? 0 : i) * T_ROW + T_ROW / 2;
  };

  return (
    <div ref={box} className="flex min-w-0 flex-col gap-2">
      <Problems list={problems} what="<ErDiagram>" />
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {title ? <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</div> : <div className="flex-1" />}
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {schema.tables.length} {schema.tables.length === 1 ? "table" : "tables"}, {schema.relations.length} {schema.relations.length === 1 ? "link" : "links"}
          {schema.format !== "data" ? ` from ${schema.format === "sql" ? "SQL" : schema.format === "prisma" ? "Prisma" : "Convex"}` : ""}
        </span>
        <div className="flex gap-1">
          <button type="button" className={BTN} onClick={() => setZoom(Math.max(0.3, +(scale - 0.15).toFixed(2)))} aria-label="Zoom out">
            <Glyph name="minus" size={13} />
          </button>
          <button type="button" className={BTN} onClick={() => setZoom(zoom === null ? 1 : null)} title={zoom === null ? "Actual size" : "Fit to width"}>
            {Math.round(scale * 100)}%
          </button>
          <button type="button" className={BTN} onClick={() => setZoom(Math.min(1.6, +(scale + 0.15).toFixed(2)))} aria-label="Zoom in">
            <Glyph name="plus" size={13} />
          </button>
        </div>
      </div>
      <div className="min-w-0 overflow-auto rounded-lg bg-muted/25 ring-1 ring-border" style={{ maxHeight: maxH }} onClick={(e) => e.target === e.currentTarget && setFocus(null)}>
        <div style={{ width: (layout.w + PAD * 2) * scale, height: (layout.h + PAD * 2) * scale }}>
          <div className="relative origin-top-left" style={{ width: layout.w + PAD * 2, height: layout.h + PAD * 2, transform: `scale(${scale})` }} onClick={(e) => e.target === e.currentTarget && setFocus(null)}>
            <svg className="pointer-events-none absolute inset-0" width={layout.w + PAD * 2} height={layout.h + PAD * 2} aria-hidden>
              <g transform={`translate(${PAD} ${PAD})`}>
                {schema.relations.map((r, k) => {
                  const a = layout.placed.get(r.from.table);
                  const b = layout.placed.get(r.to.table);
                  if (!a || !b) return null;
                  const y1 = rowY(a, r.from.column);
                  const y2 = rowY(b, r.to.column);
                  let d: string;
                  let x1: number;
                  let x2: number;
                  let dir1: number;
                  let dir2: number;
                  if (a.col > b.col) {
                    x1 = a.x;
                    x2 = b.x + T_W;
                    dir1 = -1;
                    dir2 = 1;
                    const mid = (x1 - x2) / 2;
                    d = `M${x1},${y1} C${x1 - mid},${y1} ${x2 + mid},${y2} ${x2},${y2}`;
                  } else if (a.col < b.col) {
                    x1 = a.x + T_W;
                    x2 = b.x;
                    dir1 = 1;
                    dir2 = -1;
                    const mid = (x2 - x1) / 2;
                    d = `M${x1},${y1} C${x1 + mid},${y1} ${x2 - mid},${y2} ${x2},${y2}`;
                  } else {
                    x1 = a.x + T_W;
                    x2 = b.x + T_W;
                    dir1 = dir2 = 1;
                    const out = 28 + Math.min(40, Math.abs(y2 - y1) / 6);
                    d = `M${x1},${y1} C${x1 + out},${y1} ${x2 + out},${y2} ${x2},${y2}`;
                  }
                  const on = live(r);
                  const color = focus && on ? palette.accent : "var(--muted-foreground)";
                  return (
                    <g key={k} opacity={on ? (focus ? 1 : 0.7) : 0.12} stroke={color} fill="none" strokeWidth={focus && on ? 1.6 : 1.2}>
                      <path d={d} strokeDasharray={r.kind === "list" ? "4 3" : undefined} />
                      <End x={x1} y={y1} dir={dir1} many={r.kind !== "one"} />
                      <End x={x2} y={y2} dir={dir2} many={false} />
                    </g>
                  );
                })}
              </g>
            </svg>
            {[...layout.placed.values()].map((p) => {
              const on = related(p.table.name);
              const isFocus = focus?.table === p.table.name;
              return (
                <div
                  key={p.table.name}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isFocus && focus?.pinned}
                  aria-label={`Table ${p.table.name}, ${p.table.columns.length} columns`}
                  className={cn("absolute overflow-hidden rounded-[10px] bg-card shadow-[0_0_0_1px_var(--border),0_6px_18px_-12px_rgb(0_0_0/0.45)] transition-opacity", FOCUS, !on && "opacity-35")}
                  style={{ left: p.x + PAD, top: p.y + PAD, width: T_W, height: p.h, boxShadow: isFocus ? `0 0 0 1.5px ${palette.accent}, 0 6px 18px -12px rgb(0 0 0 / 0.45)` : undefined }}
                  onMouseEnter={() => !focus?.pinned && setFocus({ table: p.table.name, pinned: false })}
                  onMouseLeave={() => !focus?.pinned && setFocus(null)}
                  onFocus={() => !focus?.pinned && setFocus({ table: p.table.name, pinned: false })}
                  onClick={() => setFocus(isFocus && focus?.pinned ? null : { table: p.table.name, pinned: true })}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setFocus(isFocus && focus?.pinned ? null : { table: p.table.name, pinned: true }))}
                >
                  <div className="flex items-center gap-1.5 border-b border-border px-2.5" style={{ height: T_HEAD, background: palette.accentSoft }}>
                    <Glyph name="table-2" size={13} className="text-muted-foreground" />
                    <span className="min-w-0 truncate text-[12.5px] font-semibold" title={p.table.name}>
                      {p.table.name}
                    </span>
                  </div>
                  {p.table.columns.map((c) => (
                    <div key={c.name} className="flex items-center gap-1.5 px-2.5 text-[12px]" style={{ height: T_ROW }}>
                      <span className="grid w-3.5 shrink-0 place-items-center">
                        {c.pk ? <Glyph name="key-round" size={12} color={palette.accent} /> : c.fk ? <Glyph name="link" size={11} className="text-muted-foreground" /> : null}
                      </span>
                      <span className={cn("min-w-0 truncate font-mono", c.pk && "font-semibold")} title={c.fk ? `${c.name} → ${c.fk.table}.${c.fk.column}` : c.name}>
                        {c.name}
                      </span>
                      {c.indexed && !c.pk ? <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-muted-foreground">idx</span> : null}
                      {c.unique && !c.pk ? <span className="shrink-0 text-[9.5px] uppercase tracking-wide text-muted-foreground">uq</span> : null}
                      <span className="ml-auto max-w-[45%] shrink-0 truncate pl-1 font-mono text-[11px] text-muted-foreground" title={c.type}>
                        {c.type}
                        {c.nullable ? "?" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Glyph name="key-round" size={12} color={palette.accent} /> Primary key
        </span>
        <span className="inline-flex items-center gap-1">
          <Glyph name="link" size={11} /> Foreign key
        </span>
        <span>? nullable</span>
        <span>Click a table to trace its links</span>
      </div>
    </div>
  );
}

/** A crow's foot (many) or a bar (one) where a line meets a table. */
function End({ x, y, dir, many }: { x: number; y: number; dir: number; many: boolean }) {
  const bx = x + dir * 9;
  if (many)
    return (
      <>
        <path d={`M${x},${y - 5} L${bx},${y} L${x},${y + 5}`} />
        <path d={`M${bx + dir * 3},${y - 5} L${bx + dir * 3},${y + 5}`} />
      </>
    );
  return <path d={`M${bx},${y - 5} L${bx},${y + 5}`} />;
}

// ---------- QueryPlan ----------

export function QueryPlanView({ props }: ViewProps) {
  const { palette } = useEnv();
  const pending = isPendingValue(props.plan);
  const { plan, problems } = useMemo(() => (pending ? { plan: null, problems: [] } : normalizePlan(props.plan)), [pending, props.plan]);
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const [open, setOpen] = useState<number | null>(null);
  const [box, width] = useWidth<HTMLDivElement>();
  if (pending || !plan) return <Shimmer className="h-48" />;
  const title = str(props.title);
  const query = str(props.query);
  const metric = str(props.metric) === "cost" || (!plan.analyzed && str(props.metric) !== "time") ? "cost" : plan.analyzed ? "time" : "cost";
  const total = metric === "time" ? Math.max(1e-9, plan.root?.totalMs ?? 0) : Math.max(1e-9, plan.totalCost);
  const self = (n: PlanNode) => (metric === "time" ? n.selfMs : n.selfCost);
  const slowest = plan.nodes.reduce<PlanNode | null>((a, n) => (!a || self(n) > self(a) ? n : a), null);
  const warnings = plan.nodes.reduce((a, n) => a + n.warnings.length, 0);
  const compact = width > 0 && width < 560;

  const rows: PlanNode[] = [];
  const walk = (n: PlanNode) => {
    rows.push(n);
    if (!closed.has(n.id)) n.children.forEach(walk);
  };
  if (plan.root) walk(plan.root);


  return (
    <div ref={box} className="flex min-w-0 flex-col gap-3">
      <Problems list={problems} what="<QueryPlan>" />
      {title ? <div className="truncate text-[13.5px] font-semibold">{title}</div> : null}
      {plan.root ? (
        <div className="flex min-w-0 flex-wrap gap-x-5 gap-y-2">
          {plan.executionMs !== null ? <Stat label="Execution" value={ms(plan.executionMs)} /> : null}
          {plan.planningMs !== null ? <Stat label="Planning" value={ms(plan.planningMs)} /> : null}
          <Stat label="Total cost" value={plan.totalCost.toLocaleString("en-US", { maximumFractionDigits: 0 })} />
          {slowest ? <Stat label={metric === "time" ? "Most time" : "Most cost"} value={`${slowest.type} ${Math.round((self(slowest) / total) * 100)}%`} /> : null}
          {warnings ? <Stat label="Warnings" value={String(warnings)} tone={palette.tone.warn} /> : null}
        </div>
      ) : null}
      {query ? (
        <details className="group min-w-0 rounded-lg bg-muted/40 ring-1 ring-border">
          <summary className={cn("flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground", FOCUS)}>
            <Glyph name="chevron-right" size={12} className="transition-transform group-open:rotate-90" />
            <span className="min-w-0 truncate font-mono">{query.replace(/\s+/g, " ")}</span>
          </summary>
          <pre className="overflow-x-auto whitespace-pre-wrap border-t border-border px-2.5 py-2 font-mono text-[12px] leading-relaxed">{query}</pre>
        </details>
      ) : null}
      {plan.root ? (
        <div className="min-w-0 overflow-x-auto rounded-lg ring-1 ring-border" role="tree" aria-label="Query plan">
          <div className={cn("flex h-7 items-center gap-2 border-b border-border bg-muted/80 px-2.5 text-[11px] text-muted-foreground", compact ? "min-w-0" : "min-w-[560px]")}>
            <span className="flex-1">Node</span>
            {!compact ? <span className="w-[86px] text-right">Rows</span> : null}
            <span className="w-[120px] text-right">{metric === "time" ? "Own time" : "Own cost"}</span>
          </div>
          {rows.map((n) => {
            const share = self(n) / total;
            const isOpen = open === n.id;
            const hasKids = n.children.length > 0;
            return (
              <Fragment key={n.id}>
                <div
                  role="treeitem"
                  aria-level={n.depth + 1}
                  aria-expanded={hasKids ? !closed.has(n.id) : undefined}
                  aria-selected={isOpen}
                  tabIndex={0}
                  onClick={() => setOpen(isOpen ? null : n.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") (e.preventDefault(), setOpen(isOpen ? null : n.id));
                    else if (e.key === "ArrowLeft" && hasKids && !closed.has(n.id)) setClosed(new Set([...closed, n.id]));
                    else if (e.key === "ArrowRight" && closed.has(n.id)) setClosed(new Set([...closed].filter((x) => x !== n.id)));
                  }}
                  className={cn("flex min-h-9 cursor-pointer items-center gap-2 border-b border-border/50 px-2.5 py-1 text-[12.5px] hover:bg-state-hover", FOCUS, isOpen && "bg-state-hover", compact ? "min-w-0" : "min-w-[560px]")}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-1" style={{ paddingLeft: n.depth * (compact ? 12 : 18) }}>
                    {hasKids ? (
                      <button
                        type="button"
                        tabIndex={-1}
                        className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"
                        aria-label={closed.has(n.id) ? "Expand" : "Collapse"}
                        onClick={(e) => {
                          e.stopPropagation();
                          const next = new Set(closed);
                          if (next.has(n.id)) next.delete(n.id);
                          else next.add(n.id);
                          setClosed(next);
                        }}
                      >
                        <Glyph name="chevron-right" size={12} className={cn("transition-transform", !closed.has(n.id) && "rotate-90")} />
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium">{n.label.split(" on ")[0].split(" using ")[0]}</span>
                      {n.label.length > n.label.split(" on ")[0].split(" using ")[0].length ? <span className="text-muted-foreground">{n.label.slice(n.label.split(" on ")[0].split(" using ")[0].length)}</span> : null}
                      {n.warnings.length ? (
                        <span className="ml-1.5 inline-flex translate-y-[2px]" title={n.warnings.join("\n")}>
                          <Glyph name="triangle-alert" size={13} color={palette.tone.warn} />
                        </span>
                      ) : null}
                    </span>
                  </div>
                  {!compact ? (
                    <div className="w-[86px] shrink-0 text-right tabular-nums text-muted-foreground" title={n.planRows !== null ? `Estimated ${n.planRows} rows` : undefined}>
                      {n.actual ? (
                        <>
                          <span className="text-foreground">{count(n.actual.rows * Math.max(1, n.actual.loops))}</span>
                          {n.planRows !== null ? <span className="text-[11px]"> / {count(n.planRows * Math.max(1, n.actual.loops))}</span> : null}
                        </>
                      ) : n.planRows !== null ? (
                        count(n.planRows)
                      ) : (
                        ""
                      )}
                    </div>
                  ) : null}
                  <div className="flex w-[120px] shrink-0 items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="iris-bar h-full rounded-full" style={{ width: `${Math.min(100, share * 100)}%`, background: palette.accent }} />
                    </div>
                    <span className="w-[54px] text-right text-[11.5px] tabular-nums">{metric === "time" ? ms(n.selfMs) : self(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
                {isOpen ? <PlanDetail node={n} share={share} metric={metric} /> : null}
              </Fragment>
            );
          })}
        </div>
      ) : null}
      {plan.root && !plan.analyzed ? <div className="text-[11.5px] text-muted-foreground">Estimates only. EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) adds real times and rows.</div> : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
      <div className="truncate text-[15px] font-semibold tabular-nums" style={{ color: tone }}>
        {value}
      </div>
    </div>
  );
}

function PlanDetail({ node, share, metric }: { node: PlanNode; share: number; metric: "time" | "cost" }) {
  const { palette } = useEnv();
  const facts: [string, string][] = [];
  facts.push([metric === "time" ? "Own time" : "Own cost", `${metric === "time" ? ms(node.selfMs) : node.selfCost.toFixed(1)} (${Math.round(share * 100)}%)`]);
  if (node.actual) {
    facts.push(["Time", `${ms(node.actual.startup)} to first row, ${ms(node.actual.total)} total${node.actual.loops > 1 ? ` per loop, ${node.actual.loops} loops` : ""}`]);
    facts.push(["Rows", `${node.actual.rows.toLocaleString("en-US")} actual${node.planRows !== null ? `, ${node.planRows.toLocaleString("en-US")} estimated` : ""}${node.actual.loops > 1 ? " per loop" : ""}`]);
  } else if (node.planRows !== null) facts.push(["Rows", `${node.planRows.toLocaleString("en-US")} estimated`]);
  if (node.cost) facts.push(["Cost", `${node.cost.startup.toFixed(2)} to ${node.cost.total.toFixed(2)}${node.width !== null ? `, ${node.width} bytes wide` : ""}`]);
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b border-border bg-muted/25 px-3 py-2.5 text-[12px]">
      {node.warnings.map((w, k) => (
        <div key={k} className="flex items-start gap-1.5" style={{ color: palette.tone.warn }}>
          <Glyph name="triangle-alert" size={13} className="mt-px" />
          <span>{w}</span>
        </div>
      ))}
      <dl className="grid min-w-0 grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1">
        {[...facts, ...node.details].map(([k, v], i) => (
          <Fragment key={i}>
            <dt className="truncate text-muted-foreground">{k}</dt>
            <dd className={cn("min-w-0 break-words", i >= facts.length && "font-mono text-[11.5px]")}>{toText(v)}</dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}
