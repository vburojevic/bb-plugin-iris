// SchemaDiff (chunk "debug"): a migration grouped by table, riskiest table
// first. Every step carries its risk (destructive in the bad tone, risky in
// warn, safe quiet) and why; a step opens its SQL. A new table lists its
// columns on one line. Logic lives in core/schemadiff.ts.

import { Chip, Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { isPendingValue } from "../core/evaluate";
import { type Risk, type SchemaDiffModel, type SchemaStep, type TableChange, schemaDiff } from "../core/schemadiff";
import type { ViewProps } from "../ui/render";
import { Caption, FOCUS, Nothing, Problems, tint } from "./agents-kit";

const STATUS_TONE: Record<TableChange["status"], string | undefined> = { added: "good", dropped: "bad", changed: undefined, renamed: "warn" };

export function SchemaDiffView({ props, text }: ViewProps) {
  const pending = [props.sql, props.before, props.after].some(isPendingValue);
  const sql = str(props.sql) ?? (text && text.trim() ? text : undefined);
  const model = useMemo(() => (pending ? null : schemaDiff({ sql, before: props.before, after: props.after })), [pending, sql, props.before, props.after]);
  if (!model) return <Shimmer className="h-40" />;
  return <Diff model={model} title={str(props.title)} />;
}

function Diff({ model, title }: { model: SchemaDiffModel; title?: string }) {
  const { palette } = useEnv();
  const riskColor = (r: Risk) => (r === "destructive" ? palette.tone.bad : r === "risky" ? palette.tone.warn : undefined);
  if (!model.steps.length)
    return (
      <div>
        <Caption title={title} />
        <Nothing>{model.problems.length ? "Nothing to show yet" : "No schema changes"}</Nothing>
        <Problems items={model.problems} />
      </div>
    );
  const losses = model.steps.filter((s) => s.risk === "destructive");
  return (
    <div className="min-w-0">
      <Caption title={title}>
        {(["destructive", "risky"] as Risk[]).filter((r) => model.tally[r]).map((r) => (
          <span key={r} style={{ color: riskColor(r) }}>
            {model.tally[r]} {r}
          </span>
        ))}
        <span>{model.tally.safe} safe</span>
      </Caption>
      {losses.length ? (
        <div className="mb-3 rounded-lg px-3 py-2" style={{ background: tint(palette.tone.bad, 9) }}>
          <div className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: palette.tone.bad }}>
            <Glyph name="triangle-alert" size={14} />
            Loses data when it runs
          </div>
          <ul className="mt-1 space-y-0.5 text-[12.5px]">
            {losses.slice(0, 6).map((s, k) => (
              <li key={k} className="min-w-0 truncate">
                <span className="font-mono text-[12px]">{s.table}{s.column ? `.${s.column}` : ""}</span>
                <span className="text-muted-foreground"> · {s.why ?? s.detail}</span>
              </li>
            ))}
            {losses.length > 6 ? <li className="text-muted-foreground">and {losses.length - 6} more</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="space-y-3">
        {model.tables.map((t) => (
          <Table key={t.name} table={t} riskColor={riskColor} />
        ))}
      </div>
      <Problems items={model.problems} />
    </div>
  );
}

function Table({ table, riskColor }: { table: TableChange; riskColor: (r: Risk) => string | undefined }) {
  const tone = STATUS_TONE[table.status];
  // A table whose steps only touch rows (DELETE, UPDATE, TRUNCATE) changes data, not shape.
  const rowsOnly = table.steps.every((s) => s.kind === "delete" || s.kind === "update" || s.kind === "truncate");
  const created = table.status === "added";
  const steps = created ? table.steps.filter((s) => s.kind !== "add_column") : table.steps;
  const columns = created ? table.steps.filter((s) => s.kind === "add_column") : [];
  return (
    <section className="min-w-0 rounded-lg px-3 py-2 shadow-[inset_0_0_0_1px_var(--border)]" aria-label={table.name}>
      <div className="flex min-w-0 items-center gap-2">
        <Glyph name="table-2" size={14} className="text-muted-foreground" />
        <span className="min-w-0 truncate font-mono text-[12.5px] font-medium">{table.name}</span>
        {rowsOnly ? <Chip>rows</Chip> : tone ? <Chip tone={tone}>{table.status}</Chip> : <Chip>{table.status}</Chip>}
      </div>
      {columns.length ? (
        <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {columns.map((c, k) => (
            <span key={k} className="font-mono text-[11.5px]">
              {k ? " · " : ""}
              {c.detail}
            </span>
          ))}
        </div>
      ) : null}
      {steps.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {steps.map((s, k) => (
            <Step key={k} step={s} color={riskColor(s.risk)} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Step({ step, color }: { step: SchemaStep; color?: string }) {
  const [open, setOpen] = useState(false);
  const icon = step.risk === "destructive" ? "triangle-alert" : step.risk === "risky" ? "circle-alert" : "check";
  return (
    <li className="min-w-0">
      <button type="button" disabled={!step.sql} onClick={() => setOpen(!open)} aria-expanded={step.sql ? open : undefined} className={cn("flex w-full min-w-0 items-start gap-2 rounded py-0.5 text-left text-[12.5px] enabled:hover:bg-state-hover", FOCUS)}>
        <Glyph name={icon} size={13} color={color ?? "var(--muted-foreground)"} className="mt-[3px]" />
        <span className="min-w-0 flex-1">
          <span className="[text-wrap:pretty]">{step.detail}</span>
          {step.why ? (
            <span className="block text-[11.5px] leading-snug" style={color ? { color } : undefined}>
              <span className={cn(!color && "text-muted-foreground")}>{step.why}</span>
            </span>
          ) : null}
        </span>
        <span className="sr-only">{step.risk}</span>
      </button>
      {open && step.sql ? <pre className="mb-1 ml-5 mt-0.5 whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11.5px]">{step.sql}</pre> : null}
    </li>
  );
}
