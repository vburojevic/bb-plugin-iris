// Media views: Gallery (a grid with a lightbox), Hotspots (pins on an image),
// Map (OpenStreetMap tiles with a list of places) and PhotoSearch (a credited
// Commons photo). Tiles, places and photos come only through Iris's server
// (ui/web.ts); the judgments live in core/media.ts.

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { isPendingValue } from "../../core/evaluate";
import {
  type GalleryImage,
  type Hotspot,
  type MapView as View,
  type Place,
  distanceKm,
  fitView,
  formatDistance,
  normalizeGallery,
  normalizeHotspots,
  normalizePlaces,
  placeOnFrame,
  visibleTiles,
  wrapIndex,
  zoomView,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  TILE,
} from "../../core/media";
import { usePortalScopeProps } from "../../lib/portal-scope";
import type { RpcContract } from "../../shared/rpc";
import { useEnv } from "../env";
import { type ImageState, useLoadedImage, useLoadedImages, imageError } from "../files";
import type { ViewProps } from "../render";
import { loadTile, useGeocode, usePhoto, useWebLookups, type GeoState } from "../web";
import { Glyph, Shimmer, cn, num, str, useTone } from "./kit";

// ---------- shared pieces ----------

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function ImageProblem({ state, src }: { state: ImageState; src: string }) {
  return (
    <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">
      {imageError(src, state.status === "error" ? state.error : "still loading")}
    </div>
  );
}

/** A numbered marker, used for hotspots, map places and annotations. */
export function NumberPin({ n, color, selected, size = 24, className }: { n: number; color: string; selected?: boolean; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold tabular-nums leading-none shadow-[0_1px_3px_rgb(0_0_0/0.35)] transition-transform", selected && "scale-[1.18]", className)}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), background: color, color: "var(--background)", boxShadow: `0 0 0 2px var(--card), 0 1px 4px rgb(0 0 0 / 0.35)` }}
    >
      {n}
    </span>
  );
}

