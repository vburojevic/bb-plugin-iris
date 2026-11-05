// Inline Markdown for short text inside components (table cells, list details): **bold**,
// *italic* or _italic_, `code` and [links](https://...). Built as React elements, never HTML,
// so a cell's text can't inject markup. Block syntax (headings, lists) stays plain text.
import type { ReactNode } from "react";
import { useEnv } from "../env";

// No lookbehind (older WebKit can't parse it): an italic's opening mark captures the character
// before it, which goes back into the text as is.
const TOKEN = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]{1,200})\]\((https:\/\/[^)\s]{1,2000})\)|(^|[^\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(^|[^\w_])_([^_\s][^_\n]*?)_(?![\w_])/g;

/** True when the text holds any inline Markdown worth rendering. */
export function hasInlineMarkdown(s: string): boolean {
  TOKEN.lastIndex = 0;
  const found = TOKEN.test(s);
  // test() on a global regex moves lastIndex, and matchAll would start from there.
  TOKEN.lastIndex = 0;
  return found;
}

export type InlinePart = string | { kind: "strong" | "code" | "em"; text: string } | { kind: "link"; text: string; url: string };

/** Splits text into plain runs and Markdown spans; never builds HTML. */
export function inlineParts(text: string): InlinePart[] {
  const out: InlinePart[] = [];
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    const lead = m[5] ?? m[7] ?? "";
    const at = (m.index ?? 0) + lead.length;
    if (at > last) out.push(text.slice(last, at));
    last = (m.index ?? 0) + m[0].length;
    if (m[1] !== undefined) out.push({ kind: "strong", text: m[1] });
    else if (m[2] !== undefined) out.push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined) out.push({ kind: "link", text: m[3], url: m[4] });
    else out.push({ kind: "em", text: m[6] ?? m[8] });
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function InlineMarkdown({ text }: { text: string }) {
  const env = useEnv();
  return (
    <>
      {inlineParts(text).map((part, k) => {
        if (typeof part === "string") return part;
        if (part.kind === "strong") return <strong key={k} className="font-semibold text-foreground">{part.text}</strong>;
        if (part.kind === "code") return <code key={k} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">{part.text}</code>;
        if (part.kind !== "link") return <em key={k}>{part.text}</em>;
        const url = part.url;
        return (
          <a
            key={k}
            href={url}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              env.perform([{ $iris: "action", kind: "openUrl", args: [url] }]);
            }}
            className="underline decoration-border underline-offset-2 hover:text-foreground"
          >
            {part.text}
          </a>
        );
      })}
    </>
  );
}
