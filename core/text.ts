// Small text helpers shared by the parser, interpreter and validator.

/** Levenshtein distance, capped for speed. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (Math.abs(al - bl) > 4) return 99;
  // Optimal string alignment: a swap of two neighbours costs one edit ("Crad" -> "Card").
  const d: number[][] = Array.from({ length: al + 1 }, (_, i) => Array.from({ length: bl + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[al][bl];
}

/** The closest known name, when one is close enough to be a typo. */
export function didYouMean(name: string, known: Iterable<string>): string | null {
  const lower = name.toLowerCase();
  let best: string | null = null;
  let bestD = Infinity;
  for (const k of known) {
    if (k.toLowerCase() === lower) return k;
    const d = distance(lower, k.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  const limit = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  return bestD <= limit ? best : null;
}

/** Removes the common indentation of a block of text and trims blank edges. */
export function dedent(text: string): string {
  const lines = text.replace(/\t/g, "  ").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.length - l.trimStart().length));
  return lines.map((l) => l.slice(Number.isFinite(indent) ? indent : 0)).join("\n");
}

/** JSX whitespace: lines trimmed and joined with single spaces; blank runs dropped. */
export function collapse(text: string): string {
  if (!text.includes("\n")) return text;
  const parts = text.split("\n").map((l, k, all) => (k === 0 ? l.trimEnd() : k === all.length - 1 ? l.trimStart() : l.trim()));
  return parts.filter((l) => l.length > 0).join(" ");
}
