// AccessibilityAudit (chunk "interact"): an axe-core or Lighthouse report as
// impact tiles, failing rules grouped by impact or WCAG criterion with their
// nodes, and the page screenshot with each failing node boxed and numbered
// (hovering a node lights its box and back). Reading lives in core/a11y.ts.

import { Chip, Glyph, InlineError, Shimmer, cn, num, sampleUrl, str, useEnv } from "@iris/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Audit, type AuditNode, type AuditRule, type Impact, IMPACTS, groupRules, readAudit } from "../core/a11y";
import { isPendingValue } from "../core/evaluate";
import type { ViewProps } from "../ui/render";
import { useFileUrl } from "./file-access";

type Tone = "bad" | "warn" | "neutral";
const IMPACT_TONE: Record<Impact, Tone> = { critical: "bad", serious: "bad", moderate: "warn", minor: "neutral" };
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

interface Numbered {
  rule: AuditRule;
  node: AuditNode;
  n: number;
}

export function AccessibilityAuditView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.report);
  const sig = pending ? "" : JSON.stringify(props.report ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const audit = useMemo(() => readAudit(pending ? {} : props.report), [sig]);
  const [by, setBy] = useState<"impact" | "wcag">(props.group === "wcag" ? "wcag" : "impact");
  const [only, setOnly] = useState<Impact | null>(null);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [hot, setHot] = useState<number | null>(null);
  const rowEls = useRef(new Map<number, HTMLElement>());

  // Every failing node gets a number shared by its list row and its box.
  const numbered = useMemo(() => {
    const out: Numbered[] = [];
    for (const rule of audit.rules) if (rule.kind === "violation") for (const node of rule.nodes) out.push({ rule, node, n: out.length + 1 });
    return out;
  }, [audit]);
  const numberOf = useMemo(() => new Map(numbered.map((x) => [x.node, x.n])), [numbered]);

  if (pending) return <Shimmer className="h-[260px] w-full" />;
  if (audit.problems.length && !audit.rules.length && !audit.passed) return <InlineError error={new Error(audit.problems[0])} context="<AccessibilityAudit>" />;

  const groups = groupRules(only ? audit.rules.filter((r) => r.impact === only) : audit.rules, by);
  const review = props.review === false ? [] : audit.rules.filter((r) => r.kind === "review");
  const toggle = (key: string) => setOpen((s) => (s.has(key) ? (s.delete(key), new Set(s)) : new Set(s).add(key)));
  const pickNode = (rule: AuditRule, node: AuditNode) => {
    if (props.onPick != null) env.run(props.onPick, [rule.id, node.target]);
    else env.perform([{ $iris: "action", kind: "copy", args: [node.target] }]);
  };
  const reveal = (n: number) => {
    const x = numbered[n - 1];
    if (!x) return;
    setOpen((s) => new Set(s).add(`${x.rule.kind}:${x.rule.id}`));
    setHot(n);
    requestAnimationFrame(() => rowEls.current.get(n)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  };
  const total = IMPACTS.reduce((s, i) => s + audit.counts[i].nodes, 0);
  const shotSrc = str(props.screenshot);
  const hasBoxes = numbered.some((x) => x.node.box);
  const title = str(props.title);

  return (
    <div className="min-w-0">
      {title ? <div className="mb-2 text-[13px] font-medium">{title}</div> : null}
      <Summary audit={audit} only={only} setOnly={setOnly} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span className="min-w-0 truncate">{[audit.engine, audit.url.replace(/^https?:\/\//, ""), when(audit.when)].filter(Boolean).join(" · ")}</span>
        <div className="inline-flex rounded-md bg-muted/70 p-0.5" role="tablist" aria-label="Group by">
          {(["impact", "wcag"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={by === v} onClick={() => setBy(v)} className={cn("rounded px-2 py-0.5", by === v ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "hover:text-foreground")}>
              {v === "impact" ? "Impact" : "WCAG"}
            </button>
          ))}
        </div>
      </div>
      <div className={cn("mt-2 grid min-w-0 gap-3", (shotSrc || audit.screenshot) && hasBoxes && "@container")}>
        <div className={cn("grid min-w-0 gap-3", (shotSrc || audit.screenshot) && hasBoxes && "@[44rem]:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]")}>
          {(shotSrc || audit.screenshot) && hasBoxes ? (
            <div className="min-w-0 @[44rem]:order-2">
              <div className="@[44rem]:sticky @[44rem]:top-2">
                <Screenshot src={shotSrc} inline={audit.screenshot} scale={num(props.scale) ?? 1} numbered={numbered} hot={hot} setHot={setHot} reveal={reveal} />
              </div>
            </div>
          ) : null}
          <div className="min-w-0 space-y-3">
            {!total ? (
              <div className="flex items-center gap-2 rounded-lg px-3 py-3 text-[13px]" style={{ background: `color-mix(in oklab, ${env.palette.tone.good} 12%, transparent)` }}>
                <Glyph name="circle-check" size={16} color={env.palette.tone.good} />
                No violations found{audit.passed ? `; ${audit.passed} rules passed` : ""}.
              </div>
            ) : null}
            {groups.map((g) => (
              <section key={g.key} className="min-w-0">
                <h4 className="mb-1 flex items-center gap-2 px-0.5 text-xs font-medium text-muted-foreground">
                  {by === "impact" ? <ImpactDot impact={g.key as Impact} /> : null}
                  {g.title}
                  <span className="tabular-nums">{g.rules.reduce((s, r) => s + r.nodes.length, 0)}</span>
                </h4>
                <ul className="overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--border)] [&>li+li]:border-t [&>li+li]:border-border/70">
                  {g.rules.map((rule) => (
                    <RuleRow
                      key={`${g.key}:${rule.id}`}
                      rule={rule}
                      open={open.has(`${rule.kind}:${rule.id}`)}
                      toggle={() => toggle(`${rule.kind}:${rule.id}`)}
                      numberOf={numberOf}
                      hot={hot}
                      setHot={setHot}
                      rowEls={rowEls.current}
                      onPick={pickNode}
                      showImpact={by === "wcag"}
                    />
                  ))}
                </ul>
              </section>
            ))}
            {review.length && !only ? (
              <section className="min-w-0">
                <h4 className="mb-1 flex items-center gap-2 px-0.5 text-xs font-medium text-muted-foreground">
                  <Glyph name="eye" size={13} />
                  Needs review
                  <span className="tabular-nums">{review.reduce((s, r) => s + r.nodes.length, 0)}</span>
                </h4>
                <ul className="overflow-hidden rounded-lg shadow-[0_0_0_1px_var(--border)] [&>li+li]:border-t [&>li+li]:border-border/70">
                  {review.map((rule) => (
                    <RuleRow key={rule.id} rule={rule} open={open.has(`review:${rule.id}`)} toggle={() => toggle(`review:${rule.id}`)} numberOf={numberOf} hot={hot} setHot={setHot} rowEls={rowEls.current} onPick={pickNode} showImpact />
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function ImpactDot({ impact }: { impact: Impact }) {
  const { palette } = useEnv();
  const color = IMPACT_TONE[impact] === "neutral" ? "var(--muted-foreground)" : palette.tone[IMPACT_TONE[impact]];
  // Critical is solid, serious a ring: both mean failure, one is worse.
  return impact === "serious" ? (
    <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ boxShadow: `inset 0 0 0 2.5px ${color}` }} />
  ) : (
    <span aria-hidden className={cn("inline-block shrink-0 rounded-full", impact === "critical" ? "size-2.5" : "size-2")} style={{ background: color }} />
  );
}

function Summary({ audit, only, setOnly }: { audit: Audit; only: Impact | null; setOnly: (i: Impact | null) => void }) {
  const { palette } = useEnv();
  return (
    <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
      {IMPACTS.map((i) => {
        const c = audit.counts[i];
        const active = only === i;
        return (
          <button
            key={i}
            type="button"
            aria-pressed={active}
            disabled={!c.nodes && !active}
            onClick={() => setOnly(active ? null : i)}
            className={cn("min-w-0 rounded-lg bg-muted/50 px-3 py-2 text-left transition-colors enabled:hover:bg-muted disabled:cursor-default", active && "bg-muted shadow-[0_0_0_1.5px_var(--ring)]")}
          >
            <div className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              <ImpactDot impact={i} />
              {cap(i)}
            </div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className={cn("text-xl font-semibold tabular-nums", !c.nodes && "text-muted-foreground/60")} style={c.nodes && IMPACT_TONE[i] !== "neutral" ? { color: palette.tone[IMPACT_TONE[i]] } : undefined}>
                {c.nodes}
              </span>
              <span className="truncate text-[11.5px] text-muted-foreground">{c.rules ? `${c.rules} rule${c.rules === 1 ? "" : "s"}` : "none"}</span>
            </div>
          </button>
        );
      })}
      <div className="col-span-full flex flex-wrap gap-1.5">
        {audit.score != null ? <Chip tone={audit.score >= 90 ? "good" : audit.score >= 50 ? "warn" : "bad"}>Score {audit.score}</Chip> : null}
        {audit.passed ? <Chip>{audit.passed} passed</Chip> : null}
        {audit.review ? <Chip>{audit.review} to review</Chip> : null}
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  open,
  toggle,
  numberOf,
  hot,
  setHot,
  rowEls,
  onPick,
  showImpact,
}: {
  rule: AuditRule;
  open: boolean;
  toggle: () => void;
  numberOf: Map<AuditNode, number>;
  hot: number | null;
  setHot: (n: number | null) => void;
  rowEls: Map<number, HTMLElement>;
  onPick: (rule: AuditRule, node: AuditNode) => void;
  showImpact: boolean;
}) {
  const env = useEnv();
  return (
    <li className="min-w-0 bg-card">
      <button type="button" aria-expanded={open} onClick={toggle} className="flex w-full min-w-0 items-start gap-2 px-3 py-2 text-left hover:bg-state-hover">
        <Glyph name="chevron-right" size={14} className={cn("mt-0.5 text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] leading-snug">{rule.title}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {showImpact ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <ImpactDot impact={rule.impact} />
                {cap(rule.impact)}
              </span>
            ) : null}
            <code className="rounded bg-muted px-1 font-mono text-[11px] text-muted-foreground">{rule.id}</code>
            {rule.wcag.map((sc) => (
              <span key={sc} className="text-[11px] text-muted-foreground">
                WCAG {sc}
                {rule.level ? ` ${rule.level}` : ""}
              </span>
            ))}
            {rule.bestPractice && !rule.wcag.length ? <span className="text-[11px] text-muted-foreground">Best practice</span> : null}
          </span>
        </span>
        <span className="shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
          {rule.nodes.length} {rule.nodes.length === 1 ? "node" : "nodes"}
        </span>
      </button>
      {open ? (
        <div className="min-w-0 space-y-2 px-3 pb-3 pl-8">
          {rule.description ? <p className="text-[12.5px] text-muted-foreground">{rule.description}</p> : null}
          <ol className="space-y-1.5">
            {rule.nodes.map((node, k) => {
              const n = numberOf.get(node);
              return (
                <li
                  key={k}
                  ref={(el) => void (n && (el ? rowEls.set(n, el) : rowEls.delete(n)))}
                  onPointerEnter={() => n && setHot(n)}
                  onPointerLeave={() => setHot(null)}
                  className={cn("min-w-0 rounded-md bg-muted/40 px-2.5 py-2 transition-shadow", n && hot === n && "shadow-[0_0_0_1.5px_var(--ring)]")}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {n ? <NodeNumber n={n} impact={node.impact} /> : null}
                    <button type="button" onClick={() => onPick(rule, node)} title="Copy selector" className="min-w-0 truncate font-mono text-[12px] text-foreground hover:underline">
                      {node.target || "(no selector)"}
                    </button>
                    {node.label ? <span className="min-w-0 truncate text-[11px] text-muted-foreground">{node.label}</span> : null}
                  </div>
                  {node.html ? <code className="mt-1 line-clamp-2 block break-all font-mono text-[11.5px] text-muted-foreground">{node.html}</code> : null}
                  {node.summary ? <FailureSummary text={node.summary} /> : null}
                </li>
              );
            })}
          </ol>
          {rule.helpUrl ? (
            <button
              type="button"
              onClick={() => env.perform([{ $iris: "action", kind: "openUrl", args: [rule.helpUrl] }])}
              className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline"
              style={{ color: env.palette.accent }}
            >
              How to fix {rule.id}
              <Glyph name="arrow-up-right" size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** axe's "Fix any of the following:" blocks as short headed lists. */
function FailureSummary({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.split("\n").map((l) => l.trim()).filter(Boolean));
  return (
    <div className="mt-1.5 space-y-1 text-[12px]">
      {blocks.map((lines, k) => {
        const head = /^fix (any|all|one)/i.test(lines[0] ?? "") ? lines[0].replace(/:$/, "") : null;
        const items = head ? lines.slice(1) : lines;
        return (
          <div key={k}>
            {head ? <div className="text-[11px] font-medium text-muted-foreground">{head}</div> : null}
            <ul className="space-y-0.5">
              {items.map((l, j) => (
                <li key={j} className="flex gap-1.5">
                  <span aria-hidden className="mt-[0.55em] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                  <span className="min-w-0">{l}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function NodeNumber({ n, impact }: { n: number; impact: Impact }) {
  const { palette } = useEnv();
  const t = IMPACT_TONE[impact];
  const color = t === "neutral" ? "var(--muted-foreground)" : palette.tone[t];
  return (
    <span className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1 text-[10.5px] font-semibold tabular-nums text-background" style={{ background: color }}>
      {n}
    </span>
  );
}

function Screenshot({
  src,
  inline,
  scale,
  numbered,
  hot,
  setHot,
  reveal,
}: {
  src: string | undefined;
  inline: Audit["screenshot"];
  scale: number;
  numbered: Numbered[];
  hot: number | null;
  setHot: (n: number | null) => void;
  reveal: (n: number) => void;
}) {
  const { palette } = useEnv();
  const [file] = useFileUrl(src);
  const url = !src && inline ? inline.src : file.status === "ok" ? file.url : file.status === "sample" ? sampleUrl("a11y-page") : null;
  const [size, setSize] = useState<{ w: number; h: number } | null>(inline && !src ? { w: inline.width, h: inline.height } : null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const img = new Image();
    img.onload = () => live && setSize((s) => (inline && !src ? s : { w: img.naturalWidth / Math.max(0.25, scale), h: img.naturalHeight / Math.max(0.25, scale) }));
    img.src = url;
    return () => {
      live = false;
    };
  }, [url, scale, inline, src]);
  if (src && file.status === "error") return <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">The screenshot could not load: {file.error}</div>;
  if (!url || !size) return <Shimmer className="aspect-[4/3] w-full" />;
  const area = size.w * size.h;
  return (
    <figure className="min-w-0">
      <div className="relative max-h-[560px] overflow-y-auto rounded-lg shadow-[0_0_0_1px_var(--border)]">
        <div className="relative">
          <img src={url} alt="The audited page" className="block h-auto w-full" draggable={false} />
          <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" className="absolute inset-0 size-full">
            {numbered.map(({ node, n }) => {
              const b = node.box;
              if (!b) return null;
              const big = b.w * b.h > area * 0.45;
              const on = hot === n;
              // A box that covers most of the page (like <html>) only shows while it's in focus.
              if (big && !on) return null;
              const t = IMPACT_TONE[node.impact];
              const color = t === "neutral" ? "var(--muted-foreground)" : palette.tone[t];
              const w = Math.max(6, b.w);
              const h = Math.max(6, b.h);
              const x = b.w < 6 ? b.x - (6 - b.w) / 2 : b.x;
              return (
                <g key={n} className="cursor-pointer" onPointerEnter={() => setHot(n)} onPointerLeave={() => setHot(null)} onClick={() => reveal(n)}>
                  <rect x={x} y={b.y} width={w} height={h} rx={3} fill={color} fillOpacity={on ? 0.22 : 0.1} stroke={color} strokeWidth={on ? 2.5 : 1.5} vectorEffect="non-scaling-stroke" strokeDasharray={big ? "6 4" : undefined} />
                </g>
              );
            })}
          </svg>
          {numbered.map(({ node, n }) => {
            const b = node.box;
            if (!b || (b.w * b.h > area * 0.45 && hot !== n)) return null;
            return (
              <button
                key={n}
                type="button"
                aria-label={`Issue ${n}: ${node.target}`}
                onClick={() => reveal(n)}
                onPointerEnter={() => setHot(n)}
                onPointerLeave={() => setHot(null)}
                className={cn("absolute -translate-x-2/3 -translate-y-1/2 transition-transform", hot === n && "z-10 scale-110")}
                // Top-right corner: page text usually starts at the left.
                style={{ left: `${Math.max(3, Math.min(98, ((b.x + Math.max(6, b.w)) / size.w) * 100))}%`, top: `${Math.max(2, (b.y / size.h) * 100)}%` }}
              >
                <NodeNumber n={n} impact={node.impact} />
              </button>
            );
          })}
        </div>
      </div>
      {!src && !inline ? null : file.status === "sample" ? <figcaption className="mt-1 text-[11px] text-muted-foreground">Sample page (no thread files here)</figcaption> : null}
    </figure>
  );
}
