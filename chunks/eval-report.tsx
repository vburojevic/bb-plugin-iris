// EvalReport (chunk "agents"): the latest score against its baseline, scores
// by category, and every case across runs with regressions and errors first.
// A row opens its judge's note. Logic lives in core/evalreport.ts.

import { Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { isPendingValue } from "../core/evaluate";
import { type EvalModel, type EvalRow, type EvalVerdict, evalReport } from "../core/evalreport";
import type { ViewProps } from "../ui/render";
import { Caption, Chevron, FOCUS, Nothing, Problems, Stat, tint } from "./agents-kit";
import { useWidth } from "./tools-kit";

const score = (n: number | null | undefined) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const signed = (n: number | null) => (n == null ? "" : n > 0 ? `+${score(n)}` : n < 0 ? `−${score(-n)}` : "±0");
const WORDS: Record<EvalVerdict, string> = { regressed: "regressed", improved: "improved", same: "same", new: "new", error: "errored" };

export function EvalReportView({ props }: ViewProps) {
  const pending = [props.runs, props.baseline].some(isPendingValue);
  const model = useMemo(() => (pending ? null : evalReport(props.runs, props.baseline, props.tolerance)), [pending, props.runs, props.baseline, props.tolerance]);
  if (!model) return <Shimmer className="h-48" />;
  return <Report model={model} title={str(props.title)} tolerance={typeof props.tolerance === "number" ? props.tolerance : 0} />;
}

function Report({ model, title, tolerance }: { model: EvalModel; title?: string; tolerance: number }) {
  const { palette } = useEnv();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const tone = (v: EvalVerdict) => (v === "regressed" || v === "error" ? palette.tone.bad : v === "improved" ? palette.tone.good : v === "new" ? palette.tone.info : undefined);
  if (!model.runs.length)
    return (
      <div>
        <Caption title={title} />
        <Nothing>No eval runs to show</Nothing>
        <Problems items={model.problems} />
      </div>
    );
  const latest = model.runs.at(-1)!;
  // Runs shown as columns: as many as fit beside the case names, newest kept.
  const fit = width ? Math.max(1, Math.floor((width - (width < 420 ? 150 : 220) - 64) / 46)) : 2;
  const cols = model.runs.length > fit ? model.runs.slice(-fit) : model.runs;
  const offset = model.runs.length - cols.length;
  const rows = all ? model.rows : model.rows.slice(0, 12);
  const changeTone = model.change == null ? undefined : model.belowBase ? palette.tone.bad : model.change > tolerance ? palette.tone.good : undefined;
  const tallyOrder: EvalVerdict[] = ["regressed", "error", "improved", "new"];
  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${cols.length}, 2.6rem) 3.6rem` };

  return (
    <div ref={ref} className="min-w-0">
      <Caption title={title}>
        {tallyOrder.filter((k) => model.tally[k]).map((k) => (
          <span key={k} style={{ color: tone(k) }}>
            {model.tally[k]} {WORDS[k]}
          </span>
        ))}
        {!tallyOrder.some((k) => model.tally[k]) && model.baseFrom ? <span>No regressions</span> : null}
      </Caption>

      <div className="grid grid-cols-2 gap-x-4 gap-y-3 @md/iris:grid-cols-4">
        <Stat label="Score" value={score(model.score)} sub={latest.model ?? latest.label} />
        <Stat label={model.baseFrom === "baseline" ? "Against baseline" : model.baseFrom ? "Against the run before" : "Baseline"} value={model.change == null ? "–" : signed(model.change)} tone={changeTone} sub={model.base != null ? `${score(model.base)}${tolerance ? `, tolerance ${tolerance}` : ""}` : "none given"} />
        <Stat label="Cases" value={latest.cases.size} sub={model.tally.error ? `${model.tally.error} errored` : "all scored"} />
        <Stat label="Runs" value={model.runs.length} sub={model.runs.length > 1 ? `${model.runs[0].label} to ${latest.label}` : latest.label} />
      </div>

      {model.categories.length ? (
        <div className="mt-4 grid grid-cols-[max-content_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1.5" aria-label="Scores by category">
          {model.categories.map((c) => {
            const t = c.change != null && c.change < -tolerance ? palette.tone.bad : c.change != null && c.change > tolerance ? palette.tone.good : undefined;
            return (
              <div key={c.name} className="contents text-[12.5px]">
                <span className="max-w-[9rem] truncate text-[12.5px]" title={c.name}>
                  {c.name}
                </span>
                <span className="relative h-1.5 rounded-full bg-muted" aria-hidden>
                  {c.score != null ? <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(0, Math.min(100, c.score))}%`, background: palette.accent }} /> : null}
                  {c.base != null ? <span className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground/60" style={{ left: `calc(${Math.max(0, Math.min(100, c.base))}% - 1px)` }} title={`Baseline ${score(c.base)}`} /> : null}
                </span>
                <span className="text-right text-[12.5px] tabular-nums">{score(c.score)}</span>
                <span className={cn("min-w-[2.6rem] text-right text-xs tabular-nums", !t && "text-muted-foreground")} style={t ? { color: t } : undefined}>
                  {signed(c.change)}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}

      <div role="table" aria-label="Cases by run" className="mt-4 min-w-0">
        <div role="row" className="grid items-end gap-x-1 pb-1 text-[11px] text-muted-foreground" style={grid}>
          <span role="columnheader">{offset ? `Case · ${offset} older ${offset === 1 ? "run" : "runs"} hidden` : "Case"}</span>
          {cols.map((r, k) => (
            <span role="columnheader" key={k} className={cn("truncate text-center", k === cols.length - 1 && "font-medium text-foreground")} title={r.at ?? r.label}>
              {k === cols.length - 1 ? "Latest" : r.label.split(" ")[0]}
            </span>
          ))}
          <span role="columnheader" className="text-right">
            Change
          </span>
        </div>
        {rows.map((r) => (
          <CaseRow key={r.id} row={r} cols={cols.length} offset={offset} grid={grid} tone={tone(r.verdict)} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)} />
        ))}
        {model.rows.length > 12 ? (
          <button type="button" onClick={() => setAll(!all)} className={cn("mt-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground", FOCUS)}>
            {all ? "Show fewer" : `Show all ${model.rows.length} cases`}
          </button>
        ) : null}
      </div>
      <Problems items={model.problems} />
    </div>
  );
}

