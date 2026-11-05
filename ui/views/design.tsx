// Design review kit views: DeviceFrame (a screenshot in a plain device or
// window frame), Swatches (colors with WCAG contrast), TypeSpecimen (a font
// at each size and weight) and Annotate (numbered callouts on a screenshot).
// Frames are drawn from theme tokens; no brand artwork. Color math lives in
// core/design.ts.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { isPendingValue } from "../../core/evaluate";
import {
  type Background,
  type Grade,
  type Rgb,
  type Swatch,
  DEVICE_SPECS,
  WEIGHT_NAMES,
  deviceOf,
  displayHost,
  fontStack,
  formatRatio,
  grade,
  normalizeBackgrounds,
  normalizeSizes,
  normalizeSwatches,
  normalizeWeights,
  parseColor,
  screenAspect,
  toHex,
} from "../../core/design";
import { type Callout, normalizeCallouts } from "../../core/media";
import { useEnv } from "../env";
import { useLoadedImage } from "../files";
import type { ViewProps } from "../render";
import { Chip, Glyph, Shimmer, cn, num, str, useTone } from "./kit";
import { ImageProblem, NumberPin, useWidth } from "./media";

// ---------- DeviceFrame ----------

/** A neutral frame color from the theme: a little foreground in the card. */
const BEZEL = "color-mix(in oklab, var(--foreground) 16%, var(--card))";
const BEZEL_EDGE = "color-mix(in oklab, var(--foreground) 26%, var(--card))";
const CHROME = "color-mix(in oklab, var(--foreground) 6%, var(--card))";

export function DeviceFrameView({ props }: ViewProps) {
  const device = deviceOf(props.device);
  const landscape = props.landscape === true;
  const spec = DEVICE_SPECS[device];
  const src = str(props.src) ?? "";
  const image = useLoadedImage(src);
  const turned = landscape && (device === "iphone" || device === "ipad");
  const base = num(props.width) ?? (turned ? Math.round(spec.width / spec.aspect) : spec.width);
  const width = Math.max(140, Math.min(1400, base));
  const aspect = screenAspect(device, landscape);
  const fit = str(props.fit) === "contain" ? "contain" : "cover";
  // Bezels and corners follow the width the frame really gets, so a phone squeezed into a narrow column keeps its shape.
  const [frameRef, measured] = useWidth<HTMLDivElement>();
  const drawn = measured > 0 ? Math.min(measured, width) : width;
  const screen = (
    <div className="relative w-full overflow-hidden bg-muted" style={{ aspectRatio: String(aspect), borderRadius: "inherit" }}>
      {image.status === "ok" ? (
        <img src={image.url} alt={str(props.alt) ?? ""} className={cn("absolute inset-0 h-full w-full", fit === "cover" ? "object-cover object-top" : "object-contain")} />
      ) : image.status === "loading" ? (
        <Shimmer className="absolute inset-0 rounded-none" />
      ) : (
        <div className="absolute inset-0 grid place-items-center p-3">
          <ImageProblem state={image} src={src} />
        </div>
      )}
    </div>
  );
  let frame: ReactNode;
  if (device === "iphone" || device === "ipad") {
    const short = turned ? drawn / aspect : drawn;
    const bezel = Math.max(5, Math.round(short * (device === "iphone" ? 0.04 : 0.035)));
    const outer = Math.round(short * (device === "iphone" ? 0.15 : 0.06));
    frame = (
      <div ref={frameRef} className="relative" style={{ width, maxWidth: "100%" }}>
        <SideButtons device={device} turned={turned} />
        <div className="relative" style={{ padding: bezel, borderRadius: outer, background: BEZEL, boxShadow: `inset 0 0 0 1px ${BEZEL_EDGE}, 0 18px 40px -28px rgb(0 0 0 / 0.55)` }}>
          <div style={{ borderRadius: Math.max(2, outer - bezel) }} className="overflow-hidden">
            {screen}
          </div>
        </div>
      </div>
    );
  } else {
    const host = device === "browser" ? displayHost(props.url) : undefined;
    frame = (
      <div ref={frameRef} className="overflow-hidden rounded-[10px]" style={{ width, maxWidth: "100%", boxShadow: `0 0 0 1px ${BEZEL_EDGE}, 0 18px 40px -28px rgb(0 0 0 / 0.55)` }}>
        <div className="flex h-8 items-center gap-2 px-3" style={{ background: CHROME, borderBottom: `1px solid ${BEZEL_EDGE}` }}>
          <span className="flex shrink-0 gap-1.5" aria-hidden>
            {[0, 1, 2].map((k) => (
              <i key={k} className="block size-2.5 rounded-full" style={{ background: BEZEL_EDGE }} />
            ))}
          </span>
          {device === "browser" ? (
            <>
              {drawn >= 360 ? (
                <span className="flex shrink-0 gap-1 text-muted-foreground" aria-hidden>
                  <Glyph name="chevron-left" size={14} />
                  <Glyph name="chevron-right" size={14} className="opacity-50" />
                </span>
              ) : null}
              <span className={cn("mx-auto flex h-5 min-w-0 flex-1", drawn >= 360 && "max-w-[70%]", " items-center justify-center gap-1 rounded-md bg-card px-2 text-[11px] text-muted-foreground")} style={{ boxShadow: `inset 0 0 0 1px ${BEZEL_EDGE}` }}>
                <Glyph name="lock" size={10} />
                <span className="truncate">{host ?? ""}</span>
              </span>
              {drawn >= 360 ? <span className="w-[52px] shrink-0" aria-hidden /> : null}
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 truncate text-center text-[11.5px] font-medium text-muted-foreground">{str(props.title) ?? ""}</span>
              <span className="w-[42px] shrink-0" aria-hidden />
            </>
          )}
        </div>
        {screen}
      </div>
    );
  }
  return (
    <figure className="flex min-w-0 flex-col items-center">
      {frame}
      {str(props.caption) ? <figcaption className="mt-2 text-center text-xs text-muted-foreground">{str(props.caption)}</figcaption> : null}
    </figure>
  );
}

