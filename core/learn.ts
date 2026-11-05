// Learning and play: the rules behind Quiz, Flashcards, Walkthrough and Timer,
// kept out of the views so they can be tested without a browser. Every
// normalizer forgives the shapes agents reach for (question or q, an answer
// given as the option's text) and reports what it could not use.

import { readField, toText } from "./evaluate";

const text = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : toText(v));
const field = (o: unknown, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = readField(o, k);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
};
const items = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []);

// ---------- Quiz ----------

export interface QuizQuestion {
  q: string;
  options: string[];
  /** Index of the right option. */
  answer: number;
  why: string | null;
}

export interface Normalized<T> {
  items: T[];
  /** Readable problems with entries that were dropped. */
  problems: string[];
}

export function normalizeQuiz(raw: unknown): Normalized<QuizQuestion> {
  const out: QuizQuestion[] = [];
  const problems: string[] = [];
  items(raw).forEach((entry, k) => {
    const q = text(field(entry, "q", "question", "prompt", "title"));
    const options = items(field(entry, "options", "choices", "answers")).map(text);
    const given = field(entry, "answer", "correct");
    let answer = typeof given === "number" ? given : typeof given === "string" ? options.indexOf(given) : -1;
    if (answer === -1 && typeof given === "string" && /^\d+$/.test(given)) answer = Number(given);
    if (!q) problems.push(`Question ${k + 1} has no text (q)`);
    else if (options.length < 2) problems.push(`Question ${k + 1} needs at least two options`);
    else if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) problems.push(`Question ${k + 1}: answer must be an option index from 0 to ${options.length - 1}`);
    else out.push({ q, options, answer, why: text(field(entry, "why", "explanation", "explain")) || null });
  });
  return { items: out, problems };
}

export interface QuizProgress {
  /** Question indexes in the order they are asked this round. */
  order: number[];
  /** Picked option per question index; missing means not answered yet. */
  picks: Record<number, number>;
  /** Position in order. */
  at: number;
}

export function quizStart(count: number, rand: (() => number) | null): QuizProgress {
  const order = Array.from({ length: count }, (_, k) => k);
  return { order: rand ? shuffled(order, rand) : order, picks: {}, at: 0 };
}

export function quizScore(questions: QuizQuestion[], progress: QuizProgress): { right: number; asked: number; missed: number[] } {
  let right = 0;
  const missed: number[] = [];
  for (const k of progress.order) {
    const pick = progress.picks[k];
    if (pick === undefined || !questions[k]) continue;
    if (pick === questions[k].answer) right++;
    else missed.push(k);
  }
  return { right, asked: progress.order.length, missed };
}

/** A round that asks only the questions missed in the last one. */
export function quizRetryMissed(questions: QuizQuestion[], progress: QuizProgress): QuizProgress {
  const { missed } = quizScore(questions, progress);
  return { order: missed, picks: {}, at: 0 };
}

export function quizDone(progress: QuizProgress): boolean {
  return progress.at >= progress.order.length;
}

// ---------- Flashcards ----------

export interface Flashcard {
  front: string;
  back: string;
  hint: string | null;
}

export function normalizeCards(raw: unknown): Normalized<Flashcard> {
  const out: Flashcard[] = [];
  const problems: string[] = [];
  items(raw).forEach((entry, k) => {
    if (Array.isArray(entry)) {
      const [front, back] = entry.map(text);
      if (front && back) out.push({ front, back, hint: null });
      else problems.push(`Card ${k + 1} needs a front and a back`);
      return;
    }
    const front = text(field(entry, "front", "term", "q", "question"));
    const back = text(field(entry, "back", "definition", "a", "answer"));
    if (!front || !back) problems.push(`Card ${k + 1} needs a front and a back`);
    else out.push({ front, back, hint: text(field(entry, "hint")) || null });
  });
  return { items: out, problems };
}

export interface DeckProgress {
  /** Card indexes still to go, in order. */
  queue: number[];
  known: number[];
  learning: number[];
}

export function deckStart(count: number, rand: (() => number) | null): DeckProgress {
  const queue = Array.from({ length: count }, (_, k) => k);
  return { queue: rand ? shuffled(queue, rand) : queue, known: [], learning: [] };
}

/** Moves the card on top of the queue to a pile. */
export function deckSort(deck: DeckProgress, pile: "known" | "learning"): DeckProgress {
  const [top, ...rest] = deck.queue;
  if (top === undefined) return deck;
  return { queue: rest, known: pile === "known" ? [...deck.known, top] : deck.known, learning: pile === "learning" ? [...deck.learning, top] : deck.learning };
}

