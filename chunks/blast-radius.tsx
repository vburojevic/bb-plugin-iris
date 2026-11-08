// BlastRadius (chunk "debug"): each changed file as the root of a tree of the
// files that import it, nearest first, tests marked with a flask; a summary of
// files and tests reached; the tests to run with a copy button. Clicking a
// file opens it. Logic lives in core/blast.ts.

import { Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useState } from "react";
import { type BlastModel, type BlastNode, blastNodes, blastRadius } from "../core/blast";
import { isPendingValue } from "../core/evaluate";
import type { ViewProps } from "../ui/render";
import { Caption, Chevron, FOCUS, Nothing, Problems, Stat } from "./agents-kit";

export function BlastRadiusView({ props }: ViewProps) {
  const pending = [props.changed, props.imports, props.tests].some(isPendingValue);
  const model = useMemo(() => (pending ? null : blastRadius({ changed: props.changed, imports: props.imports, tests: props.tests, depth: props.depth })), [pending, props.changed, props.imports, props.tests, props.depth]);
  if (!model) return <Shimmer className="h-40" />;
  return <Blast model={model} title={str(props.title)} depth={typeof props.depth === "number" ? props.depth : 3} />;
}

function Blast({ model, title, depth }: { model: BlastModel; title?: string; depth: number }) {
  const env = useEnv();
  const nodes = useMemo(() => blastNodes(model.roots), [model]);
  // Small trees open whole; bigger ones open two levels.
  const [closed, setClosed] = useState<Set<string>>(() => new Set(nodes.length <= 25 ? [] : nodes.filter((n) => n.distance >= 2 && n.children.length).map((n) => n.path)));
  if (!model.roots.length)
    return (
      <div>
        <Caption title={title} />
        <Nothing>No changed files</Nothing>
        <Problems items={model.problems} />
      </div>
    );
  const tests = [...model.tests, ...model.covered];
  const open = (p: string) => env.perform([{ $iris: "action", kind: "openFile", args: [p, null] }]);
  const toggle = (p: string) => {
    const next = new Set(closed);
    if (next.has(p)) next.delete(p);
    else next.add(p);
    setClosed(next);
  };
  const rows: { n: BlastNode; last: boolean[] }[] = [];
  const walk = (n: BlastNode, last: boolean[]) => {
    rows.push({ n, last });
    if (!closed.has(n.path)) n.children.forEach((c, k) => walk(c, [...last, k === n.children.length - 1]));
  };
  model.roots.forEach((r) => walk(r, []));

  return (
    <div className="min-w-0">
      <Caption title={title}>{model.truncated ? <span>More importers past {depth} levels</span> : null}</Caption>
      <div className="mb-3 grid grid-cols-3 gap-4">
        <Stat label="Changed" value={model.roots.length} />
        <Stat label="Files reached" value={model.affected} />
        <Stat label="Tests" value={tests.length} tone={tests.length ? undefined : env.palette.tone.warn} sub={tests.length ? undefined : "none reach it"} />
      </div>
      <ul role="tree" aria-label="Files that import the change" className="min-w-0">
        {rows.map(({ n, last }) => {
          const slash = n.path.lastIndexOf("/");
          const dir = slash >= 0 ? n.path.slice(0, slash + 1) : "";
          const base = n.path.slice(slash + 1);
          const isOpen = !closed.has(n.path);
          return (
            <li key={`${n.path}:${n.distance}`} role="treeitem" aria-level={n.distance + 1} aria-expanded={n.children.length ? isOpen : undefined} className={cn("flex min-w-0 items-center gap-1 py-[3px] text-[12.5px]", n.changed && rows[0].n !== n && "mt-2")}>
              {last.map((isLast, k) => (
                <span key={k} className="relative w-4 shrink-0 self-stretch" aria-hidden>
                  {k < last.length - 1 ? !isLast && <span className="absolute inset-y-[-3px] left-[7px] w-px bg-border" /> : <span className={cn("absolute left-[7px] top-[-3px] w-px bg-border", isLast ? "h-[calc(50%+3px)]" : "bottom-[-3px]")} />}
                  {k === last.length - 1 ? <span className="absolute left-[7px] top-1/2 h-px w-[8px] bg-border" /> : null}
                </span>
              ))}
              {n.children.length ? (
                <button type="button" onClick={() => toggle(n.path)} aria-label={isOpen ? "Fold" : "Open"} className={cn("grid size-4 shrink-0 place-items-center rounded hover:bg-state-hover", FOCUS)}>
                  <Chevron open={isOpen} />
                </button>
              ) : (
                <span className="w-4 shrink-0" />
              )}
              <Glyph name={n.changed ? "file-pen-line" : n.test ? "flask-conical" : "file-code"} size={13} color={n.changed ? env.palette.accent : n.test ? env.palette.tone.good : "var(--muted-foreground)"} />
              <button type="button" onClick={() => open(n.path)} className={cn("min-w-0 truncate rounded text-left hover:underline", FOCUS)} title={n.path}>
                <span className="text-muted-foreground">{dir}</span>
                <span className={cn(n.changed && "font-medium")}>{base}</span>
              </button>
              {n.changed ? <span className="shrink-0 text-[11px] text-muted-foreground">changed</span> : null}
              {!isOpen && n.children.length ? <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">+{blastNodes([n]).length - 1}</span> : null}
            </li>
          );
        })}
      </ul>
      {tests.length ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
            <span>Tests to run</span>
            <button type="button" onClick={() => env.perform([{ $iris: "action", kind: "copy", args: [tests.join(" ")] }])} className={cn("inline-flex items-center gap-1 rounded px-1 hover:text-foreground", FOCUS)}>
              <Glyph name="copy" size={12} />
              Copy paths
            </button>
          </div>
          <ul className="space-y-0.5">
            {tests.map((t) => (
              <li key={t} className="flex min-w-0 items-center gap-1.5 text-[12px]">
                <Glyph name="flask-conical" size={12} color={env.palette.tone.good} />
                <button type="button" onClick={() => open(t)} className={cn("min-w-0 truncate rounded font-mono text-[11.5px] hover:underline", FOCUS)}>
                  {t}
                </button>
                {model.covered.includes(t) ? <span className="shrink-0 text-[11px] text-muted-foreground">covers it</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Problems items={model.problems} />
    </div>
  );
}
