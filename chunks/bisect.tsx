// Bisect (chunk "debug"): the commits newest first on a rail. Good and bad
// marks take their tones; the range still in play is banded in the accent and
// the commit under test is called out. Long stretches outside the range fold.
// Once one commit is left it reads as the first bad commit. Logic lives in
// core/bisect.ts.

import { Chip, Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { type BisectCommit, type BisectModel, bisectState } from "../core/bisect";
import { isPendingValue } from "../core/evaluate";
import type { ViewProps } from "../ui/render";
import { Caption, FOCUS, Nothing, Problems, tint } from "./agents-kit";

export function BisectView({ props }: ViewProps) {
  const pending = [props.commits, props.log].some(isPendingValue);
  const model = useMemo(() => (pending ? null : bisectState({ commits: props.commits, log: props.log, current: props.current })), [pending, props.commits, props.log, props.current]);
  if (!model) return <Shimmer className="h-40" />;
  return <Rail model={model} title={str(props.title)} />;
}

function Rail({ model, title }: { model: BisectModel; title?: string }) {
  const { palette } = useEnv();
  const [expanded, setExpanded] = useState(false);
  if (!model.commits.length)
    return (
      <div>
        <Caption title={title} />
        <Nothing>No commits to bisect</Nothing>
        <Problems items={model.problems} />
      </div>
    );
  const color = (c: BisectCommit) => (c.verdict === "good" ? palette.tone.good : c.verdict === "bad" ? palette.tone.bad : c.verdict === "skip" ? palette.tone.warn : c.inRange ? palette.accent : "var(--muted-foreground)");
  const foundCommit = model.found ? model.commits.find((c) => c.sha === model.found) : null;
  // Keep every commit in range, each marked one, and one on either side; fold the rest.
  const keep = new Set<number>();
  model.commits.forEach((c, i) => {
    if (c.inRange || c.verdict || c.current || c.sha === model.found) for (const j of [i - 1, i, i + 1]) keep.add(j);
  });
  const fold = !expanded && model.commits.length > 10;
  const items: ({ kind: "commit"; c: BisectCommit; i: number } | { kind: "gap"; n: number })[] = [];
  model.commits.forEach((c, i) => {
    if (!fold || keep.has(i)) items.push({ kind: "commit", c, i });
    else if (items.at(-1)?.kind === "gap") (items.at(-1) as { n: number }).n += 1;
    else items.push({ kind: "gap", n: 1 });
  });
  const inRange = model.commits.filter((c) => c.inRange).length;

  return (
    <div className="min-w-0">
      <Caption title={title}>
        {model.found ? (
          <span style={{ color: palette.tone.bad }}>First bad commit found</span>
        ) : (
          <>
            <span>
              {inRange} {inRange === 1 ? "commit" : "commits"} in range
            </span>
            {model.steps ? (
              <span>
                about {model.steps} {model.steps === 1 ? "step" : "steps"} left
              </span>
            ) : null}
          </>
        )}
      </Caption>

      {foundCommit ? (
        <div className="mb-3 flex min-w-0 items-start gap-2 rounded-lg px-3 py-2" style={{ background: tint(palette.tone.bad, 10) }}>
          <Glyph name="bug" size={15} color={palette.tone.bad} className="mt-0.5" />
          <div className="min-w-0">
            <div className="font-mono text-[12.5px] font-medium">{foundCommit.sha.slice(0, 10)}</div>
            {foundCommit.subject ? <div className="text-[13px] [text-wrap:pretty]">{foundCommit.subject}</div> : null}
          </div>
        </div>
      ) : model.suspect ? (
        <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-x-2 text-[12.5px]">
          <span className="text-muted-foreground">Testing now</span>
          <span className="font-mono font-medium">{model.suspect.slice(0, 10)}</span>
          <span className="min-w-0 truncate text-muted-foreground">{model.commits.find((c) => c.sha === model.suspect)?.subject}</span>
        </div>
      ) : null}

      <ol aria-label="Commits, newest first" className="relative">
        {items.map((it, k) => {
          if (it.kind === "gap")
            return (
              <li key={`g${k}`} className="flex items-center gap-3 py-1 pl-[3px]">
                <span className="w-[9px] border-l border-dashed border-border" style={{ height: 18, marginLeft: 4 }} aria-hidden />
                <button type="button" onClick={() => setExpanded(true)} className={cn("rounded text-[11.5px] text-muted-foreground hover:text-foreground", FOCUS)}>
                  {it.n} more {it.n === 1 ? "commit" : "commits"} outside the range
                </button>
              </li>
            );
          const { c, i } = it;
          const col = color(c);
          const prevIn = i > 0 && model.commits[i - 1].inRange;
          const nextIn = i < model.commits.length - 1 && model.commits[i + 1].inRange;
          return (
            <li key={c.sha} className={cn("relative flex min-w-0 items-center gap-3 py-1.5 pl-[3px] pr-2", c.inRange && "bg-[color-mix(in_oklab,var(--iris-accent)_7%,transparent)]", c.inRange && !prevIn && "rounded-t-lg", c.inRange && !nextIn && "rounded-b-lg")}>
              <span className="relative grid w-[17px] shrink-0 place-items-center self-stretch" aria-hidden>
                <span className={cn("absolute left-1/2 w-px -translate-x-1/2 bg-border", k === 0 ? "top-1/2" : "top-[-6px]", k === items.length - 1 ? "bottom-1/2" : "bottom-[-6px]")} />
                <span className={cn("relative size-[11px] rounded-full", !c.verdict && "bg-background")} style={c.verdict && c.verdict !== "skip" ? { background: col } : { boxShadow: `inset 0 0 0 2px ${col}`, background: "var(--background)" }} />
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums" style={c.current ? { color: palette.accent } : undefined}>
                {c.sha.slice(0, 7)}
              </span>
              <span className={cn("min-w-0 flex-1 truncate text-[12.5px]", !c.inRange && !c.verdict && "text-muted-foreground")} title={c.subject}>
                {c.subject ?? ""}
              </span>
              {c.current ? <Chip className="shrink-0" variant="outline" tone="info">Testing</Chip> : null}
              {c.sha === model.found ? <Chip className="shrink-0" tone="bad">First bad</Chip> : c.verdict ? <Chip className="shrink-0" tone={c.verdict === "good" ? "good" : c.verdict === "bad" ? "bad" : "warn"}>{c.verdict}</Chip> : null}
            </li>
          );
        })}
      </ol>
      <Problems items={model.problems} />
    </div>
  );
}