function CaseRow({ row, cols, offset, grid, tone, open, onToggle }: { row: EvalRow; cols: number; offset: number; grid: { gridTemplateColumns: string }; tone?: string; open: boolean; onToggle: () => void }) {
  const detail = row.latest?.note || row.latest?.error || row.category;
  const shown = row.scores.slice(offset);
  return (
    <div role="row" className="border-t border-border">
      <button type="button" onClick={onToggle} disabled={!detail} aria-expanded={detail ? open : undefined} className={cn("grid w-full items-center gap-x-1 py-1.5 text-left text-[12.5px] enabled:hover:bg-state-hover", FOCUS)} style={grid}>
        <span role="cell" className="flex min-w-0 items-center gap-1.5">
          {detail ? <Chevron open={open} /> : <span className="w-[13px] shrink-0" />}
          <span className="truncate font-mono text-[12px]" title={row.id}>
            {row.id}
          </span>
        </span>
        {shown.map((s, k) => {
          const last = k === cols - 1;
          const color = last ? tone : undefined;
          return (
            <span role="cell" key={k} className={cn("mx-auto grid h-6 w-full place-items-center rounded-md tabular-nums", !last && "text-muted-foreground", last && "font-medium")} style={color ? { background: tint(color, 14), color } : last ? { boxShadow: "inset 0 0 0 1px var(--border)" } : undefined}>
              {last && row.verdict === "error" ? <Glyph name="circle-alert" size={13} /> : score(s)}
            </span>
          );
        })}
        <span role="cell" className={cn("text-right text-xs tabular-nums", !tone && "text-muted-foreground")} style={tone ? { color: tone } : undefined}>
          {row.verdict === "error" ? "error" : row.verdict === "new" ? "new" : signed(row.change)}
          <span className="sr-only"> {row.verdict}</span>
        </span>
      </button>
      {open && detail ? (
        <div className="mb-2 ml-5 space-y-1 text-[12.5px] leading-snug">
          {row.latest?.error ? <div style={{ color: tone }}>{row.latest.error}</div> : null}
          {row.latest?.note ? <div className="text-foreground/90 [text-wrap:pretty]">{row.latest.note}</div> : null}
          <div className="text-[11.5px] text-muted-foreground">
            {[row.category, row.base != null ? `judged against ${score(row.base)}` : null, row.latest?.tags?.length ? row.latest.tags.join(", ") : null].filter(Boolean).join(" · ")}
          </div>
        </div>
      ) : null}
    </div>
  );
}
