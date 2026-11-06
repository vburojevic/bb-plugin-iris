import { useEffect, useId, useRef, useState } from "react";
import { formatRatio, grade, normalizeBackgrounds, normalizeSwatches, parseColor, toHex } from "../../core/design";
import { toText } from "../../core/evaluate";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { Chip, Glyph, cn, fmt, num, str, useTone } from "./kit";

function useBound(props: Record<string, unknown>): [unknown, (v: unknown) => void, string | undefined] {
  const env = useEnv();
  const name = str(props.bind);
  const value = name ? env.runtime.getState(name) : undefined;
  // A bind with no matching <state> still keeps what the person enters (and sends it with the
  // answer); iris_check tells the agent to declare it, but nothing typed is ever dropped.
  const set = (v: unknown) => {
    if (name) env.runtime.setState(name, v);
  };
  return [value, set, name];
}

interface Opt {
  value: unknown;
  label: string;
  detail?: string;
  icon?: unknown;
  badges?: { label: string; tone?: unknown }[];
}

/** An option's badges: a list of labels or {label, tone}, for effort, impact, "Recommended" and the like. */
function badges(raw: unknown): Opt["badges"] {
  if (!Array.isArray(raw)) return undefined;
  const out = raw
    .map((b) => (b && typeof b === "object" ? { label: toText((b as Record<string, unknown>).label ?? (b as Record<string, unknown>).text), tone: (b as Record<string, unknown>).tone } : { label: toText(b) }))
    .filter((b) => b.label);
  return out.length ? out : undefined;
}

