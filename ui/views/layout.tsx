import { Children, createContext, isValidElement, useContext, useState, type ReactNode } from "react";
import type { ElementNode } from "../../core/ast";
import { findComponent } from "../../core/catalog";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { renderElementValue, renderNodes } from "../render";
import { GAP, Glyph, cn, num, str, useTone } from "./kit";

/** Set by the block frame: which Card carries the toolbar, and the toolbar itself. */
export const BlockContext = createContext<{ toolsFor: number | null; tools: ReactNode }>({ toolsFor: null, tools: null });

export function CardView({ props, children, node }: ViewProps) {
  const env = useEnv();
  const block = useContext(BlockContext);
  const state = str(props.state) ?? (env.mode === "picker" ? "waiting" : "done");
  const alive = state === "live" || state === "waiting";
  const tone = useTone(props.tone);
  const title = str(props.title);
  const subtitle = str(props.subtitle);
  const status = str(props.status);
  const hasHeader = Boolean(title || subtitle || props.icon || status || block.toolsFor === node.start);
  const footer = props.footer != null ? renderElementValue(props.footer) : null;
  const source = str(props.source);
  return (
    <section
      className="iris-card relative my-1 min-w-0 rounded-[14px] bg-card px-4 pt-3.5 pb-3 text-foreground shadow-[0_0_0_1px_var(--border),0_10px_28px_-22px_rgb(0_0_0/0.45)]"
      data-state={state}
      aria-label={title}
    >
      <i className="iris-edge" aria-hidden style={tone ? { background: tone } : undefined} />
      {hasHeader ? (
        <header className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
          {/* The title keeps at least 7.5rem; when the toolbar can't fit beside it, the toolbar takes its own line. */}
          {props.icon ? (
            <span className={cn("iris-glyph grid size-[30px] shrink-0 place-items-center rounded-full p-[1.5px]", alive && "iris-glyph-alive")}>
              <span className="grid size-full place-items-center rounded-full bg-card">
                <Glyph name={props.icon} size={15} color={tone} />
              </span>
            </span>
          ) : null}
          <div className="min-w-[7.5rem] flex-1 basis-0">
            {/* On a phone the title may take two lines and the status moves under it, so the toolbar never squeezes the title to a few letters. */}
            {title ? <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug @lg/iris:line-clamp-none @lg/iris:truncate">{title}</h3> : null}
            {subtitle ? <p className="truncate text-[12.5px] leading-snug text-muted-foreground">{subtitle}</p> : null}
            {status ? (
              <div className="mt-0.5 @lg/iris:hidden">
                <CardStatus state={state} text={status} />
              </div>
            ) : null}
          </div>
          {status ? (
            <div className="shrink-0 @max-lg/iris:hidden">
              <CardStatus state={state} text={status} />
            </div>
          ) : null}
          {block.toolsFor === node.start ? <div className="ml-auto shrink-0">{block.tools}</div> : null}
        </header>
      ) : null}
      <div className={cn("flex min-w-0 flex-col gap-3", hasHeader && "pt-3")}>{children}</div>
      {footer || source ? (
        <footer className="mt-3 flex min-w-0 flex-wrap items-center gap-2 pt-0.5 text-xs text-muted-foreground">
          {source ? <span className="truncate">{source}</span> : null}
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{footer}</div>
        </footer>
      ) : null}
    </section>
  );
}

function CardStatus({ state, text }: { state: string; text: string }) {
  const { palette } = useEnv();
  const dot = state === "waiting" ? palette.accent : state === "live" ? palette.tone.good : palette.tone.neutral;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs", state === "waiting" ? "iris-waitchip rounded-full px-2.5 py-0.5 text-foreground" : "text-muted-foreground")}>
      <span className={cn("size-1.5 rounded-full", state !== "done" && "iris-pulse")} style={{ background: dot }} aria-hidden />
      {text}
    </span>
  );
}

export function StackView({ props, children }: ViewProps) {
  const align = str(props.align);
  return (
    <div className={cn("flex min-w-0 flex-col", GAP[str(props.gap) ?? "md"] ?? "gap-3", align === "start" ? "items-start" : align === "end" ? "items-end" : align === "center" ? "items-center" : "items-stretch")}>
      {children}
    </div>
  );
}

