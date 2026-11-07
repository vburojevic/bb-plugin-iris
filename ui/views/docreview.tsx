// DocReview: read a spec or plan, comment on any block, then approve it or ask for changes.
// The state is {verdict, comments: [{block, quote, note}]}, so the agent knows what to change where.

import { useEffect, useRef, useState } from "react";
import { type DocComment, type DocReviewState, type DocVerdict, anchorComments, blockQuote, docBlocks, normalizeReview } from "../../core/docreview";
import { isPendingValue } from "../../core/evaluate";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { useBound } from "./inputs";
import { Glyph, Shimmer, cn, str } from "./kit";
import { Prose } from "./prose";

export function DocReviewView({ props, text }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.text);
  const source = (pending ? "" : str(props.text)) ?? text ?? "";
  const blocks = docBlocks(source);
  const [bound, setBound, name] = useBound(props);
  const [local, setLocal] = useState<unknown>({});
  const review = normalizeReview(name ? bound : local);
  const write = (next: DocReviewState) => (name ? setBound(next) : setLocal(next));
  const [editing, setEditing] = useState<number | null>(null);
  const areas = useRef(new Map<number, HTMLTextAreaElement | null>());

  useEffect(() => {
    if (editing != null) areas.current.get(editing)?.focus({ preventScroll: true });
  }, [editing]);

  if (pending) return <Shimmer className="h-40 w-full" />;
  if (!blocks.length) return <div className="text-xs text-muted-foreground">DocReview has no text</div>;

  // Comments find their block again by quote, so edits to the text between rounds don't move them.
  const { at, orphans } = anchorComments(blocks, review.comments);
  // The state only ever holds comments with words in them: an open, empty editor lives here alone.
  const setComment = (b: number, note: string) => {
    const old = at.get(b);
    const rest = review.comments.filter((c) => c !== old);
    const next: DocComment[] = note.trim() ? [...rest, { block: b, quote: blockQuote(blocks[b - 1]), note }] : rest;
    write({ ...review, comments: next.sort((x, y) => x.block - y.block) });
  };
  const drop = (c: DocComment) => {
    write({ ...review, comments: review.comments.filter((x) => x !== c) });
    setEditing(null);
  };
  const setVerdict = (v: DocVerdict) => write({ ...review, verdict: review.verdict === v ? null : v });
  const count = review.comments.length;
  const accent = env.palette.accent;

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{str(props.title)}</span>
        <span className="shrink-0 tabular-nums">{count ? `${count} ${count === 1 ? "comment" : "comments"}` : "Comment on any part"}</span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        {blocks.map((block, k) => {
          const b = k + 1;
          const c = at.get(b);
          const open = editing === b || Boolean(c);
          return (
            <section key={k} className={cn("group/block relative -mx-2 rounded-lg py-1 pl-3 pr-10 transition-colors", open ? "bg-state-hover/60" : "hover:bg-state-hover/40")}>
              {/* A commented block carries a rail in the theme's accent, so they're easy to find again. */}
              {open ? <span className="absolute inset-y-1.5 left-0.5 w-[3px] rounded-full" style={{ background: accent }} aria-hidden /> : null}
              <Prose text={block} />
              <button
                type="button"
                // Opening one editor closes an empty one elsewhere; pressing it again on an empty editor closes it.
                onClick={() => setEditing(editing === b && !c ? null : b)}
                aria-label={`Comment on block ${b}: ${blockQuote(block, 40)}`}
                className={cn(
                  "iris-hit absolute right-1 top-1 grid size-7 place-items-center rounded-md text-muted-foreground transition-opacity hover:bg-state-hover hover:text-foreground focus-visible:opacity-100",
                  open ? "opacity-100" : "opacity-0 group-hover/block:opacity-100 [@media(pointer:coarse)]:opacity-60",
                )}
              >
                <Glyph name="message-square-plus" size={15} />
              </button>
              {open ? (
                <div className="mt-1.5 flex items-start gap-2">
                  <textarea
                    ref={(el) => {
                      areas.current.set(b, el);
                    }}
                    rows={2}
                    value={c?.note ?? ""}
                    onChange={(e) => setComment(b, e.target.value)}
                    onFocus={() => setEditing(b)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape" && !c) {
                        e.stopPropagation();
                        setEditing(null);
                      }
                    }}
                    placeholder="What should change here?"
                    aria-label={`Comment on block ${b}`}
                    className="iris-field min-h-14 min-w-0 flex-1 resize-y rounded-lg bg-card px-2.5 py-1.5 text-[13px] ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-foreground/40"
                  />
                  <button type="button" onClick={() => (c ? drop(c) : setEditing(null))} aria-label={`Delete comment on block ${b}`} className="iris-hit grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-state-hover hover:text-foreground">
                    <Glyph name="trash-2" size={14} />
                  </button>
                </div>
              ) : null}
            </section>
          );
        })}
      </div>
      {orphans.length ? (
        <div className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
          <div className="mb-1 text-muted-foreground">Comments on text that has since changed</div>
          {orphans.map((c, k) => (
            <div key={k} className="flex items-start gap-2 py-1">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-muted-foreground">“{c.quote}”</span>
                <span className="block text-[13px]">{c.note}</span>
              </span>
              <button type="button" onClick={() => drop(c)} aria-label={`Delete comment on “${c.quote}”`} className="iris-hit grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground">
                <Glyph name="trash-2" size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div role="radiogroup" aria-label="Verdict" className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <VerdictButton on={review.verdict === "approve"} tone={env.palette.tone.good} icon="check" label="Approve" onClick={() => setVerdict("approve")} />
        <VerdictButton on={review.verdict === "changes"} tone={env.palette.tone.warn} icon="pencil" label={count ? `Request changes (${count})` : "Request changes"} onClick={() => setVerdict("changes")} />
      </div>
    </div>
  );
}

function VerdictButton({ on, tone, icon, label, onClick }: { on: boolean; tone: string; icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={cn("iris-hit inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] transition-colors", on ? "font-medium" : "text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground")}
      style={on ? { background: `color-mix(in oklab, ${tone} 16%, transparent)`, color: tone, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tone} 45%, transparent)` } : undefined}
    >
      <Glyph name={icon} size={14} />
      {label}
    </button>
  );
}
