// Learning views (chunk "play"): Quiz, Flashcards, Walkthrough and Timer.
// Rules live in core/learn.ts. Iris's own pieces come from "@iris/ui", the
// main bundle's instances, so these render inside the card's context.
// Progress is kept in the card's saved state under "@" keys, so a half-done
// quiz or a running timer survives scrolling, reloads and devices.

import { experimental_SourceCode as SourceCode } from "@get-bb/plugin-sdk/app";
import { Chip, Glyph, InlineError, Prose, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ElementNode } from "../core/ast";
import { isPendingValue } from "../core/evaluate";
import {
  type DeckProgress,
  type QuizProgress,
  type TimerState,
  TIMER_IDLE,
  deckReviewLearning,
  deckShuffle,
  deckSort,
  deckStart,
  formatClock,
  normalizeCards,
  normalizeQuiz,
  normalizeSteps,
  parseDuration,
  quizDone,
  quizRetryMissed,
  quizScore,
  quizStart,
  seeded,
  timerElapsed,
  timerLap,
  timerToggle,
} from "../core/learn";
import type { ViewProps } from "../ui/render";

/**
 * A component's own progress, saved with the card. null until first set.
 * Elements from one .map() share a node, so the key also carries a short hash
 * of the props that tell instances apart (each mapped Timer keeps its own clock).
 */
function useMemory<T>(node: ElementNode, name: string, identity: unknown): [T | null, (v: T | null) => void] {
  const env = useEnv();
  const key = `@${node.name}:${node.start}:${name}:${hash(identity)}`;
  const value = (env.runtime.state.get(key) as T | undefined) ?? null;
  const set = useCallback((v: T | null) => env.runtime.setState(key, v), [env.runtime, key]);
  return [value, set];
}

function hash(v: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(v) ?? "";
  } catch {
    s = "";
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

const BTN = "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-[opacity,background-color] disabled:pointer-events-none disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]";
const PRIMARY = `${BTN} bg-foreground text-background hover:opacity-90`;
const SECONDARY = `${BTN} ring-1 ring-border hover:bg-state-hover`;
const ICON_BTN = "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)] disabled:opacity-45";
const FOCUS_BOX = "outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--iris-accent)_45%,transparent)] rounded-[10px]";
const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;

function Problems({ list, what }: { list: string[]; what: string }) {
  if (!list.length) return null;
  return <InlineError error={new Error(`${list[0]}${list.length > 1 ? ` (and ${list.length - 1} more)` : ""}`)} context={what} />;
}

function Header({ title, right }: { title?: string; right?: ReactNode }) {
  if (!title && !right) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {title ? <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title}</div> : <div className="flex-1" />}
      {right}
    </div>
  );
}

