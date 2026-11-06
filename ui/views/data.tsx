import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defaultCompare, isElementValue, isFnValue, isPendingValue, toText } from "../../core/evaluate";
import { useEnv } from "../env";
import { toneColor, tooClose } from "../palette";
import type { ViewProps } from "../render";
import { renderElementValue } from "../render";
import { Glyph, Shimmer, cn, fmt, num, str } from "./kit";
import { InlineMarkdown, hasInlineMarkdown } from "./inline-md";
import { SparkPath } from "./spark";

interface Column {
  key: string;
  label: string;
  format?: unknown;
  align?: "left" | "right" | "center";
  width?: number;
  tone?: unknown;
  render?: unknown;
  /** The longest text column: takes the room left over. */
  fluid?: boolean;
  /** Prose: wraps over as many lines as it needs instead of being cut to one. */
  wrap?: boolean;
}

function normalizeRows(rows: unknown, columns: unknown): { rows: Record<string, unknown>[]; cols: Column[] } {
  let list: unknown[] = Array.isArray(rows) ? rows : rows && typeof rows === "object" ? Object.values(rows) : [];
  const colSpecs = Array.isArray(columns) ? columns : null;
  // A list of lists: the columns name the positions.
  if (list.length && Array.isArray(list[0])) {
    const names = colSpecs ? colSpecs.map((c) => (typeof c === "string" ? c : toText((c as Column).key ?? (c as Column).label))) : (list[0] as unknown[]).map((_, k) => `Column ${k + 1}`);
    list = list.map((r) => Object.fromEntries(names.map((n, k) => [n, (r as unknown[])[k]])));
  }
  const objects = list.map((r) => (r && typeof r === "object" && !Array.isArray(r) ? (r as Record<string, unknown>) : { value: r }));
  const keys = colSpecs
    ? colSpecs
    : [...objects.slice(0, 50).reduce((s, r) => {
        Object.keys(r).forEach((k) => s.add(k));
        return s;
      }, new Set<string>())];
  const cols: Column[] = keys.map((c) => {
    if (typeof c === "string") return { key: c, label: humanize(c) };
    const o = c as Partial<Column> & { key?: unknown };
    const key = toText(o.key ?? o.label);
    return { key, label: str(o.label) ?? humanize(key), format: o.format, align: o.align, width: num(o.width), tone: o.tone, render: o.render };
  });
  for (const c of cols) {
    if (!c.align) {
      const sample = objects.slice(0, 20).map((r) => r[c.key]).filter((v) => v != null);
      c.align = sample.length && sample.every((v) => typeof v === "number") ? "right" : "left";
    }
  }
  // The left-aligned plain-text column with the longest values gives way first when space runs short.
  // Prose (values with spaces) gives way before IDs, hashes and dates of the same length.
  const avgLength = (c: Column) => {
    const sample = objects.slice(0, 50).map((r) => r[c.key]).filter((v) => typeof v === "string") as string[];
    if (!sample.length) return 0;
    const prose = sample.filter((v) => v.includes(" ")).length / sample.length;
    return (sample.reduce((n, v) => n + v.length, 0) / sample.length) * (prose >= 0.5 ? 2 : 1);
  };
  const fluid = cols.filter((c) => c.align === "left" && !c.width && !c.render && !c.format).sort((a, b) => avgLength(b) - avgLength(a))[0];
  const rawLength = (c: Column) => {
    const sample = objects.slice(0, 50).map((r) => r[c.key]).filter((v) => typeof v === "string") as string[];
    return sample.length ? sample.reduce((n, v) => n + v.length, 0) / sample.length : 0;
  };
  if (fluid && rawLength(fluid) >= 16) fluid.fluid = true;
  // Sentences wrap; short values, IDs and paths stay on one line.
  for (const c of cols) {
    if (c.render || c.format || c.align !== "left") continue;
    const sample = objects.slice(0, 50).map((r) => r[c.key]).filter((v) => typeof v === "string") as string[];
    if (!sample.length) continue;
    const prose = sample.filter((v) => /\s/.test(v.trim())).length / sample.length;
    if (prose >= 0.5 && rawLength(c) >= 28) c.wrap = true;
  }
  return { rows: objects, cols };
}

