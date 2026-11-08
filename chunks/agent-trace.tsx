// AgentTrace (chunk "agents"): spans as a tree beside a shared timeline. Each
// kind (subagent, model call, tool call) keeps one series color; errors take
// the bad tone. A parent folds its children; selecting a span opens its input,
// output, tokens and cost under its row. Logic lives in core/trace.ts.

import { Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { isPendingValue } from "../core/evaluate";
import { type SpanKind, type TraceModel, type TraceSpan, errorPath, normalizeTrace } from "../core/trace";
import type { ViewProps } from "../ui/render";
import { Caption, Chevron, DataBlock, FOCUS, Nothing, Problems, compact, money, ms, tint } from "./agents-kit";
import { useWidth } from "./tools-kit";

const ICON: Record<SpanKind, string> = { agent: "bot", llm: "sparkles", tool: "wrench", step: "circle-dot" };
const KIND_LABEL: Record<SpanKind, string> = { agent: "Agent", llm: "Model call", tool: "Tool call", step: "Step" };
const MAX_ROWS = 400;

export function AgentTraceView({ props }: ViewProps) {
  const pending = isPendingValue(props.spans);
  const model = useMemo(() => (pending ? null : normalizeTrace(props.spans)), [pending, props.spans]);
  if (!model) return <Shimmer className="h-48" />;
  return <Trace model={model} title={str(props.title)} />;
}

function Trace({ model, title }: { model: TraceModel; title?: string }) {
  const { palette } = useEnv();
  const [ref, width] = useWidth<HTMLDivElement>();
  const narrow = width > 0 && width < 460;
  const initial = useMemo(() => {
    const open = errorPath(model);
    for (const s of model.flat) if (s.depth < 1 && s.children.length) open.add(s.id);
    return open;
  }, [model]);
  const [open, setOpen] = useState<Set<string>>(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const color = (s: TraceSpan) => (s.error ? palette.tone.bad : s.kind === "agent" ? palette.series[0] : s.kind === "llm" ? palette.series[1] ?? palette.accent : s.kind === "tool" ? palette.series[2] ?? palette.accent : "color-mix(in oklab, var(--foreground) 40%, transparent)");

  if (!model.flat.length)
    return (
      <div>
        <Caption title={title} />
        <Nothing>No spans to show</Nothing>
        <Problems items={model.problems} />
      </div>
    );

  // Rows: spans whose ancestors are all open.
  const rows: TraceSpan[] = [];
  const walk = (s: TraceSpan) => {
    if (rows.length >= MAX_ROWS) return;
    rows.push(s);
    if (open.has(s.id)) s.children.forEach(walk);
  };
  model.roots.forEach(walk);
  const total = model.duration || 1;
  const kinds = (["agent", "llm", "tool"] as SpanKind[]).filter((k) => model.flat.some((s) => s.kind === k));
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  // Round tick values (1, 2 or 5 times a power of ten), about four across.
  const raw = total / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw) ?? raw;
  const ticks: number[] = [];
  for (let t = 0; t <= total + 1e-9 && ticks.length < 12; t += step) ticks.push(t / total);

  return (
    <div ref={ref} className="min-w-0">
      <Caption title={title}>
        <span>{ms(model.duration)}</span>
        {model.tokens != null ? <span>{compact(model.tokens)} tokens</span> : null}
        {model.cost != null ? <span>{money(model.cost)}</span> : null}
        {model.errors ? <span style={{ color: palette.tone.bad }}>{model.errors} {model.errors === 1 ? "error" : "errors"}</span> : null}
      </Caption>
      <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
        {kinds.map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: color({ kind: k, error: null } as TraceSpan) }} aria-hidden />
            {KIND_LABEL[k]} {model.flat.filter((s) => s.kind === k).length}
          </span>
        ))}
      </div>

      {!narrow ? (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.2rem] gap-x-3 pb-1 text-[11px] text-muted-foreground" aria-hidden>
          <span>Span</span>
          <span className="relative h-3.5">
            {ticks.map((t) => (
              <span key={t} className="absolute top-0 whitespace-nowrap tabular-nums" style={{ left: `${t * 100}%`, transform: t === 0 ? "none" : t > 0.92 ? "translateX(-100%)" : "translateX(-50%)" }}>
                {t === 0 ? "0" : ms(total * t)}
              </span>
            ))}
          </span>
          <span className="text-right">Time</span>
        </div>
      ) : null}

      <div role="tree" aria-label={title ?? "Agent trace"}>
        {rows.map((s) => {
          const c = color(s);
          const isOpen = open.has(s.id);
          const sel = selected === s.id;
          const bar = (
            <span className={cn("relative block", narrow ? "mt-1 h-1" : "h-2.5")} aria-hidden>
              {!narrow ? ticks.slice(1).filter((t) => t < 0.999).map((t) => <span key={t} className="absolute inset-y-[-6px] w-px bg-border/60" style={{ left: `${t * 100}%` }} />) : <span className="absolute inset-0 rounded-full bg-muted" />}
              <span className="absolute inset-y-0 rounded-[3px]" style={{ left: `${(s.start / total) * 100}%`, width: `max(2px, ${(s.duration / total) * 100}%)`, background: s.children.length && isOpen ? tint(c, 35) : c }} />
            </span>
          );
          const meta = [s.model, s.tokens != null ? `${compact(s.tokens)} tok` : null].filter(Boolean).join(" · ");
          return (
            <div key={s.id} role="treeitem" aria-level={s.depth + 1} aria-expanded={s.children.length ? isOpen : undefined} aria-selected={sel} className="border-t border-border first:border-t-0">
              <div className={cn("grid items-center gap-x-3 py-1", !narrow && "grid-cols-[minmax(0,2fr)_minmax(0,3fr)_4.2rem]", sel && "bg-state-hover")}>
                <div className="flex min-w-0 items-center gap-1" style={{ paddingLeft: Math.min(s.depth, 8) * 14 }}>
                  {s.children.length ? (
                    <button type="button" onClick={() => toggle(s.id)} aria-label={isOpen ? `Fold ${s.name}` : `Open ${s.name}`} className={cn("grid size-5 shrink-0 place-items-center rounded hover:bg-state-hover", FOCUS)}>
                      <Chevron open={isOpen} />
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}
                  <button type="button" onClick={() => setSelected(sel ? null : s.id)} className={cn("flex min-w-0 flex-1 items-center gap-1.5 rounded py-0.5 text-left text-[12.5px]", FOCUS)}>
                    <Glyph name={s.error ? "circle-alert" : ICON[s.kind]} size={13} color={c} />
                    <span className="min-w-0 truncate" title={s.name}>
                      {s.name}
                    </span>
                    {meta && !narrow ? <span className="hidden shrink-0 truncate text-[11px] text-muted-foreground @xl/iris:inline">{meta}</span> : null}
                    {narrow ? <span className="ml-auto shrink-0 pl-2 text-[11.5px] tabular-nums text-muted-foreground">{ms(s.duration)}</span> : null}
                  </button>
                </div>
                {narrow ? <div style={{ paddingLeft: Math.min(s.depth, 8) * 14 + 20 }}>{bar}</div> : bar}
                {!narrow ? <span className="text-right text-[11.5px] tabular-nums text-muted-foreground">{ms(s.duration)}</span> : null}
              </div>
              {sel ? <SpanDetail span={s} color={c} /> : null}
            </div>
          );
        })}
      </div>
      {rows.length >= MAX_ROWS ? <div className="pt-1 text-xs text-muted-foreground">Showing the first {MAX_ROWS} rows; fold spans to see the rest</div> : null}
      <Problems items={model.problems} />
    </div>
  );
}

