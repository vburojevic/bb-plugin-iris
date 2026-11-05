// Redline (chunk "codework"): a word-level redline of prose. Each change is a
// focusable mark; the bar below reviews one change at a time (arrows move, A
// accepts, R rejects). Decisions are saved with the card; the result goes to
// the composer, or to onApply.

import { Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { isPendingValue } from "../core/evaluate";
import { applyDecisions, changeCount, readDecisions, redline, redlineProblems, type Decision } from "../core/redline";
import type { ViewProps } from "../ui/render";
import { FOCUS_BOX, Header, ICON_BTN, PRIMARY, Problems, SECONDARY, ownKey, tint, useMemory } from "./codework-kit";

export function RedlineView({ props, node }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const pending = isPendingValue(props.before) || isPendingValue(props.after);
  const before = typeof props.before === "string" ? props.before : "";
  const after = typeof props.after === "string" ? props.after : "";
  const segments = useMemo(() => (pending ? [] : redline(before, after)), [pending, before, after]);
  const count = changeCount(segments);
  const [saved, setSaved] = useMemory<Record<number, Decision>>(node, "decisions", [before, after]);
  const decisions = readDecisions(saved, count);
  const [selected, setSelected] = useState<number | null>(null);
  const marks = useRef<Map<number, HTMLButtonElement>>(new Map());
  if (pending) return <Shimmer className="h-28" />;
  const problems = redlineProblems(props.before, props.after);
  if (problems.length) return <Problems list={problems} what="<Redline>" />;

  const accepted = Object.values(decisions).filter((d) => d === "accept").length;
  const rejected = Object.values(decisions).filter((d) => d === "reject").length;
  const open = count - accepted - rejected;
  const result = applyDecisions(segments, decisions);
  const cur = selected != null && selected < count ? selected : null;

  const focusMark = (id: number) => {
    setSelected(id);
    marks.current.get(id)?.focus({ preventScroll: false });
  };
  const decide = (id: number, d: Decision | null) => {
    const next: Record<number, Decision> = { ...decisions };
    if (d) next[id] = d;
    else delete next[id];
    setSaved(next);
    // Move on to the next undecided change.
    if (d) {
      const after = [...Array(count).keys()].find((k) => k > id && !next[k]) ?? [...Array(count).keys()].find((k) => !next[k]);
      if (after != null) focusMark(after);
      else setSelected(id);
    }
  };
  const all = (d: Decision | null) => setSaved(d ? Object.fromEntries([...Array(count).keys()].map((k) => [k, d])) : {});
  const apply = () => {
    if (props.onApply != null) env.run(props.onApply, [result]);
    else env.perform([{ $iris: "action", kind: "insert", args: [result] }]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (cur == null) return;
    const k = e.key.toLowerCase();
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (k === "a" || k === "r") {
      e.preventDefault();
      decide(cur, k === "a" ? "accept" : "reject");
    } else if (k === "u") {
      e.preventDefault();
      decide(cur, null);
    } else if (ownKey(e, ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"])) {
      e.preventDefault();
      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1;
      focusMark((cur + step + count) % count);
    }
  };

  // Insertions and deletions in bb's own diff colors, as <Diff> draws them.
  const good = `var(--diff-added, ${palette.tone.good})`;
  const bad = `var(--diff-removed, ${palette.tone.bad})`;
  const title = str(props.title);
  const summary = count === 0 ? "No changes" : `${count} change${count === 1 ? "" : "s"}`;
  const tally = (
    <div className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums text-muted-foreground">
      <span>{summary}</span>
      {accepted ? <span style={{ color: good }}>{accepted} accepted</span> : null}
      {rejected ? <span style={{ color: bad }}>{rejected} rejected</span> : null}
    </div>
  );

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", FOCUS_BOX)} onKeyDown={onKey}>
      {title ? <Header title={title} right={tally} /> : null}
      <div className="min-w-0 whitespace-pre-wrap break-words rounded-[10px] bg-muted/25 px-3.5 py-3 text-[14px] leading-[1.75] ring-1 ring-border" role="document" aria-label={title ?? "Redline"}>
        {segments.map((s, k) => {
          if (s.kind === "same") return <span key={k}>{s.text}</span>;
          const d = decisions[s.id];
          const sel = cur === s.id;
          const label = `Change ${s.id + 1} of ${count}${s.del.trim() ? `: remove "${s.del.trim()}"` : ""}${s.ins.trim() ? `${s.del.trim() ? "," : ":"} add "${s.ins.trim()}"` : ""}${d ? `, ${d}ed` : ""}`;
          return (
            <button
              key={k}
              type="button"
              ref={(el) => {
                if (el) marks.current.set(s.id, el);
                else marks.current.delete(s.id);
              }}
              onClick={() => setSelected(s.id)}
              onFocus={() => setSelected(s.id)}
              aria-label={label}
              aria-pressed={sel}
              className={cn("inline rounded-[4px] text-left outline-none transition-shadow [box-decoration-break:clone]", sel && "ring-2 ring-[color-mix(in_oklab,var(--iris-accent)_60%,transparent)] ring-offset-1 ring-offset-transparent")}
            >
              {s.del && d !== "accept" ? (
                <del
                  className={cn("rounded-[3px] px-px [box-decoration-break:clone]", d === "reject" ? "no-underline" : "line-through decoration-[1.5px]")}
                  style={d === "reject" ? { textDecoration: "none", boxShadow: `inset 0 -1.5px 0 ${tint(bad, 55)}` } : { color: bad, background: tint(bad, 12), textDecorationColor: bad }}
                >
                  {s.del}
                </del>
              ) : null}
              {s.ins && d !== "reject" ? (
                <ins
                  className="rounded-[3px] px-px no-underline [box-decoration-break:clone]"
                  style={d === "accept" ? { textDecoration: "none", boxShadow: `inset 0 -1.5px 0 ${tint(good, 55)}` } : { color: good, background: tint(good, 13), textDecoration: "underline", textDecorationColor: tint(good, 60), textUnderlineOffset: 3 }}
                >
                  {s.ins}
                </ins>
              ) : null}
            </button>
          );
        })}
      </div>
      {count ? (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {cur != null ? (
            <div className="flex min-w-0 items-center gap-1.5 rounded-full py-0.5 pl-1 pr-1 ring-1 ring-border" role="toolbar" aria-label={`Change ${cur + 1}`}>
              <button type="button" className={cn(ICON_BTN, "size-7 ring-0")} onClick={() => focusMark((cur - 1 + count) % count)} aria-label="Previous change">
                <Glyph name="chevron-left" size={14} />
              </button>
              <span className="px-1 text-[12px] tabular-nums text-muted-foreground">
                {cur + 1} of {count}
              </span>
              <button type="button" className={cn(ICON_BTN, "size-7 ring-0")} onClick={() => focusMark((cur + 1) % count)} aria-label="Next change">
                <Glyph name="chevron-right" size={14} />
              </button>
              <button
                type="button"
                className={cn(SECONDARY, "h-7 px-2.5 text-[12px] ring-0")}
                style={decisions[cur] === "accept" ? { background: tint(good, 16), color: good } : undefined}
                onClick={() => decide(cur, decisions[cur] === "accept" ? null : "accept")}
                aria-pressed={decisions[cur] === "accept"}
                title="Accept (A)"
              >
                <Glyph name="check" size={13} />
                Accept
              </button>
              <button
                type="button"
                className={cn(SECONDARY, "h-7 px-2.5 text-[12px] ring-0")}
                style={decisions[cur] === "reject" ? { background: tint(bad, 16), color: bad } : undefined}
                onClick={() => decide(cur, decisions[cur] === "reject" ? null : "reject")}
                aria-pressed={decisions[cur] === "reject"}
                title="Reject (R)"
              >
                <Glyph name="x" size={13} />
                Reject
              </button>
            </div>
          ) : (
            <button type="button" className={SECONDARY} onClick={() => focusMark([...Array(count).keys()].find((k) => !decisions[k]) ?? 0)}>
              <Glyph name="list-checks" size={14} />
              Review changes
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className={cn(SECONDARY, "h-7 px-2.5 text-[12px]")} onClick={() => all("accept")} disabled={accepted === count}>
            Accept all
          </button>
          <button type="button" className={cn(SECONDARY, "h-7 px-2.5 text-[12px]")} onClick={() => all("reject")} disabled={rejected === count}>
            Reject all
          </button>
          {accepted + rejected ? (
            <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => all(null)} aria-label="Clear decisions" title="Clear decisions">
              <Glyph name="rotate-ccw" size={13} />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-border pt-3">
        <button type="button" className={PRIMARY} onClick={apply} disabled={env.streaming}>
          <Glyph name={props.onApply != null ? "check" : "text-cursor-input"} size={14} />
          {props.onApply != null ? "Apply result" : "Insert result"}
        </button>
        <button type="button" className={SECONDARY} onClick={() => env.perform([{ $iris: "action", kind: "copy", args: [result] }])}>
          <Glyph name="copy" size={14} />
          Copy
        </button>
        {open && count ? <span className="text-[12px] text-muted-foreground">{open === count ? "Undecided changes count as accepted" : `${open} undecided, counted as accepted`}</span> : null}
        {title ? null : <div className="ml-auto">{tally}</div>}
      </div>
    </div>
  );
}
