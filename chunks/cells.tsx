// Cells (chunk "tools"): a notebook-like stack of named expressions run by the
// card's own interpreter (core/compute.ts). Edits, added and removed cells are
// saved with the card; Reset brings back the agent's cells.

import { Chip, Glyph, InlineError, Shimmer, cn, renderValue, runCells, str, useEnv } from "@iris/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { type CellResult, type CellSpec, cellValues, fingerprint, nameIssue, normalizeCells, splitCell } from "../core/cells";
import { isElementValue, isFnValue, isPendingValue, toText } from "../core/evaluate";
import { formatValue, type NumberFormat } from "../core/format";
import type { ViewProps } from "../ui/render";
import { ErrorLine, GHOST_BTN, Header, ICON_BTN, useMemory } from "./tools-kit";

type Obj = Record<string, unknown>;
const isPlain = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v) && !isElementValue(v) && !isFnValue(v) && !isPendingValue(v);

export function CellsView({ props, node, scope }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.cells);
  const original = useMemo(() => (pending ? { cells: [], problems: [] } : normalizeCells(props.cells)), [pending, props.cells]);
  const [saved, setSaved] = useMemory<CellSpec[]>(node, "cells", props.cells);
  const cells = saved ?? original.cells;
  const editable = props.editable !== false;
  const bind = str(props.bind);
  // The scope Cells was written in, so a Cells inside rows.map((r) => ...) sees r.
  const results = runCells(cells, env.runtime.interp, scope, bind);

  // Hand named values to the bound state, only when they changed. runCells
  // refuses cells that read the bound state; the guard is a last backstop.
  const values = cellValues(results);
  const print = fingerprint(values);
  const writes = useRef({ at: 0, n: 0 });
  useEffect(() => {
    if (!bind || !env.runtime.hasState(bind) || env.streaming) return;
    if (fingerprint(env.runtime.getState(bind)) === print) return;
    const now = Date.now();
    writes.current = now - writes.current.at < 1000 ? { at: writes.current.at, n: writes.current.n + 1 } : { at: now, n: 1 };
    if (writes.current.n > 8) return;
    env.runtime.setState(bind, values);
  });

  const [editing, setEditing] = useState<number | null>(null);
  const update = (k: number, text: string) => {
    const next = cells.map((c, j) => (j === k ? { ...c, ...splitCell(text) } : c));
    setSaved(next);
  };
  const add = () => {
    const taken = new Set(cells.map((c) => c.name));
    let n = cells.length + 1;
    while (taken.has(`x${n}`)) n++;
    setSaved([...cells, { name: `x${n}`, expr: "" }]);
    setEditing(cells.length);
  };
  const remove = (k: number) => {
    setSaved(cells.filter((_, j) => j !== k));
    setEditing(null);
  };

  if (pending) return <Shimmer className="h-24" />;
  const title = str(props.title);
  const changed = saved !== null;
  return (
    <div className="min-w-0">
      <Header
        title={title}
        right={
          editable && changed ? (
            <button type="button" className={GHOST_BTN} onClick={() => (setSaved(null), setEditing(null))}>
              <Glyph name="rotate-ccw" size={13} />
              Reset
            </button>
          ) : null
        }
      />
      {original.problems.length ? <InlineError error={new Error(original.problems[0])} context="<Cells>" /> : null}
      <ol className="min-w-0 overflow-hidden rounded-xl ring-1 ring-border [&>li+li]:border-t [&>li+li]:border-border/70">
        {cells.map((c, k) => (
          <CellRow
            key={k}
            cell={c}
            result={results[k]}
            index={k}
            editable={editable}
            editing={editing === k}
            onEdit={(on) => setEditing(on ? k : null)}
            onCommit={(text) => update(k, text)}
            onRemove={() => remove(k)}
          />
        ))}
        {!cells.length ? <li className="px-3 py-3 text-[12.5px] text-muted-foreground">No cells yet</li> : null}
      </ol>
      {editable ? (
        <div className="mt-2 flex items-center gap-2">
          <button type="button" className={GHOST_BTN} onClick={add}>
            <Glyph name="plus" size={13} />
            Add cell
          </button>
          {bind ? <span className="truncate text-[11.5px] text-muted-foreground">Named values feed {bind}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function CellRow({ cell, result, index, editable, editing, onEdit, onCommit, onRemove }: { cell: CellSpec; result: CellResult; index: number; editable: boolean; editing: boolean; onEdit: (on: boolean) => void; onCommit: (text: string) => void; onRemove: () => void }) {
  const text = cell.name ? `${cell.name} = ${cell.expr}` : cell.expr;
  const [draft, setDraft] = useState(text);
  const box = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) setDraft(text);
  }, [text, editing]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !editing) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, editing]);
  const commit = () => {
    if (draft !== text) onCommit(draft);
    onEdit(false);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDraft(text);
      onEdit(false);
    }
  };
  const nameProblem = editing ? nameIssue(splitCell(draft).name) : null;
  const block = !!result.error || (isBlockValue(result.value) && !result.pending);
  return (
    <li className="group/cell min-w-0 px-3 py-2">
      <div className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-1">
        {/* The cell's number gives way to its remove button on hover, so results reach the row's edge. */}
        <span className="relative mt-[3px] w-5 shrink-0 text-right">
          <span className={cn("font-mono text-[10.5px] tabular-nums text-muted-foreground/70", editable && "group-hover/cell:opacity-0 group-focus-within/cell:opacity-0")} aria-hidden>
            {index + 1}
          </span>
          {editable ? (
            <span className="absolute -top-[5px] -right-0.5">
              <RemoveButton onClick={onRemove} />
            </span>
          ) : null}
        </span>
        <div className="min-w-[10rem] flex-1">
          {cell.label ? <div className="mb-0.5 truncate px-1.5 text-[12px] text-muted-foreground">{cell.label}</div> : null}
          {editing ? (
            <textarea
              ref={box}
              value={draft}
              rows={1}
              spellCheck={false}
              aria-label={`Cell ${index + 1}`}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={onKey}
              className="block w-full resize-none overflow-hidden rounded-md bg-muted/50 px-1.5 py-0.5 font-mono text-[12.5px] leading-[1.55] outline-none ring-2 ring-[color-mix(in_oklab,var(--iris-accent)_50%,transparent)]"
            />
          ) : (
            <button
              type="button"
              disabled={!editable}
              onClick={() => onEdit(true)}
              title={editable ? "Edit (Enter runs, Esc cancels)" : undefined}
              className={cn("block w-full min-w-0 rounded-md px-1.5 py-0.5 text-left font-mono text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap", editable && "hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-[var(--iris-accent)]")}
            >
              {cell.name ? (
                <>
                  <span className="font-semibold text-foreground">{cell.name}</span>
                  <span className="text-muted-foreground"> = </span>
                </>
              ) : null}
              <span className="text-foreground/85">{cell.expr || <span className="text-muted-foreground">empty</span>}</span>
            </button>
          )}
          {nameProblem ? <ErrorLine className="mt-1 px-1.5">{nameProblem}</ErrorLine> : null}
        </div>
        {!block ? (
          <div className="ml-auto flex max-w-full min-w-0 items-center gap-1">
            <CellValue result={result} format={cell.format} />
          </div>
        ) : null}
      </div>
      {block ? (
        <div className="mt-1 min-w-0 pl-[2.375rem]">
          <CellValue result={result} format={cell.format} />
        </div>
      ) : null}
      {cell.note ? <div className="mt-0.5 pl-[2.375rem] text-[11.5px] text-muted-foreground">{cell.note}</div> : null}
    </li>
  );
}

function RemoveButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" aria-label="Remove cell" className={cn(ICON_BTN, "size-6 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100")} onClick={onClick}>
      <Glyph name="x" size={12} />
    </button>
  );
}

/** Lists of rows, objects and components get their own line under the expression. */
function isBlockValue(v: unknown): boolean {
  if (isElementValue(v)) return true;
  if (Array.isArray(v)) return v.some((x) => isPlain(x) || Array.isArray(x)) || v.length > 8 || isElementValue(v[0]);
  if (isPlain(v)) return Object.keys(v).length > 2;
  return typeof v === "string" && v.length > 48;
}

function CellValue({ result, format }: { result: CellResult; format?: string }) {
  const env = useEnv();
  if (result.error) return <ErrorLine className="max-w-[28rem]">{result.error}</ErrorLine>;
  if (result.pending) return <Shimmer className="h-5 w-24" />;
  const v = result.value;
  if (v === undefined || v === null) return <span className="text-[12.5px] text-muted-foreground">nothing</span>;
  if (typeof v === "number") return <span className="text-[15px] font-semibold tabular-nums tracking-[-0.01em]">{formatValue(v, (format as NumberFormat) ?? undefined)}</span>;
  if (typeof v === "boolean") return <Chip tone={v ? "good" : "neutral"}>{v ? "true" : "false"}</Chip>;
  if (typeof v === "string") return <span className="min-w-0 break-words text-[13px]">{v}</span>;
  if (isFnValue(v)) return <span className="font-mono text-[12px] text-muted-foreground">function ({v.params.map((p) => (p.kind === "name" ? p.name : "…")).join(", ")})</span>;
  if (isElementValue(v)) return <div className="min-w-0">{renderValue(v)}</div>;
  if (Array.isArray(v)) {
    if (v.length && v.every(isPlain)) return <RowsTable rows={v as Obj[]} format={format} />;
    if (v.length && isElementValue(v[0])) return <div className="min-w-0 space-y-2">{renderValue(v)}</div>;
    const shown = v.slice(0, 24).map((x) => (typeof x === "number" ? formatValue(x, (format as NumberFormat) ?? undefined) : short(x)));
    return (
      <span className="min-w-0 break-words font-mono text-[12.5px]">
        [{shown.join(", ")}
        {v.length > 24 ? <span className="text-muted-foreground">, {v.length - 24} more</span> : null}]
      </span>
    );
  }
  if (isPlain(v)) {
    const entries = Object.entries(v);
    return (
      <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12.5px]">
        {entries.slice(0, 16).map(([k, x]) => (
          <div key={k} className="contents">
            <dt className="font-mono text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate tabular-nums">{typeof x === "number" ? formatValue(x, (format as NumberFormat) ?? undefined) : short(x)}</dd>
          </div>
        ))}
        {entries.length > 16 ? <div className="col-span-2 text-muted-foreground">{entries.length - 16} more</div> : null}
      </dl>
    );
  }
  void env;
  return <span className="text-[12.5px]">{toText(v)}</span>;
}

