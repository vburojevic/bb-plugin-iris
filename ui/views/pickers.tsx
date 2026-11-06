import { toText } from "../../core/evaluate";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Glyph, cn, str } from "./kit";

export function FollowUpsView({ props }: ViewProps) {
  const env = useEnv();
  const prompts = Array.isArray(props.prompts) ? props.prompts.map(toText).filter(Boolean) : [];
  const kind = props.mode === "send" ? "send" : "insert";
  return (
    <div className="iris-scroll-x -mx-0.5 flex gap-1.5 overflow-x-auto px-0.5 pb-0.5">
      {prompts.map((p) => (
        <button key={p} type="button" disabled={env.streaming} onClick={() => env.perform([{ $iris: "action", kind, args: [p] }])} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] ring-1 ring-border transition-colors hover:bg-state-hover disabled:opacity-50">
          <Glyph name="corner-down-right" size={13} className="text-muted-foreground" />
          {p}
        </button>
      ))}
    </div>
  );
}

export function ChoicesView({ props }: ViewProps) {
  const env = useEnv();
  const opts = (Array.isArray(props.options) ? props.options : []).map((o) =>
    o && typeof o === "object" ? (o as Record<string, unknown>) : ({ label: o } as Record<string, unknown>),
  );
  const pick = (o: Record<string, unknown>) => {
    if (env.submit) return env.submit({ choice: toText(o.label), prompt: str(o.prompt) });
    env.perform([{ $iris: "action", kind: "insert", args: [str(o.prompt) ?? toText(o.label)] }]);
  };
  return (
    <div className="min-w-0">
      {str(props.title) ? <div className="mb-2 text-[13px] text-muted-foreground">{str(props.title)}</div> : null}
      <div className="grid gap-1.5 @lg/iris:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))]">
        {opts.map((o, k) => (
          <button key={k} type="button" disabled={env.streaming} onClick={() => pick(o)} className={cn("group flex min-w-0 items-start gap-2.5 rounded-xl px-3 py-2.5 text-left ring-1 ring-border transition-colors hover:bg-state-hover disabled:opacity-50")}>
            {o.icon ? <Glyph name={o.icon} size={16} className="mt-0.5 text-muted-foreground" /> : null}
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-medium">{toText(o.label)}</span>
              {str(o.detail) ? <span className="block text-xs text-muted-foreground">{str(o.detail)}</span> : null}
            </span>
            <Glyph name="arrow-up-right" size={14} className="mt-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
    <div className="ml-auto flex items-center justify-end gap-3">
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
