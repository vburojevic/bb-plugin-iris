// A small code editor for Iris markup: a plain textarea over a highlighted copy
// of its text, with line numbers. No editor library: the markup is short and the
// page stays light.
import { useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref } from "react";

// Every alternative matches without backtracking: an unclosed comment or string runs to the end
// of its line (or the text) in one match, an escape takes at most one character, and a word is
// matched whole and only then checked for a following "=" (an attribute name).
const TOKEN =
  /(\{\/\*[\s\S]*?(?:\*\/\}|$(?![\s\S]))|<!--[\s\S]*?(?:-->|$(?![\s\S])))|("(?:[^"\\\n]|\\[^\n]?)*(?:"|(?=\n)|$(?![\s\S]))|'(?:[^'\\\n]|\\[^\n]?)*(?:'|(?=\n)|$(?![\s\S]))|`(?:[^`\\]|\\[\s\S]?)*(?:`|$(?![\s\S])))|(<\/?)([A-Za-z][\w.]*)|([A-Za-z_][\w-]*)|(\b\d+(?:\.\d+)?\b)|(\/>|>|[{}])|(=>|===?|!==?|&&|\|\||[?:])/g;

/** Longer text than this is shown plain: highlighting it would slow typing. */
const HIGHLIGHT_LIMIT = 100_000;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const span = (cls: string, s: string) => `<span class="tok-${cls}">${esc(s)}</span>`;

/** Iris markup as HTML with a span per token; every piece of the source is escaped. */
export function highlight(src: string): string {
  if (src.length > HIGHLIGHT_LIMIT) return esc(src);
  let out = "";
  let last = 0;
  for (const m of src.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    out += esc(src.slice(last, at));
    last = at + m[0].length;
    if (m[1]) out += span("comment", m[1]);
    else if (m[2]) out += span("string", m[2]);
    else if (m[3]) out += span("punct", m[3]) + span("tag", m[4]);
    else if (m[5]) out += src[last] === "=" ? span("attr", m[5]) : esc(m[5]);
    else if (m[6]) out += span("number", m[6]);
    else if (m[7]) out += span("punct", m[7]);
    else if (m[8]) out += span("op", m[8]);
  }
  return out + esc(src.slice(last));
}

export function CodeView({ source, className }: { source: string; className?: string }) {
  const html = useMemo(() => highlight(source), [source]);
  return <pre className={`site-code ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export type EditorApi = {
  /** Replaces all of the text as one edit the person can undo with Cmd+Z. */
  replaceAll: (text: string) => void;
};

/** Replaces the selected range with text through the browser's own editing, so Cmd+Z undoes it. */
function insert(a: HTMLTextAreaElement, from: number, to: number, text: string): boolean {
  a.focus();
  a.setSelectionRange(from, to);
  // execCommand is the one way to edit a textarea that keeps the browser's undo history.
  return typeof document.execCommand === "function" && document.execCommand("insertText", false, text);
}

export function Editor({ value, onChange, label, api }: { value: string; onChange: (v: string) => void; label: string; api?: Ref<EditorApi> }) {
  const area = useRef<HTMLTextAreaElement | null>(null);
  const layer = useRef<HTMLPreElement | null>(null);
  const gutter = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => `${highlight(value)}\n`, [value]);
  const lines = useMemo(() => value.split("\n").length, [value]);

  useImperativeHandle(
    api,
    () => ({
      replaceAll: (text: string) => {
        const a = area.current;
        if (!a || !insert(a, 0, a.value.length, text)) onChange(text);
        a?.setSelectionRange(0, 0);
        if (a) a.scrollTop = 0;
      },
    }),
    [onChange],
  );

  const sync = () => {
    const a = area.current;
    if (!a) return;
    if (layer.current) layer.current.style.transform = `translate(${-a.scrollLeft}px, ${-a.scrollTop}px)`;
    if (gutter.current) gutter.current.style.transform = `translateY(${-a.scrollTop}px)`;
  };
  useLayoutEffect(sync, [value]);

  // Tab indents the lines a selection touches by two spaces and Shift+Tab outdents them.
  // Escape, then Tab, moves focus on, as in most code editors (the hint below says so).
  const escaped = useRef(false);
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape") {
      escaped.current = true;
      return;
    }
    if (e.key !== "Tab" || escaped.current || e.metaKey || e.ctrlKey || e.altKey) {
      escaped.current = false;
      return;
    }
    e.preventDefault();
    const a = e.currentTarget;
    const text = a.value;
    const { selectionStart: s, selectionEnd: end } = a;
    const multi = text.slice(s, end).includes("\n");
    if (!e.shiftKey && !multi) {
      if (!insert(a, s, end, "  ")) onChange(`${text.slice(0, s)}  ${text.slice(end)}`);
      return;
    }
    const from = text.lastIndexOf("\n", s - 1) + 1;
    const lastLineEnd = text.indexOf("\n", end > s && text[end - 1] === "\n" ? end - 1 : end);
    const to = lastLineEnd < 0 ? text.length : lastLineEnd;
    const block = text.slice(from, to).split("\n");
    let firstShift = 0;
    let total = 0;
    const next = block.map((line, k) => {
      if (!e.shiftKey) {
        if (k === 0) firstShift = 2;
        total += 2;
        return `  ${line}`;
      }
      const cut = line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0;
      if (k === 0) firstShift = -cut;
      total -= cut;
      return line.slice(cut);
    });
    if (total === 0) return;
    const joined = next.join("\n");
    if (!insert(a, from, to, joined)) onChange(text.slice(0, from) + joined + text.slice(to));
    a.setSelectionRange(Math.max(from, s + firstShift), Math.max(from, end + total));
  };

  return (
    <div className="site-editor">
      <div className="site-editor-gutter" aria-hidden>
        <div ref={gutter}>
          {Array.from({ length: lines }, (_, k) => (
            <div key={k}>{k + 1}</div>
          ))}
        </div>
      </div>
      <div className="site-editor-body">
        <pre ref={layer} className="site-code site-editor-layer" aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
        <textarea
          ref={area}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onScroll={sync}
          onKeyDown={onKeyDown}
          onBlur={() => (escaped.current = false)}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          wrap="off"
          className="site-editor-input"
          aria-label={label}
          aria-describedby="site-editor-hint"
        />
      </div>
    </div>
  );
}