/** Small plain buttons on the frame's edge, so a phone reads as a device. */
function SideButtons({ device, turned }: { device: "iphone" | "ipad"; turned: boolean }) {
  const style = (s: CSSProperties): CSSProperties => ({ position: "absolute", background: BEZEL_EDGE, borderRadius: 2, ...s });
  if (device === "ipad") return <i aria-hidden style={style(turned ? { left: "8%", top: -2, width: "7%", height: 3 } : { right: "10%", top: -2, width: "9%", height: 3 })} />;
  return turned ? (
    <>
      <i aria-hidden style={style({ left: "16%", top: -2, width: "7%", height: 3 })} />
      <i aria-hidden style={style({ left: "25%", top: -2, width: "7%", height: 3 })} />
      <i aria-hidden style={style({ left: "22%", bottom: -2, width: "11%", height: 3 })} />
    </>
  ) : (
    <>
      <i aria-hidden style={style({ left: -2, top: "17%", width: 3, height: "6%" })} />
      <i aria-hidden style={style({ left: -2, top: "25%", width: 3, height: "6%" })} />
      <i aria-hidden style={style({ right: -2, top: "22%", width: 3, height: "11%" })} />
    </>
  );
}

// ---------- Swatches ----------

let canvas: HTMLCanvasElement | null = null;
function canvasRgb(color: string): Rgb | null {
  try {
    canvas ??= document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 0 ? null : [r, g, b];
  } catch {
    return null;
  }
}

/** A color as the theme draws it: exact for hex, rgb() and hsl(); theme tokens and other CSS colors through the browser. */
function resolveColors(probe: HTMLElement | null, values: string[]): (Rgb | null)[] {
  return values.map((v) => {
    const exact = parseColor(v);
    if (exact) return exact;
    if (!probe) return null;
    probe.style.color = "";
    probe.style.color = v;
    if (!probe.style.color) return null;
    const computed = getComputedStyle(probe).color;
    return parseColor(computed) ?? canvasRgb(computed);
  });
}