function Dots({ count, at, tones }: { count: number; at: number; tones?: (string | undefined)[] }) {
  if (count > 24) {
    return (
      <div className="h-1 w-20 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="iris-bar h-full rounded-full bg-[var(--iris-accent)]" style={{ width: `${(Math.min(at, count) / count) * 100}%` }} />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1" aria-hidden>
      {Array.from({ length: count }, (_, k) => (
        <span key={k} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-200", k === at ? "w-4" : "w-1.5")} style={{ background: tones?.[k] ?? (k <= at ? "var(--iris-accent)" : "var(--muted)") }} />
      ))}
    </div>
  );
}

// ---------- Quiz ----------

export function QuizView({ props, node }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const [saved, setSaved] = useMemory<QuizProgress>(node, "round", props.questions);
  const [focus, setFocus] = useState<number | null>(null);
  if (isPendingValue(props.questions)) return <Shimmer className="h-40" />;
  const { items: qs, problems } = normalizeQuiz(props.questions);
  const reveal = str(props.reveal) === "end" ? "end" : "each";
  const valid = saved && saved.order.every((k) => k < qs.length) ? saved : null;
  const round = valid ?? quizStart(qs.length, props.shuffle === true ? seeded(node.start + qs.length) : null);
  const title = str(props.title);
  if (!qs.length) return <Problems list={problems.length ? problems : ["has no questions"]} what="<Quiz>" />;

  const done = quizDone(round);
  const score = quizScore(qs, round);
  const restart = (next: QuizProgress) => {
    setFocus(null);
    setSaved(next);
  };

  if (done) {
    const total = round.order.length;
    const ratio = total ? score.right / total : 0;
    const tone = ratio >= 0.8 ? palette.tone.good : ratio >= 0.5 ? palette.tone.warn : palette.tone.bad;
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Problems list={problems} what="<Quiz>" />
        <Header title={title} />
        <div className="flex items-center gap-3.5" role="status">
          <ScoreRing ratio={ratio} color={tone} />
          <div className="min-w-0">
            <div className="text-[22px] font-semibold tabular-nums leading-tight">
              {score.right} <span className="text-muted-foreground">of {total}</span>
            </div>
            <div className="text-[12.5px] text-muted-foreground">{score.missed.length ? `${score.missed.length} to review` : "Every answer right"}</div>
          </div>
        </div>
        {score.missed.length ? (
          <ul className="flex flex-col gap-1.5">
            {score.missed.map((k) => (
              <li key={k} className="rounded-[10px] px-3 py-2 ring-1 ring-border">
                <Prose text={qs[k].q} className="font-medium" />
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]">
                  <span className="inline-flex items-center gap-1" style={{ color: palette.tone.bad }}>
                    <Glyph name="x" size={12} />
                    {qs[k].options[round.picks[k]] ?? "No answer"}
                  </span>
                  <span className="inline-flex items-center gap-1" style={{ color: palette.tone.good }}>
                    <Glyph name="check" size={12} />
                    {qs[k].options[qs[k].answer]}
                  </span>
                </div>
                {qs[k].why ? <Prose text={qs[k].why!} className="mt-1 text-[12.5px] text-muted-foreground" /> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {score.missed.length ? (
            <button type="button" className={PRIMARY} onClick={() => restart(quizRetryMissed(qs, round))}>
              <Glyph name="rotate-ccw" size={14} />
              Retry the {score.missed.length} missed
            </button>
          ) : null}
          <button type="button" className={score.missed.length ? SECONDARY : PRIMARY} onClick={() => restart(quizStart(qs.length, props.shuffle === true ? Math.random : null))}>
            Start over
          </button>
        </div>
      </div>
    );
  }

  const k = round.order[round.at];
  const q = qs[k];
  const pick = round.picks[k];
  const answered = pick !== undefined;
  const choose = (i: number) => {
    if (answered || env.streaming) return;
    restart({ ...round, picks: { ...round.picks, [k]: i } });
    setFocus(i);
  };
  const next = () => {
    if (!answered) return;
    const after = { ...round, at: round.at + 1 };
    restart(after);
    if (quizDone(after) && props.onFinish) env.run(props.onFinish, [quizScore(qs, after).right, after.order.length]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLButtonElement && (e.key === "Enter" || e.key === " ")) return;
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= q.options.length) {
      e.preventDefault();
      choose(n - 1);
    } else if (e.key === "Enter" && answered) {
      e.preventDefault();
      next();
    }
  };
  const tones = round.order.map((qk, j) => {
    const p = round.picks[qk];
    if (j === round.at) return "var(--iris-accent)";
    if (p === undefined) return undefined;
    return reveal === "each" ? (p === qs[qk].answer ? palette.tone.good : palette.tone.bad) : palette.tone.neutral;
  });
  const last = round.at === round.order.length - 1;
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", FOCUS_BOX)} tabIndex={0} onKeyDown={onKey} aria-label={title ?? "Quiz"}>
      <Problems list={problems} what="<Quiz>" />
      <Header
        title={title}
        right={
          <div className="flex items-center gap-2.5 text-[12px] tabular-nums text-muted-foreground">
            <Dots count={round.order.length} at={round.at} tones={tones} />
            {round.at + 1} of {round.order.length}
          </div>
        }
      />
      <div key={`${k}:${round.order.length}`} className="iris-step-in flex min-w-0 flex-col gap-3">
        <Prose text={q.q} className="text-[14.5px] font-medium" />
        <div role="radiogroup" aria-label="Options" className="flex flex-col gap-1.5">
          {q.options.map((o, i) => {
            const right = i === q.answer;
            const mine = i === pick;
            const show = answered && reveal === "each";
            const color = show ? (right ? palette.tone.good : mine ? palette.tone.bad : undefined) : undefined;
            return (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={mine}
                autoFocus={focus === i}
                onClick={() => choose(i)}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2.5 rounded-[10px] px-3 py-1.5 text-left text-[13.5px] ring-1 ring-border transition-[background-color,box-shadow,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]",
                  !answered && "hover:bg-state-hover",
                  answered && !mine && !(show && right) && "opacity-55",
                  mine && !show && "iris-picked",
                )}
                style={color ? { boxShadow: `inset 0 0 0 1.5px ${color}`, background: tint(color, 9) } : undefined}
              >
                <kbd className="grid size-5 shrink-0 place-items-center rounded-md bg-muted font-sans text-[11px] text-muted-foreground" style={color ? { background: color, color: "var(--background)" } : undefined}>
                  {show && (right || mine) ? <Glyph name={right ? "check" : "x"} size={12} /> : i + 1}
                </kbd>
                <span className="min-w-0 flex-1">{o}</span>
              </button>
            );
          })}
        </div>
        {answered && reveal === "each" ? (
          <div className="flex gap-2 rounded-[10px] px-3 py-2 text-[13px]" style={{ background: tint(pick === q.answer ? palette.tone.good : palette.tone.bad, 8) }} role="status">
            <Glyph name={pick === q.answer ? "circle-check" : "circle-x"} size={15} color={pick === q.answer ? palette.tone.good : palette.tone.bad} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{pick === q.answer ? "Right" : `Not quite: ${q.options[q.answer]}`}</div>
              {q.why ? <Prose text={q.why} className="text-[13px] text-muted-foreground" /> : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!answered} onClick={next}>
          {last ? "See score" : "Next"}
          <Glyph name="arrow-right" size={14} />
        </button>
        <span className="text-[11.5px] text-muted-foreground pointer-coarse:hidden">{answered ? "Press Enter to go on" : `Press 1 to ${Math.min(9, q.options.length)} to pick`}</span>
      </div>
    </div>
  );
}

function ScoreRing({ ratio, color }: { ratio: number; color: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <svg width={56} height={56} viewBox="0 0 56 56" aria-hidden className="shrink-0 -rotate-90">
      <circle cx={28} cy={28} r={r} fill="none" stroke="var(--muted)" strokeWidth={5} />
      <circle className="iris-bar" cx={28} cy={28} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${c * Math.max(0.001, ratio)} ${c}`} />
    </svg>
  );
}

// ---------- Flashcards ----------

export function FlashcardsView({ props, node }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const [saved, setSaved] = useMemory<DeckProgress>(node, "deck", props.cards);
  const [flipped, setFlipped] = useState(false);
  const [hint, setHint] = useState(false);
  if (isPendingValue(props.cards)) return <Shimmer className="h-48" />;
  const { items: cards, problems } = normalizeCards(props.cards);
  if (!cards.length) return <Problems list={problems.length ? problems : ["has no cards"]} what="<Flashcards>" />;
  const fits = (d: DeckProgress) => [...d.queue, ...d.known, ...d.learning].every((k) => k < cards.length);
  const deck = saved && fits(saved) ? saved : deckStart(cards.length, props.shuffle === true ? seeded(node.start + cards.length) : null);
  const title = str(props.title);
  const update = (d: DeckProgress) => {
    setFlipped(false);
    setHint(false);
    setSaved(d);
  };
  const top = deck.queue[0];
  const card = top === undefined ? null : cards[top];
  const sort = (pile: "known" | "learning") => card && update(deckSort(deck, pile));
  const onKey = (e: KeyboardEvent) => {
    if (!card) return;
    const key = e.key.toLowerCase();
    if (key === " " && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      setFlipped((f) => !f);
    } else if (key === "k" || key === "arrowright") {
      e.preventDefault();
      sort("known");
    } else if (key === "l" || key === "arrowleft") {
      e.preventDefault();
      sort("learning");
    }
  };
  const counts = (
    <div className="flex items-center gap-1.5">
      <Chip>{deck.queue.length} left</Chip>
      <Chip tone="warn">{deck.learning.length} learning</Chip>
      <Chip tone="good">{deck.known.length} known</Chip>
    </div>
  );
  if (!card) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <Problems list={problems} what="<Flashcards>" />
        <Header title={title} right={counts} />
        <div className="flex flex-col items-center gap-1 rounded-[12px] px-4 py-6 text-center ring-1 ring-border" role="status">
          <Glyph name={deck.learning.length ? "rotate-ccw" : "party-popper"} size={20} color={deck.learning.length ? palette.tone.warn : palette.tone.good} />
          <div className="mt-1 text-[14.5px] font-semibold">{deck.learning.length ? "Deck done" : "You know every card"}</div>
          <div className="text-[12.5px] text-muted-foreground">
            {deck.known.length} known{deck.learning.length ? `, ${deck.learning.length} still learning` : ""}
          </div>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {deck.learning.length ? (
            <button type="button" className={PRIMARY} onClick={() => update(deckReviewLearning(deck, Math.random))}>
              Review the {deck.learning.length} learning
            </button>
          ) : null}
          <button type="button" className={deck.learning.length ? SECONDARY : PRIMARY} onClick={() => update(deckStart(cards.length, props.shuffle === true ? Math.random : null))}>
            Start over
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", FOCUS_BOX)} tabIndex={0} onKeyDown={onKey} aria-label={title ?? "Flashcards"}>
      <Problems list={problems} what="<Flashcards>" />
      <Header title={title} right={counts} />
      <button
        type="button"
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? "Card back. Click to see the front" : "Card front. Click to see the back"}
        className="iris-flip group relative block min-h-[168px] w-full rounded-[14px] text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]"
        data-flipped={flipped || undefined}
      >
        <span className="iris-flip-inner absolute inset-0">
          <Face side="Front" muted={false}>
            <Prose text={card.front} className="text-[17px]" />
            {card.hint && hint ? <span className="text-[12.5px] text-muted-foreground">{card.hint}</span> : null}
          </Face>
          <Face side="Back" muted>
            <Prose text={card.back} className="text-[15px]" />
          </Face>
        </span>
      </button>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={SECONDARY} onClick={() => sort("learning")} style={{ color: palette.tone.warn }}>
          <Glyph name="arrow-left" size={14} />
          Still learning
        </button>
        <button type="button" className={SECONDARY} onClick={() => sort("known")} style={{ color: palette.tone.good }}>
          Know it
          <Glyph name="arrow-right" size={14} />
        </button>
        <span className="hidden text-[11.5px] text-muted-foreground @lg/iris:inline">Space flips</span>
        <div className="ml-auto flex gap-1.5">
          {card.hint && !flipped ? (
            <button type="button" className={ICON_BTN} aria-label="Show a hint" title="Hint" disabled={hint} onClick={() => setHint(true)}>
              <Glyph name="lightbulb" size={14} />
            </button>
          ) : null}
          <button type="button" className={ICON_BTN} aria-label="Shuffle the cards left" title="Shuffle" disabled={deck.queue.length < 2} onClick={() => update(deckShuffle(deck, Math.random))}>
            <Glyph name="shuffle" size={14} />
          </button>
          <button type="button" className={ICON_BTN} aria-label="Start over" title="Start over" onClick={() => update(deckStart(cards.length, props.shuffle === true ? Math.random : null))}>
            <Glyph name="rotate-ccw" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Face({ side, muted, children }: { side: string; muted: boolean; children: ReactNode }) {
  return (
    <span className={cn("iris-flip-face absolute inset-0 flex flex-col items-center justify-center gap-2 overflow-y-auto rounded-[14px] px-5 py-6 text-center ring-1 ring-border", muted ? "iris-flip-back bg-muted/40" : "bg-card")}>
      <span className="absolute left-3.5 top-2.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{side}</span>
      {children}
    </span>
  );
}

// ---------- Walkthrough ----------

const EXT: Record<string, string> = { ts: "ts", typescript: "ts", tsx: "tsx", js: "js", javascript: "js", jsx: "jsx", swift: "swift", py: "py", python: "py", rb: "rb", go: "go", rs: "rs", rust: "rs", sh: "sh", bash: "sh", zsh: "sh", json: "json", yaml: "yaml", yml: "yaml", css: "css", html: "html", md: "md", sql: "sql", kotlin: "kt", kt: "kt", java: "java", c: "c", cpp: "cpp", glsl: "glsl" };

export function WalkthroughView({ props, node }: ViewProps) {
  const [saved, setSaved] = useMemory<number>(node, "step", props.steps);
  if (isPendingValue(props.steps)) return <Shimmer className="h-40" />;
  const { items: steps, problems } = normalizeSteps(props.steps);
  if (!steps.length) return <Problems list={problems.length ? problems : ["has no steps"]} what="<Walkthrough>" />;
  const first = Math.min(steps.length, Math.max(1, Math.round(num(props.start) ?? 1))) - 1;
  const at = Math.min(steps.length - 1, Math.max(0, saved ?? first));
  const go = (n: number) => setSaved(Math.min(steps.length - 1, Math.max(0, n)));
  const step = steps[at];
  const title = str(props.title);
  const onKey = (e: KeyboardEvent) => {
    const move: Record<string, number> = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: steps.length - 1 };
    if (e.key in move && !(e.target instanceof HTMLButtonElement && (e.key === "ArrowUp" || e.key === "ArrowDown"))) {
      e.preventDefault();
      go(move[e.key]);
    }
  };
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", FOCUS_BOX)} tabIndex={0} onKeyDown={onKey} aria-label={title ?? "Walkthrough"} aria-roledescription="walkthrough">
      <Problems list={problems} what="<Walkthrough>" />
      <Header title={title} />
      <ol className="iris-scroll-x -mx-1 flex gap-1 overflow-x-auto px-1 py-0.5" aria-label="Steps">
        {steps.map((s, k) => (
          <li key={k} className="shrink-0">
            <button
              type="button"
              onClick={() => go(k)}
              aria-current={k === at ? "step" : undefined}
              title={s.title}
              className={cn(
                "flex h-7 max-w-[180px] items-center gap-1.5 rounded-full pl-1 pr-2.5 text-[12px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--iris-accent)]",
                k === at ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full text-[11px] tabular-nums", k === at ? "bg-[var(--iris-accent)] text-background" : k < at ? "bg-muted text-foreground" : "ring-1 ring-border")}>
                {k < at ? <Glyph name="check" size={11} /> : k + 1}
              </span>
              <span className={cn("truncate", k !== at && "@max-lg/iris:hidden")}>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <div key={at} className="iris-step-in flex min-w-0 flex-col gap-2.5" aria-live="polite">
        <div className="text-[15px] font-semibold leading-snug">{step.title}</div>
        {step.body ? <Prose text={step.body} /> : null}
        {step.code ? (
          <div className="min-w-0 overflow-hidden rounded-[10px] bg-muted/30 ring-1 ring-border">
            {step.file ? <div className="truncate border-b border-border px-3 py-1.5 font-mono text-[12px]">{step.file}</div> : null}
            <div className="min-w-0 text-[12.5px]">
              <SourceCode content={step.code} path={step.file && step.file.includes(".") ? step.file : `step-${at + 1}.${EXT[step.lang.toLowerCase()] ?? step.lang}`} highlightedLines={step.lines} overflow="scroll" />
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={SECONDARY} disabled={at === 0} onClick={() => go(at - 1)}>
          <Glyph name="arrow-left" size={14} />
          Back
        </button>
        {at < steps.length - 1 ? (
          <button type="button" className={PRIMARY} onClick={() => go(at + 1)}>
            Next
            <Glyph name="arrow-right" size={14} />
          </button>
        ) : (
          <button type="button" className={SECONDARY} onClick={() => go(0)}>
            <Glyph name="rotate-ccw" size={14} />
            From the top
          </button>
        )}
        <span className="ml-auto text-[12px] tabular-nums text-muted-foreground">
          Step {at + 1} of {steps.length}
          <span className="@max-lg/iris:hidden"> · arrow keys move</span>
        </span>
      </div>
    </div>
  );
}

// ---------- Timer ----------

export function TimerView({ props, node }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const [saved, setSaved] = useMemory<TimerState>(node, "clock", [props.label, props.seconds, props.mode]);
  const seconds = parseDuration(props.seconds);
  const mode = str(props.mode) === "stopwatch" || seconds === null ? "stopwatch" : "countdown";
  const total = (seconds ?? 0) * 1000;
  const t = saved ?? TIMER_IDLE;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (saved || props.autostart !== true || env.streaming) return;
    setSaved(timerToggle(TIMER_IDLE, Date.now()));
  }, [saved, props.autostart, env.streaming, setSaved]);
  useEffect(() => {
    if (!t.running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), mode === "stopwatch" ? 100 : 250);
    return () => clearInterval(id);
  }, [t.running, mode]);
  const elapsed = timerElapsed(t, t.running ? Math.max(now, t.since ?? 0) : now);
  const finished = mode === "countdown" && total > 0 && elapsed >= total;
  // A countdown stops itself at zero, so a restored card reads done, not negative.
  useEffect(() => {
    if (finished && t.running) setSaved({ ...t, running: false, since: null, banked: total });
  }, [finished, t, total, setSaved]);
  if (props.seconds != null && seconds === null) return <InlineError error={new Error(`seconds "${String(props.seconds)}" is not a duration: use 90, "5m", "1:30" or "1h 20m"`)} context="<Timer>" />;

  const left = Math.max(0, total - elapsed);
  const shown = mode === "countdown" ? formatClock(left, { up: true }) : formatClock(elapsed, { tenths: true });
  // A countdown's ring empties as time runs out; a stopwatch shows a short arc while it has time
  // on it and only its track when idle, so an untouched stopwatch never reads as complete.
  const ratio = mode === "countdown" ? (total > 0 ? left / total : 1) : t.running || elapsed > 0 ? 0.25 : 0;
  const color = finished ? palette.tone.good : mode === "countdown" && ratio < 0.1 && t.running ? palette.tone.warn : "var(--iris-accent)";
  const label = str(props.label);
  const toggle = () => setSaved(finished ? timerToggle(TIMER_IDLE, Date.now()) : timerToggle(t, Date.now()));
  const reset = () => setSaved({ ...TIMER_IDLE });
  const lap = () => setSaved(timerLap(t, Date.now()));
  const laps = t.laps.map((at, k) => ({ at, split: at - (t.laps[k - 1] ?? 0) }));
  const splits = laps.map((l) => l.split);
  const best = laps.length > 1 ? Math.min(...splits) : null;
  const worst = laps.length > 1 ? Math.max(...splits) : null;
  return (
    <div className="@container flex min-w-[150px] flex-1 flex-col gap-2 rounded-[12px] px-3.5 py-3 ring-1 ring-border">
      {/* Wraps the buttons under the time when the tile is narrow (two timers in a Row on a phone). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <ClockRing ratio={ratio} color={color} spinning={mode === "stopwatch" && t.running} />
        <div className="min-w-[5.5rem] flex-1">
          <div className="truncate text-[12px] text-muted-foreground">{label ?? (mode === "countdown" ? "Countdown" : "Stopwatch")}</div>
          <div className="text-[26px] font-semibold leading-tight tabular-nums tracking-[-0.01em]" style={finished ? { color } : undefined} role="timer" aria-live={finished ? "assertive" : "off"} aria-label={`${label ?? mode} ${shown}`}>
            {finished ? "Done" : shown}
          </div>
        </div>
        {/* No ml-auto: the time block's flex-1 already pushes the buttons right, and once they wrap under it they start on its left edge. */}
        <div className="flex shrink-0 gap-1.5">
          {mode === "stopwatch" ? (
            <button type="button" className={ICON_BTN} aria-label="Lap" title="Lap" disabled={!t.running} onClick={lap}>
              <Glyph name="flag" size={14} />
            </button>
          ) : null}
          <button type="button" className={ICON_BTN} aria-label="Reset" title="Reset" disabled={!t.running && t.banked === 0 && !t.laps.length} onClick={reset}>
            <Glyph name="rotate-ccw" size={14} />
          </button>
          <button type="button" className="grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)] disabled:opacity-45" disabled={env.streaming} aria-label={t.running ? "Pause" : finished ? "Start again" : "Start"} onClick={toggle}>
            <Glyph name={t.running ? "pause" : finished ? "rotate-ccw" : "play"} size={14} />
          </button>
        </div>
      </div>
      {laps.length ? (
        <ol className="flex max-h-36 flex-col overflow-y-auto border-t border-border pt-1.5 text-[12.5px] tabular-nums">
          {laps
            .map((l, k) => (
              <li key={k} className="flex items-center gap-2 py-0.5">
                <span className="w-12 shrink-0 whitespace-nowrap text-muted-foreground">Lap {k + 1}</span>
                <span className="flex-1" style={l.split === best ? { color: palette.tone.good } : l.split === worst ? { color: palette.tone.warn } : undefined}>
                  {formatClock(l.split, { tenths: true })}
                </span>
                <span className="hidden text-muted-foreground @[13rem]:inline">{formatClock(l.at, { tenths: true })}</span>
              </li>
            ))
            .reverse()}
        </ol>
      ) : null}
    </div>
  );
}

function ClockRing({ ratio, color, spinning }: { ratio: number; color: string; spinning: boolean }) {
  const r = 17;
  const c = 2 * Math.PI * r;
  return (
    <svg width={42} height={42} viewBox="0 0 42 42" aria-hidden className={cn("shrink-0 -rotate-90", spinning && "iris-spin-slow")}>
      <circle cx={21} cy={21} r={r} fill="none" stroke="var(--muted)" strokeWidth={4} />
      <circle cx={21} cy={21} r={r} fill="none" stroke={color} strokeWidth={4} strokeLinecap="round" strokeDasharray={spinning ? `${c * 0.25} ${c}` : `${c * Math.max(0, Math.min(1, ratio))} ${c}`} style={{ transition: "stroke-dasharray 250ms linear" }} />
    </svg>
  );
}
