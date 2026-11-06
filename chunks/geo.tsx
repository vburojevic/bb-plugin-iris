// GeoHeatmap (chunk "interact"): countries or US states shaded in one accent
// hue. Boundaries are compact SVG paths in their own chunks ("geo-world",
// "geo-us", built by scripts/build-geo.mjs) fetched from Iris's own route, so
// nothing reaches the network. Region matching and steps live in core/geo.ts.

import { InlineError, Shimmer, chunkEntryUrl, cn, num, sequentialRamp, str, useEnv } from "@iris/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { isPendingValue } from "../core/evaluate";
import { formatValue, type NumberFormat } from "../core/format";
import { type GeoMapName, mapRegions, readGeo, stepBounds, stepOf } from "../core/geo";
import type { ViewProps } from "../ui/render";

interface Shapes {
  w: number;
  h: number;
  d: Record<string, string>;
}

const shapeCache = new Map<GeoMapName, Promise<Shapes>>();
function loadShapes(map: GeoMapName): Promise<Shapes> {
  let p = shapeCache.get(map);
  if (!p) {
    p = import(/* @vite-ignore */ chunkEntryUrl(`geo-${map}`)).then((m: { default: Shapes }) => m.default);
    shapeCache.set(map, p);
    p.catch(() => shapeCache.delete(map));
  }
  return p;
}

function useShapes(map: GeoMapName): Shapes | Error | null {
  const [state, setState] = useState<Shapes | Error | null>(null);
  useEffect(() => {
    let live = true;
    setState(null);
    loadShapes(map).then(
      (s) => live && setState(s),
      (e: unknown) => live && setState(e instanceof Error ? e : new Error(String(e))),
    );
    return () => {
      live = false;
    };
  }, [map]);
  return state;
}

export function GeoHeatmapView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.data);
  const sig = pending ? "" : JSON.stringify([props.data ?? null, props.map ?? null, props.key ?? null, props.value ?? null, props.domain ?? null]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => readGeo(pending ? [] : props.data, { map: props.map, key: props.key, value: props.value, domain: props.domain }), [sig]);
  const shapes = useShapes(model.map);
  const [view, setView] = useState<"map" | "table">("map");
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);

  const steps = Math.max(3, Math.min(9, Math.round(num(props.steps) ?? 5)));
  const ramp = sequentialRamp(env.palette, steps);
  const values = [...model.values.values()];
  const bounds = stepBounds(
    values.map((v) => v.value),
    model.min,
    model.max,
    steps,
    props.scale,
  );
  const fmt = (v: unknown) => formatValue(v, (props.format as NumberFormat) ?? undefined);
  const label = str(props.label) ?? (model.valueField === "value" ? "Value" : humanize(model.valueField));
  const unit = model.map === "us" ? "state" : "country";
  const ranked = values.slice().sort((a, b) => b.value - a.value);
  const rankOf = new Map(ranked.map((v, k) => [v.region.id, k + 1]));
  const names = useMemo(() => new Map(mapRegions(model.map).map((r) => [r.id, r.name])), [model.map]);
  const undrawn = values.filter((v) => !v.region.drawn);

  if (pending) return <Shimmer className="aspect-[2.2/1] w-full" />;
  if (shapes instanceof Error) return <InlineError error={new Error(`the ${model.map === "us" ? "US" : "world"} map could not load: ${shapes.message}`)} context="<GeoHeatmap>" />;

  const pick = (id: string) => {
    const v = model.values.get(id);
    if (props.onPick != null) env.run(props.onPick, [id, v?.value ?? null, v?.rows[0] ?? null]);
  };
  const colorOf = (id: string) => {
    const v = model.values.get(id);
    return v ? ramp[stepOf(v.value, bounds)] : undefined;
  };
  const hovered = hover ? { id: hover.id, name: names.get(hover.id) ?? hover.id, value: model.values.get(hover.id) } : null;
  const title = str(props.title);
  const top = ranked.slice(0, 3).map((v) => `${v.region.name} ${fmt(v.value)}`).join(", ");

  return (
    <figure className="min-w-0">
      {title ? <figcaption className="mb-2 text-[13px] font-medium">{title}</figcaption> : null}
      {view === "map" ? (
        <div ref={box} className="relative min-w-0" onPointerLeave={() => setHover(null)}>
          {!shapes ? (
            <Shimmer className={cn("w-full", model.map === "us" ? "aspect-[1.7/1]" : "aspect-[2.27/1]")} />
          ) : (
            <svg
              viewBox={`0 0 ${shapes.w} ${shapes.h}`}
              className="block h-auto w-full select-none"
              role="img"
              aria-label={`Map of ${label.toLowerCase()} by ${unit}${top ? `; highest: ${top}` : ""}. The table view lists every value.`}
            >
              <g>
                {Object.entries(shapes.d).map(([id, d]) => {
                  const fill = colorOf(id);
                  return (
                    <path
                      key={id}
                      data-region={id}
                      d={d}
                      fill={fill ?? "var(--muted)"}
                      stroke="var(--card)"
                      strokeWidth={0.6}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      className={cn(props.onPick != null && "cursor-pointer")}
                      onPointerMove={(e) => {
                        const r = box.current?.getBoundingClientRect();
                        if (r) setHover({ id, x: e.clientX - r.left, y: e.clientY - r.top });
                      }}
                      onClick={() => pick(id)}
                    />
                  );
                })}
              </g>
              {hovered && shapes.d[hovered.id] ? <path d={shapes.d[hovered.id]} fill="none" stroke="var(--foreground)" strokeWidth={1.4} strokeLinejoin="round" vectorEffect="non-scaling-stroke" pointerEvents="none" /> : null}
            </svg>
          )}
          {hovered && hover ? (
            <Readout x={hover.x} y={hover.y} width={box.current?.clientWidth ?? 0} name={hovered.name} label={label} value={hovered.value ? fmt(hovered.value.value) : null} rank={hovered.value ? `#${rankOf.get(hovered.id)} of ${values.length}` : null} swatch={colorOf(hovered.id)} />
          ) : null}
        </div>
      ) : (
        <GeoTable rows={ranked} fmt={fmt} label={label} unit={unit} colorOf={colorOf} onPick={props.onPick != null ? pick : undefined} />
      )}
      <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <Legend ramp={ramp} bounds={bounds} fmt={fmt} label={label} />
        <div className="inline-flex rounded-md bg-muted/70 p-0.5 text-[11.5px]" role="tablist" aria-label="View">
          {(["map", "table"] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={cn("rounded px-2 py-0.5 capitalize", view === v ? "bg-card text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}>
              {v}
            </button>
          ))}
        </div>
      </div>
      {undrawn.length || model.unknown.length ? (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">
          {undrawn.length ? `${undrawn.map((v) => v.region.name).slice(0, 4).join(", ")}${undrawn.length > 4 ? ` and ${undrawn.length - 4} more` : ""} ${undrawn.length === 1 ? "is" : "are"} too small for this map; see the table. ` : ""}
          {model.unknown.length ? `Not matched: ${model.unknown.slice(0, 4).join(", ")}${model.unknown.length > 4 ? ` and ${model.unknown.length - 4} more` : ""}.` : ""}
        </p>
      ) : null}
    </figure>
  );
}