export function SwatchesView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.colors);
  const swatches = useMemo(() => (pending ? [] : normalizeSwatches(props.colors)), [pending, props.colors]);
  const backgrounds = useMemo(() => normalizeBackgrounds(props.backgrounds), [props.backgrounds]);
  const level = str(props.level)?.toUpperCase() === "AAA" ? "AAA" : "AA";
  const sample = str(props.sample) ?? "Aa";
  const probe = useRef<HTMLSpanElement>(null);
  const [rgb, setRgb] = useState<{ fg: (Rgb | null)[]; bg: (Rgb | null)[] } | null>(null);
  const key = JSON.stringify([swatches.map((s) => s.value), backgrounds.map((b) => b.value), env.palette.accent]);
  useLayoutEffect(() => {
    setRgb({ fg: resolveColors(probe.current, swatches.map((s) => s.value)), bg: resolveColors(probe.current, backgrounds.map((b) => b.value)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const [ref, width] = useWidth<HTMLDivElement>();
  const stacked = width > 0 && width < 520;
  if (pending) return <Shimmer className="h-40 w-full" />;
  if (!swatches.length) return <div className="text-xs text-muted-foreground">Swatches has no colors</div>;
  const pairs = rgb ? swatches.flatMap((_, i) => backgrounds.map((__, j) => (rgb.fg[i] && rgb.bg[j] ? grade(rgb.fg[i]!, rgb.bg[j]!) : null))) : [];
  const graded = pairs.filter((g): g is Grade => g !== null);
  const passing = graded.filter((g) => (level === "AAA" ? g.aaa : g.aa)).length;
  return (
    <div ref={ref} className="min-w-0">
      <span ref={probe} aria-hidden className="hidden" />
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {str(props.title) ? <span className="text-xs text-muted-foreground">{str(props.title)}</span> : null}
        {graded.length ? (
          <span className="text-xs text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground">
              {passing} of {graded.length}
            </span>{" "}
            pairs pass {level} for normal text
          </span>
        ) : null}
      </div>
      {!stacked ? (
        <div className="grid items-end gap-x-2 pb-1 text-[11px] text-muted-foreground" style={{ gridTemplateColumns: `minmax(150px, 1fr) repeat(${backgrounds.length}, minmax(108px, 1fr))` }}>
          <span>Color</span>
          {backgrounds.map((b) => (
            <span key={b.name} className="truncate">
              on {b.name}
            </span>
          ))}
        </div>
      ) : null}
      <ul className="flex flex-col gap-2">
        {swatches.map((s, i) => (
          <li key={i} className={cn("grid items-stretch gap-2", stacked && "gap-1.5")} style={{ gridTemplateColumns: stacked ? `repeat(${Math.min(backgrounds.length, 2)}, minmax(0, 1fr))` : `minmax(150px, 1fr) repeat(${backgrounds.length}, minmax(108px, 1fr))` }}>
            <SwatchInfo swatch={s} rgb={rgb?.fg[i] ?? null} className={stacked ? "col-span-full" : undefined} />
            {backgrounds.map((b, j) => (
              <PairTile key={j} swatch={s} background={b} grade={rgb?.fg[i] && rgb.bg[j] ? grade(rgb.fg[i]!, rgb.bg[j]!) : null} unresolved={Boolean(rgb) && (!rgb!.fg[i] || !rgb!.bg[j])} level={level} sample={sample} showName={stacked} />
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A swatch or background value as a CSS color, or transparent: only color syntax and theme
 * variables pass, never url(), image-set() or another value that could load a resource.
 */
function cssColor(v: string): string {
  const t = v.trim();
  if (/url\(|image-set\(|image\(|element\(|cross-fade\(|paint\(/i.test(t)) return "transparent";
  if (/^var\(--[\w-]+\)$/.test(t)) return t;
  if (typeof CSS !== "undefined" && CSS.supports?.("color", t)) return t;
  return "transparent";
}

function SwatchInfo({ swatch, rgb, className }: { swatch: Swatch; rgb: Rgb | null; className?: string }) {
  const hex = rgb ? toHex(rgb) : null;
  return (
    <div className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <span aria-hidden className="size-10 shrink-0 rounded-lg" style={{ backgroundColor: cssColor(swatch.value), boxShadow: "inset 0 0 0 1px color-mix(in oklab, var(--foreground) 14%, transparent)" }} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-snug">{swatch.name}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">
          {hex && hex.toLowerCase() !== swatch.value.toLowerCase() ? (swatch.name === swatch.value ? hex : `${swatch.value} · ${hex}`) : swatch.name === swatch.value ? "" : swatch.value}
          {!rgb ? " (not a color)" : ""}
        </span>
        {swatch.note ? <span className="block truncate text-[11.5px] text-muted-foreground">{swatch.note}</span> : null}
      </span>
    </div>
  );
}

function PairTile({ swatch, background, grade: g, unresolved, level, sample, showName }: { swatch: Swatch; background: Background; grade: Grade | null; unresolved: boolean; level: "AA" | "AAA"; sample: string; showName: boolean }) {
  const normal = g ? (level === "AAA" ? g.aaa : g.aa) : false;
  const large = g ? (level === "AAA" ? g.aaaLarge : g.aaLarge) : false;
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg" style={{ boxShadow: "0 0 0 1px var(--border)" }}>
      <div className="flex h-11 items-center justify-between gap-2 px-2.5" style={{ backgroundColor: cssColor(background.value) }}>
        <span className="truncate text-[17px] font-semibold leading-none" style={{ color: cssColor(swatch.value) }}>
          {sample}
        </span>
        <span className="truncate text-[11px]" style={{ color: cssColor(swatch.value) }}>
          {showName ? `on ${background.name}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1 bg-card px-2 py-1.5">
        {g ? (
          <>
            <span className="mr-auto font-mono text-[11.5px] tabular-nums" title={`Contrast ${g.ratio.toFixed(3)}:1`}>
              {formatRatio(g.ratio)}
            </span>
            <Verdict pass={normal} label={level} spoken={`${level} normal text`} title={`${level} normal text needs ${level === "AAA" ? "7" : "4.5"}:1`} />
            <Verdict pass={large} label={showName ? "Large" : `${level} Large`} spoken={`${level} large text`} title={`${level} large text and UI parts need ${level === "AAA" ? "4.5" : "3"}:1`} />
          </>
        ) : (
          <span className="text-[11px] text-muted-foreground">{unresolved ? "Can't read this color" : "Measuring"}</span>
        )}
      </div>
    </div>
  );
}

function Verdict({ pass, label, spoken, title }: { pass: boolean; label: string; spoken: string; title: string }) {
  return (
    <span title={title} aria-label={`${spoken} ${pass ? "passes" : "fails"}`}>
      <Chip tone={pass ? "good" : "bad"} icon={pass ? "check" : "x"} className="h-[18px] px-1.5 text-[10.5px]">
        {label}
      </Chip>
    </span>
  );
}

// ---------- TypeSpecimen ----------

/** Whether the first named font is installed here: its glyphs measure differently from the fallbacks. */
function useFontAvailable(stack: string): boolean | null {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const first = stack.split(",")[0].trim();
    if (!first.startsWith('"')) {
      setOk(true);
      return;
    }
    let live = true;
    const measure = () => {
      try {
        const c = document.createElement("canvas").getContext("2d");
        if (!c) return setOk(null);
        const probe = "mmmmmmmmmmlliWW@#0123";
        const differs = ["monospace", "serif", "sans-serif"].some((g) => {
          c.font = `72px ${g}`;
          const base = c.measureText(probe).width;
          c.font = `72px ${first}, ${g}`;
          return c.measureText(probe).width !== base;
        });
        if (live) setOk(differs);
      } catch {
        if (live) setOk(null);
      }
    };
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) fonts.ready.then(measure, measure);
    else measure();
    return () => {
      live = false;
    };
  }, [stack]);
  return ok;
}

export function TypeSpecimenView({ props }: ViewProps) {
  const stack = fontStack(props.font);
  const sizes = useMemo(() => normalizeSizes(props.sizes), [props.sizes]);
  const weights = useMemo(() => normalizeWeights(props.weights), [props.weights]);
  const [weight, setWeight] = useState<number | null>(null);
  const active = weight !== null && weights.includes(weight) ? weight : (weights.find((w) => w === 400) ?? weights[0] ?? 400);
  const sample = str(props.sample) ?? "The quick brown fox jumps over the lazy dog";
  const lineHeight = Math.max(0.8, Math.min(3, num(props.lineHeight) ?? 1.3));
  const italic = props.italic === true;
  const available = useFontAvailable(stack);
  const name = str(props.title) ?? stack.split(",")[0].replace(/"/g, "").trim();
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold" style={{ fontFamily: stack }}>
          {name}
        </span>
        <span className="truncate font-mono text-[11px] text-muted-foreground">{stack}</span>
        {available === false ? (
          <Chip tone="warn" icon="triangle-alert" className="ml-auto">
            Not installed here; showing a fallback
          </Chip>
        ) : null}
      </div>
      <div role="radiogroup" aria-label="Weight" className="iris-scroll-x mt-2.5 flex gap-1.5 overflow-x-auto pb-0.5">
        {weights.map((w) => (
          <button
            key={w}
            type="button"
            role="radio"
            aria-checked={active === w}
            onClick={() => setWeight(w)}
            className={cn("flex shrink-0 flex-col items-start rounded-lg px-3 py-1.5 text-left transition-colors", active === w ? "bg-muted shadow-[0_0_0_1px_var(--border)]" : "hover:bg-muted/50")}
          >
            <span className="text-[22px] leading-tight" style={{ fontFamily: stack, fontWeight: w, fontStyle: italic ? "italic" : undefined }}>
              Aa
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {WEIGHT_NAMES[w] ?? w} {w}
            </span>
          </button>
        ))}
      </div>
      <ol className="mt-2 flex flex-col">
        {[...sizes].reverse().map((s) => (
          <li key={s.size} className="grid min-w-0 items-baseline gap-x-3 border-t border-border/60 py-2 first:border-t-0" style={{ gridTemplateColumns: "minmax(64px, auto) minmax(0, 1fr)" }}>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {s.label ? <span className="block text-foreground/80">{s.label}</span> : null}
              {s.size} px
            </span>
            <span className="line-clamp-2 min-w-0 break-words" style={{ fontFamily: stack, fontSize: s.size, fontWeight: active, lineHeight, fontStyle: italic ? "italic" : undefined }}>
              {sample}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- Annotate ----------

export function AnnotateView({ props }: ViewProps) {
  const { palette } = useEnv();
  const src = str(props.src) ?? "";
  const image = useLoadedImage(src);
  const pending = isPendingValue(props.notes);
  const notes = useMemo(() => (pending ? [] : normalizeCallouts(props.notes)), [pending, props.notes]);
  const [active, setActive] = useState<number | null>(null);
  const width = num(props.width);
  return (
    <figure className="min-w-0">
      {image.status === "ok" ? (
        <div className="relative mx-auto w-fit max-w-full" style={width ? { maxWidth: `min(100%, ${width}px)` } : undefined}>
          <img src={image.url} alt={str(props.alt) ?? ""} className="block max-h-[640px] w-auto max-w-full rounded-lg ring-1 ring-border" />
          {notes.map((c) => (
            <CalloutMark key={c.n} callout={c} active={active} onActive={setActive} fallback={palette.accent} />
          ))}
        </div>
      ) : image.status === "loading" ? (
        <Shimmer className="aspect-video w-full" />
      ) : (
        <ImageProblem state={image} src={src} />
      )}
      {str(props.caption) ? <figcaption className="mt-1.5 text-center text-xs text-muted-foreground">{str(props.caption)}</figcaption> : null}
      {notes.length ? (
        <ol className="mt-2.5 flex flex-col gap-0.5">
          {notes.map((c) => (
            <CalloutRow key={c.n} callout={c} active={active === c.n} onActive={setActive} fallback={palette.accent} />
          ))}
        </ol>
      ) : null}
    </figure>
  );
}

function CalloutMark({ callout: c, active, onActive, fallback }: { callout: Callout; active: number | null; onActive: (n: number | null) => void; fallback: string }) {
  const tone = useTone(c.tone) ?? fallback;
  const lit = active === c.n;
  const dim = active !== null && !lit;
  const hover = { onMouseEnter: () => onActive(c.n), onMouseLeave: () => onActive(null) };
  if (!c.box) {
    return (
      <span className="absolute -translate-x-1/2 -translate-y-1/2 transition-opacity" style={{ left: `${c.x}%`, top: `${c.y}%`, opacity: dim ? 0.45 : 1, zIndex: lit ? 3 : 2 }} {...hover}>
        <NumberPin n={c.n} color={tone} selected={lit} size={22} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="absolute rounded-[5px] transition-[opacity,background-color] duration-150"
      style={{
        left: `${c.box.x}%`,
        top: `${c.box.y}%`,
        width: `${c.box.w}%`,
        height: `${c.box.h}%`,
        boxShadow: `0 0 0 2px ${tone}, 0 0 0 3.5px var(--card)`,
        background: `color-mix(in oklab, ${tone} ${lit ? 22 : 10}%, transparent)`,
        opacity: dim ? 0.4 : 1,
        zIndex: lit ? 3 : 2,
      }}
      {...hover}
    >
      <span className="absolute -left-2.5 -top-2.5">
        <NumberPin n={c.n} color={tone} selected={lit} size={20} />
      </span>
    </span>
  );
}

function CalloutRow({ callout: c, active, onActive, fallback }: { callout: Callout; active: boolean; onActive: (n: number | null) => void; fallback: string }) {
  const tone = useTone(c.tone) ?? fallback;
  return (
    <li>
      <button
        type="button"
        aria-pressed={active}
        onMouseEnter={() => onActive(c.n)}
        onMouseLeave={() => onActive(null)}
        onFocus={() => onActive(c.n)}
        onBlur={() => onActive(null)}
        onClick={() => onActive(active ? null : c.n)}
        className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60", active && "bg-muted/70")}
      >
        <NumberPin n={c.n} color={tone} size={20} className="mt-px" />
        <span className="min-w-0">
          <span className="block text-[13px] leading-snug">{c.label}</span>
          {c.text ? <span className="block text-xs leading-relaxed text-muted-foreground">{c.text}</span> : null}
        </span>
      </button>
    </li>
  );
}