function Notice({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Glyph name={icon} size={13} />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function ExternalLink({ url, children, className }: { url: string; children: ReactNode; className?: string }) {
  const env = useEnv();
  return (
    <button type="button" onClick={() => env.perform([{ $iris: "action", kind: "openUrl", args: [url] }])} className={cn("underline decoration-border underline-offset-2 hover:text-foreground", className)} title={url}>
      {children}
    </button>
  );
}

// ---------- Gallery ----------

const ASPECT: Record<string, string> = { square: "aspect-square", landscape: "aspect-[4/3]", portrait: "aspect-[3/4]" };

export function GalleryView({ props }: ViewProps) {
  const pending = isPendingValue(props.images);
  const images = useMemo(() => (pending ? [] : normalizeGallery(props.images)), [pending, props.images]);
  const states = useLoadedImages(images.map((i) => i.src));
  const [open, setOpen] = useState<number | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const columns = num(props.columns);
  const aspect = str(props.aspect) ?? "landscape";
  if (pending) return <Shimmer className="aspect-video w-full" />;
  if (!images.length) return <Notice icon="images">Gallery has no images</Notice>;
  const close = () => {
    const k = open;
    setOpen(null);
    if (k !== null) thumbs.current[k]?.focus();
  };
  return (
    <div className="min-w-0">
      {str(props.title) ? <div className="mb-2 text-xs text-muted-foreground">{str(props.title)}</div> : null}
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: columns ? `repeat(${Math.max(1, Math.min(8, Math.round(columns)))}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(min(150px, 45%), 1fr))" }}
      >
        {images.map((im, k) => {
          const s = states[k];
          return (
            <figure key={k} className="min-w-0">
              <button
                ref={(el) => {
                  thumbs.current[k] = el;
                }}
                type="button"
                onClick={() => setOpen(k)}
                aria-label={`Open ${im.alt}`}
                className={cn("group/thumb relative block w-full overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-shadow hover:ring-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50", ASPECT[aspect])}
              >
                {s.status === "ok" ? (
                  <img src={s.url} alt={im.alt} loading="lazy" className={cn("block w-full transition-transform duration-300 group-hover/thumb:scale-[1.03] motion-reduce:transition-none", aspect === "natural" ? "h-auto" : "h-full object-contain")} />
                ) : s.status === "loading" ? (
                  <Shimmer className={cn("w-full", aspect === "natural" ? "aspect-[4/3]" : "h-full")} />
                ) : (
                  <span className="grid h-full min-h-20 place-items-center px-2 text-center text-[11px] text-muted-foreground">{s.error}</span>
                )}
              </button>
              {im.caption ? <figcaption className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground" title={im.caption}>{im.caption}</figcaption> : null}
            </figure>
          );
        })}
      </div>
      {open !== null ? <Lightbox images={images} states={states} index={open} onIndex={setOpen} onClose={close} /> : null}
    </div>
  );
}

function Lightbox({ images, states, index, onIndex, onClose }: { images: GalleryImage[]; states: ImageState[]; index: number; onIndex: (k: number) => void; onClose: () => void }) {
  const scope = usePortalScopeProps();
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const many = images.length > 1;
  const step = useCallback((d: number) => onIndex(wrapIndex(index, d, images.length)), [index, images.length, onIndex]);
  useEffect(() => {
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (many && e.key === "ArrowRight") step(1);
    else if (many && e.key === "ArrowLeft") step(-1);
    else if (e.key === "Tab") {
      // Keep focus inside the lightbox.
      const items = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("button")];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at === items.length - 1 ? 0 : at + 1;
      items[next]?.focus();
      e.preventDefault();
    }
  };
  const im = images[index];
  const s = states[index];
  return createPortal(
    <div {...scope} data-iris-root="" role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby={titleId} onKeyDown={onKey} className="fixed inset-0 z-[1000] flex flex-col bg-background/95 text-foreground outline-none backdrop-blur-sm" onClick={onClose}>
      <div className="flex shrink-0 items-center gap-3 px-4 py-3" onClick={(e) => e.stopPropagation()}>
        <div id={titleId} className="min-w-0 flex-1 truncate text-[13.5px]">
          {im.caption ?? im.alt}
        </div>
        {many ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            {index + 1} of {images.length}
          </span>
        ) : null}
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50">
          <Glyph name="x" size={17} />
        </button>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16">
        {s.status === "ok" ? (
          <img src={s.url} alt={im.alt} onClick={(e) => e.stopPropagation()} className="max-h-full max-w-full rounded-lg object-contain shadow-[0_20px_60px_-30px_rgb(0_0_0/0.6)]" />
        ) : s.status === "loading" ? (
          <Shimmer className="aspect-video w-[min(720px,90%)]" />
        ) : (
          <div className="text-xs text-muted-foreground">{s.error}</div>
        )}
        {many ? (
          <>
            <LightboxArrow side="left" onClick={() => step(-1)} />
            <LightboxArrow side="right" onClick={() => step(1)} />
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function LightboxArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === "left" ? "Previous image" : "Next image"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-card/90 shadow-[0_0_0_1px_var(--border)] hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50",
        side === "left" ? "left-2 sm:left-4" : "right-2 sm:right-4",
      )}
    >
      <Glyph name={side === "left" ? "chevron-left" : "chevron-right"} size={18} />
    </button>
  );
}

// ---------- Hotspots ----------

export function HotspotsView({ props }: ViewProps) {
  const { palette } = useEnv();
  const src = str(props.src) ?? "";
  const image = useLoadedImage(src);
  const pending = isPendingValue(props.spots);
  const spots = useMemo(() => (pending ? [] : normalizeHotspots(props.spots)), [pending, props.spots]);
  const [selected, setSelected] = useState<number | null>(null);
  const showList = props.list !== false;
  const baseId = useId();
  return (
    <figure className="min-w-0">
      {image.status === "ok" ? (
        <div
          className="relative mx-auto w-fit max-w-full"
          onKeyDown={(e) => {
            if (e.key === "Escape") setSelected(null);
          }}
        >
          <img src={image.url} alt={str(props.alt) ?? ""} className="block max-h-[560px] w-auto max-w-full rounded-lg ring-1 ring-border" onClick={() => setSelected(null)} />
          {spots.map((s) => (
            <SpotPin key={s.n} spot={s} selected={selected === s.n} onSelect={() => setSelected(selected === s.n ? null : s.n)} color={palette.accent} describedBy={`${baseId}-${s.n}`} />
          ))}
        </div>
      ) : image.status === "loading" ? (
        <Shimmer className="aspect-video w-full" />
      ) : (
        <ImageProblem state={image} src={src} />
      )}
      {str(props.caption) ? <figcaption className="mt-1.5 text-xs text-muted-foreground">{str(props.caption)}</figcaption> : null}
      {showList && spots.length ? (
        <ol className="mt-2.5 grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(220px, 100%), 1fr))" }}>
          {spots.map((s) => (
            <li key={s.n} id={`${baseId}-${s.n}`}>
              <SpotRow spot={s} selected={selected === s.n} onSelect={() => setSelected(selected === s.n ? null : s.n)} color={palette.accent} />
            </li>
          ))}
        </ol>
      ) : null}
    </figure>
  );
}

function SpotPin({ spot, selected, onSelect, color, describedBy }: { spot: Hotspot; selected: boolean; onSelect: () => void; color: string; describedBy: string }) {
  const tone = useTone(spot.tone) ?? color;
  const right = spot.x > 62;
  const low = spot.y > 70;
  return (
    <div className="absolute size-0" style={{ left: `${spot.x}%`, top: `${spot.y}%`, zIndex: selected ? 3 : 2 }}>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={selected}
        aria-label={`${spot.n}. ${spot.title}`}
        aria-describedby={describedBy}
        className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
      >
        <NumberPin n={spot.n} color={tone} selected={selected} />
      </button>
      {selected ? (
        <div
          role="note"
          className="absolute w-max max-w-[min(15rem,60vw)] rounded-xl bg-card px-3 py-2 text-left shadow-[0_0_0_1px_var(--border),0_10px_30px_-12px_rgb(0_0_0/0.45)]"
          style={{ ...(right ? { right: 18 } : { left: 18 }), ...(low ? { bottom: -14 } : { top: -14 }) }}
        >
          <div className="text-[13px] font-medium leading-snug">{spot.title}</div>
          {spot.text ? <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{spot.text}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function SpotRow({ spot, selected, onSelect, color }: { spot: Hotspot; selected: boolean; onSelect: () => void; color: string }) {
  const tone = useTone(spot.tone) ?? color;
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/60", selected && "bg-muted/70")}>
      <NumberPin n={spot.n} color={tone} size={20} className="mt-px" />
      <span className="min-w-0">
        <span className="block text-[13px] leading-snug">{spot.title}</span>
        {spot.text ? <span className="block text-xs leading-relaxed text-muted-foreground">{spot.text}</span> : null}
      </span>
    </button>
  );
}

// ---------- Map ----------

interface Resolved {
  place: Place;
  at: { lat: number; lng: number } | null;
  label?: string;
  geo: GeoState | null;
}

export function MapView({ props }: ViewProps) {
  const pending = isPendingValue(props.places);
  const places = useMemo(() => (pending ? [] : normalizePlaces(props.places)), [pending, props.places]);
  const on = useWebLookups();
  const geo = useGeocode(places.map((p) => (on && !p.at ? p.query : undefined)));
  const resolved: Resolved[] = places.map((place, k) => {
    const g = !place.at && on ? geo[k] : null;
    const at = place.at ?? (g?.status === "found" ? { lat: g.hit.lat, lng: g.hit.lng } : null);
    return { place, at, label: g?.status === "found" ? g.hit.label : undefined, geo: g };
  });
  const [selected, setSelected] = useState<number | null>(null);
  const [wrapRef, wrapW] = useWidth<HTMLDivElement>();
  const showList = props.list !== false;
  const side = showList && wrapW >= 620;
  const route = props.route === true;
  const mapHeight = Math.max(160, Math.min(720, num(props.height) ?? 320));
  if (pending) return <Shimmer className="h-[320px] w-full" />;
  if (!places.length) return <Notice icon="map-pin">Map has no places</Notice>;
  const located = resolved.filter((r) => r.at);
  const stillLooking = resolved.some((r) => r.geo?.status === "loading");
  const lookupError = resolved.find((r) => r.geo?.status === "error")?.geo as Extract<GeoState, { status: "error" }> | undefined;
  return (
    <div ref={wrapRef} className="min-w-0">
      {str(props.title) ? <div className="mb-2 text-xs text-muted-foreground">{str(props.title)}</div> : null}
      <div className={cn("flex min-w-0 gap-3", side ? "flex-row items-stretch" : "flex-col")}>
        {on === false ? null : (
          <div className="min-w-0 flex-1">
            {on === null || (located.length === 0 && stillLooking) ? (
              <div style={{ height: mapHeight }}>
                <Shimmer className="h-full w-full rounded-xl" />
              </div>
            ) : located.length === 0 ? (
              <Notice icon="map-pin-off">{lookupError ? `Couldn't look up the places: ${lookupError.error}` : "None of the places could be found on the map"}</Notice>
            ) : (
              <TileMap resolved={resolved} route={route} height={mapHeight} zoom={num(props.zoom)} selected={selected} onSelect={setSelected} />
            )}
          </div>
        )}
        {showList || on === false ? (
          <div className={cn("min-w-0", side && on !== false ? "w-[240px] shrink-0" : "w-full")}>
            {on === false ? <Notice icon="globe-lock">The map is hidden: web lookups are off in Iris's settings.</Notice> : null}
            <PlaceList resolved={resolved} route={route} selected={selected} onSelect={setSelected} maxHeight={side && on !== false ? mapHeight : undefined} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlaceList({ resolved, route, selected, onSelect, maxHeight }: { resolved: Resolved[]; route: boolean; selected: number | null; onSelect: (n: number | null) => void; maxHeight?: number }) {
  const { palette } = useEnv();
  const legs = resolved.map((r, k) => {
    if (!route || k === 0 || !r.at) return null;
    const prev = resolved.slice(0, k).reverse().find((x) => x.at);
    return prev?.at ? { from: prev.place.n, km: distanceKm(prev.at, r.at) } : null;
  });
  const total = legs.reduce((sum, l) => sum + (l?.km ?? 0), 0);
  return (
    <div className={cn("min-w-0", maxHeight && "overflow-y-auto")} style={maxHeight ? { maxHeight } : undefined}>
      <ol className="flex flex-col gap-0.5">
        {resolved.map((r, k) => {
          const g = r.geo;
          return (
            <li key={r.place.n}>
              <button
                type="button"
                onClick={() => onSelect(selected === r.place.n ? null : r.place.n)}
                aria-pressed={selected === r.place.n}
                disabled={!r.at}
                className={cn("flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors enabled:hover:bg-muted/60", selected === r.place.n && "bg-muted/70")}
              >
                <PlacePinTone place={r.place} fallback={palette.accent} dim={!r.at} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] leading-snug">{r.place.name}</span>
                  {r.label && r.label.toLowerCase() !== r.place.name.toLowerCase() ? <span className="block truncate text-[11.5px] text-muted-foreground">{r.label}</span> : null}
                  {r.place.note ? <span className="block text-xs leading-relaxed text-muted-foreground">{r.place.note}</span> : null}
                  {g?.status === "loading" ? <span className="iris-shimmer mt-1 block h-2.5 w-24 rounded" aria-label="Looking up" /> : null}
                  {g?.status === "missing" ? <span className="block text-[11.5px] text-muted-foreground">Not found on the map</span> : null}
                  {legs[k] ? (
                    <span className="mt-0.5 flex items-center gap-1 text-[11.5px] tabular-nums text-muted-foreground">
                      <Glyph name="route" size={11} />
                      {formatDistance(legs[k]!.km)} from {legs[k]!.from}
                    </span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      {route && total > 0 ? <div className="mt-1.5 px-2 text-xs tabular-nums text-muted-foreground">Route {formatDistance(total)} as the crow flies</div> : null}
    </div>
  );
}

function PlacePinTone({ place, fallback, dim, selected }: { place: Place; fallback: string; dim?: boolean; selected?: boolean }) {
  const tone = useTone(place.tone) ?? fallback;
  return <NumberPin n={place.n} color={dim ? "var(--muted-foreground)" : tone} size={20} selected={selected} className="mt-px" />;
}

function TileMap({ resolved, route, height, zoom, selected, onSelect }: { resolved: Resolved[]; route: boolean; height: number; zoom?: number; selected: number | null; onSelect: (n: number | null) => void }) {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const [ref, width] = useWidth<HTMLDivElement>();
  const located = resolved.filter((r) => r.at) as (Resolved & { at: { lat: number; lng: number } })[];
  const pointsKey = JSON.stringify(located.map((r) => r.at));
  const fit = useMemo(() => {
    if (!width) return null;
    const v = fitView(
      located.map((r) => r.at),
      width,
      height,
      44,
    );
    if (zoom !== undefined) return zoomView(v, Math.round(Math.max(MAP_MIN_ZOOM, Math.min(MAP_MAX_ZOOM, zoom))) - v.z);
    return v;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointsKey, width, height, zoom]);
  const [moved, setMoved] = useState<View | null>(null);
  useEffect(() => setMoved(null), [pointsKey]);
  const view = moved ?? fit;
  const drag = useRef<{ x: number; y: number; v: View; id: number; moved: boolean } | null>(null);
  const tiles = view && width ? visibleTiles(view, width, height) : [];
  const set = (v: View) => setMoved(v);
  const pan = (dx: number, dy: number) => view && set({ ...view, cx: view.cx + dx, cy: Math.max(0, Math.min(TILE * 2 ** view.z, view.cy + dy)) });
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!view || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    drag.current = { x: e.clientX, y: e.clientY, v: view, id: e.pointerId, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    set({ ...d.v, cx: d.v.cx - dx, cy: Math.max(0, Math.min(TILE * 2 ** d.v.z, d.v.cy - dy)) });
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && !(e.target as HTMLElement).closest("button")) onSelect(null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!view) return;
    const k = e.key;
    if (k === "ArrowLeft") pan(-64, 0);
    else if (k === "ArrowRight") pan(64, 0);
    else if (k === "ArrowUp") pan(0, -64);
    else if (k === "ArrowDown") pan(0, 64);
    else if (k === "+" || k === "=") set(zoomView(view, 1));
    else if (k === "-" || k === "_") set(zoomView(view, -1));
    else if (k === "0") setMoved(null);
    else if (k === "Escape") onSelect(null);
    else return;
    e.preventDefault();
  };
  const dark = env.palette.dark;
  const routeColor = env.palette.accent;
  const pins = view ? located.map((r) => ({ r, pos: placeOnFrame(r.at, view, width, height) })) : [];
  const sel = pins.find((p) => p.r.place.n === selected);
  return (
    <div
      ref={ref}
      className="relative w-full touch-none select-none overflow-hidden rounded-xl bg-muted ring-1 ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50"
      style={{ height, cursor: "grab" }}
      tabIndex={0}
      role="application"
      aria-label={`Map of ${located.length} ${located.length === 1 ? "place" : "places"}. Arrow keys pan, plus and minus zoom, 0 fits.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={(e) => {
        if (!view || (e.target as HTMLElement).closest("button")) return;
        const box = e.currentTarget.getBoundingClientRect();
        const ox = e.clientX - box.left - width / 2;
        const oy = e.clientY - box.top - height / 2;
        const z = zoomView({ ...view, cx: view.cx + ox, cy: view.cy + oy }, 1);
        set({ ...z, cx: z.cx - ox, cy: z.cy - oy });
      }}
      onKeyDown={onKey}
    >
      <div aria-hidden className="absolute inset-0" style={dark ? { filter: "invert(1) hue-rotate(180deg) brightness(0.92) contrast(0.88) saturate(0.6)" } : undefined}>
        {tiles.map((t) => (
          <Tile key={t.key} z={t.z} x={t.x} y={t.y} left={t.left} top={t.top} rpc={rpc} />
        ))}
      </div>
      {route && pins.length > 1 ? (
        <svg aria-hidden className="pointer-events-none absolute inset-0" width={width} height={height}>
          <polyline points={pins.map((p) => `${p.pos.left},${p.pos.top}`).join(" ")} fill="none" stroke="var(--card)" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
          <polyline points={pins.map((p) => `${p.pos.left},${p.pos.top}`).join(" ")} fill="none" stroke={routeColor} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />
        </svg>
      ) : null}
      {pins.map(({ r, pos }) => (
        <MapPin key={r.place.n} place={r.place} left={pos.left} top={pos.top} selected={selected === r.place.n} onSelect={() => onSelect(selected === r.place.n ? null : r.place.n)} fallback={routeColor} />
      ))}
      {sel ? <MapPopup r={sel.r} left={sel.pos.left} top={sel.pos.top} width={width} /> : null}
      <div className="absolute left-2 top-2 flex flex-col overflow-hidden rounded-lg bg-card/95 shadow-[0_0_0_1px_var(--border)]">
        <MapButton icon="plus" label="Zoom in" onClick={() => view && set(zoomView(view, 1))} disabled={!view || view.z >= MAP_MAX_ZOOM} />
        <MapButton icon="minus" label="Zoom out" onClick={() => view && set(zoomView(view, -1))} disabled={!view || view.z <= MAP_MIN_ZOOM} />
        <MapButton icon="scan" label="Fit every place" onClick={() => setMoved(null)} disabled={!moved} />
      </div>
      <div className="absolute bottom-0 right-0 rounded-tl-md bg-card/85 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
        © <ExternalLink url="https://www.openstreetmap.org/copyright">OpenStreetMap</ExternalLink> contributors
      </div>
    </div>
  );
}

function Tile({ z, x, y, left, top, rpc }: { z: number; x: number; y: number; left: number; top: number; rpc: ReturnType<typeof useRpc<RpcContract>> }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    setUrl(null);
    // One retry: a tile asked for while the server restarts or is busy comes back empty once.
    loadTile(rpc, z, x, y).then((u) => {
      if (!live) return;
      if (u) setUrl(u);
      else retry = setTimeout(() => loadTile(rpc, z, x, y).then((again) => live && setUrl(again)), 2000);
    });
    return () => {
      live = false;
      clearTimeout(retry);
    };
  }, [rpc, z, x, y]);
  if (!url) return null;
  return <img src={url} alt="" draggable={false} className="absolute max-w-none" style={{ left: Math.round(left), top: Math.round(top), width: TILE, height: TILE }} />;
}

function MapPin({ place, left, top, selected, onSelect, fallback }: { place: Place; left: number; top: number; selected: boolean; onSelect: () => void; fallback: string }) {
  const tone = useTone(place.tone) ?? fallback;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${place.n}. ${place.name}`}
      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/60"
      style={{ left, top, zIndex: selected ? 3 : 2 }}
    >
      <NumberPin n={place.n} color={tone} selected={selected} />
    </button>
  );
}

function MapPopup({ r, left, top, width }: { r: Resolved; left: number; top: number; width: number }) {
  const right = left > width * 0.6;
  return (
    <div
      role="note"
      className="pointer-events-none absolute z-[4] w-max max-w-[min(15rem,70%)] rounded-xl bg-card px-3 py-2 shadow-[0_0_0_1px_var(--border),0_10px_30px_-12px_rgb(0_0_0/0.45)]"
      style={right ? { right: width - left + 16, top: top - 12 } : { left: left + 16, top: top - 12 }}
    >
      <div className="text-[13px] font-medium leading-snug">{r.place.name}</div>
      {r.label && r.label.toLowerCase() !== r.place.name.toLowerCase() ? <div className="text-[11.5px] text-muted-foreground">{r.label}</div> : null}
      {r.place.note ? <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{r.place.note}</div> : null}
    </div>
  );
}

function MapButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label} className="grid size-8 place-items-center text-foreground transition-colors enabled:hover:bg-muted disabled:opacity-40">
      <Glyph name={icon} size={15} />
    </button>
  );
}

// ---------- PhotoSearch ----------

export function PhotoSearchView({ props }: ViewProps) {
  const query = str(props.query) ?? "";
  const maxWidth = Math.max(160, Math.min(1280, num(props.width) ?? 640));
  const dpr = typeof devicePixelRatio === "number" ? Math.min(2, devicePixelRatio) : 1;
  // Commons serves at most 1280 px wide (photoWidth), and the wire caps width.
  const state = usePhoto(query, Math.min(1280, Math.round(maxWidth * dpr)));
  const aspect = str(props.aspect) ?? "natural";
  if (state.status === "loading") return <Shimmer className="aspect-[3/2] w-full" />;
  if (state.status === "error") {
    const text =
      state.code === "off"
        ? "Photo hidden: web lookups are off in Iris's settings."
        : state.code === "not_found"
          ? `Wikimedia Commons has no photo for "${query}".`
          : `Couldn't get a photo from Wikimedia Commons: ${state.error}`;
    return <Notice icon={state.code === "off" ? "globe-lock" : "image-off"}>{text}</Notice>;
  }
  const photo = state.photo;
  return (
    <figure className="min-w-0" style={{ maxWidth }}>
      <img
        src={photo.dataUrl}
        alt={str(props.caption) ?? photo.title}
        className={cn("block w-full rounded-lg bg-muted ring-1 ring-border", aspect === "landscape" ? "aspect-[3/2] object-cover" : aspect === "square" ? "aspect-square object-cover" : "h-auto")}
        width={photo.width || undefined}
        height={photo.height || undefined}
      />
      <figcaption className="mt-1.5 min-w-0 text-xs text-muted-foreground">
        <span className="block text-foreground/90">{str(props.caption) ?? photo.title}</span>
        {/* Credits sit apart by space, so a wrapped line never starts or ends on a separator. */}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3">
          <span>Photo{photo.author ? `: ${photo.author}` : ""}</span>
          {photo.license ? photo.licenseUrl ? <ExternalLink url={photo.licenseUrl}>{photo.license}</ExternalLink> : <span>{photo.license}</span> : null}
          <ExternalLink url={photo.page}>Wikimedia Commons</ExternalLink>
        </span>
      </figcaption>
    </figure>
  );
}