export function RowView({ props, children }: ViewProps) {
  const justify = str(props.justify);
  const align = str(props.align);
  const equal = !justify;
  return (
    <div
      className={cn(
        "flex min-w-0",
        props.wrap === false ? "flex-nowrap" : "flex-wrap",
        GAP[str(props.gap) ?? "md"] ?? "gap-3",
        align === "center" ? "items-center" : align === "end" ? "items-end" : align === "baseline" ? "items-baseline" : align === "start" ? "items-start" : "items-stretch",
        justify === "between" ? "justify-between" : justify === "center" ? "justify-center" : justify === "end" ? "justify-end" : "",
        equal && "[&>*]:min-w-[8rem] [&>*]:flex-1 [&>*]:basis-0",
      )}
    >
      {children}
    </div>
  );
}

export function GridView({ props, children }: ViewProps) {
  const cols = Math.max(1, Math.min(6, num(props.columns) ?? 3));
  return (
    <div className={cn("grid min-w-0", GAP[str(props.gap) ?? "md"] ?? "gap-3")} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(9rem, calc((100% - ${cols - 1}rem) / ${cols}))), 1fr))` }}>
      {children}
    </div>
  );
}

export function TabsView({ props, node, scope }: ViewProps) {
  const env = useEnv();
  const tabs = node.children.filter((c): c is ElementNode => c.kind === "element" && findComponent(c.name)?.name === "Tab");
  const bind = str(props.bind);
  const labels = tabs.map((t, k) => {
    const { props: tp } = env.runtime.props(t, scope);
    return { label: str(tp.label) ?? `Tab ${k + 1}`, icon: tp.icon, badge: tp.badge };
  });
  const [local, setLocal] = useState(0);
  const boundIndex = bind ? labels.findIndex((l) => l.label === env.runtime.getState(bind)) : -1;
  const active = boundIndex >= 0 ? boundIndex : Math.min(local, Math.max(0, tabs.length - 1));
  const pick = (k: number) => {
    setLocal(k);
    if (bind && env.runtime.hasState(bind)) env.runtime.setState(bind, labels[k].label);
  };
  if (!tabs.length) return null;
  return (
    <div className="min-w-0">
      <div role="tablist" className="iris-scroll-x mb-3 flex gap-5 overflow-x-auto border-b border-border">
        {labels.map((l, k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={k === active}
            onClick={() => pick(k)}
            className={cn(
              // No side padding: the first label starts on the content edge and each underline is as wide as its label.
              "iris-hit -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-0 pb-2 pt-1 text-[13px] font-medium transition-colors",
              k === active ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {l.icon ? <Glyph name={l.icon} size={14} /> : null}
            {l.label}
            {l.badge != null ? <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{String(l.badge)}</span> : null}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex min-w-0 flex-col gap-3">
        {renderNodes(tabs[active].children, scope)}
      </div>
    </div>
  );
}

export function TabView({ children }: ViewProps) {
  // Rendered by Tabs; a stray Tab shows its content.
  return <div className="flex min-w-0 flex-col gap-3">{children}</div>;
}

export function DetailsView({ props, children }: ViewProps) {
  const [open, setOpen] = useState(props.open === true);
  return (
    <div className="min-w-0 rounded-lg ring-1 ring-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium hover:bg-state-hover rounded-lg">
        <Glyph name="chevron-right" size={14} className={cn("text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="min-w-0 flex-1 truncate">{str(props.title)}</span>
        {props.badge != null ? <span className="text-xs text-muted-foreground">{String(props.badge)}</span> : null}
      </button>
      {open ? <div className="flex min-w-0 flex-col gap-3 px-3 pb-3">{children}</div> : null}
    </div>
  );
}

export function DividerView({ props }: ViewProps) {
  const label = str(props.label);
  if (!label) return <hr className="my-0.5 border-0 border-t border-border" />;
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground" role="separator">
      <span className="h-px flex-1 bg-border" />
      {label}
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export function countChildren(children: ReactNode) {
  return Children.toArray(children).filter(isValidElement).length;
}
