// Turns the Iris tree into React. Each element evaluates its props in the scope
// it was written in, so a <Row> inside rows.map((r) => ...) sees r. A failing
// element shows its own error and leaves the rest of the card alone.

import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import type { ElementNode, Node } from "../core/ast";
import { findComponent, type ComponentSpec } from "../core/catalog";
import { type ElementValue, IrisError, type Scope, isActionValue, isElementValue, isFnValue, isPendingValue, toText } from "../core/evaluate";
import { DECLARATION_TAGS, asIrisError, position } from "../core/program";
import { collapse, dedent, didYouMean } from "../core/text";
import { ALL_TAG_NAMES } from "../core/catalog";
import { useEnv } from "./env";
import { Prose } from "./views/prose";
import { VIEWS } from "./views";

export interface ViewProps {
  props: Record<string, unknown>;
  /** Rendered children (for components that hold nodes). */
  children: ReactNode;
  /** Children as plain text when they are only text (raw, text and markdown components). */
  text: string | null;
  node: ElementNode;
  scope: Scope;
  spec: ComponentSpec;
}

export type View = (p: ViewProps) => ReactNode;

export function renderNodes(nodes: Node[], scope: Scope, markdownText = true): ReactNode[] {
  return nodes.map((n, k) => <NodeView key={`${n.start}:${k}`} node={n} scope={scope} markdownText={markdownText} />);
}

function NodeView({ node, scope, markdownText }: { node: Node; scope: Scope; markdownText: boolean }) {
  const env = useEnv();
  if (node.kind === "text") {
    const text = markdownText ? dedent(node.value) : collapse(node.value);
    if (!text.trim()) return null;
    return markdownText ? <Prose text={text} /> : <>{text}</>;
  }
  if (node.kind === "expr") {
    let value: unknown;
    try {
      env.runtime.interp.steps = 0;
      value = env.runtime.interp.eval(node.expr, scope);
    } catch (cause) {
      return <InlineError error={asIrisError(cause, node)} />;
    }
    return <>{renderValue(value)}</>;
  }
  return <ElementView node={node} scope={scope} />;
}

/** How a value from {expression} shows up. */
export function renderValue(value: unknown): ReactNode {
  if (value == null || typeof value === "boolean" || isActionValue(value) || isFnValue(value)) return null;
  if (Array.isArray(value)) return value.map((v, k) => <Fragment key={k}>{renderValue(v)}</Fragment>);
  if (isElementValue(value)) return <ElementView node={value.node} scope={value.scope} />;
  if (isPendingValue(value)) return <span className="iris-shimmer inline-block h-3 w-16 rounded align-middle" aria-label="Loading" />;
  return toText(value);
}

export function renderElementValue(v: unknown): ReactNode {
  if (isElementValue(v)) return <ElementView node={v.node} scope={v.scope} />;
  return renderValue(v);
}

export function ElementView({ node, scope }: { node: ElementNode; scope: Scope }) {
  const env = useEnv();
  if (DECLARATION_TAGS.has(node.name)) return null;
  if (node.name === "") return <>{renderNodes(node.children, scope)}</>;
  const spec = findComponent(node.name);
  if (!spec) {
    const hint = didYouMean(node.name, ALL_TAG_NAMES);
    return <InlineError error={new IrisError(`<${node.name}> is not an Iris component${hint ? `. Did you mean <${hint}>?` : ""}`, node.start, node.end)} />;
  }
  const View = VIEWS[spec.name];
  if (!View) return <InlineError error={new IrisError(`<${spec.name}> is coming in a later version of Iris`, node.start, node.end)} />;
  const { props, errors } = env.runtime.props(node, scope);
  if (errors.size) {
    const [name, err] = [...errors][0];
    return <InlineError error={err} context={`<${spec.name} ${name}>`} />;
  }
  coerce(spec, props);
  const textOnly = node.children.every((c) => c.kind === "text");
  let text: string | null = null;
  if (spec.children === "raw") text = rawText(node);
  else if (textOnly && (spec.children === "text" || spec.children === "markdown")) {
    text = spec.children === "text" ? collapse(node.children.map((c) => (c as { value: string }).value).join("")).trim() : dedent(node.children.map((c) => (c as { value: string }).value).join(""));
  } else if (spec.children === "text" && !textOnly) {
    // Text with {expressions} in it: evaluate to one string.
    text = node.children
      .map((c) => {
        if (c.kind === "text") return collapse(c.value);
        if (c.kind === "expr") {
          try {
            env.runtime.interp.steps = 0;
            return toText(env.runtime.interp.eval(c.expr, scope));
          } catch {
            return "";
          }
        }
        return "";
      })
      .join("")
      .trim();
  }
  const children = spec.children === "raw" || spec.children === "none" ? null : renderNodes(node.children, scope, spec.children !== "text");
  return (
    <Boundary label={spec.name} at={node.start}>
      <View props={props} node={node} scope={scope} spec={spec} text={text}>
        {children}
      </View>
    </Boundary>
  );
}

function rawText(node: ElementNode): string {
  return dedent(node.children.map((c) => (c.kind === "text" ? c.value : "")).join(""));
}

/** Forgives the common slips: numbers written as strings, a single item where a list goes. */
function coerce(spec: ComponentSpec, props: Record<string, unknown>) {
  for (const [k, v] of Object.entries(props)) {
    const p = spec.props[k];
    if (!p) continue;
    if (p.type === "number" && typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) props[k] = Number(v);
    if (p.type === "boolean" && (v === "true" || v === "false")) props[k] = v === "true";
    if (p.type === "list" && v != null && !Array.isArray(v) && !isPendingValue(v) && typeof v === "object" && !isElementValue(v)) {
      // An object of rows keyed by id reads as its values.
      props[k] = Object.values(v as object);
    }
  }
}

export function InlineError({ error, context }: { error: IrisError | Error; context?: string }) {
  const env = useEnv();
  const at = error instanceof IrisError && error.start !== undefined ? position(env.source, error.start) : null;
  const message = `${context ? `${context}: ` : ""}${error.message}`;
  return (
    <div role="alert" className="iris-error my-1 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-xs text-foreground">
      <span className="mt-0.5 size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
      <span className="min-w-0 flex-1">
        {message}
        {at ? <span className="text-muted-foreground"> (line {at.line})</span> : null}
      </span>
      {env.mode === "fence" && !env.streaming ? (
        <button
          type="button"
          className="shrink-0 font-medium text-foreground underline-offset-2 hover:underline"
          onClick={() => env.perform([{ $iris: "action", kind: "insert", args: [`Your Iris card has an error${at ? ` at line ${at.line}` : ""}: ${message}. Please fix it.`] }])}
        >
          Ask to fix
        </button>
      ) : null}
    </div>
  );
}

class Boundary extends Component<{ label: string; at: number; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn(`[iris] <${this.props.label}> failed`, error, info.componentStack);
  }
  componentDidUpdate(prev: { children: ReactNode }) {
    if (this.state.error && prev.children !== this.props.children) this.setState({ error: null });
  }
  render() {
    if (this.state.error) {
      const e = this.state.error instanceof IrisError ? this.state.error : new IrisError(this.state.error.message, this.props.at, this.props.at + 1);
      return <InlineError error={e} context={`<${this.props.label}>`} />;
    }
    return this.props.children;
  }
}

export type { ElementValue };
