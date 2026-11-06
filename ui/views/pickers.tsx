import type { Node } from "../../core/ast";
import { toText } from "../../core/evaluate";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Glyph, cn, str } from "./kit";

export function FollowUpsView({ props }: ViewProps) {
  const env = useEnv();
  const prompts = Array.isArray(props.prompts) ? props.prompts.map(toText).filter(Boolean) : [];
  const kind = props.mode === "send" ? "send" : "insert";
  return (
    // A sideways scroller clips on every side, and each pill's outline sits just outside its box:
    // two pixels of room all round keep it whole, and the matching negative margin keeps the layout.
    <div className="iris-scroll-x -m-0.5 flex gap-1.5 overflow-x-auto p-0.5">
      {prompts.map((p) => (
        <button key={p} type="button" disabled={env.streaming} onClick={() => env.perform([{ $iris: "action", kind, args: [p] }])} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] ring-1 ring-border transition-colors hover:bg-state-hover disabled:opacity-50">
          <Glyph name="corner-down-right" size={13} className="text-muted-foreground" />
          {p}
        </button>
      ))}
    </div>
  );
}

/**
 * Whether the card has a plain <Submit> that sends every input. Only element tags count (not text
 * in a string or a code sample), and a Submit with its own value doesn't, since it would leave the
 * pick behind. Missing one is safe: Choices then answers at once.
 */
function sendsAnswers(nodes: Node[]): boolean {
  return nodes.some((n) => n.kind === "element" && ((n.name === "Submit" && !n.attrs.some((a) => a.name === "value")) || sendsAnswers(n.children)));
}

/** Columns that fill evenly: no lone option on the last row when the count allows it. */
function cols(opts: Record<string, unknown>[]): string {
  const n = opts.length;
  if (n < 2) return "";
  const wide = opts.some((o) => str(o.detail) || toText(o.label).length > 32);
  if (wide) return n % 2 === 0 ? "@lg/iris:grid-cols-2" : "";
  if (n % 3 === 0 || (n % 2 === 1 && n >= 5)) return "@lg/iris:grid-cols-2 @2xl/iris:grid-cols-3";
  return "@lg/iris:grid-cols-2";
}

export function ChoicesView({ props }: ViewProps) {
  const env = useEnv();
  const opts = (Array.isArray(props.options) ? props.options : []).map((o) =>
    o && typeof o === "object" ? (o as Record<string, unknown>) : ({ label: o } as Record<string, unknown>),
  );
  // In a picker with its own Send button, a choice is a selection (kept as "choice") that goes with
  // the note and every other input when the person sends. Without one, a click answers at once and
  // still carries whatever else the card holds.
  const selects = Boolean(env.submit) && sendsAnswers(env.runtime.program.nodes);
  const chosen = selects ? toText(env.runtime.getState("choice") ?? "") : "";
  const pick = (o: Record<string, unknown>) => {
    if (selects) {
      env.runtime.setState("choice", toText(o.label));
      // The option's prompt rides along as "prompt", unless the card has its own input by that name.
      if (str(o.prompt) !== undefined && !env.runtime.program.states.some((d) => d.name === "prompt")) env.runtime.setState("prompt", str(o.prompt));
      return;
    }
    if (env.submit) return env.submit({ ...env.runtime.answers(), choice: toText(o.label), prompt: str(o.prompt) });
    env.perform([{ $iris: "action", kind: "insert", args: [str(o.prompt) ?? toText(o.label)] }]);
  };
  return (
    <div className="min-w-0">
      {str(props.title) ? <div className="mb-2 text-[13px] text-muted-foreground">{str(props.title)}</div> : null}
      <div className={cn("grid gap-1.5", cols(opts))}>
        {opts.map((o, k) => (
          <button key={k} type="button" disabled={env.streaming} onClick={() => pick(o)} aria-pressed={selects ? chosen === toText(o.label) : undefined} className={cn("group flex min-w-0 items-start gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors disabled:opacity-50", selects && chosen === toText(o.label) ? "iris-picked ring-transparent" : "ring-border hover:bg-state-hover")}>
            {o.icon ? <Glyph name={o.icon} size={16} className="mt-0.5 text-muted-foreground" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">{toText(o.label)}</span>
              {str(o.detail) ? <span className="block text-xs text-muted-foreground">{str(o.detail)}</span> : null}
            </span>
            {selects ? null : <Glyph name="arrow-up-right" size={14} className="mt-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SubmitView({ props, text }: ViewProps) {
  const env = useEnv();
  const label = text || str(props.label) || "Send answer";
  // Outside a waiting picker there is no one to answer: the button shows, switched off, and says why.
  const live = Boolean(env.submit);
  return (
    // In a waiting picker that scrolls, the Send row stays pinned to its bottom edge (AskPicker marks data-overflow).
    <div className={cn("ml-auto flex items-center justify-end gap-3", env.mode === "picker" && "-mx-1 w-[calc(100%+0.5rem)] px-1 pt-2 pb-1 group-data-[overflow]/picker:sticky group-data-[overflow]/picker:bottom-[calc(-1*var(--iris-picker-b,0px))] group-data-[overflow]/picker:mx-[calc(-1*var(--iris-picker-x,4px))] group-data-[overflow]/picker:w-[calc(100%+2*var(--iris-picker-x,4px))] group-data-[overflow]/picker:px-[var(--iris-picker-x,4px)] group-data-[overflow]/picker:pb-[calc(var(--iris-picker-b,0px)+0.25rem)] group-data-[overflow]/picker:z-[1] group-data-[overflow]/picker:border-t group-data-[overflow]/picker:border-border group-data-[overflow]/picker:[background:var(--iris-picker-bg,var(--card))]")}>
      {live ? null : <span className="text-xs text-muted-foreground">Sends in an iris_ask picker</span>}
      <button
        type="button"
        disabled={!live}
        title={live ? undefined : "Sends the answer when this card is an iris_ask picker"}
        onClick={() => env.submit?.(props.value !== undefined ? props.value : env.runtime.answers())}
        className={cn("iris-hit inline-flex h-8 w-fit shrink-0 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium disabled:opacity-50", props.variant === "secondary" ? "ring-1 ring-border hover:bg-state-hover" : "bg-foreground text-background hover:opacity-90")}
      >
        {label}
        <Glyph name="arrow-up" size={14} />
      </button>
    </div>
  );
}
