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
