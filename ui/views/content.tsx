import { normalizeTone } from "../../core/tones";
import { betterWay } from "../../core/better";
import { useState, type ReactNode } from "react";
import { isElementValue, isPendingValue, toText } from "../../core/evaluate";
import { formatValue } from "../../core/format";
import { useEnv } from "../env";
import { toneColor } from "../palette";
import type { ViewProps } from "../render";
import { renderElementValue, renderValue } from "../render";
import { useLoadedImage, imageError } from "../files";
import { Prose } from "./prose";
import { Chip, Glyph, Label, Shimmer, cn, fmt, num, str, useTone } from "./kit";
import { SparkPath } from "./spark";

export function TextView({ props, children, text }: ViewProps) {
  const color = useTone(props.tone);
  const size = str(props.size);
  const cls = cn(size === "sm" ? "text-[12.5px]" : size === "lg" ? "text-[15px]" : "", props.muted ? "text-muted-foreground" : "");
  if (text != null) return <Prose text={text} className={cls} />;
  return (
    <div className={cn("min-w-0 text-[13.5px] leading-relaxed", cls)} style={color ? { color } : undefined}>
      {children}
    </div>
  );
}

export function HeadingView({ props, text }: ViewProps) {
  const level = num(props.level) ?? 2;
  const cls = level <= 1 ? "text-[17px] font-semibold tracking-[-0.01em]" : level === 2 ? "text-[14.5px] font-semibold" : "text-[13px] font-semibold text-muted-foreground";
  return <div role="heading" aria-level={level + 2} className={cn("min-w-0 leading-snug", cls)}>{text}</div>;
}

const TONE_ICON: Record<string, string> = { info: "info", good: "circle-check", warn: "triangle-alert", bad: "circle-x", neutral: "lightbulb" };

export function CalloutView({ props, children, text }: ViewProps) {
  const tone = normalizeTone(props.tone) ?? "info";
  const color = useTone(tone);
  return (
    <div
      className="flex min-w-0 gap-2.5 rounded-lg px-3 py-2.5"
      style={{ background: color ? `color-mix(in oklab, ${color} 13%, transparent)` : undefined, boxShadow: color ? `inset 0 0 0 1px color-mix(in oklab, ${color} 32%, transparent)` : undefined }}
      role={tone === "bad" || tone === "warn" ? "alert" : "note"}
    >
      <Glyph name={props.icon ?? TONE_ICON[tone] ?? "info"} size={16} color={color} className="mt-0.5" />
      <div className="min-w-0 flex-1 text-[13.5px] leading-relaxed">
        {str(props.title) ? <div className="font-semibold">{str(props.title)}</div> : null}
        {text != null ? <Prose text={text} /> : children}
      </div>
    </div>
  );
}

export function MetricView({ props }: ViewProps) {
  const { palette } = useEnv();
  const tone = useTone(props.tone);
  const delta = num(props.delta);
  const better = betterWay(props.better) ?? "up";
  const good = delta === undefined || delta === 0 ? null : better === "up" ? delta > 0 : delta < 0;
  const deltaColor = good === null ? palette.tone.neutral : good ? palette.tone.good : palette.tone.bad;
  const trend = Array.isArray(props.trend) ? props.trend.map(Number).filter(Number.isFinite) : null;
  const value = isPendingValue(props.value) ? null : fmt(props.value, props.format);
  return (
    <div className="min-w-0">
      <div className="truncate text-xs text-muted-foreground">{str(props.label)}</div>
      <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
        {value === null ? (
          <Shimmer className="h-7 w-20" />
        ) : (
          <span className="iris-metric truncate text-[26px] font-semibold leading-tight tracking-[-0.025em] tabular-nums" style={tone ? { color: tone } : undefined}>
            {value}
            {str(props.unit) ? <span className="ml-1 text-[13px] font-normal tracking-normal text-muted-foreground">{str(props.unit)}</span> : null}
          </span>
        )}
        {delta !== undefined ? (
          <span className="inline-flex shrink-0 items-center gap-0.5 text-[12.5px] font-medium tabular-nums" style={{ color: deltaColor }}>
            <Glyph name={delta > 0 ? "arrow-up-right" : delta < 0 ? "arrow-down-right" : "arrow-right"} size={13} />
            {formatValue(Math.abs(delta), (props.deltaFormat as never) ?? "number")}
          </span>
        ) : null}
      </div>
      {str(props.note) ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{str(props.note)}</div> : null}
      {trend && trend.length > 1 ? <SparkPath values={trend} color={tone ?? palette.accent} width={120} height={26} className="mt-1.5" /> : null}
    </div>
  );
}

