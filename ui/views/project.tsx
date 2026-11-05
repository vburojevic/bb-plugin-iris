import { useState } from "react";
import { isPendingValue } from "../../core/evaluate";
import { formatValue } from "../../core/format";
import { type Finding, normalizeBench, normalizeCoverage, normalizeFindings, normalizeTests } from "../../core/reports";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Chip, Glyph, Shimmer, cn, num, str } from "./kit";

function FileRef({ file, line }: { file?: string; line?: number }) {
  const env = useEnv();
  if (!file) return null;
  return (
    <button type="button" onClick={() => env.perform([{ $iris: "action", kind: "openFile", args: [file, line ?? null] }])} className="max-w-full truncate font-mono text-[11.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
      {file}
      {line ? `:${line}` : ""}
    </button>
  );
}

export function TestsView({ props }: ViewProps) {
  const env = useEnv();
  const [showAll, setShowAll] = useState(props.show === "all");
  const [expanded, setExpanded] = useState(false);
  if (isPendingValue(props.results)) return <Shimmer className="h-28" />;
  const tests = normalizeTests(props.results);
  const passed = tests.filter((t) => t.status === "passed").length;
  const failed = tests.filter((t) => t.status === "failed");
  const skipped = tests.filter((t) => t.status === "skipped").length;
  const total = tests.length || 1;
  const others = showAll ? tests.filter((t) => t.status !== "failed") : [];
  const PASS_CAP = 8;
  const shownOthers = expanded ? others : others.slice(0, PASS_CAP);
  const listed = failed;
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <Count label="Passed" value={passed} color={env.palette.tone.good} />
        <Count label="Failed" value={failed.length} color={failed.length ? env.palette.tone.bad : undefined} />
        {skipped ? <Count label="Skipped" value={skipped} /> : null}
        <span className="ml-auto text-xs text-muted-foreground">{str(props.title) ?? `${tests.length} tests`}</span>
      </div>
      <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="iris-bar h-full" style={{ width: `${(passed / total) * 100}%`, background: env.palette.tone.good }} />
        <div className="iris-bar h-full" style={{ width: `${(failed.length / total) * 100}%`, background: env.palette.tone.bad }} />
      </div>
      {listed.length ? (
        <ul className="mt-3 [&>li+li]:border-t [&>li+li]:border-border/70">
          {listed.slice(0, 200).map((t, k) => (
            <li key={k} className="flex min-w-0 gap-2.5 py-2">
              <Glyph name={t.status === "failed" ? "circle-x" : t.status === "skipped" ? "circle-minus" : "circle-check"} size={15} className="mt-0.5" color={t.status === "failed" ? env.palette.tone.bad : t.status === "passed" ? env.palette.tone.good : env.palette.tone.neutral} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px]">{t.name}</div>
                {t.message ? <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap rounded-md bg-destructive/[0.06] px-2 py-1 font-mono text-[11.5px] text-foreground">{t.message}</pre> : null}
                <FileRef file={t.file} line={t.line} />
              </div>
              {t.duration != null ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatValue(t.duration, "duration")}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {shownOthers.length ? (
        <ul className="mt-2 columns-1 gap-6 text-[12.5px] sm:columns-2">
          {shownOthers.map((t, k) => (
            <li key={k} className="flex min-w-0 break-inside-avoid items-center gap-2 py-0.5 text-muted-foreground">
              <Glyph name={t.status === "skipped" ? "circle-minus" : "check"} size={13} color={t.status === "passed" ? env.palette.tone.good : undefined} />
              <span className="truncate" title={t.file ? `${t.file}${t.line ? `:${t.line}` : ""}` : undefined}>
                {t.name}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {others.length > PASS_CAP && !expanded ? (
        <button type="button" onClick={() => setExpanded(true)} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
          Show {others.length - PASS_CAP} more
        </button>
      ) : null}
      {!listed.length && !others.length ? (
        tests.length ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-muted-foreground">
          <Glyph name="party-popper" size={15} />
          Every test passed
        </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">No tests in this report</div>
        )
      ) : null}
      {tests.length > failed.length && !showAll ? (
        <button type="button" onClick={() => setShowAll(true)} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
          Show all {tests.length} tests
        </button>
      ) : null}
    </div>
  );
}

function Count({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums" style={color ? { color } : undefined}>
        {value.toLocaleString("en-US")}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

const SEV_ORDER: Finding["severity"][] = ["critical", "high", "medium", "low", "info"];
const SEV_TONE: Record<Finding["severity"], string> = { critical: "bad", high: "bad", medium: "warn", low: "info", info: "neutral" };

export function FindingsView({ props }: ViewProps) {
  if (isPendingValue(props.items)) return <Shimmer className="h-28" />;
  const items = normalizeFindings(props.items).sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  if (!items.length) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Glyph name="circle-check" size={15} />
        No findings
      </div>
    );
  }
  const counts = SEV_ORDER.map((s) => [s, items.filter((i) => i.severity === s).length] as const).filter(([, c]) => c);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {counts.map(([s, c]) => (
          <Chip key={s} tone={SEV_TONE[s]}>
            {c} {s}
          </Chip>
        ))}
      </div>
      <ul className="[&>li+li]:border-t [&>li+li]:border-border/70">
        {items.slice(0, 300).map((f, k) => (
          <FindingRow key={k} f={f} />
        ))}
      </ul>
    </div>
  );
}

function FindingRow({ f }: { f: Finding }) {
  const [open, setOpen] = useState(false);
  const env = useEnv();
  const color = env.palette.tone[SEV_TONE[f.severity] as keyof typeof env.palette.tone];
  const more = Boolean(f.detail || f.fix);
  return (
    <li className={cn("py-2", f.status === "fixed" || f.status === "rejected" ? "opacity-60" : "")}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: color }} aria-label={f.severity} />
        <div className="min-w-0 flex-1">
          <button type="button" disabled={!more} onClick={() => setOpen(!open)} className="block max-w-full text-left text-[13px] leading-snug disabled:cursor-default">
            {f.title}
            {f.status ? <span className="ml-2 text-xs text-muted-foreground">{f.status}</span> : null}
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <FileRef file={f.file} line={f.line} />
            {f.rule ? <span className="truncate text-[11px] text-muted-foreground">{f.rule}</span> : null}
          </div>
          {open ? (
            <div className="mt-1.5 space-y-1 text-[12.5px]">
              {f.detail ? <p className="text-muted-foreground">{f.detail}</p> : null}
              {f.fix ? (
                <p>
                  <span className="font-medium">Fix: </span>
                  {f.fix}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        {more ? (
          <button type="button" onClick={() => setOpen(!open)} className="mt-0.5 text-muted-foreground hover:text-foreground" aria-label={open ? "Hide detail" : "Show detail"}>
            <Glyph name="chevron-down" size={14} className={cn("transition-transform", open && "rotate-180")} />
          </button>
        ) : null}
      </div>
    </li>
  );
}

export function CoverageView({ props }: ViewProps) {
  const env = useEnv();
  if (isPendingValue(props.report)) return <Shimmer className="h-28" />;
  const rows = normalizeCoverage(props.report).sort((a, b) => a.lines - b.lines);
  const threshold = num(props.threshold) ?? 80;
  const total = rows.length ? rows.reduce((s, r) => s + r.lines, 0) / rows.length : 0;
  const tone = (p: number) => (p >= threshold ? env.palette.tone.good : p >= threshold * 0.75 ? env.palette.tone.warn : env.palette.tone.bad);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums" style={{ color: tone(total) }}>
          {total.toFixed(1)}%
        </span>
        <span className="text-xs text-muted-foreground">average line coverage across {rows.length} files</span>
      </div>
      <ul className="space-y-1.5">
        {rows.slice(0, 60).map((r) => (
          <li key={r.file} className="grid grid-cols-[minmax(0,1fr)_minmax(60px,30%)_3.5rem] items-center gap-3 text-[12.5px]">
            <button type="button" onClick={() => env.perform([{ $iris: "action", kind: "openFile", args: [r.file, null] }])} className="truncate text-left font-mono text-[12px] hover:underline">
              {r.file}
            </button>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="iris-bar block h-full rounded-full" style={{ width: `${Math.min(100, r.lines)}%`, background: tone(r.lines) }} />
            </span>
            <span className="text-right tabular-nums">{r.lines.toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BenchmarkView({ props }: ViewProps) {
  const env = useEnv();
  if (isPendingValue(props.results)) return <Shimmer className="h-24" />;
  const rows = normalizeBench(props.results);
  const unit = str(props.unit) ?? "ms";
  const format = props.format ?? (unit === "ms" ? "ms" : undefined);
  const show = (v?: number) => (v == null ? "" : format ? formatValue(v, format as never) : `${formatValue(v, "number")} ${unit}`);
  const max = Math.max(1, ...rows.flatMap((r) => [r.before ?? 0, r.after ?? 0]));
  return (
    <ul className="space-y-3">
      {rows.map((r) => {
        const change = r.before != null && r.after != null && r.before !== 0 ? (r.after - r.before) / r.before : null;
        const good = change == null ? null : r.better === "lower" ? change < 0 : change > 0;
        const color = good == null ? env.palette.tone.neutral : good ? env.palette.tone.good : env.palette.tone.bad;
        return (
          <li key={r.name} className="min-w-0">
            <div className="flex items-baseline gap-2 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              {change != null ? (
                <span className="shrink-0 font-medium tabular-nums" style={{ color }}>
                  {change > 0 ? "+" : "−"}
                  {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%{Math.abs(change) >= 0.5 && r.before && r.after ? ` (${(r.better === "lower" ? r.before / r.after : r.after / r.before).toFixed(1)}×)` : ""}
                </span>
              ) : null}
            </div>
            <div className="mt-1 grid grid-cols-[4rem_minmax(0,1fr)_5rem] items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {r.before != null ? (
                <>
                  <span>Before</span>
                  <span className="h-1.5 rounded-full bg-muted">
                    <span className="block h-full rounded-full bg-muted-foreground/50" style={{ width: `${(r.before / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">{show(r.before)}</span>
                </>
              ) : null}
              <span>{r.before != null ? "After" : "Time"}</span>
              <span className="h-1.5 rounded-full bg-muted">
                <span className="iris-bar block h-full rounded-full" style={{ width: `${((r.after ?? 0) / max) * 100}%`, background: color === env.palette.tone.neutral ? env.palette.accent : color }} />
              </span>
              <span className="text-right tabular-nums text-foreground">{show(r.after)}</span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
