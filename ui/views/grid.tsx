// DataGrid: a virtualized explorer for large results. Only the rows on screen
// are drawn, so 10,000+ rows scroll smoothly; the work (filter, sort, group,
// pivot, stats) happens in core/grid.ts over row indexes.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { isElementValue, isFnValue, isPendingValue, toText } from "../../core/evaluate";
import { AGGS, type Agg, type GridColumn, type GridData, type PivotSpec, columnStats, groupRows, normalizeGrid, pivot, pivotToCsv, query, rowsToCsv, searchIndex, suggestGroupKey, toCsv } from "../../core/grid";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { renderElementValue } from "../render";
import { Glyph, Shimmer, cn, fmt, num, str } from "./kit";

type Mode = "rows" | "groups" | "pivot" | "stats";
const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: "rows", label: "Rows", icon: "rows-3" },
  { id: "groups", label: "Groups", icon: "group" },
  { id: "pivot", label: "Pivot", icon: "table-2" },
  { id: "stats", label: "Stats", icon: "sigma" },
];

type Item = { kind: "row"; id: number } | { kind: "group"; g: number };

export function DataGridView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.rows);
  // Inline columns are a new array on every render; key them by what they say.
  const columnsKey = signature(props.columns);
  const data = useMemo<GridData>(() => (pending ? { rows: [], cols: [] } : normalizeGrid(props.rows, props.columns)), [props.rows, columnsKey, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const index = useMemo(() => searchIndex(data.rows, data.cols), [data]);

  const initialSort = str(props.sort);
  const initialPivot = (props.pivot && typeof props.pivot === "object" ? props.pivot : null) as Partial<PivotSpec> | null;
  const [mode, setMode] = useState<Mode>(() => {
    const v = str(props.view);
    if (v === "rows" || v === "groups" || v === "pivot" || v === "stats") return v;
    return initialPivot ? "pivot" : str(props.groupBy) ? "groups" : "rows";
  });
  const [search, setSearch] = useState(str(props.search) ?? "");
  const [filters, setFilters] = useState<Record<string, string>>(() => {
    const f = props.filters && typeof props.filters === "object" ? (props.filters as Record<string, unknown>) : {};
    return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, toText(v)]));
  });
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ? { key: initialSort.replace(/^-/, ""), dir: initialSort.startsWith("-") ? -1 : 1 } : null);
  const [groupKey, setGroupKey] = useState<string | null>(str(props.groupBy) ?? null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [pv, setPv] = useState<PivotSpec | null>(initialPivot?.rows ? { rows: toText(initialPivot.rows), columns: initialPivot.columns ? toText(initialPivot.columns) : null, value: initialPivot.value ? toText(initialPivot.value) : null, agg: AGGS.includes(initialPivot.agg as Agg) ? (initialPivot.agg as Agg) : undefined } : null);

  const ids = useMemo(() => query(data, { search, filters, sort }, index), [data, search, filters, sort, index]);
  const suggested = useMemo(() => suggestGroupKey(data), [data]);
  const group = groupKey && data.cols.some((c) => c.key === groupKey) ? groupKey : suggested;
  const groups = useMemo(() => (mode === "groups" && group ? groupRows(data, ids, group, sort?.key) : null), [mode, group, data, ids, sort]);
  const pivotSpec: PivotSpec | null = pv ?? (group ? { rows: group, columns: null, value: data.cols.find((c) => c.type === "number")?.key ?? null, agg: "sum" } : null);
  const table = useMemo(() => (mode === "pivot" && pivotSpec ? pivot(data, ids, pivotSpec) : null), [mode, pivotSpec?.rows, pivotSpec?.columns, pivotSpec?.value, pivotSpec?.agg, data, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = search.trim() !== "" || Object.values(filters).some((f) => f.trim() !== "");
  if (pending) return <Shimmer className="h-48" />;

  const copy = () => {
    let csv: string;
    if (mode === "pivot" && table && pivotSpec) csv = pivotToCsv(table, labelOf(data, pivotSpec.rows));
    else if (mode === "stats") csv = statsCsv(data, ids);
    else csv = rowsToCsv(data, ids);
    env.perform([{ $iris: "action", kind: "copy", args: [csv] }]);
  };

  return (
    <div className="iris-grid min-w-0">
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-2">
        <label className="flex h-8 min-w-[10rem] flex-1 items-center gap-2 rounded-full bg-muted/60 px-3 text-[13px] ring-1 ring-border focus-within:ring-foreground/30">
          <Glyph name="search" size={14} className="text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search every column" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground" aria-label="Search rows" />
          {search ? (
            <button type="button" onClick={() => setSearch("")} className="text-muted-foreground hover:text-foreground" aria-label="Clear search">
              <Glyph name="x" size={13} />
            </button>
          ) : null}
        </label>
        <div className="iris-scroll-x flex max-w-full shrink-0 overflow-x-auto rounded-full bg-muted/70 p-0.5 text-[12px]" role="tablist" aria-label="View">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={mode === m.id}
              onClick={() => setMode(m.id)}
              className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5", mode === m.id ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}
            >
              <Glyph name={m.icon} size={13} />
              {m.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={copy} className="grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground" title="Copy what is shown as CSV" aria-label="Copy what is shown as CSV">
          <Glyph name="clipboard-copy" size={14} />
        </button>
      </div>

      {mode === "groups" ? (
        <Controls>
          <Pick label="Group by" value={group ?? ""} onChange={(v) => (setGroupKey(v), setCollapsed(new Set()))} options={data.cols.map((c) => [c.key, c.label])} />
        </Controls>
      ) : null}
      {mode === "pivot" && pivotSpec ? (
        <Controls>
          <Pick label="Rows" value={pivotSpec.rows} onChange={(v) => setPv({ ...pivotSpec, rows: v })} options={data.cols.map((c) => [c.key, c.label])} />
          <Pick label="Columns" value={pivotSpec.columns ?? ""} onChange={(v) => setPv({ ...pivotSpec, columns: v || null })} options={[["", "None"], ...data.cols.filter((c) => c.key !== pivotSpec.rows).map((c) => [c.key, c.label] as [string, string])]} />
          <Pick label="Value" value={pivotSpec.value ?? ""} onChange={(v) => setPv({ ...pivotSpec, value: v || null, agg: v ? (pivotSpec.agg === "count" ? "sum" : pivotSpec.agg) : "count" })} options={[["", "Row count"], ...data.cols.filter((c) => c.type === "number").map((c) => [c.key, c.label] as [string, string])]} />
          {pivotSpec.value ? <Pick label="As" value={pivotSpec.agg ?? "sum"} onChange={(v) => setPv({ ...pivotSpec, agg: v as Agg })} options={AGGS.map((a) => [a, a === "mean" ? "Mean" : a[0].toUpperCase() + a.slice(1)])} /> : null}
        </Controls>
      ) : null}

      <div className="mb-1.5 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {ids.length === data.rows.length ? `${fmt(data.rows.length, "number")} rows` : `${fmt(ids.length, "number")} of ${fmt(data.rows.length, "number")} rows`}
          {groups ? ` in ${fmt(groups.length, "number")} groups` : ""}
        </span>
        {filtered ? (
          <button type="button" onClick={() => (setSearch(""), setFilters({}))} className="text-foreground underline-offset-2 hover:underline">
            Clear filters
          </button>
        ) : null}
      </div>

      {mode === "stats" ? (
        <StatsTable data={data} ids={ids} />
      ) : mode === "pivot" ? (
        table && pivotSpec ? <PivotTable table={table} rowLabel={labelOf(data, pivotSpec.rows)} colLabel={pivotSpec.columns ? labelOf(data, pivotSpec.columns) : null} format={data.cols.find((c) => c.key === pivotSpec.value)?.format} agg={pivotSpec.value ? (pivotSpec.agg ?? "sum") : "count"} /> : <Empty text="No columns to pivot" />
      ) : (
        <Body props={props} data={data} ids={ids} queryKey={signature([search, filters, sort, mode, group])} groups={groups} groupKey={group} collapsed={collapsed} setCollapsed={setCollapsed} sort={sort} setSort={setSort} filters={filters} setFilters={setFilters} />
      )}
    </div>
  );
}

/** A stable key for a value that may hold functions: a function counts by where it was written. */
export function signature(v: unknown): string {
  try {
    return JSON.stringify(v, (_, x) => (isFnValue(x) ? `fn@${(x.body as { start?: number }).start ?? ""}` : x)) ?? "";
  } catch {
    return String(Math.random());
  }
}

function labelOf(data: GridData, key: string) {
  return data.cols.find((c) => c.key === key)?.label ?? key;
}

function Controls({ children }: { children: ReactNode }) {
  return <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">{children}</div>;
}

function Pick({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      {label}
      <span className="relative inline-flex min-w-0 items-center">
        <select value={value} onChange={(e) => onChange(e.target.value)} className="h-7 min-w-0 max-w-[12rem] appearance-none truncate rounded-full bg-muted/60 py-0 pl-2.5 pr-7 text-[12.5px] text-foreground ring-1 ring-border outline-none focus-visible:ring-foreground/40">
          {options.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Glyph name="chevron-down" size={12} className="pointer-events-none absolute right-2 text-muted-foreground" />
      </span>
    </label>
  );
}

function Empty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-[10px] py-8 text-xs text-muted-foreground ring-1 ring-border">
      {text}
      {action}
    </div>
  );
}

// ---------- the virtualized body ----------

const OVERSCAN = 10;

function widthOf(c: GridColumn, data: GridData): number {
  if (c.width) return c.width;
  let longest = c.label.length * 7.6 + 34;
  const step = Math.max(1, Math.floor(data.rows.length / 200));
  for (let i = 0; i < data.rows.length; i += step) {
    const v = data.rows[i][c.key];
    const t = v == null ? "" : typeof v === "number" ? fmt(v, c.format ?? "number") : toText(v);
    // Digits run wider than letters at this size.
    longest = Math.max(longest, Math.min(t.length, 48) * (c.type === "text" ? 7.6 : 8.4) + 30);
  }
  return Math.round(Math.max(64, Math.min(340, longest)));
}

function Body(p: {
  props: Record<string, unknown>;
  data: GridData;
  ids: number[];
  /** Changes when the person changes the query; the list then starts at the top. */
  queryKey: string;
  groups: ReturnType<typeof groupRows> | null;
  groupKey: string | null;
  collapsed: Set<string>;
  setCollapsed: (s: Set<string>) => void;
  sort: { key: string; dir: 1 | -1 } | null;
  setSort: (s: { key: string; dir: 1 | -1 } | null) => void;
  filters: Record<string, string>;
  setFilters: (f: Record<string, string>) => void;
}) {
  const { props, data, ids, groups, collapsed } = p;
  const env = useEnv();
  const dense = props.dense === true;
  const rowH = dense ? 26 : 30;
  const maxH = Math.max(160, Math.min(1200, num(props.height) ?? 420));
  const widths = useMemo(() => data.cols.map((c) => widthOf(c, data)), [data]);
  const template = widths.map((w) => `minmax(${w}px, 1fr)`).join(" ");
  const total = widths.reduce((s, w) => s + w, 0);

  const items = useMemo<Item[]>(() => {
    if (!groups) return ids.map((id) => ({ kind: "row", id }));
    const out: Item[] = [];
    groups.forEach((g, k) => {
      out.push({ kind: "group", g: k });
      if (!collapsed.has(g.label)) for (const id of g.ids) out.push({ kind: "row", id });
    });
    return out;
  }, [ids, groups, collapsed]);

  const scroller = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState(0);
  const [viewH, setViewH] = useState(maxH);
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setTop(scroller.current?.scrollTop ?? 0));
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => (ro.disconnect(), cancelAnimationFrame(frame.current));
  }, []);
  // A new query starts at the top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setTop(0);
  }, [p.queryKey]);

  const header = useRef<HTMLDivElement | null>(null);
  const headH = header.current?.offsetHeight ?? 62;
  const bodyTop = Math.max(0, top - headH);
  const first = Math.max(0, Math.floor(bodyTop / rowH) - OVERSCAN);
  const last = Math.min(items.length, Math.ceil((bodyTop + viewH) / rowH) + OVERSCAN);

  const bind = str(props.bind);
  const selected = bind ? env.runtime.getState(bind) : undefined;
  // Rows can be rebuilt between renders (inline data, CSV text); match the selection by content.
  const selectedKey = selected != null && typeof selected === "object" ? signature(selected) : null;
  const clickable = props.onRowClick != null || (bind != null && env.runtime.hasState(bind));
  const [active, setActive] = useState<number | null>(null);
  const activate = (id: number) => {
    const row = data.rows[id];
    if (bind && env.runtime.hasState(bind)) env.runtime.setState(bind, row);
    if (props.onRowClick != null) env.run(props.onRowClick, [row]);
  };
  const toggleGroup = (label: string) => {
    const next = new Set(collapsed);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    p.setCollapsed(next);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === "INPUT") return;
    if (!items.length) return;
    let k = active ?? -1;
    if (e.key === "ArrowDown") k = Math.min(items.length - 1, k + 1);
    else if (e.key === "ArrowUp") k = Math.max(0, k - 1);
    else if (e.key === "PageDown") k = Math.min(items.length - 1, k + Math.floor(viewH / rowH));
    else if (e.key === "PageUp") k = Math.max(0, k - Math.floor(viewH / rowH));
    else if (e.key === "Home") k = 0;
    else if (e.key === "End") k = items.length - 1;
    else if (e.key === "Enter" || e.key === " ") {
      const it = active != null ? items[active] : null;
      if (it?.kind === "row" && clickable) activate(it.id);
      else if (it?.kind === "group" && groups) toggleGroup(groups[it.g].label);
      else return;
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    setActive(k);
    const el = scroller.current;
    if (el) {
      const y = headH + k * rowH;
      if (y < el.scrollTop + headH) el.scrollTop = y - headH;
      else if (y + rowH > el.scrollTop + el.clientHeight) el.scrollTop = y + rowH - el.clientHeight;
    }
  };

  // Scrolling re-renders only this list, so the visible cells' tone and render
  // calls share one fresh step budget per frame.
  env.runtime.interp.steps = 0;
  const toggleSort = (key: string) => p.setSort(p.sort?.key !== key ? { key, dir: 1 } : p.sort.dir === 1 ? { key, dir: -1 } : null);
  const height = Math.min(maxH, headH + (items.length ? items.length * rowH : 64) + 2);
  const gridStyle: CSSProperties = { gridTemplateColumns: template };

  return (
    <div
      ref={scroller}
      onScroll={onScroll}
      onKeyDown={onKey}
      tabIndex={0}
      role="grid"
      aria-rowcount={items.length + 1}
      aria-colcount={data.cols.length}
      className="iris-scroll-x relative min-w-0 overflow-auto rounded-[10px] text-[13px] tabular-nums ring-1 ring-border outline-none focus-visible:ring-foreground/40"
      style={{ height }}
    >
      <div style={{ width: `max(100%, ${total}px)` }}>
        <div ref={header} className="sticky top-0 z-[1] bg-card" role="rowgroup">
          <div className="grid border-b border-border" style={gridStyle} role="row">
            {data.cols.map((c) => (
              <div key={c.key} role="columnheader" aria-sort={p.sort?.key === c.key ? (p.sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn("flex min-w-0 items-center px-2.5 pt-1.5 pb-1", c.align === "right" ? "justify-end" : c.align === "center" ? "justify-center" : "")}>
                <button type="button" onClick={() => toggleSort(c.key)} className={cn("inline-flex min-w-0 items-center gap-1 text-xs font-medium hover:text-foreground", p.sort?.key === c.key ? "text-foreground" : "text-muted-foreground")} title={`Sort by ${c.label}`}>
                  <span className="truncate">{c.label}</span>
                  {p.sort?.key === c.key ? <Glyph name={p.sort.dir === 1 ? "arrow-up" : "arrow-down"} size={11} /> : null}
                </button>
              </div>
            ))}
          </div>
          <div className="grid border-b border-border bg-muted/25" style={gridStyle} role="row">
            {data.cols.map((c) => (
              <div key={c.key} className="min-w-0 px-1.5 py-1" role="gridcell">
                <input
                  value={p.filters[c.key] ?? ""}
                  onChange={(e) => p.setFilters({ ...p.filters, [c.key]: e.target.value })}
                  placeholder={c.type === "number" ? "> 0" : c.type === "date" ? "> 2026-01" : "Filter"}
                  aria-label={`Filter ${c.label}`}
                  className={cn("h-6 w-full min-w-0 rounded-md bg-transparent px-1.5 text-[12px] outline-none placeholder:text-muted-foreground/60 focus:bg-card focus:ring-1 focus:ring-border", c.align === "right" && "text-right", p.filters[c.key] && "bg-card ring-1 ring-border")}
                />
              </div>
            ))}
          </div>
        </div>
        {items.length ? (
          <div className="relative" style={{ height: items.length * rowH }} role="rowgroup">
            {items.slice(first, last).map((it, j) => {
              const k = first + j;
              const style: CSSProperties = { ...gridStyle, position: "absolute", top: k * rowH, left: 0, right: 0, height: rowH };
              if (it.kind === "group" && groups) {
                const g = groups[it.g];
                const open = !collapsed.has(g.label);
                return (
                  <div key={`g${g.label}`} role="row" aria-expanded={open} style={style} className={cn("grid cursor-pointer border-b border-border bg-muted/45 font-medium hover:bg-muted/70", active === k && "ring-1 ring-inset ring-foreground/30")} onClick={() => (setActive(k), toggleGroup(g.label))}>
                    {data.cols.map((c, ci) =>
                      ci === 0 ? (
                        <div key={c.key} role="gridcell" className="flex min-w-0 items-center gap-1.5 overflow-visible whitespace-nowrap px-2.5">
                          <Glyph name="chevron-right" size={13} className={cn("text-muted-foreground transition-transform", open && "rotate-90")} />
                          <span className="truncate">{g.label}</span>
                          <span className="rounded-full bg-card px-1.5 text-[11px] text-muted-foreground ring-1 ring-border">{fmt(g.ids.length, "number")}</span>
                        </div>
                      ) : (
                        <div key={c.key} role="gridcell" className={cn("flex min-w-0 items-center truncate px-2.5 text-[12.5px]", c.align === "right" ? "justify-end" : "")}>
                          {c.key in g.sums ? <span title={`Sum of ${c.label}`}>{fmt(g.sums[c.key], c.format ?? "number")}</span> : null}
                        </div>
                      ),
                    )}
                  </div>
                );
              }
              if (it.kind !== "row") return null;
              const row = data.rows[it.id];
              const isSel = selectedKey != null && (selected === row || signature(row) === selectedKey);
              return (
                <div
                  key={it.id}
                  role="row"
                  aria-selected={isSel || undefined}
                  style={style}
                  onClick={() => (setActive(k), clickable && activate(it.id))}
                  className={cn("grid border-b border-border/50", clickable ? "cursor-pointer hover:bg-state-hover" : "hover:bg-state-hover/50", isSel && "bg-state-active", active === k && "ring-1 ring-inset ring-foreground/30")}
                >
                  {data.cols.map((c) => (
                    <GridCell key={c.key} col={c} row={row} />
                  ))}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-muted-foreground">{ids.length || !data.rows.length ? "No rows" : "No rows match"}</div>
        )}
      </div>
    </div>
  );
}

function GridCell({ col, row }: { col: GridColumn; row: Record<string, unknown> }) {
  const env = useEnv();
  const value = row[col.key];
  let tone: unknown = col.tone;
  let content: ReactNode;
  try {
    if (isFnValue(col.tone)) tone = env.runtime.interp.call(col.tone, [value, row]);
    if (isFnValue(col.render)) content = renderElementValue(env.runtime.interp.call(col.render, [value, row]));
    else if (isElementValue(value)) content = renderElementValue(value);
    else if (value == null || value === "") content = <span className="text-muted-foreground/50">-</span>;
    else if (col.format) content = fmt(value, col.format);
    else if (typeof value === "number") content = fmt(value, "number");
    else if (typeof value === "object") content = <span className="font-mono text-[12px] text-muted-foreground">{JSON.stringify(value)}</span>;
    else content = toText(value);
  } catch (e) {
    content = <span className="text-destructive">{e instanceof Error ? e.message : String(e)}</span>;
  }
  const color = typeof tone === "string" && tone in env.palette.tone ? env.palette.tone[tone as keyof typeof env.palette.tone] : undefined;
  return (
    <div role="gridcell" className={cn("flex min-w-0 items-center px-2.5", col.align === "right" ? "justify-end" : col.align === "center" ? "justify-center" : "")} style={color ? { color } : undefined}>
      <span className="truncate" title={typeof content === "string" && content.length > 24 ? content : undefined}>
        {content}
      </span>
    </div>
  );
}

// ---------- stats ----------

function statsCsv(data: GridData, ids: number[]): string {
  return toCsv(
    ["Column", "Type", "Filled", "Empty", "Distinct", "Min", "Max", "Mean", "Sum"],
    data.cols.map((c) => {
      const s = columnStats(data.rows, c, ids);
      return [c.label, c.type, s.count, s.empty, s.distinct, s.min, s.max, s.mean, s.sum];
    }),
  );
}

function StatsTable({ data, ids }: { data: GridData; ids: number[] }) {
  const stats = useMemo(() => data.cols.map((c) => ({ c, s: columnStats(data.rows, c, ids) })), [data, ids]);
  const v = (x: unknown, c: GridColumn) => (x == null ? <span className="text-muted-foreground/50">-</span> : typeof x === "number" ? fmt(x, c.format ?? "number") : toText(x));
  return (
    <div className="iris-scroll-x min-w-0 overflow-x-auto rounded-[10px] ring-1 ring-border">
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="text-xs text-muted-foreground">
            {["Column", "Filled", "Distinct", "Min", "Max", "Mean", "Most common"].map((h, k) => (
              <th key={h} scope="col" className={cn("whitespace-nowrap border-b border-border px-2.5 py-1.5 font-medium", k === 0 || k === 6 ? "text-left" : "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {stats.map(({ c, s }) => (
            <tr key={c.key} className="border-b border-border/50 last:border-b-0">
              <td className="whitespace-nowrap px-2.5 py-1.5">
                <span className="font-medium">{c.label}</span> <span className="text-xs text-muted-foreground">{c.type}</span>
              </td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                {fmt(s.count, "number")}
                {s.empty ? <span className="text-xs text-muted-foreground"> +{fmt(s.empty, "number")} empty</span> : null}
              </td>
              <td className="px-2.5 py-1.5 text-right">{fmt(s.distinct, "number")}</td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right">{v(s.min, c)}</td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right">{v(s.max, c)}</td>
              <td className="whitespace-nowrap px-2.5 py-1.5 text-right">{v(s.mean, c)}</td>
              <td className="max-w-[16rem] truncate px-2.5 py-1.5 text-muted-foreground">{s.top.map((t) => `${t.value} (${fmt(t.count, "number")})`).join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- pivot ----------

function PivotTable({ table, rowLabel, colLabel, format, agg }: { table: ReturnType<typeof pivot>; rowLabel: string; colLabel: string | null; format: unknown; agg: Agg }) {
  const { palette } = useEnv();
  const values = table.cells.flat().filter((x): x is number => x != null);
  const lo = values.reduce((m, x) => (x < m ? x : m), Infinity);
  const hi = values.reduce((m, x) => (x > m ? x : m), -Infinity);
  const shade = (x: number | null): CSSProperties | undefined => {
    if (x == null || !values.length || hi === lo) return undefined;
    return { background: `color-mix(in oklab, ${palette.accent} ${Math.round(4 + ((x - lo) / (hi - lo)) * 30)}%, transparent)` };
  };
  const show = (x: number | null) => (x == null ? <span className="text-muted-foreground/50">-</span> : fmt(x, agg === "count" ? "number" : (format ?? "number")));
  if (!table.rowLabels.length) return <Empty text="No rows to pivot" />;
  return (
    <div className="iris-scroll-x min-w-0 overflow-auto rounded-[10px] ring-1 ring-border" style={{ maxHeight: 520 }}>
      <table className="w-full border-collapse text-[13px] tabular-nums">
        <thead className="sticky top-0 z-[1] bg-card">
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="sticky left-0 z-[1] whitespace-nowrap border-b border-border bg-card px-2.5 py-1.5 text-left font-medium">
              {rowLabel}
              {colLabel ? <span className="font-normal"> by {colLabel}</span> : null}
            </th>
            {table.colLabels.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap border-b border-border px-2.5 py-1.5 text-right font-medium">
                {colLabel ? c : agg === "count" ? "Rows" : agg[0].toUpperCase() + agg.slice(1)}
              </th>
            ))}
            {colLabel ? <th scope="col" className="whitespace-nowrap border-b border-l border-border px-2.5 py-1.5 text-right font-medium text-foreground">Total</th> : null}
          </tr>
        </thead>
        <tbody>
          {table.rowLabels.map((r, k) => (
            <tr key={r} className="border-b border-border/50">
              <th scope="row" className="sticky left-0 max-w-[14rem] truncate bg-card px-2.5 py-1.5 text-left font-medium">
                {r}
              </th>
              {table.cells[k].map((x, j) => (
                <td key={j} className="whitespace-nowrap px-2.5 py-1.5 text-right" style={shade(x)}>
                  {show(x)}
                </td>
              ))}
              {colLabel ? <td className="whitespace-nowrap border-l border-border px-2.5 py-1.5 text-right font-medium">{show(table.rowTotals[k])}</td> : null}
            </tr>
          ))}
          <tr className="font-medium">
            <th scope="row" className="sticky left-0 bg-card px-2.5 py-1.5 text-left">
              Total
            </th>
            {table.colTotals.map((x, j) => (
              <td key={j} className="whitespace-nowrap px-2.5 py-1.5 text-right">
                {show(x)}
              </td>
            ))}
            {colLabel ? <td className="whitespace-nowrap border-l border-border px-2.5 py-1.5 text-right">{show(table.total)}</td> : null}
          </tr>
        </tbody>
      </table>
      {table.folded ? <div className="border-t border-border px-2.5 py-1 text-xs text-muted-foreground">{table.folded} smaller columns are folded into Other</div> : null}
    </div>
  );
}
