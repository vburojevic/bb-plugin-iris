// Inline Markdown for short text inside components (table cells, list details): **bold**,
// *italic* or _italic_, `code` and [links](https://...). Built as React elements, never HTML,
// so a cell's text can't inject markup. Block syntax (headings, lists) stays plain text.
import type { ReactNode } from "react";
import { useEnv } from "../env";

const TOKEN = /\*\*([^*\n]+)\*\*|`([^`\n]+)`|\[([^\]\n]{1,200})\]\((https:\/\/[^)\s]{1,2000})\)|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/g;

/** True when the text holds any inline Markdown worth rendering. */
export function hasInlineMarkdown(s: string): boolean {
  TOKEN.lastIndex = 0;
  const found = TOKEN.test(s);
  // test() on a global regex moves lastIndex, and matchAll would start from there.
  TOKEN.lastIndex = 0;
  return found;
}

export function InlineMarkdown({ text }: { text: string }) {
  const env = useEnv();
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    last = at + m[0].length;
    if (m[1] !== undefined) out.push(<strong key={k++} className="font-semibold text-foreground">{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<code key={k++} className="rounded bg-muted px-1 py-px font-mono text-[0.92em]">{m[2]}</code>);
    else if (m[3] !== undefined) {
      const url = m[4];
      out.push(
        <a
          key={k++}
          href={url}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            env.perform([{ $iris: "action", kind: "openUrl", args: [url] }]);
          }}
          className="underline decoration-border underline-offset-2 hover:text-foreground"
        >
          {m[3]}
        </a>,
      );
    } else out.push(<em key={k++}>{m[5] ?? m[6]}</em>);
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}