function Readout({ x, y, width, name, label, value, rank, swatch }: { x: number; y: number; width: number; name: string; label: string; value: string | null; rank: string | null; swatch?: string }) {
  const right = x > width - 190;
  return (
    <div
      className="pointer-events-none absolute z-10 min-w-[9rem] max-w-[14rem] rounded-lg bg-popover px-2.5 py-2 text-[12px] shadow-[0_0_0_1px_var(--border),0_6px_20px_-8px_rgb(0_0_0/0.35)]"
      style={{ left: right ? undefined : x + 14, right: right ? width - x + 14 : undefined, top: Math.max(0, y - 12) }}
    >
      <div className="truncate font-semibold text-foreground">{name}</div>
      {value != null ? (
        <div className="mt-1 flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2.5 shrink-0 rounded-sm" style={{ background: swatch }} />
          <span className="truncate">{label}</span>
          <span className="ml-auto pl-2 font-medium tabular-nums text-foreground">{value}</span>
        </div>
      ) : (
        <div className="mt-0.5 text-muted-foreground">No data</div>
      )}
      {rank ? <div className="mt-0.5 text-[11px] text-muted-foreground">{rank}</div> : null}
    </div>
  );
}

function Legend({ ramp, bounds, fmt, label }: { ramp: string[]; bounds: number[]; fmt: (v: unknown) => string; label: string }) {
  return (
    <div className="min-w-0 text-[11px] text-muted-foreground">
      <div className="mb-1 font-medium text-foreground/80">{label}</div>
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <div className="flex">
            {ramp.map((c, k) => (
              <span key={k} className="h-2.5 w-9 first:rounded-l-sm last:rounded-r-sm @max-lg/iris:w-7" style={{ background: c }} />
            ))}
          </div>
          <div className="mt-0.5 flex justify-between gap-2 tabular-nums">
            <span>{fmt(bounds[0])}</span>
            {/* A middle label sits at the bar's center, which is a step edge only for an even count. */}
            {ramp.length % 2 === 0 ? <span>{fmt(bounds[ramp.length / 2])}</span> : null}
            <span>{fmt(bounds[bounds.length - 1])}</span>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-sm bg-muted" />
          No data
        </span>
      </div>
    </div>
  );
}

function GeoTable({
  rows,
  fmt,
  label,
  unit,
  colorOf,
  onPick,
}: {
  rows: { region: { id: string; name: string; drawn: boolean }; value: number }[];
  fmt: (v: unknown) => string;
  label: string;
  unit: string;
  colorOf: (id: string) => string | undefined;
  onPick?: (id: string) => void;
}) {
  if (!rows.length) return <div className="rounded-lg bg-muted/40 py-8 text-center text-xs text-muted-foreground">No values to show</div>;
  return (
    <div className="max-h-[420px] overflow-auto">
      <table className="w-full text-[13px] tabular-nums">
        <thead className="sticky top-0 bg-card">
          <tr className="text-xs text-muted-foreground">
            <th className="w-8 border-b border-border pb-1 text-left font-medium">#</th>
            <th className="border-b border-border pb-1 text-left font-medium capitalize">{unit}</th>
            <th className="border-b border-border pb-1 text-right font-medium">{label}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={r.region.id} className={cn(onPick && "cursor-pointer hover:bg-state-hover")} onClick={onPick ? () => onPick(r.region.id) : undefined}>
              <td className="border-b border-border/60 py-1 text-muted-foreground">{k + 1}</td>
              <td className="border-b border-border/60 py-1">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colorOf(r.region.id) }} />
                  <span className="truncate">{r.region.name}</span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.region.id}</span>
                  {!r.region.drawn ? <span className="text-[11px] text-muted-foreground">not on map</span> : null}
                </span>
              </td>
              <td className="border-b border-border/60 py-1 text-right">{fmt(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function humanize(key: string) {
  const s = key.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return s ? s[0].toUpperCase() + s.slice(1) : key;
}
