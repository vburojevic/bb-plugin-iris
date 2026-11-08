// ToolCall (chunk "agents"): one tool or MCP call as a single line (status,
// name, server, a preview of the arguments, retries and time) that opens to
// its arguments, result, error and every try. Logic lives in core/toolcall.ts.

import { Chip, Glyph, Shimmer, cn, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { isPendingValue } from "../core/evaluate";
import { normalizeToolCall } from "../core/toolcall";
import type { ViewProps } from "../ui/render";
import { Chevron, DataBlock, FOCUS, ms } from "./agents-kit";

export function ToolCallView({ props }: ViewProps) {
  const { palette } = useEnv();
  const pending = [props.args, props.result, props.error, props.attempts].some(isPendingValue);
  const call = useMemo(() => (pending ? null : normalizeToolCall(props)), [pending, props]);
  const [open, setOpen] = useState(props.open === true);
  if (!call) return <Shimmer className="h-9" />;
  const tone = call.status === "error" ? palette.tone.bad : call.status === "running" ? palette.tone.info : palette.tone.good;
  const retries = Math.max(0, call.attempts.length - 1);
  return (
    <div className="min-w-0 rounded-lg shadow-[inset_0_0_0_1px_var(--border)]">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={cn("flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-state-hover", FOCUS)}>
        <Chevron open={open} />
        {call.status === "running" ? (
          <span className="iris-pulse size-2 shrink-0 rounded-full" style={{ background: tone }} aria-hidden />
        ) : (
          <Glyph name={call.status === "error" ? "circle-x" : "circle-check"} size={14} color={tone} />
        )}
        <span className="sr-only">{call.status === "error" ? "Failed" : call.status === "running" ? "Running" : "Succeeded"}</span>
        <span className="shrink-0 truncate font-mono text-[12.5px] font-medium">{call.name}</span>
        {call.server ? <Chip className="hidden shrink-0 @sm/iris:inline-flex">{call.server}</Chip> : null}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted-foreground">{call.preview}</span>
        {retries ? (
          <Chip tone="warn" className="shrink-0">
            {retries} {retries === 1 ? "retry" : "retries"}
          </Chip>
        ) : null}
        {call.ms != null ? <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{ms(call.ms)}</span> : null}
      </button>
      {open ? (
        <div className="space-y-2.5 px-2.5 pb-2.5 pt-0.5">
          {call.server ? (
            <div className="text-[11.5px] text-muted-foreground @sm/iris:hidden">
              Server <span className="text-foreground">{call.server}</span>
            </div>
          ) : null}
          <DataBlock label="Arguments" value={call.args ?? "(none)"} />
          {call.error ? <DataBlock label="Error" value={call.error} tone={palette.tone.bad} /> : null}
          {call.resultText !== undefined ? <DataBlock label="Result" value={call.resultText} /> : call.result !== undefined ? <DataBlock label="Result" value={call.result} /> : call.status === "running" ? <div className="text-[12px] text-muted-foreground">Still running</div> : null}
          {call.attempts.length > 1 ? (
            <div>
              <div className="mb-1 text-[11.5px] text-muted-foreground">Tries</div>
              <ol className="space-y-0.5 text-[12px]">
                {call.attempts.map((a) => (
                  <li key={a.n} className="flex min-w-0 items-baseline gap-2">
                    <Glyph name={a.error ? "circle-x" : "circle-check"} size={12} color={a.error ? palette.tone.bad : palette.tone.good} className="translate-y-0.5" />
                    <span className="shrink-0 tabular-nums">Try {a.n}</span>
                    {a.ms != null ? <span className="shrink-0 tabular-nums text-muted-foreground">{ms(a.ms)}</span> : null}
                    <span className="min-w-0 truncate text-muted-foreground">{a.error ?? "succeeded"}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
