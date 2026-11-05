// Sheet view (chunk "sheet"): an editable grid over core/sheet.ts. Edits are
// kept in the card's saved state under an "@" key, so they survive scrolling
// and reloads; a bound <state> gets the computed table, so a waiting picker
// (iris_ask) answers with what the person left in it. Rows are windowed at a
// fixed height, so a 2,000-row sheet stays quick to edit.

import { Glyph, InlineError, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import type { ElementNode } from "../core/ast";
import { isPendingValue } from "../core/evaluate";
import { formatValue, type NumberFormat } from "../core/format";
import { type CellValue, type Raw, type SheetColumn, type SheetData, MAX_ROWS, address, colName, computeSheet, isCellError, isFormula, normalizeSheet, parsePaste, rawText, readInput, sheetCsv, sheetRows, shiftFormula } from "../core/sheet";
import type { ViewProps } from "../ui/render";

const ROW_H = 30;
const HEAD_H = 52;
const GUTTER = 40;

function hash(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? "";
  } catch {
    s = "";
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/** The person's edits, saved with the card under an "@" key tied to what the agent sent. */
function useEdits(node: ElementNode, identity: string): [Raw[][] | null, (v: Raw[][] | null) => void] {
  const env = useEnv();
  const key = `@Sheet:${node.start}:cells:${identity}`;
  const value = (env.runtime.state.get(key) as Raw[][] | undefined) ?? null;
  const set = useCallback((v: Raw[][] | null) => env.runtime.setState(key, v), [env.runtime, key]);
  return [value, set];
}

const ICON_BTN =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]";

function display(v: CellValue, format: unknown): string {
  if (v == null) return "";
  if (isCellError(v)) return v.$error;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") {
    if (format) return formatValue(v, format as NumberFormat);
    return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
  return v;
}

/** Ranges that end right above a new row grow to take it when a totals formula sits below. */
function insertRow(cells: Raw[][], at: number, columns: SheetColumn[]): Raw[][] {
  const grown = cells.map((row, r) =>
    row.map((v) => {
      if (!isFormula(v)) return v;
      const own = r >= at ? r + 1 : r;
      return shiftFormula(v, at, 1, own, columns);
    }),
  );
  grown.splice(at, 0, new Array(columns.length).fill(null));
  return grown;
}

function removeRow(cells: Raw[][], at: number, columns: SheetColumn[]): Raw[][] {
  const kept = cells.filter((_, r) => r !== at);
  return kept.map((row) => row.map((v) => (isFormula(v) ? shiftFormula(v, at, -1, undefined, columns) : v)));
}

/** A last row whose formulas add up ranges reads as a totals row; new rows go above it. */
function totalsRow(cells: Raw[][]): boolean {
  const last = cells[cells.length - 1];
  return Boolean(last?.some((v) => isFormula(v) && /[A-Za-z]+\$?\d+\s*:\s*\$?[A-Za-z]+\$?\d+/.test(v)));
}

export function SheetView({ props, node }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const pending = isPendingValue(props.rows);
  const identity = useMemo(() => hash([props.rows, props.columns]), [props.rows, props.columns]);
  const base = useMemo(() => (pending ? null : normalizeSheet(props.rows, props.columns)), [identity, pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edits, setEdits] = useEdits(node, identity);
  const editable = props.editable !== false;
  const columns = base?.data.columns ?? [];
  const cells = edits && edits.every((r) => r.length === columns.length) ? edits : (base?.data.cells ?? []);
  const data: SheetData = useMemo(() => ({ columns, cells }), [columns, cells]);
  const values = useMemo(() => computeSheet(data), [data]);

  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);
  const [editing, setEditing] = useState<{ r: number; c: number; text: string; bar?: boolean } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const uid = useId().replace(/:/g, "");
  const cellId = (r: number, c: number) => `iris-sheet-${uid}-${r}-${c}`;
  const scroller = useRef<HTMLDivElement | null>(null);
  const grid = useRef<HTMLDivElement | null>(null);

  // A bound <state> always holds the current table, so a picker answers with it.
  const bind = str(props.bind);
  const rowsOut = useMemo(() => sheetRows(data, values), [data, values]);
  useEffect(() => {
    if (!bind || !env.runtime.hasState(bind)) return;
    if (hash(env.runtime.getState(bind)) !== hash(rowsOut)) env.runtime.setState(bind, rowsOut);
  }, [bind, rowsOut, env.runtime]);

  const readOnly = (r: number, c: number) => !editable || (Boolean(columns[c]?.formula) && !isFormula(cells[r]?.[c] ?? null));

  const commit = useCallback(
    (next: Raw[][]) => {
      setEdits(next);
    },
    [setEdits],
  );

  const setCell = (r: number, c: number, text: string) => {
    if (readOnly(r, c)) return;
    const v = readInput(text);
    if (rawText(cells[r][c]) === rawText(v) && typeof cells[r][c] === typeof v) return;
    commit(cells.map((row, k) => (k === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  };

  const scrollInto = (r: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = r * ROW_H;
    const view = el.clientHeight - HEAD_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + view) el.scrollTop = top + ROW_H - view;
  };

  const move = (r: number, c: number) => {
    const nr = Math.max(0, Math.min(cells.length - 1, r));
    const nc = Math.max(0, Math.min(columns.length - 1, c));
    setSel({ r: nr, c: nc });
    scrollInto(nr);
  };

  const focusGrid = () => requestAnimationFrame(() => grid.current?.focus({ preventScroll: true }));

  const finish = (how: "down" | "right" | "left" | "stay" | "cancel") => {
    if (!editing) return;
    if (how !== "cancel") setCell(editing.r, editing.c, editing.text);
    setEditing(null);
    if (how === "down") move(editing.r + 1, editing.c);
    else if (how === "right") move(editing.r, editing.c + 1);
    else if (how === "left") move(editing.r, editing.c - 1);
    focusGrid();
  };

  const startEdit = (r: number, c: number, text?: string) => {
    if (readOnly(r, c)) return;
    setSel({ r, c });
    setEditing({ r, c, text: text ?? rawText(cells[r][c]) });
  };

  const addRow = () => {
    if (!editable || cells.length >= MAX_ROWS) return;
    const at = sel ? sel.r + 1 : totalsRow(cells) && cells.length > 1 ? cells.length - 1 : cells.length;
    commit(insertRow(cells, at, columns));
    setSel({ r: at, c: sel?.c ?? 0 });
    requestAnimationFrame(() => scrollInto(at));
    focusGrid();
  };

  const deleteRow = () => {
    if (!editable || !sel || !cells.length) return;
    commit(removeRow(cells, sel.r, columns));
    setSel(cells.length > 1 ? { r: Math.min(sel.r, cells.length - 2), c: sel.c } : null);
    focusGrid();
  };

  const copyCsv = () => env.perform([{ $iris: "action", kind: "copy", args: [sheetCsv(data, values)] }]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || !cells.length) return;
    const s = sel ?? { r: 0, c: 0 };
    const k = e.key;
    // Tab leaves the grid when nothing is selected or the selection is at the edge, so keyboard users are never trapped.
    if (k === "Tab" && (!sel || (e.shiftKey ? s.c === 0 : s.c === columns.length - 1))) return;
    if (!sel && /^(Arrow|Enter)/.test(k)) {
      e.preventDefault();
      return setSel(s);
    }
    if (k === "ArrowDown") (e.preventDefault(), move(s.r + 1, s.c));
    else if (k === "ArrowUp") (e.preventDefault(), move(s.r - 1, s.c));
    else if (k === "ArrowRight") (e.preventDefault(), move(s.r, s.c + 1));
    else if (k === "ArrowLeft") (e.preventDefault(), move(s.r, s.c - 1));
    else if (k === "Tab") (e.preventDefault(), move(s.r, s.c + (e.shiftKey ? -1 : 1)));
    else if (k === "Enter" || k === "F2") (e.preventDefault(), startEdit(s.r, s.c));
    else if (k === "Escape") setSel(null);
    else if ((k === "Delete" || k === "Backspace") && sel) (e.preventDefault(), setCell(s.r, s.c, ""));
    else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && sel) {
      e.preventDefault();
      startEdit(s.r, s.c, k);
    }
  };

  const onCopy = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !sel) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", display(values[sel.r][sel.c], null));
  };

  const onPaste = (e: ClipboardEvent<HTMLDivElement>) => {
    if (editing || !sel || !editable) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    const block = parsePaste(text);
    let next = cells.map((r) => [...r]);
    const need = Math.min(MAX_ROWS, sel.r + block.length);
    while (next.length < need) next.push(new Array(columns.length).fill(null));
    block.forEach((row, i) =>
      row.forEach((v, j) => {
        const r = sel.r + i;
        const c = sel.c + j;
        if (r < next.length && c < columns.length && !readOnly(r, c)) next[r][c] = v;
      }),
    );
    next = next.slice(0, MAX_ROWS);
    commit(next);
  };

  if (pending || !base) return <Shimmer className="h-48" />;
  const problems = base.problems;
  const title = str(props.title);
  const maxH = Math.max(160, Math.min(1200, num(props.height) ?? 420));
  const edited = edits !== null && hash(edits) !== hash(base.data.cells);

  // Rows on screen, with a margin.
  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - 10);
  const last = Math.min(cells.length, Math.ceil((scrollTop + maxH) / ROW_H) + 10);

  const selCol = sel ? columns[sel.c] : null;
  const selRaw = sel ? cells[sel.r]?.[sel.c] ?? null : null;
  const computed = sel ? Boolean(selCol?.formula) && !isFormula(selRaw) : false;
  const barText = editing ? editing.text : computed ? `=${selCol!.formula!.replace(/^\s*=/, "")}` : rawText(selRaw);
  const selValue = sel ? values[sel.r]?.[sel.c] : null;

  return (
    <div className="iris-sheet flex min-w-0 flex-col gap-2">
      {problems.length ? <InlineError error={new Error(`${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`)} context="<Sheet>" /> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {title ? <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</div> : <div className="flex-1 text-xs tabular-nums text-muted-foreground">{`${cells.length} ${cells.length === 1 ? "row" : "rows"}`}</div>}
        {editable ? (
          <>
            <button type="button" className={ICON_BTN} onClick={addRow} disabled={cells.length >= MAX_ROWS} title={sel ? `Add a row below row ${sel.r + 2}` : "Add a row"}>
              <Glyph name="plus" size={14} />
              Row
            </button>
            <button type="button" className={ICON_BTN} onClick={deleteRow} disabled={!sel} title={sel ? `Remove row ${sel.r + 2}` : "Select a cell to remove its row"} aria-label="Remove row">
              <Glyph name="trash-2" size={14} />
            </button>
            {edited ? (
              <button type="button" className={ICON_BTN} onClick={() => (setEdits(null), setEditing(null))} title="Undo every edit" aria-label="Revert to the original">
                <Glyph name="rotate-ccw" size={14} />
              </button>
            ) : null}
          </>
        ) : null}
        <button type="button" className={ICON_BTN} onClick={copyCsv} title="Copy as CSV" aria-label="Copy as CSV">
          <Glyph name="clipboard-copy" size={14} />
        </button>
      </div>

      <div className="flex h-8 min-w-0 items-center gap-2 rounded-lg bg-muted/50 px-1.5 ring-1 ring-border">
        {sel ? <span className="w-12 shrink-0 rounded-md bg-card px-1.5 py-0.5 text-center font-mono text-[11.5px] tabular-nums shadow-[0_0_0_1px_var(--border)]">{address(sel.r, sel.c)}</span> : null}
        <Glyph name="square-function" size={14} className="text-muted-foreground" />
        <input
          aria-label="Formula bar"
          className={cn("min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-muted-foreground", computed && "italic text-muted-foreground")}
          placeholder={sel ? (readOnly(sel.r, sel.c) ? "" : "Type a value or =formula") : "Select a cell"}
          value={sel ? barText : ""}
          readOnly={!sel || readOnly(sel.r, sel.c)}
          onFocus={() => sel && !readOnly(sel.r, sel.c) && !editing && setEditing({ r: sel.r, c: sel.c, text: rawText(selRaw), bar: true })}
          onChange={(e) => editing && setEditing({ ...editing, text: e.target.value })}
          onBlur={() => editing?.bar && finish("stay")}
          onKeyDown={(e) => {
            if (!editing) return;
            if (e.key === "Enter") (e.preventDefault(), finish("down"));
            else if (e.key === "Escape") (e.preventDefault(), finish("cancel"));
            else if (e.key === "Tab") (e.preventDefault(), finish(e.shiftKey ? "left" : "right"));
          }}
        />
        {sel && isCellError(selValue) ? (
          <span className="shrink-0 truncate pr-1 text-[11.5px]" style={{ color: palette.tone.bad }}>
            {selValue.detail}
          </span>
        ) : computed ? (
          <span className="shrink-0 pr-1 text-[11.5px] text-muted-foreground">Computed</span>
        ) : null}
      </div>

      <div
        ref={scroller}
        className="relative min-w-0 overflow-auto rounded-lg ring-1 ring-border"
        style={{ maxHeight: maxH }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div
          ref={grid}
          role="grid"
          aria-label={title ?? "Sheet"}
          aria-rowcount={cells.length + 1}
          aria-colcount={columns.length}
          aria-activedescendant={sel && sel.r >= first && sel.r < last ? cellId(sel.r, sel.c) : undefined}
          tabIndex={0}
          onKeyDown={onKey}
          onCopy={onCopy}
          onPaste={onPaste}
          className="w-max min-w-full text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--iris-accent)_45%,transparent)]"
        >
          <div className="sticky top-0 z-[2] flex bg-card" role="row" aria-rowindex={1}>
            <div className="sticky left-0 z-[3] shrink-0 border-r border-b border-border bg-muted/80" style={{ width: GUTTER, height: HEAD_H }}>
              <div className="flex h-5 items-center justify-center border-b border-border/70 text-[10.5px] text-muted-foreground" />
              <div className="flex items-center justify-center text-[10.5px] tabular-nums text-muted-foreground" style={{ height: HEAD_H - 20 }}>
                1
              </div>
            </div>
            {columns.map((col, c) => (
              <div key={c} role="columnheader" className="shrink-0 border-r border-b border-border bg-muted/80" style={{ width: col.width ?? widthFor(col.label, col.format) }} title={col.formula ? `= ${col.formula}` : undefined}>
                <div className={cn("flex h-5 items-center justify-center border-b border-border/70 text-[10.5px] tabular-nums", sel?.c === c ? "font-semibold text-foreground" : "text-muted-foreground")}>{colName(c)}</div>
                <div className="flex items-center gap-1 px-2 font-medium" style={{ height: HEAD_H - 20, justifyContent: alignOf(col, null) === "right" ? "flex-end" : "flex-start" }}>
                  {col.formula ? <Glyph name="square-function" size={12} className="text-muted-foreground" /> : null}
                  <span className="truncate">{col.label}</span>
                </div>
              </div>
            ))}
          </div>
          <div style={{ height: first * ROW_H }} aria-hidden />
          {cells.slice(first, last).map((row, i) => {
            const r = first + i;
            return (
              <div key={r} role="row" aria-rowindex={r + 2} className="flex" style={{ height: ROW_H }}>
                <div
                  className={cn("sticky left-0 z-[1] flex shrink-0 items-center justify-center border-r border-b border-border bg-muted/80 text-[10.5px] tabular-nums", sel?.r === r ? "font-semibold text-foreground" : "text-muted-foreground")}
                  style={{ width: GUTTER }}
                  onMouseDown={(e) => (e.preventDefault(), setSel({ r, c: sel?.c ?? 0 }), grid.current?.focus({ preventScroll: true }))}
                >
                  {r + 2}
                </div>
                {columns.map((col, c) => {
                  const v = values[r][c];
                  const isSel = sel?.r === r && sel.c === c;
                  const isEdit = editing && !editing.bar && editing.r === r && editing.c === c;
                  const derived = Boolean(col.formula) && !isFormula(row[c]);
                  const err = isCellError(v);
                  const align = alignOf(col, v);
                  return (
                    <div
                      key={c}
                      id={cellId(r, c)}
                      role="gridcell"
                      aria-selected={isSel}
                      aria-readonly={readOnly(r, c) || undefined}
                      title={err ? `${v.$error} ${v.detail}` : undefined}
                      className={cn("relative shrink-0 border-r border-b border-border/70", derived && "bg-muted/30", isFormula(row[c]) && "font-medium")}
                      style={{ width: col.width ?? widthFor(col.label, col.format) }}
                      onMouseDown={(e) => {
                        if (isEdit) return;
                        e.preventDefault();
                        if (editing) finish("stay");
                        setSel({ r, c });
                        grid.current?.focus({ preventScroll: true });
                      }}
                      onDoubleClick={() => startEdit(r, c)}
                    >
                      {isEdit ? (
                        <input
                          autoFocus
                          aria-label={`Edit ${address(r, c)}`}
                          className="absolute inset-0 z-[1] w-full bg-card px-2 font-mono text-[12.5px] outline-none ring-2 ring-[var(--iris-accent)]"
                          value={editing.text}
                          onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                          onBlur={() => finish("stay")}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.preventDefault(), finish("down"));
                            else if (e.key === "Escape") (e.preventDefault(), finish("cancel"));
                            else if (e.key === "Tab") (e.preventDefault(), finish(e.shiftKey ? "left" : "right"));
                          }}
                        />
                      ) : (
                        <div className="flex h-full items-center truncate px-2 tabular-nums" style={{ justifyContent: align === "right" ? "flex-end" : align === "center" ? "center" : "flex-start", color: err ? palette.tone.bad : undefined }}>
                          <span className="truncate">{display(v, col.format)}</span>
                        </div>
                      )}
                      {isSel && !isEdit ? <i aria-hidden className="pointer-events-none absolute inset-0 z-[1] ring-2 ring-inset ring-[var(--iris-accent)]" /> : null}
                    </div>
                  );
                })}
              </div>
            );
          })}
          <div style={{ height: (cells.length - last) * ROW_H }} aria-hidden />
          {!cells.length ? <div className="px-3 py-6 text-center text-xs text-muted-foreground">No rows{editable ? "; add one with + Row" : ""}</div> : null}
        </div>
      </div>
      {editable && cells.length ? <div className="text-[11.5px] text-muted-foreground">Double-click or type to edit. Start with = for a formula, like =SUM(B2:B4).</div> : null}
    </div>
  );
}

function alignOf(col: { align?: string; format?: unknown }, v: CellValue): "left" | "right" | "center" {
  if (col.align === "left" || col.align === "right" || col.align === "center") return col.align;
  if (v === null) return col.format ? "right" : "left";
  return typeof v === "number" ? "right" : typeof v === "boolean" || isCellError(v) ? "center" : "left";
}

function widthFor(label: string, format: unknown): number {
  return Math.max(format ? 104 : 92, Math.min(220, label.length * 8 + 36));
}