function humanize(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : key;
}

export function TableView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.rows);
  const { rows, cols } = useMemo(() => (pending ? { rows: [], cols: [] } : normalizeRows(props.rows, props.columns)), [props.rows, props.columns, pending]);
  const initialSort = str(props.sort);
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ? { key: initialSort.replace(/^-/, ""), dir: initialSort.startsWith("-") ? -1 : 1 } : null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = Math.max(5, num(props.pageSize) ?? 25);
  const searchable = props.search === true || (props.search !== false && rows.length > 8);
  // Narrow places (a phone, a side panel) get one block per row instead of columns that can't fit.
  const box = useRef<HTMLDivElement | null>(null);
  const table = useRef<HTMLTableElement | null>(null);
  const [width, setWidth] = useState(0);
  const [need, setNeed] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [pending]);
  useLayoutEffect(() => {
    if (table.current) setNeed(table.current.offsetWidth);
  });
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = q ? rows.filter((r) => cols.some((c) => toText(r[c.key]).toLowerCase().includes(q))) : rows;
    if (sort) out = [...out].sort((a, b) => sort.dir * defaultCompare(a[sort.key], b[sort.key]));
    return out;
  }, [rows, cols, query, sort]);
  if (pending) return <Shimmer className="h-32" />;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const shown = filtered.slice(page * pageSize, page * pageSize + pageSize);
  const clickable = props.onRowClick != null;
  const toggleSort = (key: string) => {
    setPage(0);
    setSort((s) => (s?.key !== key ? { key, dir: 1 } : s.dir === 1 ? { key, dir: -1 } : null));
  };
  // Stack only when the columns really don't fit: the table, laid out at full width even while
  // hidden, reports how wide it has to be.
  const stacked = width > 0 && cols.length >= 3 && need > width + 4;
  return (
    <div className="min-w-0" ref={box}>
      {searchable ? (
        <div className="mb-2 flex items-center gap-2">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted/60 px-3 text-[13px] ring-1 ring-border focus-within:ring-foreground/30">
            <Glyph name="search" size={14} className="text-muted-foreground" />
            <input value={query} onChange={(e) => (setQuery(e.target.value), setPage(0))} placeholder="Filter rows" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" aria-label="Filter rows" />
          </label>
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {filtered.length === rows.length ? `${rows.length} rows` : `${filtered.length} of ${rows.length}`}
          </span>
        </div>
      ) : null}
      {stacked ? <StackedRows cols={cols} rows={shown} onRowClick={clickable ? (r) => env.run(props.onRowClick, [r]) : null} /> : null}
      <div className={cn("iris-scroll-x -mx-1 overflow-x-auto px-1", stacked && "pointer-events-none invisible absolute h-0 overflow-hidden")} style={stacked ? { width } : undefined} aria-hidden={stacked || undefined}>
        <table ref={table} className={cn("w-full border-collapse text-[13px] tabular-nums", props.dense ? "[&_td]:py-1" : "[&_td]:py-1.5")}>
          <thead>
            <tr>
              {cols.map((c) => (
                <th key={c.key} scope="col" className={cn("whitespace-nowrap border-b border-border px-2 pb-1.5 text-xs font-medium text-muted-foreground first:pl-0 last:pr-0", c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left")} style={c.width ? { width: c.width } : undefined}>
                  <button type="button" onClick={() => toggleSort(c.key)} className={cn("inline-flex items-center gap-1 hover:text-foreground", sort?.key === c.key && "text-foreground")} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                    {c.label}
                    {sort?.key === c.key ? <Glyph name={sort.dir === 1 ? "arrow-up" : "arrow-down"} size={11} /> : null}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, k) => (
              <tr key={k} className={cn("group", clickable && "cursor-pointer")} onClick={clickable ? () => env.run(props.onRowClick, [r]) : undefined}>
                {cols.map((c) => (
                  <Cell key={c.key} col={c} row={r} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!shown.length ? <div className="py-4 text-center text-xs text-muted-foreground">{query ? "No rows match" : "No rows"}</div> : null}
      {pages > 1 ? (
        <div className="mt-2 flex items-center justify-end gap-1 text-xs text-muted-foreground">
          <span className="mr-2 tabular-nums">
            Page {page + 1} of {pages}
          </span>
          <button type="button" className="rounded-md px-2 py-1 hover:bg-state-hover disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <Glyph name="chevron-left" size={14} />
          </button>
          <button type="button" className="rounded-md px-2 py-1 hover:bg-state-hover disabled:opacity-40" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
            <Glyph name="chevron-right" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function useCellContent(col: Column, row: Record<string, unknown>): { content: React.ReactNode; color: string | undefined; value: unknown } {
  const env = useEnv();
  const value = row[col.key];
  let tone: unknown = col.tone;
  let content: React.ReactNode;
  try {
    if (isFnValue(col.tone)) tone = env.runtime.interp.call(col.tone, [value, row]);
    if (isFnValue(col.render)) content = renderElementValue(env.runtime.interp.call(col.render, [value, row]));
    else if (isElementValue(value)) content = renderElementValue(value);
    else content = col.format ? fmt(value, col.format) : value == null ? "" : typeof value === "number" ? fmt(value, "number") : toText(value);
    if (typeof content === "string" && hasInlineMarkdown(content)) content = <InlineMarkdown text={content} />;
  } catch (e) {
    content = <span className="text-destructive">{e instanceof Error ? e.message : String(e)}</span>;
  }
  const color = toneColor(env.palette, tone) ?? undefined;
  return { content, color, value };
}

function Cell({ col, row }: { col: Column; row: Record<string, unknown> }) {
  const { content, color, value } = useCellContent(col, row);
  return (
    <td
      title={!col.wrap && typeof value === "string" && value.length > 40 ? value : undefined}
      className={cn(
        col.wrap ? "whitespace-normal leading-snug" : col.fluid ? "w-full max-w-0 truncate" : "max-w-[28rem] truncate",
        "border-b border-border/60 px-2 align-top first:pl-0 last:pr-0 group-last:border-b-0 group-hover:bg-state-hover/50",
        col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "",
      )}
      style={{ ...(color ? { color } : {}), ...(col.wrap ? { minWidth: col.fluid ? "14rem" : "9rem", maxWidth: col.fluid ? undefined : "24rem", textWrap: "pretty", overflowWrap: "anywhere" } : {}) }}
    >
      {content}
    </td>
  );
}

/** One block per row: the row's main text first, then every other column as a label and its value. */
function StackedRows({ cols, rows, onRowClick }: { cols: Column[]; rows: Record<string, unknown>[]; onRowClick: ((r: Record<string, unknown>) => void) | null }) {
  const lead = cols.find((c) => c.fluid) ?? cols.find((c) => c.wrap) ?? cols.find((c) => c.align === "left") ?? cols[0];
  const index = cols[0] !== lead && cols[0].align === "right" && /^(#|no\.?|n|rank)$/i.test(cols[0].label) ? cols[0] : null;
  const rest = cols.filter((c) => c !== lead && c !== index);
  return (
    <ul className="divide-y divide-border/60">
      {rows.map((r, k) => (
        <li key={k} className={cn("py-2.5 first:pt-0.5", onRowClick && "cursor-pointer")} onClick={onRowClick ? () => onRowClick(r) : undefined}>
          <div className="flex gap-2 text-[13px] leading-snug" style={{ overflowWrap: "anywhere" }}>
            {index ? <StackedValue col={index} row={r} className="shrink-0 tabular-nums text-muted-foreground" /> : null}
            <StackedValue col={lead} row={r} className="min-w-0" />
          </div>
          {rest.length ? (
            <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px]">
              {rest.map((c) => (
                <div key={c.key} className="flex min-w-0 max-w-full items-baseline gap-1.5">
                  <dt className="shrink-0 text-muted-foreground">{c.label}</dt>
                  <dd className="min-w-0" style={{ overflowWrap: "anywhere" }}>
                    <StackedValue col={c} row={r} />
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function StackedValue({ col, row, className }: { col: Column; row: Record<string, unknown>; className?: string }) {
  const { content, color } = useCellContent(col, row);
  return (
    <span className={className} style={color ? { color } : undefined}>
      {content}
    </span>
  );
}

export function JsonView({ props }: ViewProps) {
  if (isPendingValue(props.value)) return <Shimmer className="h-24" />;
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg bg-muted/40 p-2.5 font-mono text-[12px] leading-relaxed ring-1 ring-border">
      {str(props.label) ? <div className="mb-1 font-sans text-xs text-muted-foreground">{str(props.label)}</div> : null}
      <JsonNode value={props.value} depth={0} open={num(props.depth) ?? 2} />
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
    return (
      <div className="flex min-w-0 items-center gap-1">
        {/* The width of a chevron, so leaf keys line up with their expandable siblings. */}
        <span className="w-[11px] shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          {label}
          <span style={{ color }}>{typeof value === "string" ? JSON.stringify(value) : String(value)}</span>
        </span>
      </div>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, k) => [String(k), v] as const) : Object.entries(value);
  const brackets = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <div>
      <button type="button" onClick={() => setExpanded(!expanded)} className="inline-flex items-center gap-1 hover:text-foreground" aria-expanded={expanded}>
        <Glyph name="chevron-right" size={11} className={cn("text-muted-foreground transition-transform", expanded && "rotate-90")} />
        {label}
        <span className="text-muted-foreground">
          {brackets[0]}
          {!expanded ? ` ${entries.length} ${Array.isArray(value) ? "items" : "keys"} ${brackets[1]}` : ""}
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

export function SegmentedBarView({ props }: ViewProps) {
  const { palette } = useEnv();
  const parts = (Array.isArray(props.parts) ? props.parts : []) as { label?: unknown; value?: unknown; tone?: unknown }[];
  const values = parts.map((p) => Math.max(0, num(p.value) ?? 0));
  const total = num(props.total) ?? values.reduce((a, b) => a + b, 0);
  // Toned parts keep their meaning; untoned parts are the accent first, then quiet neutrals.
  // When a toned part already looks like the accent (an amber theme with a warn part), skip the accent.
  const toned = parts.map((p) => toneColor(palette, p.tone)).filter((c): c is string => Boolean(c));
  let untoned = toned.some((c) => tooClose(c, palette.accent)) ? 1 : 0;
  const neutralAt = (n: number) => (n === 0 ? palette.accent : `color-mix(in oklab, ${palette.tone.neutral} ${Math.max(28, 70 - n * 14)}%, transparent)`);
  const colors = parts.map((p) => (toneColor(palette, p.tone) ?? neutralAt(untoned++)));
  const color = (_p: { tone?: unknown }, k: number) => colors[k];
  return (
    <div className="min-w-0">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={parts.map((p, k) => `${toText(p.label)} ${values[k]}`).join(", ")}>
        {parts.map((p, k) => (values[k] > 0 ? <div key={k} className="iris-bar h-full min-w-1.5 first:rounded-l-full last:rounded-r-full" style={{ flex: `${values[k] / (total || 1)} 1 0%`, background: color(p, k) }} /> : null))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p, k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full" style={{ background: color(p, k) }} />
            <span className="text-muted-foreground">{toText(p.label)}</span>
            <span className="tabular-nums">{fmt(values[k], props.format)}</span>
            {total ? <span className="tabular-nums text-muted-foreground">{Math.round((values[k] / total) * 100)}%</span> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

export function SparklineView({ props }: ViewProps) {
  const { palette } = useEnv();
  const values = Array.isArray(props.values) ? props.values.map(Number).filter(Number.isFinite) : [];
  const tone = toneColor(palette, props.tone) ?? palette.accent;
  return <SparkPath values={values} color={tone} width={num(props.width) ?? 96} height={24} area={props.area !== false} className="inline-block align-middle" />;
}

export function CalendarHeatmapView({ props }: ViewProps) {
  const { palette } = useEnv();
  const counts = new Map<string, number>();
  if (Array.isArray(props.days)) for (const d of props.days as { date?: unknown; value?: unknown }[]) counts.set(toText(d.date), num(d.value) ?? 0);
  else if (props.days && typeof props.days === "object") for (const [k, v] of Object.entries(props.days)) counts.set(k, num(v) ?? 0);
  const weeks = Math.round(Math.max(4, Math.min(53, num(props.weeks) ?? 26)));
  const dates = [...counts.keys()].sort();
  const end = dates.length ? new Date(`${dates[dates.length - 1]}T00:00:00Z`) : new Date();
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + (6 - end.getUTCDay())));
  const max = Math.max(1, ...counts.values());
  const color = palette.accent;
  const cells: { date: string; value: number }[] = [];
  for (let k = weeks * 7 - 1; k >= 0; k--) {
    const d = new Date(endDay.getTime() - k * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: key, value: counts.get(key) ?? 0 });
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  return <HeatmapGrid cells={cells} weeks={weeks} max={max} color={color} footer={`${total.toLocaleString("en-US")} ${str(props.label)?.toLowerCase() ?? "events"} in ${weeks} weeks`} />;
}

const GAP = 3;
const DAY_LABEL_W = 26;

/** The grid fills the card: cells grow to fit up to 16 px; past the 9 px floor it scrolls, opened at the newest week. */
function HeatmapGrid({ cells, weeks, max, color, footer }: { cells: { date: string; value: number }[]; weeks: number; max: number; color: string; footer: string }) {
  const box = useRef<HTMLDivElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  // Measured before paint, so the first frame already has its fitted cell size.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const size = width ? Math.max(9, Math.min(16, Math.floor((width - DAY_LABEL_W - GAP * (weeks - 1)) / weeks))) : 11;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [size, weeks]);
  const months: { col: number; label: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    const d = new Date(`${cells[w * 7].date}T00:00:00Z`);
    const prev = w ? new Date(`${cells[(w - 1) * 7].date}T00:00:00Z`) : null;
    if (!prev || prev.getUTCMonth() !== d.getUTCMonth()) months.push({ col: w, label: d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }) });
  }
  // A month that starts in the last two columns has no room for its name.
  const shown = months.filter((m, k) => (k === 0 ? months.length < 2 || months[1].col - m.col >= 3 : weeks - m.col >= 2));
  return (
    <div ref={box} className="min-w-0">
      <div ref={scroller} className="iris-scroll-x overflow-x-auto">
        <div className="grid w-max text-[10.5px] text-muted-foreground" style={{ gridTemplateColumns: `${DAY_LABEL_W}px repeat(${weeks}, ${size}px)`, columnGap: GAP, rowGap: GAP, gridTemplateRows: `14px repeat(7, ${size}px)` }}>
          {shown.map((m) => (
            <span key={m.col} className="whitespace-nowrap leading-none" style={{ gridColumn: m.col + 2, gridRow: 1 }}>
              {m.label}
            </span>
          ))}
          {/* One sticky column holds the weekday names, so scrolled cells never show beside them. */}
          <span className="sticky left-0 z-[1] grid bg-card" style={{ gridColumn: 1, gridRow: "2 / -1", gridTemplateRows: `repeat(7, ${size}px)`, rowGap: GAP }}>
            {["", "Mon", "", "Wed", "", "Fri", ""].map((d, k) => (
              <span key={k} className="self-center leading-none">
                {d}
              </span>
            ))}
          </span>
          {cells.map((c, k) => (
            <div
              key={c.date}
              title={`${c.date}: ${c.value}`}
              className="rounded-[3px]"
              style={{ gridColumn: Math.floor(k / 7) + 2, gridRow: (k % 7) + 2, background: c.value ? `color-mix(in oklab, ${color} ${Math.round(25 + (c.value / max) * 75)}%, transparent)` : "var(--muted)" }}
            />
          ))}
        </div>
      </div>
      <div className="mt-1.5 text-xs text-muted-foreground">{footer}</div>
    </div>
  );
}
