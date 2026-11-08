import { CardRuntime, compile, type LoadResult } from "./program";
import { didYouMean } from "./text";

// The thread's own Iris cards, found in its agent messages, with what the person set in each.
// A card's saved inputs live under a key that ends "item:<message id>#<language>#<index>", where
// index counts the message's Iris blocks (```iris, ```iris-app and ```iris-react) from 0.

export interface CardRef {
  /** The agent message's id. */
  message: string;
  /** Which ```iris fence in that message, from 0. */
  index: number;
  language: string;
  title: string;
  source: string;
}

const IRIS = new Set(["iris", "iris-app", "iris-react"]);

/**
 * Every ```iris, ```iris-app and ```iris-react block in a message, numbered as the renderer numbers
 * them. Fences are read line by line as markdown does: a fence opens at the start of a line, closes
 * at a bare fence line at least as long, and a ```iris written inside another code block is content.
 */
export function cardsInMessage(messageId: string, text: string): CardRef[] {
  const out: CardRef[] = [];
  let open: { marker: string; language: string; body: string[] } | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        if (IRIS.has(open.language)) {
          const source = open.body.join("\n");
          const title = /<Card\b[^>]*?\btitle="([^"]{1,120})"/.exec(source)?.[1] ?? /<title>([^<]{1,120})<\/title>/.exec(source)?.[1] ?? `${open.language} block`;
          out.push({ message: messageId, index: out.length, language: open.language, title, source });
        }
        open = null;
      } else open.body.push(line);
      continue;
    }
    const start = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (start) open = { marker: start[1], language: start[2].toLowerCase(), body: [] };
  }
  return out;
}

/** What the person set: the saved state without a component's own "@" progress keys. */
export function personInputs(state: unknown): Record<string, unknown> {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  return Object.fromEntries(Object.entries(state as Record<string, unknown>).filter(([k]) => !k.startsWith("@")));
}

/** Whether a saved state key belongs to this card. */
export function isCardKey(key: string, card: CardRef): boolean {
  return key.endsWith(`item:${card.message}#${card.language}#${card.index}`);
}

/**
 * Where the agent's values wait for a card that has no saved state yet. The card's own key needs
 * the message's turn and parent, which only the renderer knows; it reads this one when its own is empty.
 */
export function pendingKey(threadId: string, card: Pick<CardRef, "message" | "language" | "index">): string {
  return `state:cardset:${threadId}:item:${card.message}#${card.language}#${card.index}`;
}

/** The pending key for a renderer's state key ("<thread>:...|item:<message>#<language>#<index>"), or null. */
export function pendingKeyFor(stateKey: string): string | null {
  const m = /^(thr_[A-Za-z0-9_-]+):.*\|(item:[^|]+#[a-z-]+#\d+)$/.exec(stateKey);
  return m ? `state:cardset:${m[1]}:${m[2]}` : null;
}

export type InputPlan = { ok: true; next: Record<string, unknown>; changed: string[] } | { ok: false; error: string };

const kind = (v: unknown) => (v === null || v === undefined ? "empty" : Array.isArray(v) ? "list" : typeof v === "object" ? "object" : typeof v);

/**
 * The card's inputs after the agent sets `values`: each must be one of the card's <state> names and
 * keep the type its state starts with (a number stays a number). Nothing is written here.
 */
export function planInputs(card: CardRef, current: Record<string, unknown>, values: Record<string, unknown>): InputPlan {
  if (card.language !== "iris") return { ok: false, error: `card "${card.title}" is an ${card.language} block: only \`\`\`iris cards have <state> inputs to set` };
  const program = compile(card.source);
  if (program.error) return { ok: false, error: `card "${card.title}" doesn't compile: ${program.error.message}` };
  const runtime = new CardRuntime(program, { load: () => new Promise<LoadResult>(() => undefined) });
  const names = program.states.map((s) => s.name);
  if (!names.length) return { ok: false, error: `card "${card.title}" has no <state> inputs` };
  const keys = Object.keys(values);
  if (!keys.length) return { ok: false, error: `name at least one input: ${names.join(", ")}` };
  for (const k of keys) {
    if (!names.includes(k)) {
      const hint = didYouMean(k, names);
      return { ok: false, error: `card "${card.title}" has no input "${k}".${hint ? ` Did you mean ${hint}?` : ""} Its inputs: ${names.join(", ")}` };
    }
    const start = runtime.getState(k);
    if (kind(start) !== "empty" && kind(values[k]) !== kind(start)) return { ok: false, error: `"${k}" holds a ${kind(start)} (it starts as ${JSON.stringify(start)}), not a ${kind(values[k])}` };
  }
  const changed = keys.filter((k) => JSON.stringify(current[k]) !== JSON.stringify(values[k]));
  return { ok: true, next: { ...current, ...values }, changed };
}