/** Another pass over the cards still being learned; known cards stay known. */
export function deckReviewLearning(deck: DeckProgress, rand: (() => number) | null): DeckProgress {
  return { queue: rand ? shuffled(deck.learning, rand) : [...deck.learning], known: deck.known, learning: [] };
}

export function deckShuffle(deck: DeckProgress, rand: () => number): DeckProgress {
  return { ...deck, queue: shuffled(deck.queue, rand) };
}

// ---------- Walkthrough ----------

export interface WalkStep {
  title: string;
  body: string | null;
  code: string | null;
  lang: string;
  file: string | null;
  lines: { start: number; end: number } | null;
}

export function lineSpan(v: unknown): { start: number; end: number } | null {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return { start: v, end: v };
  if (Array.isArray(v) && v.length >= 1 && v.every((n) => typeof n === "number" && n > 0)) return { start: Math.min(...v), end: Math.max(...v) };
  const m = typeof v === "string" ? /^\s*(\d+)\s*(?:[-:]\s*(\d+))?\s*$/.exec(v) : null;
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2] ?? m[1]);
  return a > 0 && b > 0 ? { start: Math.min(a, b), end: Math.max(a, b) } : null;
}

export function normalizeSteps(raw: unknown): Normalized<WalkStep> {
  const out: WalkStep[] = [];
  const problems: string[] = [];
  items(raw).forEach((entry, k) => {
    const title = text(field(entry, "title", "name", "heading"));
    const body = text(field(entry, "body", "text", "detail", "description")) || null;
    const code = text(field(entry, "code")) || null;
    if (!title && !body && !code) {
      problems.push(`Step ${k + 1} is empty: give it a title, body or code`);
      return;
    }
    out.push({
      title: title || `Step ${k + 1}`,
      body,
      code: code ? code.replace(/^\n+|\s+$/g, "") : null,
      lang: text(field(entry, "lang", "language")) || "txt",
      file: text(field(entry, "file", "path")) || null,
      lines: lineSpan(field(entry, "lines", "highlight")),
    });
  });
  return { items: out, problems };
}

// ---------- Timer ----------

/** Seconds from 90, "90s", "5m", "1h 20m", "1:30" or "01:02:03". */
export function parseDuration(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (clock) {
    const [a, b, c] = [clock[1], clock[2], clock[3]].map((x) => (x === undefined ? undefined : Number(x)));
    return c === undefined ? a! * 60 + b! : a! * 3600 + b! * 60 + c;
  }
  let total = 0;
  let matched = "";
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/g)) {
    const n = Number(m[1]);
    const unit = m[2][0];
    total += unit === "h" ? n * 3600 : unit === "m" ? n * 60 : n;
    matched += m[0];
  }
  return matched.replace(/\s/g, "").length === s.replace(/\s/g, "").length ? total : null;
}

/** 4:05, 1:02:03, or 4:05.3 with tenths. Countdowns round up so 0:00 means done. */
export function formatClock(ms: number, opts: { tenths?: boolean; up?: boolean } = {}): string {
  const t = Math.max(0, ms);
  const tenthsTotal = opts.up ? Math.ceil(t / 100 - 1e-9) : Math.floor(t / 100 + 1e-9);
  const total = opts.tenths ? Math.floor(tenthsTotal / 10) : opts.up ? Math.ceil(t / 1000 - 1e-9) : Math.floor(t / 1000 + 1e-9);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return opts.tenths ? `${base}.${tenthsTotal % 10}` : base;
}

export interface TimerState {
  running: boolean;
  /** Epoch ms when it last started; null while paused. */
  since: number | null;
  /** Milliseconds run before the last start. */
  banked: number;
  /** Elapsed milliseconds at each lap. */
  laps: number[];
}

export const TIMER_IDLE: TimerState = { running: false, since: null, banked: 0, laps: [] };

export function timerElapsed(t: TimerState, now: number): number {
  return t.banked + (t.running && t.since !== null ? Math.max(0, now - t.since) : 0);
}

export function timerToggle(t: TimerState, now: number): TimerState {
  return t.running ? { ...t, running: false, since: null, banked: timerElapsed(t, now) } : { ...t, running: true, since: now };
}

export function timerLap(t: TimerState, now: number): TimerState {
  return { ...t, laps: [...t.laps, timerElapsed(t, now)] };
}

// ---------- shared ----------

/** A small seeded generator, so tests and restored decks repeat. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(list: readonly T[], rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
