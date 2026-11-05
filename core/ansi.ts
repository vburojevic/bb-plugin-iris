// ANSI color handling shared by Logs, LiveLog and TerminalReplay. Colors stay
// indexes into the theme's 16 ANSI colors (--ansi-0..15): 256-color and
// truecolor codes map to the nearest of those, so output always reads in the
// person's bb theme.

export interface AnsiStyle {
  fg?: number;
  bg?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
}

export interface Span extends AnsiStyle {
  text: string;
}

/** Agents can't type ESC, so "\u001b[", "\x1b[" and "\033[" count too. */
export function normalizeEscapes(s: string): string {
  return s.replace(/\\u001b\[|\\x1b\[|\\033\[|\\e\[/g, "\u001b[");
}

// xterm's reference values for the 16 base colors, used only to find the
// nearest base color for 256-color and truecolor codes. Never drawn.
const BASE_RGB: [number, number, number][] = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0], [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0], [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];

/** The nearest of the 16 theme ANSI colors to an RGB value. */
export function nearestAnsi(r: number, g: number, b: number): number {
  let best = 7;
  let bestD = Infinity;
  BASE_RGB.forEach(([R, G, B], k) => {
    const d = (r - R) ** 2 * 0.3 + (g - G) ** 2 * 0.59 + (b - B) ** 2 * 0.11;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  });
  return best;
}

/** A 256-color index as one of the 16 theme colors. */
export function ansi256(n: number): number {
  if (n < 16) return n;
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return v < 60 ? 0 : v < 150 ? 8 : v < 220 ? 7 : 15;
  }
  const k = n - 16;
  const level = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return nearestAnsi(level(Math.floor(k / 36)), level(Math.floor(k / 6) % 6), level(k % 6));
}

/** Applies one SGR sequence's codes (the numbers in ESC[...m) to a style. */
export function applySgr(style: AnsiStyle, codes: number[]): AnsiStyle {
  const next: AnsiStyle = { ...style };
  if (!codes.length) codes = [0];
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) {
      for (const key of Object.keys(next) as (keyof AnsiStyle)[]) delete next[key];
    } else if (c === 1) next.bold = true;
    else if (c === 2) next.dim = true;
    else if (c === 3) next.italic = true;
    else if (c === 4) next.underline = true;
    else if (c === 7) next.inverse = true;
    else if (c === 22) next.bold = next.dim = false;
    else if (c === 23) next.italic = false;
    else if (c === 24) next.underline = false;
    else if (c === 27) next.inverse = false;
    else if (c >= 30 && c <= 37) next.fg = c - 30;
    else if (c >= 90 && c <= 97) next.fg = c - 90 + 8;
    else if (c === 39) next.fg = undefined;
    else if (c >= 40 && c <= 47) next.bg = c - 40;
    else if (c >= 100 && c <= 107) next.bg = c - 100 + 8;
    else if (c === 49) next.bg = undefined;
    else if (c === 38 || c === 48) {
      let color: number | undefined;
      if (codes[i + 1] === 5 && codes[i + 2] != null) {
        color = ansi256(codes[i + 2]);
        i += 2;
      } else if (codes[i + 1] === 2 && codes[i + 4] != null) {
        color = nearestAnsi(codes[i + 2], codes[i + 3], codes[i + 4]);
        i += 4;
      }
      if (color != null) next[c === 38 ? "fg" : "bg"] = color;
    }
  }
  return next;
}

/** One line of text with SGR colors as styled spans; other escapes are dropped. */
export function parseAnsi(line: string): Span[] {
  const out: Span[] = [];
  let cur: AnsiStyle = {};
  const re = /\u001b\[([\d;]*)m/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ ...cur, text: line.slice(last, m.index) });
    last = re.lastIndex;
    cur = applySgr(cur, m[1] ? m[1].split(";").map(Number) : []);
  }
  if (last < line.length) out.push({ ...cur, text: line.slice(last) });
  return out.map((sp) => ({ ...sp, text: sp.text.replace(/\u001b\[[\d;?]*[A-Za-z]/g, "") }));
}

/** CSS for a span in theme colors. */
export function spanStyle(sp: AnsiStyle): { color?: string; background?: string; fontWeight?: number; opacity?: number; fontStyle?: string; textDecoration?: string } {
  let fg = sp.fg != null ? `var(--ansi-${sp.fg})` : undefined;
  let bg = sp.bg != null ? `var(--ansi-${sp.bg})` : undefined;
  if (sp.inverse) [fg, bg] = [bg ?? "var(--background)", fg ?? "var(--foreground)"];
  return {
    color: fg,
    background: bg,
    fontWeight: sp.bold ? 600 : undefined,
    opacity: sp.dim ? 0.65 : undefined,
    fontStyle: sp.italic ? "italic" : undefined,
    textDecoration: sp.underline ? "underline" : undefined,
  };
}
