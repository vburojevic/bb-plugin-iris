// TestHistory (chunk "debug"): a row per test, a square per run (oldest left),
// flaky tests first, then failing, then fixed; tests that passed every run
// fold into one line. A row opens its last failure and file. Logic lives in
// core/testhistory.ts.

import { Chip, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { isPendingValue } from "../core/evaluate";
import { type HistoryModel, type HistoryTest, type RunStatus, type TestKind, testHistory } from "../core/testhistory";
import type { ViewProps } from "../ui/render";
import { Caption, Chevron, FOCUS, Nothing, Problems, ms, pct, tint } from "./agents-kit";
import { useWidth } from "./tools-kit";

const KIND: Record<TestKind, { label: string; tone?: string }> = { flaky: { label: "Flaky", tone: "warn" }, failing: { label: "Failing", tone: "bad" }, fixed: { label: "Fixed", tone: "good" }, passing: { label: "Passing" }, skipped: { label: "Skipped" } };

export function TestHistoryView({ props }: ViewProps) {
  const pending = isPendingValue(props.runs) || (Array.isArray(props.runs) && props.runs.some(isPendingValue));
  const model = useMemo(() => (pending ? null : testHistory(props.runs, props.labels)), [pending, props.runs, props.labels]);
  if (!model) return <Shimmer className="h-40" />;
  return <History model={model} title={str(props.title)} />;
}

function History({ model, title }: { model: HistoryModel; title?: string }) {
  const { palette } = useEnv();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [open, setOpen] = useState<string | null>(null);
  const [showPassing, setShowPassing] = useState(false);
  if (!model.tests.length)
    return (
      <div>
        <Caption title={title} />
        <Nothing>No tests in these runs</Nothing>
        <Problems items={model.problems} />
      </div>
    );
  const cell = width && width < 420 ? 14 : 18;
  const nameMin = width && width < 420 ? 120 : 200;
  const fit = width ? Math.max(3, Math.floor((width - nameMin - 48) / (cell + 3))) : model.runs.length;
  const hidden = Math.max(0, model.runs.length - fit);
  const runs = model.runs.slice(hidden);
  const notable = model.tests.filter((t) => t.kind !== "passing" && t.kind !== "skipped");
  const quiet = model.tests.filter((t) => t.kind === "passing" || t.kind === "skipped");
  const shown = showPassing || !notable.length ? model.tests : notable;
  const paint = (s: RunStatus) => (s === "passed" ? { background: tint(palette.tone.good, 50) } : s === "failed" ? { background: palette.tone.bad } : s === "skipped" ? { boxShadow: "inset 0 0 0 1px var(--border)" } : {});
  const latest = model.runs.at(-1)!;
  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${runs.length}, ${cell}px) 2.6rem` };

  return (
    <div ref={ref} className="min-w-0">
      <Caption title={title}>
        {(["flaky", "failing", "fixed"] as TestKind[]).filter((k) => model.tally[k]).map((k) => (
          <span key={k} style={{ color: KIND[k].tone ? palette.tone[KIND[k].tone as "warn"] : undefined }}>
            {model.tally[k]} {KIND[k].label.toLowerCase()}
          </span>
        ))}
        <span>
          {model.runs.length} {model.runs.length === 1 ? "run" : "runs"}, latest {latest.passed} passed{latest.failed ? `, ${latest.failed} failed` : ""}
        </span>
      </Caption>
      <div role="table" aria-label={title ?? "Test history"}>
        <div role="row" className="grid items-end gap-x-[3px] pb-1 text-[11px] text-muted-foreground" style={grid}>
          <span role="columnheader">{hidden ? `Test · ${hidden} older ${hidden === 1 ? "run" : "runs"} hidden` : "Test"}</span>
          {runs.map((r, k) => (
            <span role="columnheader" key={k} className="text-center" title={`${r.label}: ${r.passed} passed, ${r.failed} failed`}>
              <span className="mx-auto block w-full rounded-full" style={{ height: 3, background: r.failed ? tint(palette.tone.bad, 60) : "var(--muted)" }} />
              <span className="sr-only">{r.label}</span>
            </span>
          ))}
          <span role="columnheader" className="text-right">
            Fails
          </span>
        </div>
        {shown.map((t) => (
          <Row key={t.key} test={t} runs={runs.map((r) => r.label)} offset={hidden} grid={grid} cell={cell} paint={paint} open={open === t.key} onToggle={() => setOpen(open === t.key ? null : t.key)} />
        ))}
        {notable.length && quiet.length ? (
          <button type="button" onClick={() => setShowPassing(!showPassing)} className={cn("mt-1 rounded px-1 text-xs text-muted-foreground hover:text-foreground", FOCUS)}>
            {showPassing ? "Hide the steady tests" : `${quiet.length} more ${quiet.length === 1 ? "test" : "tests"} passed or skipped every run`}
          </button>
        ) : null}
        <div className="mt-1.5 flex justify-between gap-2 pl-0 text-[11px] text-muted-foreground" style={{ marginRight: "2.6rem" }}>
          <span className="truncate">Oldest left: {runs[0]?.label}</span>
          <span className="truncate">Latest: {latest.label}</span>
        </div>
      </div>
      <Problems items={model.problems} />
    </div>
  );
}

function Row({ test, runs, offset, grid, cell, paint, open, onToggle }: { test: HistoryTest; runs: string[]; offset: number; grid: { gridTemplateColumns: string }; cell: number; paint: (s: RunStatus) => object; open: boolean; onToggle: () => void }) {
  const { palette } = useEnv();
  const kind = KIND[test.kind];
  const statuses = test.results.slice(offset);
  return (
    <div role="row" className="border-t border-border">
      <button type="button" onClick={onToggle} aria-expanded={open} className={cn("grid w-full items-center gap-x-[3px] py-1.5 text-left text-[12.5px] hover:bg-state-hover", FOCUS)} style={grid}>
        <span role="cell" className="flex min-w-0 items-center gap-1.5 pr-2">
          <Chevron open={open} />
          <span className="min-w-0 break-words leading-snug [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden" title={test.name}>
            {test.name}
          </span>
          {kind.tone ? (
            <Chip tone={kind.tone} className="hidden shrink-0 @md/iris:inline-flex">
              {kind.label}
            </Chip>
          ) : null}
        </span>
        {statuses.map((s, k) => (
          <span role="cell" key={k} className="grid place-items-center" title={`${runs[k]}: ${s ?? "not run"}${test.durations[k + offset] != null ? `, ${ms(test.durations[k + offset])}` : ""}`}>
            {s ? <span className="block rounded-[3px]" style={{ width: cell, height: cell, ...paint(s) }} /> : <span className="block size-1 rounded-full bg-muted-foreground/40" />}
            <span className="sr-only">{s ?? "not run"}</span>
          </span>
        ))}
        <span role="cell" className="text-right text-xs tabular-nums" style={test.failRate ? { color: test.kind === "fixed" ? undefined : test.kind === "flaky" ? palette.tone.warn : palette.tone.bad } : undefined}>
          <span className={cn(!test.failRate || test.kind === "fixed" ? "text-muted-foreground" : undefined)}>{test.failRate ? pct(test.failRate) : "0%"}</span>
        </span>
      </button>
      {open ? (
        <div className="mb-2 ml-5 space-y-1 text-[12px] leading-snug">
          <div className="flex flex-wrap items-center gap-2">
            {kind.tone ? <Chip tone={kind.tone}>{kind.label}</Chip> : <Chip>{kind.label}</Chip>}
            <span className="text-muted-foreground">
              {test.kind === "flaky"
                ? `Flipped ${test.flips} ${test.flips === 1 ? "time" : "times"}, failed ${pct(test.failRate)} of runs`
                : test.kind === "failing" && test.since != null
                  ? `Failing since ${runs[test.since - offset] ?? `run ${test.since + 1}`}`
                  : test.kind === "fixed"
                    ? "Failed before, passing now"
                    : "Steady"}
            </span>
          </div>
          {test.file ? (
            <div className="font-mono text-[11.5px] text-muted-foreground">
              {test.file}
              {test.line ? `:${test.line}` : ""}
            </div>
          ) : null}
          {test.message ? <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11.5px]">{test.message}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
