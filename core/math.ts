// Splits text with TeX in it: $inline$, $$display$$, \(inline\) and \[display\].
// A backslash-escaped dollar (\$) stays a dollar sign.

export type MathPart = { kind: "text"; value: string } | { kind: "inline"; tex: string } | { kind: "display"; tex: string };

export function hasDelimiters(s: string): boolean {
  return /(^|[^\\])\$|\\\(|\\\[/.test(s);
}

export function splitMath(s: string): MathPart[] {
  const parts: MathPart[] = [];
  let text = "";
  let i = 0;
  const flush = () => {
    if (text) parts.push({ kind: "text", value: text.replace(/\\\$/g, "$") });
    text = "";
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "$") {
      text += "\\$";
      i += 2;
      continue;
    }
    const open = s.startsWith("$$", i) ? "$$" : c === "$" ? "$" : s.startsWith("\\[", i) ? "\\[" : s.startsWith("\\(", i) ? "\\(" : null;
    if (open) {
      const close = open === "\\[" ? "\\]" : open === "\\(" ? "\\)" : open;
      const end = findClose(s, close, i + open.length);
      if (end >= 0) {
        const tex = s.slice(i + open.length, end).trim();
        if (tex) {
          flush();
          parts.push({ kind: open === "$$" || open === "\\[" ? "display" : "inline", tex });
        }
        i = end + close.length;
        continue;
      }
    }
    text += c;
    i++;
  }
  flush();
  return parts;
}

function findClose(s: string, close: string, from: number): number {
  for (let j = from; j < s.length; j++) {
    if (s[j] === "\\" && close.startsWith("$")) {
      j++;
      continue;
    }
    if (s.startsWith(close, j)) return j;
  }
  return -1;
}
