// DocReview: a markdown document split into blocks the person can comment on, plus a verdict.

export type DocVerdict = "approve" | "changes";

export interface DocComment {
  /** The block's index in the document, from 1. */
  block: number;
  /** The start of the block, so the agent can find it again. */
  quote: string;
  note: string;
}

export interface DocReviewState {
  verdict: DocVerdict | null;
  comments: DocComment[];
}

export const MAX_DOC_BLOCKS = 200;

/**
 * Markdown into blocks at blank lines, keeping fenced code whole and a heading on its own: each
 * block is one thing a person might comment on (a paragraph, a list, a table, a code sample).
 */
export function docBlocks(md: string): string[] {
  const out: string[] = [];
  let cur: string[] = [];
  let fence: string | null = null;
  // Only blank lines and trailing space go: a block's own indentation (indented code, nested lists) stays.
  const flush = () => {
    const t = cur.join("\n").replace(/^(\s*\n)+/, "").trimEnd();
    if (t.trim()) out.push(t);
    cur = [];
  };
  for (const line of md.replace(/\r\n?/g, "\n").split("\n")) {
    const f = line.match(/^\s*(`{3,}|~{3,})/);
    if (fence) {
      cur.push(line);
      // Only a bare fence line closes it; "```js" inside a fence is content.
      const close = line.match(/^\s*(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = null;
        flush();
      }
      continue;
    }
    if (f) {
      flush();
      fence = f[1];
      cur.push(line);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush();
      cur.push(line);
      flush();
      continue;
    }
    if (!line.trim()) flush();
    else cur.push(line);
    if (out.length >= MAX_DOC_BLOCKS) break;
  }
  flush();
  return out.slice(0, MAX_DOC_BLOCKS);
}

/** The first words of a block, without markdown marks, for a comment's quote. */
export function blockQuote(block: string, max = 80): string {
  const plain = block
    .replace(/^\s*(`{3,}|~{3,}).*$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`>#|]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

/** State read back: a verdict of approve or changes (or none) and the comments that still hold a note. */
export function normalizeReview(v: unknown): DocReviewState {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const verdict = o.verdict === "approve" || o.verdict === "changes" ? o.verdict : null;
  const comments: DocComment[] = [];
  for (const c of Array.isArray(o.comments) ? o.comments : []) {
    if (!c || typeof c !== "object") continue;
    const x = c as Record<string, unknown>;
    if (typeof x.block !== "number" || !Number.isInteger(x.block) || x.block < 1) continue;
    if (comments.some((y) => y.block === x.block)) continue;
    comments.push({ block: x.block, quote: typeof x.quote === "string" ? x.quote : "", note: typeof x.note === "string" ? x.note : "" });
  }
  return { verdict, comments };
}

/**
 * Each comment's block in the current text: where its quote still matches, else the block whose
 * quote does, else none (the text it was about changed). Agents edit specs between rounds, so a
 * number alone would move comments onto the wrong paragraph.
 */
export function anchorComments(blocks: string[], comments: DocComment[]): { at: Map<number, DocComment>; orphans: DocComment[] } {
  const quotes = blocks.map((b) => blockQuote(b));
  const at = new Map<number, DocComment>();
  const orphans: DocComment[] = [];
  for (const c of comments) {
    let b = c.block >= 1 && c.block <= blocks.length && (!c.quote || quotes[c.block - 1] === c.quote) ? c.block : 0;
    if (!b && c.quote) b = quotes.findIndex((q, i) => q === c.quote && !at.has(i + 1)) + 1;
    if (b && !at.has(b)) at.set(b, c);
    else orphans.push(c);
  }
  return { at, orphans };
}
