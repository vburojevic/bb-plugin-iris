// KaTeX, loaded only when a card shows math. Its stylesheet and fonts ship
// next to this chunk (scripts/build-chunks.mjs).
import katex from "katex";

export interface TexResult {
  html: string;
  error: string | null;
}

/** Renders TeX to HTML. trust stays off, so no \href, \url or raw HTML gets through. */
export function renderTex(tex: string, display: boolean, macros?: Record<string, string>): TexResult {
  try {
    const html = katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "htmlAndMathml", strict: "ignore", trust: false, macros: macros ? { ...macros } : undefined, maxExpand: 500 });
    return { html, error: null };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.replace(/^KaTeX parse error: /, "") : String(cause);
    return { html: "", error: message };
  }
}