function options(raw: unknown): Opt[] {
  return (Array.isArray(raw) ? raw : []).map((o) => {
    if (o && typeof o === "object") {
      const x = o as Record<string, unknown>;
      const value = x.value ?? x.label;
      return { value, label: toText(x.label ?? x.value), detail: str(x.detail), icon: x.icon, badges: badges(x.badges) };
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
  const numbered = props.numbered === true;
  const picked = (o: Opt) => (multi ? Array.isArray(value) && value.some((v) => same(v, o.value)) : same(o.value, value));
  const toggle = (o: Opt) => {
    if (!multi) return set(o.value);
    const cur = Array.isArray(value) ? value : [];
    set(cur.some((v) => same(v, o.value)) ? cur.filter((v) => !same(v, o.value)) : [...cur, o.value]);
  };
  const count = multi ? opts.filter(picked).length : 0;
  // A long multi-pick says how many are picked and offers all or none, so ten options stay quick to answer.
  const tally = multi && opts.length >= 5;
  // Six or more short, plain options sit in two columns when the card has room; options that carry a
  // detail line or badges read better one per row.
  const twoUp = opts.length >= 6 && !opts.some((o) => o.detail || o.badges || o.label.length > 32);
  return (
    // The header is a plain row (a <legend> can't share a line with the tally), so the options' group takes its name from the label.
    <fieldset className="min-w-0">
      {str(props.label) || tally ? (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          <span className="text-[12.5px] text-muted-foreground">{str(props.label)}</span>
          {tally ? (
            <span className="flex shrink-0 items-baseline gap-2 text-xs text-muted-foreground">
              <span className="tabular-nums" aria-live="polite" aria-label={`${count} of ${opts.length} picked`}>
                {count} of {opts.length}
              </span>
              <button type="button" onClick={() => set(count === opts.length ? [] : opts.filter((o, i) => opts.findIndex((x) => same(x.value, o.value)) === i).map((o) => o.value))} className="iris-hit rounded px-1 font-medium text-foreground hover:bg-state-hover">
                {count === opts.length ? "None" : "All"}
              </button>
            </span>
          ) : null}
        </div>
      ) : null}
      <div className={cn("grid gap-1.5", twoUp && "@lg/iris:grid-cols-2")} role={multi ? "group" : "radiogroup"} aria-label={str(props.label)}>
        {opts.map((o, i) => {
          const on = picked(o);
          return (
            <button key={`${i}:${o.label}`} type="button" role={multi ? "checkbox" : "radio"} aria-checked={on} onClick={() => toggle(o)} className={cn("flex min-w-0 items-start gap-2.5 rounded-xl px-3 py-2 text-left ring-1 transition-shadow", on ? "iris-picked ring-transparent" : "ring-border hover:bg-state-hover")}>
              <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center ring-[1.5px]", multi ? "rounded-[5px]" : "rounded-full", on ? "bg-foreground ring-foreground" : "ring-border")}>
                {on ? multi ? <Glyph name="check" size={11} className="text-background" /> : <span className="size-1.5 rounded-full bg-background" /> : null}
              </span>
              {numbered ? <span className="mt-px w-4 shrink-0 text-right text-[13px] tabular-nums text-muted-foreground">{i + 1}</span> : null}
              {o.icon ? <Glyph name={o.icon} size={15} className="mt-0.5 shrink-0 text-muted-foreground" /> : null}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13.5px]">{o.label}</span>
                  {o.badges?.map((b, k) => (
                    <Chip key={k} tone={b.tone}>
                      {b.label}
                    </Chip>
                  ))}
                </span>
                {o.detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{o.detail}</span> : null}
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

/**
 * A typed color, opaque: "#FF7A3D", "ff7a3d", "rgb(...)" or "hsl(...)". Hex takes 6 digits while
 * typing (so "#FF7" on its way to "#FF7A3D" never lands in the state) and 3 once the field is left.
 */
const readColor = (raw: string, done = false) => {
  const t = raw.trim().replace(/^#/, "");
  if (/^[0-9a-f]+$/i.test(t)) return t.length === 6 || (done && t.length === 3) ? parseColor(`#${t}`) : null;
  return parseColor(raw.trim());
};

/** A color field: a swatch that opens the system picker, a hex field, presets, and contrast on the backgrounds it will sit on. */
export function ColorInputView({ props }: ViewProps) {
  const id = useId();
  const [value, set] = useBound(props);
  const rgb = parseColor(value);
  const hex = rgb ? toHex(rgb) : "";
  // The hex field keeps what is typed until it parses, so a half-typed color never reaches the state.
  const [draft, setDraft] = useState<string | null>(null);
  const presets = normalizeSwatches(props.presets).slice(0, 16).flatMap((s) => {
    const c = parseColor(s.value);
    return c ? [{ name: s.name, hex: toHex(c) }] : [];
  });
  // Graded only on the backgrounds given; none given means no grading, not white and black.
  const onList = (Array.isArray(props.on) ? props.on : props.on == null || props.on === "" ? [] : [props.on]).filter((b) => b != null && b !== "");
  const backgrounds = onList.length ? normalizeBackgrounds(onList).filter((b) => parseColor(b.value)).slice(0, 3) : [];
  // A state this field can't read (a name, a token) still shows as typed rather than as blank.
  const shownText = hex || (value == null ? "" : toText(value));
  // The agent changed the color while a valid draft was held: the field follows the new color.
  useEffect(() => {
    if (draft == null) return;
    const c = readColor(draft);
    if (c && toHex(c) !== hex) setDraft(null);
  }, [hex]); // eslint-disable-line react-hooks/exhaustive-deps
  const presetIndex = presets.findIndex((s) => s.hex === hex);
  const presetRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pickPreset = (k: number, focus = false) => {
    const next = (k + presets.length) % presets.length;
    setDraft(null);
    set(presets[next].hex);
    if (focus) presetRefs.current[next]?.focus();
  };
  const invalid = draft != null && draft.trim() !== "" && !readColor(draft, true);
  const bad = useTone("bad");
  return (
    <Field label={str(props.label)} htmlFor={id}>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <label className="iris-hit relative grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg shadow-[0_0_0_1px_var(--border)]" style={{ background: hex || "transparent" }} title="Pick a color">
          {hex ? null : <Glyph name="pipette" size={14} className="text-muted-foreground" />}
          <input type="color" aria-label={`${str(props.label) ?? "Color"} picker`} value={(hex || "#808080").toLowerCase()} onChange={(e) => set(e.target.value.toUpperCase())} className="absolute inset-0 size-full cursor-pointer opacity-0" />
        </label>
        <input
          id={id}
          value={draft ?? shownText}
          placeholder="#RRGGBB"
          spellCheck={false}
          aria-invalid={invalid || undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            const c = readColor(e.target.value);
            if (c) set(toHex(c));
          }}
          onBlur={() => {
            if (draft != null) {
              const c = readColor(draft, true);
              if (c) set(toHex(c));
            }
            setDraft(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className="iris-field h-8 w-28 rounded-lg bg-card px-2.5 font-mono text-[13px] uppercase ring-1 ring-border outline-none focus-visible:ring-foreground/40"
          style={invalid && bad ? { boxShadow: `0 0 0 1px ${bad}` } : undefined}
        />
        {rgb
          ? backgrounds.map((b, k) => {
              const bg = parseColor(b.value);
              if (!bg) return null;
              const g = grade(rgb, bg);
              const verdict = g.aa ? { label: "AA", tone: "good" } : g.aaLarge ? { label: "AA Large", tone: "warn" } : { label: "Fails", tone: "bad" };
              return (
                <span key={k} className="inline-flex h-8 items-center gap-2 rounded-lg pr-2 shadow-[0_0_0_1px_var(--border)]" title={`${formatRatio(g.ratio)} on ${b.name}`}>
                  <span className="grid h-full place-items-center rounded-l-lg px-2 text-[13px] font-semibold" style={{ background: b.value, color: hex }}>
                    Aa
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatRatio(g.ratio)} on {b.name}
                  </span>
                  <Chip tone={verdict.tone}>{verdict.label}</Chip>
                </span>
              );
            })
          : null}
      </div>
      {presets.length ? (
        <div
          role="radiogroup"
          aria-label="Presets"
          onKeyDown={(e) => {
            const from = presetIndex >= 0 ? presetIndex : 0;
            const k = e.key === "ArrowRight" || e.key === "ArrowDown" ? from + 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? from - 1 : null;
            if (k == null) return;
            e.preventDefault();
            pickPreset(k, true);
          }}
          className="iris-scroll-x -m-1 mt-1.5 flex gap-1.5 overflow-x-auto p-1"
        >
          {presets.map((s, k) => {
            const on = k === presetIndex;
            return (
              <button
                key={k}
                ref={(el) => {
                  presetRefs.current[k] = el;
                }}
                type="button"
                role="radio"
                aria-checked={on}
                tabIndex={on || (presetIndex < 0 && k === 0) ? 0 : -1}
                aria-label={s.name === s.hex || /^#/.test(s.name) ? s.hex : `${s.name}, ${s.hex}`}
                title={s.name}
                onClick={() => pickPreset(k)}
                className={cn("iris-hit iris-swatch size-7 shrink-0 rounded-full transition-shadow", on ? "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--foreground)]" : "shadow-[0_0_0_1px_var(--border)] hover:shadow-[0_0_0_2px_var(--card),0_0_0_3px_var(--border)]")}
                style={{ background: s.hex }}
              />
            );
          })}
        </div>
      ) : null}
    </Field>
  );
}