export function BadgeView({ props, text }: ViewProps) {
  return (
    <span className="inline-flex">
      <Chip tone={props.tone} variant={str(props.variant)} icon={props.icon}>
        {text}
      </Chip>
    </span>
  );
}

export function IconView({ props }: ViewProps) {
  const color = useTone(props.tone);
  return <Glyph name={props.name} size={num(props.size) ?? 16} color={color} className="inline-block align-[-3px]" />;
}

function pairs(items: unknown): { label: string; value: unknown; tone?: unknown; format?: unknown }[] {
  if (Array.isArray(items)) {
    return items.map((it) => {
      if (Array.isArray(it)) return { label: toText(it[0]), value: it[1] };
      if (it && typeof it === "object") {
        const o = it as Record<string, unknown>;
        return { label: toText(o.label ?? o.key ?? o.name), value: o.value, tone: o.tone, format: o.format };
      }
      return { label: toText(it), value: "" };
    });
  }
  if (items && typeof items === "object") return Object.entries(items).map(([label, value]) => ({ label, value }));
  return [];
}

export function KeyValueView({ props }: ViewProps) {
  const cols = Math.max(1, Math.min(3, num(props.columns) ?? 1));
  if (isPendingValue(props.items)) return <Shimmer className="h-16" />;
  const rows = pairs(props.items);
  return (
    <dl className={cn("grid min-w-0 gap-x-6", cols === 1 && "max-w-[32rem]")} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {rows.map((r, k) => (
        <KVRow key={k} {...r} />
      ))}
    </dl>
  );
}

function KVRow({ label, value, tone, format }: { label: string; value: unknown; tone?: unknown; format?: unknown }) {
  const color = useTone(tone);
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 border-b border-border/70 py-1.5 last:border-b-0">
      <dt className="shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[13px] tabular-nums" style={color ? { color } : undefined}>
        {isElementValue(value) ? renderElementValue(value) : format ? fmt(value, format) : renderValue(value)}
      </dd>
    </div>
  );
}

interface ItemData {
  title?: unknown;
  detail?: unknown;
  icon?: unknown;
  value?: unknown;
  tone?: unknown;
  badge?: unknown;
  onClick?: unknown;
}

export function ListView({ props, children }: ViewProps) {
  if (isPendingValue(props.items)) return <Shimmer className="h-20" />;
  const items = Array.isArray(props.items) ? (props.items as unknown[]) : [];
  const numbered = props.numbered === true;
  return (
    <ul className={cn("min-w-0", props.divided === false ? "" : "[&>li+li]:border-t [&>li+li]:border-border/70")}>
      {items.map((it, k) => (
        <ItemRow key={k} item={typeof it === "object" && it ? (it as ItemData) : { title: it }} index={numbered ? k + 1 : undefined} />
      ))}
      {children}
    </ul>
  );
}

export function ItemView({ props, children }: ViewProps) {
  return <ItemRow item={props as ItemData} extra={children} />;
}

function ItemRow({ item, index, extra }: { item: ItemData; index?: number; extra?: ReactNode }) {
  const env = useEnv();
  const color = useTone(item.tone);
  const clickable = item.onClick != null;
  const body = (
    <>
      {index !== undefined ? <span className="w-5 shrink-0 pt-px text-right text-xs tabular-nums text-muted-foreground">{index}</span> : null}
      {item.icon ? <Glyph name={item.icon} size={16} color={color} className="mt-0.5" /> : item.tone ? <span className="mt-[7px] size-1.5 shrink-0 rounded-full" style={{ background: color }} /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px]">{str(item.title)}</span>
        {str(item.detail) ? <span className="block truncate text-xs text-muted-foreground">{str(item.detail)}</span> : null}
        {extra}
      </span>
      {item.badge != null ? <Chip tone={item.tone}>{str(item.badge)}</Chip> : null}
      {item.value != null ? <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{renderValue(item.value)}</span> : null}
      {clickable ? <Glyph name="chevron-right" size={14} className="mt-0.5 text-muted-foreground" /> : null}
    </>
  );
  return (
    <li className="min-w-0">
      {clickable ? (
        <button type="button" onClick={() => env.run(item.onClick, [item])} className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2.5 rounded-md px-2 py-2 text-left hover:bg-state-hover">
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-2.5 py-2">{body}</div>
      )}
    </li>
  );
}

