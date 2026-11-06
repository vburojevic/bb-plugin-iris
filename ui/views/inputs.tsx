import { useId, useState } from "react";
import { toText } from "../../core/evaluate";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Glyph, cn, fmt, num, str } from "./kit";

function useBound(props: Record<string, unknown>): [unknown, (v: unknown) => void, string | undefined] {
  const env = useEnv();
  const name = str(props.bind);
  const value = name ? env.runtime.getState(name) : undefined;
  const set = (v: unknown) => {
    if (name && env.runtime.hasState(name)) env.runtime.setState(name, v);
  };
  return [value, set, name];
}

interface Opt {
  value: unknown;
  label: string;
  detail?: string;
  icon?: unknown;
}

function options(raw: unknown): Opt[] {
  return (Array.isArray(raw) ? raw : []).map((o) => {
    if (o && typeof o === "object") {
      const x = o as Record<string, unknown>;
      const value = x.value ?? x.label;
      return { value, label: toText(x.label ?? x.value), detail: str(x.detail), icon: x.icon };
    }
    return { value: o, label: toText(o) };
  });
}

const same = (a: unknown, b: unknown) => a === b || toText(a) === toText(b);

function Field({ label, htmlFor, children, right }: { label?: string; htmlFor?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      {label || right ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label ? (
            <label htmlFor={htmlFor} className="text-[12.5px] text-muted-foreground">
              {label}
            </label>
          ) : (
            <span />
          )}
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export function SliderView({ props }: ViewProps) {
  const id = useId();
  const [value, set] = useBound(props);
  const min = num(props.min) ?? 0;
  const max = num(props.max) ?? 100;
  const step = num(props.step) ?? 1;
  const v = num(value) ?? min;
  const pct = ((v - min) / (max - min || 1)) * 100;
  return (
    <Field label={str(props.label)} htmlFor={id} right={<output className="text-[13px] font-medium tabular-nums">{fmt(v, props.format)}</output>}>
      <input id={id} type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} className="iris-range w-full" style={{ ["--iris-fill" as string]: `${pct}%` }} />
    </Field>
  );
}

export function StepperView({ props }: ViewProps) {
  const [value, set] = useBound(props);
  const step = num(props.step) ?? 1;
  const min = num(props.min);
  const max = num(props.max);
  const v = num(value) ?? 0;
  const clamp = (x: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, x));
  return (
    <Field label={str(props.label)}>
      <div className="inline-flex h-8 items-center rounded-full ring-1 ring-border">
        <button type="button" className="iris-hit grid size-8 place-items-center rounded-l-full hover:bg-state-hover disabled:opacity-40" disabled={min != null && v <= min} onClick={() => set(clamp(v - step))} aria-label="Decrease">
          <Glyph name="minus" size={14} />
        </button>
        <span className="min-w-10 px-1 text-center text-[13.5px] font-medium tabular-nums" aria-live="polite">
          {v}
        </span>
        <button type="button" className="iris-hit grid size-8 place-items-center rounded-r-full hover:bg-state-hover disabled:opacity-40" disabled={max != null && v >= max} onClick={() => set(clamp(v + step))} aria-label="Increase">
          <Glyph name="plus" size={14} />
        </button>
      </div>
    </Field>
  );
}

export function ToggleView({ props }: ViewProps) {
  const id = useId();
  const [value, set] = useBound(props);
  const on = Boolean(value);
  return (
    <label htmlFor={id} className="flex min-w-0 cursor-pointer items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px]">{str(props.label)}</span>
        {str(props.detail) ? <span className="block text-xs text-muted-foreground">{str(props.detail)}</span> : null}
      </span>
      <button id={id} type="button" role="switch" aria-checked={on} onClick={() => set(!on)} className={cn("iris-hit relative h-5 w-9 shrink-0 rounded-full transition-colors", on ? "bg-foreground" : "bg-muted ring-1 ring-border")}>
        <span className={cn("absolute top-0.5 size-4 rounded-full shadow transition-[left]", on ? "left-[18px] bg-background" : "left-0.5 bg-muted-foreground")} />
      </button>
    </label>
  );
}