function SpanDetail({ span, color }: { span: TraceSpan; color: string }) {
  const { palette } = useEnv();
  const facts: [string, string][] = [
    ["Kind", KIND_LABEL[span.kind]],
    ["Started", `${ms(span.start)} in`],
    ["Took", ms(span.duration)],
  ];
  if (span.model) facts.push(["Model", span.model]);
  if (span.tokensIn != null || span.tokensOut != null) facts.push(["Tokens", `${compact(span.tokensIn ?? 0)} in, ${compact(span.tokensOut ?? 0)} out`]);
  else if (span.tokens != null) facts.push([span.tokensRolled ? "Tokens below" : "Tokens", compact(span.tokens)]);
  if (span.cost != null) facts.push([span.costRolled ? "Cost below" : "Cost", money(span.cost)]);
  return (
    <div className="mb-2 ml-5 mt-1 space-y-2 rounded-lg px-3 py-2.5" style={{ boxShadow: `inset 2px 0 0 ${color}, inset 0 0 0 1px var(--border)` }}>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[12px] @md/iris:grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {span.error ? <DataBlock label="Error" value={span.error} tone={palette.tone.bad} /> : null}
      <DataBlock label="Input" value={span.input} />
      <DataBlock label="Output" value={span.output} />
      {span.input === undefined && span.output === undefined && !span.error ? <div className="text-[11.5px] text-muted-foreground">No input or output recorded</div> : null}
    </div>
  );
}