export function LinkView({ props, text }: ViewProps) {
  const env = useEnv();
  const href = str(props.href);
  const file = str(props.file);
  const label = text || file || href || "link";
  return (
    <button
      type="button"
      className="iris-link inline text-left text-[13.5px] text-foreground underline underline-offset-[3px]"
      onClick={() => env.perform([file ? { $iris: "action", kind: "openFile", args: [file, num(props.line) ?? null] } : { $iris: "action", kind: "openUrl", args: [href ?? ""] }])}
    >
      {label}
      <Glyph name={file ? "file" : "arrow-up-right"} size={12} className="ml-0.5 inline align-[-1px] text-muted-foreground" />
    </button>
  );
}

export function ImageView({ props }: ViewProps) {
  const src = str(props.src) ?? "";
  const image = useLoadedImage(src);
  const width = num(props.width);
  return (
    <figure className="min-w-0">
      {image.status === "loading" ? (
        <Shimmer className="aspect-video w-full" />
      ) : image.status === "error" ? (
        <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">{imageError(src, image.error)}</div>
      ) : (
        <img
          src={image.url}
          alt={str(props.alt) ?? ""}
          className={cn("block max-h-[520px] w-auto max-w-full rounded-lg ring-1 ring-border", props.fit === "cover" && "w-full object-cover")}
          style={width ? { maxWidth: width } : undefined}
        />
      )}
      {str(props.caption) ? <figcaption className="mt-1.5 text-xs text-muted-foreground">{str(props.caption)}</figcaption> : null}
    </figure>
  );
}

export function ProgressView({ props }: ViewProps) {
  const { palette } = useEnv();
  const tone = useTone(props.tone);
  const value = num(props.value) ?? 0;
  const max = num(props.max) ?? 100;
  const ratio = Math.max(0, Math.min(1, max ? value / max : 0));
  return (
    <div className="min-w-0">
      {str(props.label) || props.showValue !== false ? (
        <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
          <span className="truncate text-muted-foreground">{str(props.label)}</span>
          {props.showValue !== false ? <span className="tabular-nums text-muted-foreground">{props.max == null ? `${Math.round(ratio * 100)}%` : `${value.toLocaleString("en-US")} of ${max.toLocaleString("en-US")}`}</span> : null}
        </div>
      ) : null}
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className="iris-bar h-full rounded-full" style={{ width: `${ratio * 100}%`, background: tone ?? palette.accent }} />
      </div>
    </div>
  );
}

export function GaugeView({ props }: ViewProps) {
  const { palette } = useEnv();
  const min = num(props.min) ?? 0;
  const max = num(props.max) ?? 100;
  const value = num(props.value) ?? 0;
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const thresholds = Array.isArray(props.thresholds) ? (props.thresholds as { at: number; tone: string }[]) : [];
  const t = [...thresholds].sort((a, b) => a.at - b.at).filter((x) => value >= x.at).pop();
  const color = (t && toneColor(palette, t.tone)) ?? toneColor(palette, props.tone) ?? palette.accent;
  const r = 52;
  const arc = Math.PI * r;
  return (
    <div className="flex min-w-0 flex-col items-center">
      <svg viewBox="0 0 128 76" className="w-full max-w-[180px]" role="img" aria-label={`${str(props.label) ?? "Value"}: ${fmt(value, props.format)}`}>
        <path d="M12 68 A52 52 0 0 1 116 68" fill="none" stroke="var(--muted)" strokeWidth="10" strokeLinecap="round" />
        <path d="M12 68 A52 52 0 0 1 116 68" fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${ratio * arc} ${arc}`} className="iris-bar" />
        <text x="64" y="62" textAnchor="middle" className="fill-foreground" style={{ font: "600 19px var(--font-sans, system-ui)" }}>
          {fmt(value, props.format)}
        </text>
      </svg>
      {str(props.label) ? <Label className="-mt-1 text-center">{str(props.label)}</Label> : null}
    </div>
  );
}

export function EmptyView({ props, text, children }: ViewProps) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg px-4 py-6 text-center">
      {props.icon ? <Glyph name={props.icon} size={22} className="text-muted-foreground" /> : null}
      <div className="text-[13.5px] font-medium">{str(props.title)}</div>
      {text ? <Prose text={text} className="text-muted-foreground" /> : children}
      {props.action ? <div className="mt-1.5">{renderElementValue(props.action)}</div> : null}
    </div>
  );
}

export function useToggle(initial = false): [boolean, () => void] {
  const [v, set] = useState(initial);
  return [v, () => set((x) => !x)];
}
