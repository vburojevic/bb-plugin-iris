import { Markdown } from "@get-bb/plugin-sdk/app";
import { cn } from "../../lib/utils";

/** Markdown prose in bb's own message style, sized for cards. */
export function Prose({ text, className }: { text: string; className?: string }) {
  return <Markdown content={text} className={cn("iris-prose min-w-0 text-[13.5px] leading-relaxed", className)} />;
}