function short(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (isPlain(v)) return "{…}";
  return toText(v);
}

function RowsTable({ rows, format }: { rows: Obj[]; format?: string }) {
  const cols = [...new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))].slice(0, 8);
  const shown = rows.slice(0, 8);
  return (
    <div className="iris-scroll-x min-w-0 overflow-x-auto">
      <table className="w-full max-w-[32rem] min-w-0 border-collapse text-[12.5px]">
        <thead>
          <tr className="text-left text-[11.5px] text-muted-foreground">
            {cols.map((c) => (
              <th key={c} className={cn("border-b border-border px-2 py-1 font-medium first:pl-0", shown.every((r) => typeof r[c] === "number" || r[c] == null) && "text-right")}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, k) => (
            <tr key={k} className="[&+tr>td]:border-t [&+tr>td]:border-border/60">
              {cols.map((c) => {
                const x = r[c];
                return (
                  <td key={c} className={cn("px-2 py-1 first:pl-0", typeof x === "number" && "text-right tabular-nums")}>
                    {typeof x === "number" ? formatValue(x, (format as NumberFormat) ?? undefined) : x == null ? "" : short(x).replace(/^"|"$/g, "")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > shown.length ? <div className="pt-1 text-[11.5px] text-muted-foreground">{rows.length - shown.length} more rows</div> : null}
    </div>
  );
}