export function SegmentedView({ props }: ViewProps) {
  const [value, set] = useBound(props);
  const opts = options(props.options);
  return (
    <Field label={str(props.label)}>
      <div role="radiogroup" className="iris-scroll-x inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-muted/70 p-0.5">
        {opts.map((o) => {
          const active = same(o.value, value);
          return (
            <button key={o.label} type="button" role="radio" aria-checked={active} onClick={() => set(o.value)} className={cn("iris-hit inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors", active ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}>
              {o.icon ? <Glyph name={o.icon} size={13} /> : null}
              {o.label}
            </button>
          );
        })}
      </div>
    </Field>
  );
}

export function SelectView({ props }: ViewProps) {
  const id = useId();
  const [value, set] = useBound(props);
  const opts = options(props.options);
  const index = opts.findIndex((o) => same(o.value, value));
  return (
    <Field label={str(props.label)} htmlFor={id}>
      <div className="relative">
        <select id={id} value={index} onChange={(e) => set(opts[Number(e.target.value)]?.value)} className="iris-field h-8 w-full appearance-none rounded-lg bg-card pl-3 pr-8 text-[13.5px] ring-1 ring-border outline-none focus-visible:ring-foreground/40">
          {index < 0 ? <option value={-1}>{str(props.placeholder) ?? "Choose"}</option> : null}
          {opts.map((o, k) => (
            <option key={k} value={k}>
              {o.label}
            </option>
          ))}
        </select>
        <Glyph name="chevrons-up-down" size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
      </div>
    </Field>
  );
}

function OptionList({ props, multi }: { props: Record<string, unknown>; multi: boolean }) {
  const [value, set] = useBound(props);
  const opts = options(props.options);
  const picked = (o: Opt) => (multi ? Array.isArray(value) && value.some((v) => same(v, o.value)) : same(o.value, value));
  const toggle = (o: Opt) => {
    if (!multi) return set(o.value);
    const cur = Array.isArray(value) ? value : [];
    set(cur.some((v) => same(v, o.value)) ? cur.filter((v) => !same(v, o.value)) : [...cur, o.value]);
  };
  return (
    <fieldset className="min-w-0">
      {str(props.label) ? <legend className="mb-1.5 text-[12.5px] text-muted-foreground">{str(props.label)}</legend> : null}
      <div className="flex flex-col gap-1.5" role={multi ? "group" : "radiogroup"}>
        {opts.map((o) => {
          const on = picked(o);
          return (
            <button key={o.label} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on} onClick={() => toggle(o)} className={cn("flex min-w-0 items-start gap-2.5 rounded-xl px-3 py-2 text-left ring-1 transition-shadow", on ? "iris-picked ring-transparent" : "ring-border hover:bg-state-hover")}>
              <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center ring-[1.5px]", multi ? "rounded-[5px]" : "rounded-full", on ? "bg-foreground ring-foreground" : "ring-border")}>
                {on ? multi ? <Glyph name="check" size={11} className="text-background" /> : <span className="size-1.5 rounded-full bg-background" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px]">{o.label}</span>
                {o.detail ? <span className="block text-xs text-muted-foreground">{o.detail}</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function RadioView({ props }: ViewProps) {
  return <OptionList props={props} multi={false} />;
}

export function ChecklistView({ props }: ViewProps) {
  return <OptionList props={props} multi />;
}

export function InputView({ props }: ViewProps) {
  const id = useId();
  const [value, set] = useBound(props);
  const type = str(props.type) ?? "text";
  return (
    <Field label={str(props.label)} htmlFor={id}>
      <input
        id={id}
        type={type}
        value={value == null ? "" : String(value)}
        placeholder={str(props.placeholder)}
        onChange={(e) => set(type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
        className="iris-field h-8 w-full rounded-lg bg-card px-3 text-[13.5px] ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-foreground/40"
      />
    </Field>
  );
}

export function TextAreaView({ props }: ViewProps) {
  const id = useId();
  const [value, set] = useBound(props);
  return (
    <Field label={str(props.label)} htmlFor={id}>
      <textarea id={id} rows={num(props.rows) ?? 3} value={value == null ? "" : String(value)} placeholder={str(props.placeholder)} onChange={(e) => set(e.target.value)} className="w-full resize-y rounded-lg bg-card px-3 py-2 text-[13.5px] leading-relaxed ring-1 ring-border outline-none placeholder:text-muted-foreground focus-visible:ring-foreground/40" />
    </Field>
  );
}

export function DateInputView({ props }: ViewProps) {
  const id = useId();
  const [value, set] = useBound(props);
  return (
    <Field label={str(props.label)} htmlFor={id}>
      <input id={id} type="date" value={value == null ? "" : String(value)} min={str(props.min)} max={str(props.max)} onChange={(e) => set(e.target.value)} className="iris-field h-8 rounded-lg bg-card px-3 text-[13.5px] ring-1 ring-border outline-none focus-visible:ring-foreground/40" />
    </Field>
  );
}

export function RatingView({ props }: ViewProps) {
  const env = useEnv();
  const [value, set] = useBound(props);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, Math.min(10, num(props.max) ?? 5));
  const v = hover ?? num(value) ?? 0;
  return (
    <Field label={str(props.label)}>
      <div className="flex gap-0.5" role="radiogroup" onPointerLeave={() => setHover(null)}>
        {Array.from({ length: max }, (_, k) => (
          <button key={k} type="button" role="radio" aria-checked={num(value) === k + 1} aria-label={`${k + 1} of ${max}`} onPointerEnter={() => setHover(k + 1)} onClick={() => set(k + 1)} className="iris-hit p-0.5">
            <Glyph name="star" size={20} color={k < v ? env.palette.tone.warn : undefined} className={k < v ? "[&_*]:fill-current" : "text-muted-foreground/50"} />
          </button>
        ))}
      </div>
    </Field>
  );
}

const BUTTON: Record<string, string> = {
  primary: "bg-foreground text-background hover:opacity-90",
  secondary: "ring-1 ring-border hover:bg-state-hover",
  ghost: "text-muted-foreground hover:bg-state-hover hover:text-foreground",
  destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
};

export function ButtonView({ props, text }: ViewProps) {
  const env = useEnv();
  const variant = str(props.variant) ?? "secondary";
  return (
    <button
      type="button"
      disabled={props.disabled === true || env.streaming}
      onClick={() => env.run(props.onClick)}
      className={cn("iris-hit inline-flex w-fit shrink-0 items-center justify-center gap-1.5 rounded-full font-medium transition-[opacity,background-color] disabled:pointer-events-none disabled:opacity-50", props.size === "sm" ? "h-7 px-3 text-[12.5px]" : "h-8 px-3.5 text-[13px]", BUTTON[variant] ?? BUTTON.secondary)}
    >
      {props.icon ? <Glyph name={props.icon} size={14} /> : null}
      {text}
    </button>
  );
}
