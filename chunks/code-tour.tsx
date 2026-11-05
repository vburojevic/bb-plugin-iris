// CodeTour (chunk "codework"): a guided walk across real files. Each step reads
// its file through the card's load() path (the thread's workspace only),
// highlights its lines in bb's own source viewer and shows a markdown note.

import { experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import { Chip, Glyph, Prose, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { isPendingValue } from "../core/evaluate";
import { normalizeTour, type TourStep } from "../core/tour";
import type { ViewProps } from "../ui/render";
import { FOCUS_BOX, Header, ICON_BTN, Problems, SECONDARY, ownKey, readFile, useMemory } from "./codework-kit";

/** The gallery has no thread to read files from; it walks this stand-in. */
const SAMPLE = `// Sample file: in a thread, the tour reads the real one.
import { tokenize } from "./tokens";
import type { ElementNode, Program } from "./ast";

export interface ParseOptions {
  /** Streaming input may end mid-tag. */
  partial?: boolean;
}

export function parse(source: string, options: ParseOptions = {}): Program {
  const tokens = tokenize(source);
  const nodes: ElementNode[] = [];
  let at = 0;
  while (at < tokens.length) {
    const t = tokens[at];
    if (t.kind === "open") {
      const node = element(tokens, at);
      nodes.push(node.value);
      at = node.next;
    } else at++;
  }
  return { nodes, partial: options.partial === true };
}

export function evaluate(node: ElementNode, scope: Scope): unknown {
  const props: Record<string, unknown> = {};
  for (const attr of node.attrs) {
    // Attributes run in Iris's own interpreter: no eval, no globals.
    props[attr.name] = attr.value === null ? true : interpret(attr.value, scope);
  }
  if (node.children.length) {
    props.children = node.children.map((c) => evaluate(c, scope));
  }
  return { type: node.name, props };
}

export function render(value: unknown): ReactNode {
  if (value == null || value === false) return null;
  if (Array.isArray(value)) return value.map(render);
  const { type, props } = value as Rendered;
  const View = VIEWS[type];
  if (!View) return <InlineError error={new Error(\`Unknown <\${type}>\`)} />;
  return <View props={props} />;
}
`;

const where = (s: TourStep) => (s.start ? `${s.file}:${s.start}${s.end && s.end !== s.start ? `-${s.end}` : ""}` : s.file);

export function CodeTourView({ props, node }: ViewProps) {
  const env = useEnv();
  const sample = !env.threadId;
  const pending = isPendingValue(props.steps);
  const { items, problems } = pending ? { items: [], problems: [] } : normalizeTour(props.steps);
  const [saved, setSaved] = useMemory<number>(node, "step", props.steps);
  const first = Math.max(0, Math.min(items.length - 1, (num(props.start) ?? 1) - 1));
  const at = saved != null && saved >= 0 && saved < items.length ? saved : first;
  const step = items[at] as TourStep | undefined;
  const height = Math.max(120, Math.min(900, num(props.height) ?? 280));
  const title = str(props.title);
  const list = useRef<HTMLDivElement | null>(null);

  // Keep the active step in view in the step list.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-step="${at}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [at]);
  // Read the next step's file ahead, so moving on is instant.
  const next = items[at + 1];
  useEffect(() => {
    if (!sample && next) readFile(env, next.file, { raw: true });
  }, [sample, next?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  if (pending) return <Shimmer className="h-48" />;
  if (!step) return <Problems list={problems.length ? problems : ["has no steps"]} what="<CodeTour>" />;

  const go = (k: number) => setSaved(Math.max(0, Math.min(items.length - 1, k)));
  const onKey = (e: KeyboardEvent) => {
    if (!ownKey(e, ["ArrowLeft", "ArrowRight", "Home", "End"])) return;
    e.preventDefault();
    go(e.key === "ArrowLeft" ? at - 1 : e.key === "ArrowRight" ? at + 1 : e.key === "Home" ? 0 : items.length - 1);
  };
  const open = () => env.perform([{ $iris: "action", kind: "openFile", args: [step.file, step.start ?? null] }]);
  const file = sample ? ({ status: "ok", value: SAMPLE } as const) : readFile(env, step.file, { raw: true });

  return (
    <div className={cn("@container flex min-w-0 flex-col gap-3", FOCUS_BOX)} tabIndex={0} onKeyDown={onKey} aria-label={title ?? "Code tour"} role="group" aria-roledescription="code tour">
      <Problems list={problems} what="<CodeTour>" />
      <Header
        title={title}
        right={
          <div className="flex items-center gap-2 text-[12px] tabular-nums text-muted-foreground">
            {sample ? <Chip tone="neutral">Sample file</Chip> : null}
            <span aria-live="polite">
              Step {at + 1} of {items.length}
            </span>
            <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => go(at - 1)} disabled={at === 0} aria-label="Previous step">
              <Glyph name="chevron-left" size={14} />
            </button>
            <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => go(at + 1)} disabled={at === items.length - 1} aria-label="Next step">
              <Glyph name="chevron-right" size={14} />
            </button>
          </div>
        }
      />
      <div className="grid min-w-0 gap-3 @[620px]:grid-cols-[minmax(170px,210px)_minmax(0,1fr)]">
        <div ref={list} role="tablist" aria-label="Steps" className="iris-scroll-x flex min-w-0 gap-1.5 overflow-x-auto @[620px]:max-h-[420px] @[620px]:flex-col @[620px]:overflow-y-auto @[620px]:overflow-x-visible">
          {items.map((s, k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={k === at}
              data-step={k}
              onClick={() => go(k)}
              className={cn(
                "flex min-w-0 shrink-0 items-start gap-2 rounded-[9px] px-2.5 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--iris-accent)] @[620px]:w-full",
                k === at ? "bg-[color-mix(in_oklab,var(--iris-accent)_13%,transparent)]" : "hover:bg-state-hover",
              )}
            >
              <span
                className={cn("mt-px grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums", k === at ? "text-background" : "bg-muted text-muted-foreground")}
                style={k === at ? { background: "var(--iris-accent)" } : undefined}
              >
                {k + 1}
              </span>
              <span className="min-w-0 max-w-[180px] @[620px]:max-w-none">
                <span className={cn("block truncate text-[13px]", k === at ? "font-semibold" : "font-medium")}>{s.title}</span>
                <span className="block truncate font-mono text-[11px] text-muted-foreground">{where(s)}</span>
              </span>
            </button>
          ))}
        </div>
        <div key={at} className="iris-step-in flex min-w-0 flex-col gap-2.5">
          {step.note ? <Prose text={step.note} className="text-[13.5px]" /> : null}
          <div className="min-w-0 overflow-hidden rounded-[10px] bg-muted/30 ring-1 ring-border">
            <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
              <button type="button" onClick={open} className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-foreground hover:underline" title={where(step)}>
                {where(step)}
              </button>
              <button type="button" onClick={open} className={cn(SECONDARY, "h-7 px-2.5 text-[12px]")}>
                <Glyph name="square-arrow-out-up-right" size={13} />
                Open in editor
              </button>
            </div>
            <div className="min-w-0 overflow-auto text-[12.5px]" style={{ height }}>
              {file.status === "loading" ? (
                <Shimmer className="m-3 h-24" />
              ) : file.status === "ok" ? (
                <SourceCode content={String(file.value ?? "")} path={step.file} overflow="scroll" highlightedLines={step.start ? { start: step.start, end: step.end ?? step.start } : null} />
              ) : (
                <div className="flex items-start gap-2 px-3 py-2.5 text-[12.5px] text-muted-foreground">
                  <Glyph name="file-x" size={14} className="mt-0.5 text-destructive" />
                  <span className="min-w-0">
                    <span className="font-mono text-foreground">{step.file}</span>: {file.status === "missing" ? "file not found in this thread's workspace" : file.error}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
