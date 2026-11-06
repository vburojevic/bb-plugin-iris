// Evidence views: Acceptance (is it really done), Compare (what changed on
// screen) and Provenance (which build is really where). The judgments live in
// core/evidence.ts; these only draw them, in the theme's tone colors.

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { isPendingValue } from "../../core/evaluate";
import {
  type AcceptanceCell,
  type AcceptanceStatus,
  type CompareImage,
  type CompareMode,
  type PixelDiff,
  type ProvenanceStage,
  ACCEPTANCE_STATUSES,
  compareMode,
  diffPixels,
  diffSize,
  evidenceTarget,
  normalizeAcceptance,
  normalizeCompareImages,
  normalizeProvenance,
  showFact,
  stageTone,
} from "../../core/evidence";
import { useEnv } from "../env";
import { type ImageState, useLoadedImages, imageError } from "../files";
import type { Tone } from "../palette";
import type { ViewProps } from "../render";
import { Chip, Glyph, Shimmer, cn, num, str } from "./kit";

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
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

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof matchMedia === "undefined") return;
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return reduced;
}

// ---------- Acceptance ----------

const STATUS_LOOK: Record<AcceptanceStatus, { tone: Tone; icon: string; label: string }> = {
  passed: { tone: "good", icon: "circle-check", label: "Passed" },
  failed: { tone: "bad", icon: "circle-x", label: "Failed" },
  blocked: { tone: "warn", icon: "ban", label: "Blocked" },
  claimed: { tone: "info", icon: "quote", label: "Claimed" },
  untested: { tone: "neutral", icon: "circle-dashed", label: "Untested" },
};

const VERDICT_LOOK = {
  done: { tone: "good" as Tone, icon: "circle-check", label: "Done" },
  "not done": { tone: "bad" as Tone, icon: "circle-x", label: "Not done" },
  unproven: { tone: "warn" as Tone, icon: "circle-dashed", label: "Not proven" },
  empty: { tone: "neutral" as Tone, icon: "circle-dashed", label: "No criteria" },
};

function StatusIcon({ status, size = 15 }: { status: AcceptanceStatus; size?: number }) {
  const { palette } = useEnv();
  const look = STATUS_LOOK[status];
  return <Glyph name={look.icon} size={size} color={palette.tone[look.tone]} />;
}

function EvidenceLink({ evidence, className }: { evidence: string; className?: string }) {
  const env = useEnv();
  const target = evidenceTarget(evidence);
  const open = () =>
    target.kind === "url"
      ? env.perform([{ $iris: "action", kind: "openUrl", args: [target.url] }])
      : env.perform([{ $iris: "action", kind: "openFile", args: [target.path, target.line] }]);
  const label = target.kind === "url" ? evidence.replace(/^https?:\/\//i, "") : evidence.replace(/^\$BB_THREAD_STORAGE\//, "");
  if (target.kind === "url" && !/^https:/i.test(target.url)) {
    // Only https links open in bb; show an http link as text rather than a dead button.
    return (
      <span title="Only https links open" className={cn("inline-flex max-w-full min-w-0 items-center gap-1 font-mono text-[11.5px] text-muted-foreground", className)}>
        <Glyph name="external-link" size={12} />
        <span className="truncate">{evidence}</span>
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={open}
      title={`Open ${evidence}`}
      className={cn("inline-flex max-w-full min-w-0 items-center gap-1 font-mono text-[11.5px] text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground", className)}
    >
      <Glyph name={target.kind === "url" ? "external-link" : "paperclip"} size={12} />
      <span className="truncate">{label}</span>
    </button>
  );
}

export function AcceptanceView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.criteria);
  const model = useMemo(() => (pending ? null : normalizeAcceptance(props.criteria, props.columns)), [pending, props.criteria, props.columns]);
  // The first failing or blocked cell that says why opens at first, so the reason shows without a click.
  const firstWhy = useMemo(() => {
    if (!model) return null;
    for (const s of ["failed", "blocked", "claimed"] as AcceptanceStatus[])
      for (let r = 0; r < model.rows.length; r++)
        for (let c = 0; c < model.rows[r].cells.length; c++) {
          const cell = model.rows[r].cells[c];
          if (cell.status === s && (cell.note || cell.evidence)) return `${r}:${c}`;
        }
    return null;
  }, [model]);
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const panelId = useId();
  const root = useRef<HTMLDivElement | null>(null);
  if (!model) return <Shimmer className="h-28" />;
  const selected = picked === undefined ? firstWhy : picked;
  const total = ACCEPTANCE_STATUSES.reduce((n, s) => n + model.counts[s], 0);
  const verdict = VERDICT_LOOK[model.verdict];
  const verdictColor = env.palette.tone[verdict.tone];
  const title = str(props.title);
  const order: AcceptanceStatus[] = ["passed", "failed", "blocked", "claimed", "untested"];
  const matrix = model.columns.length > 0;
  const sel = selected ? selected.split(":").map(Number) : null;
  const selRow = sel ? model.rows[sel[0]] : undefined;
  const selCell = sel && selRow ? selRow.cells[sel[1]] : undefined;
  return (
    <div ref={root} className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold tracking-[-0.01em]" style={{ color: verdictColor }}>
          <Glyph name={verdict.icon} size={17} color={verdictColor} />
          {verdict.label}
        </span>
        <span className="text-[12.5px] tabular-nums text-muted-foreground">
          {model.counts.passed} of {total} {matrix ? "checks" : "criteria"} passed
        </span>
        {title ? <span className="ml-auto truncate text-xs text-muted-foreground">{title}</span> : null}
      </div>
      {total ? (
        <div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full bg-muted" aria-hidden>
          {order.map((s) =>
            model.counts[s] && s !== "untested" ? <div key={s} className="iris-bar h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(model.counts[s] / total) * 100}%`, background: env.palette.tone[STATUS_LOOK[s].tone] }} /> : null,
          )}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {order
          .filter((s) => model.counts[s] && s !== "passed")
          .map((s) => (
            <Chip key={s} tone={STATUS_LOOK[s].tone} icon={STATUS_LOOK[s].icon}>
              {model.counts[s]} {STATUS_LOOK[s].label.toLowerCase()}
              {s === "claimed" ? ", not shown" : ""}
            </Chip>
          ))}
      </div>
      {matrix ? (
        <AcceptanceMatrix model={model} selected={selected} onSelect={setPicked} panelId={panelId} />
      ) : (
        <ul className="mt-2 [&>li+li]:border-t [&>li+li]:border-border/70">
          {model.rows.map((r, k) => (
            <li key={k} className="flex min-w-0 gap-2.5 py-2">
              <span className="mt-0.5">
                <StatusIcon status={r.status} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] leading-snug">{r.name}</div>
                {r.note ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{r.note}</p> : null}
                {r.evidence ? <EvidenceLink evidence={r.evidence} className="mt-0.5" /> : null}
              </div>
              <span className={cn("shrink-0 text-xs font-medium", r.status === "untested" && "text-muted-foreground")} style={{ color: r.status === "untested" ? undefined : env.palette.tone[STATUS_LOOK[r.status].tone] }}>
                {STATUS_LOOK[r.status].label}
                {r.status === "claimed" ? ", not shown" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {matrix && selRow && selCell ? (
        <CellDetail
          id={panelId}
          row={selRow.name}
          column={model.columns[sel![1]]}
          cell={selCell}
          onClose={() => {
            // Hand focus back to the cell that opened the detail.
            root.current?.querySelector<HTMLButtonElement>(`[data-cell="${selected}"]`)?.focus();
            setPicked(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AcceptanceMatrix({ model, selected, onSelect, panelId }: { model: ReturnType<typeof normalizeAcceptance>; selected: string | null; onSelect: (k: string | null) => void; panelId: string }) {
  return (
    <div className="iris-scroll-x mt-2 overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th className="pb-1.5 pr-3 text-left text-xs font-normal text-muted-foreground">
              <span className="sr-only">Criterion</span>
            </th>
            {model.columns.map((c) => (
              <th key={c} scope="col" className="w-[3.25rem] min-w-[3.25rem] whitespace-nowrap px-1 pb-1.5 text-center text-xs font-medium text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r, ri) => (
            <tr key={ri} className="[&>*]:border-t [&>*]:border-border/70">
              <th scope="row" className="min-w-[7.5rem] max-w-[22rem] py-1.5 pr-3 text-left align-middle font-normal">
                <div className="whitespace-normal leading-snug [text-wrap:pretty]">{r.name}</div>
                {r.note ? <div className="mt-0.5 whitespace-normal text-[12px] leading-snug text-muted-foreground">{r.note}</div> : null}
                {r.evidence ? <EvidenceLink evidence={r.evidence} /> : null}
              </th>
              {r.cells.map((cell, ci) => {
                const key = `${ri}:${ci}`;
                const hasWhy = Boolean(cell.note || cell.evidence);
                const label = `${model.columns[ci]}: ${STATUS_LOOK[cell.status].label}${cell.missing ? ", no result given" : ""}`;
                return (
                  <td key={ci} className="px-1 py-1 text-center align-middle">
                    {hasWhy ? (
                      <button
                        type="button"
                        aria-label={`${label}. Show why`}
                        aria-expanded={selected === key}
                        aria-controls={selected === key ? panelId : undefined}
                        data-cell={key}
                        title={label}
                        onClick={() => onSelect(selected === key ? null : key)}
                        className={cn("iris-hit relative inline-grid size-8 place-items-center rounded-lg hover:bg-state-hover pointer-coarse:size-10", selected === key && "bg-muted ring-1 ring-border")}
                      >
                        <StatusIcon status={cell.status} size={16} />
                        <span className="absolute right-1 top-1 size-1 rounded-full bg-muted-foreground/70" aria-hidden />
                      </button>
                    ) : (
                      <span className={cn("inline-grid size-8 place-items-center", cell.missing && "opacity-60")} title={label} role="img" aria-label={label}>
                        <StatusIcon status={cell.status} size={16} />
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CellDetail({ id, row, column, cell, onClose }: { id: string; row: string; column: string; cell: AcceptanceCell; onClose: () => void }) {
  const { palette } = useEnv();
  const look = STATUS_LOOK[cell.status];
  return (
    <div id={id} className="mt-2 flex min-w-0 gap-2.5 rounded-lg bg-muted/50 px-3 py-2" role="region" aria-label={`${row}, ${column}`}>
      <span className="mt-0.5">
        <StatusIcon status={cell.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px]">
          <span className="font-medium">{column}</span>
          <span className="text-muted-foreground"> · {row} · </span>
          <span style={{ color: look.tone === "neutral" ? undefined : palette.tone[look.tone] }}>{look.label}</span>
        </div>
        {cell.note ? <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{cell.note}</p> : null}
        {cell.evidence ? <EvidenceLink evidence={cell.evidence} className="mt-0.5" /> : null}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="self-start text-muted-foreground hover:text-foreground">
        <Glyph name="x" size={14} />
      </button>
    </div>
  );
}

// ---------- Compare ----------

const MODE_LABEL: Record<CompareMode, { label: string; icon: string }> = {
  wipe: { label: "Wipe", icon: "chevrons-left-right" },
  side: { label: "Side by side", icon: "columns-2" },
  blink: { label: "Blink", icon: "eye" },
  diff: { label: "Diff", icon: "scan" },
};

function ImageTag({ label, className }: { label: string; className?: string }) {
  return <span className={cn("pointer-events-none absolute top-2 max-w-[45%] truncate rounded-full bg-card/85 px-2 py-0.5 text-[11.5px] font-medium text-foreground shadow-[0_0_0_1px_var(--border)] backdrop-blur", className)}>{label}</span>;
}

function Failed({ state, src }: { state: ImageState; src: string }) {
  return <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">{imageError(src, state.status === "error" ? state.error : "")}</div>;
}

/** The reference image's natural size, once it is known. */
function useNaturalSize(url: string | undefined): { width: number; height: number } | null {
  const [size, setSize] = useState<{ url: string; width: number; height: number } | null>(null);
  useEffect(() => {
    if (!url) return;
    let live = true;
    const im = new Image();
    im.onload = () => live && setSize({ url, width: im.naturalWidth || 1, height: im.naturalHeight || 1 });
    im.src = url;
    return () => {
      live = false;
    };
  }, [url]);
  return size && size.url === url ? size : null;
}

/** Reads only props, so CompareGrid can open a pair in it too. */
export function CompareView({ props }: Pick<ViewProps, "props">) {
  const pending = isPendingValue(props.images);
  const images = useMemo(() => (pending ? [] : normalizeCompareImages(props.images)), [pending, props.images]);
  const states = useLoadedImages(images.map((i) => i.src));
  const [chosen, setMode] = useState<CompareMode | null>(null);
  const mode = chosen ?? compareMode(props.mode, images.length);
  const [other, setOther] = useState(1);
  if (pending) return <Shimmer className="aspect-video w-full" />;
  if (images.length < 2) return <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">Compare needs a reference and at least one more image</div>;
  const b = Math.min(other, images.length - 1);
  const pair = mode !== "side";
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Compare mode" className="iris-scroll-x inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-muted/70 p-0.5">
          {(Object.keys(MODE_LABEL) as CompareMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              title={MODE_LABEL[m].label}
              aria-label={MODE_LABEL[m].label}
              className={cn("iris-hit inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors", mode === m ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground @max-lg/iris:px-2.5")}
            >
              <Glyph name={MODE_LABEL[m].icon} size={13} />
              {/* On a phone only the chosen mode keeps its name, so all four fit. */}
              <span className={cn(mode !== m && "@max-lg/iris:hidden")}>{MODE_LABEL[m].label}</span>
            </button>
          ))}
        </div>
        {pair && images.length > 2 ? (
          <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>against</span>
            {images.slice(1).map((im, k) => (
              <button key={k} type="button" aria-pressed={b === k + 1} onClick={() => setOther(k + 1)} className={cn("h-6 rounded-full px-2.5", b === k + 1 ? "bg-foreground text-background" : "ring-1 ring-border hover:text-foreground")}>
                {im.label}
              </button>
            ))}
          </div>
        ) : null}
        {str(props.title) ? <span className="ml-auto truncate text-xs text-muted-foreground">{str(props.title)}</span> : null}
      </div>
      {mode === "side" ? (
        <SideBySide images={images} states={states} />
      ) : states[0].status !== "ok" || states[b].status !== "ok" ? (
        states[0].status === "error" ? (
          <Failed state={states[0]} src={images[0].src} />
        ) : states[b].status === "error" ? (
          <Failed state={states[b]} src={images[b].src} />
        ) : (
          <Shimmer className="aspect-video w-full" />
        )
      ) : mode === "wipe" ? (
        <Wipe a={images[0]} b={images[b]} aUrl={states[0].url} bUrl={states[b].url} />
      ) : mode === "blink" ? (
        <Blink a={images[0]} b={images[b]} aUrl={states[0].url} bUrl={states[b].url} />
      ) : (
        <PixelDiffView a={images[0]} b={images[b]} aUrl={states[0].url} bUrl={states[b].url} threshold={num(props.threshold) ?? 16} />
      )}
    </div>
  );
}

function Wipe({ a, b, aUrl, bUrl }: { a: CompareImage; b: CompareImage; aUrl: string; bUrl: string }) {
  const size = useNaturalSize(aUrl);
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef(false);
  const moveTo = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };
  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    moveTo(e.clientX);
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const next = e.key === "ArrowLeft" ? pos - step : e.key === "ArrowRight" ? pos + step : e.key === "Home" ? 0 : e.key === "End" ? 100 : null;
    if (next == null) return;
    e.preventDefault();
    setPos(Math.max(0, Math.min(100, next)));
  };
  return (
    <div
      ref={box}
      className="relative w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border"
      style={{ aspectRatio: size ? `${size.width} / ${size.height}` : "16 / 10" }}
      onPointerDown={down}
      onPointerMove={(e) => drag.current && moveTo(e.clientX)}
      onPointerUp={() => (drag.current = false)}
      onPointerCancel={() => (drag.current = false)}
    >
      <img src={bUrl} alt={b.label} draggable={false} className="absolute inset-0 size-full object-contain" />
      <img src={aUrl} alt={a.label} draggable={false} className="absolute inset-0 size-full object-contain" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} />
      <ImageTag label={a.label} className="left-2" />
      <ImageTag label={b.label} className="right-2" />
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground shadow-[0_0_0_1px_var(--card)]" style={{ left: `${pos}%` }} />
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Divider between ${a.label} and ${b.label}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% ${a.label}`}
        onKeyDown={key}
        className="absolute top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-foreground text-background shadow-[0_0_0_2px_var(--card)] outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
        style={{ left: `${pos}%` }}
      >
        <Glyph name="chevrons-left-right" size={15} />
      </div>
    </div>
  );
}

function SideBySide({ images, states }: { images: CompareImage[]; states: ImageState[] }) {
  return (
    <div className="grid min-w-0 gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${images.length > 2 ? 11 : 14}rem), 1fr))` }}>
      {images.map((im, k) => {
        const s = states[k];
        return (
          <figure key={k} className="min-w-0">
            {s.status === "ok" ? (
              <img src={s.url} alt={im.label} className="block w-full rounded-lg bg-muted/40 ring-1 ring-border" />
            ) : s.status === "error" ? (
              <Failed state={s} src={im.src} />
            ) : (
              <Shimmer className="aspect-video w-full" />
            )}
            <figcaption className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
              {k === 0 ? <Chip>Reference</Chip> : null}
              <span className="truncate">{k === 0 && im.label === "Reference" ? "" : im.label}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function Blink({ a, b, aUrl, bUrl }: { a: CompareImage; b: CompareImage; aUrl: string; bUrl: string }) {
  const reduced = useReducedMotion();
  const size = useNaturalSize(aUrl);
  const [showB, setShowB] = useState(false);
  const [playing, setPlaying] = useState(!reduced);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setShowB((v) => !v), 700);
    return () => clearInterval(t);
  }, [playing]);
  const shown = showB ? b : a;
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => {
          setPlaying(false);
          setShowB((v) => !v);
        }}
        aria-label={`Showing ${shown.label}. Switch image`}
        className="relative block w-full overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border"
        style={{ aspectRatio: size ? `${size.width} / ${size.height}` : "16 / 10" }}
      >
        <img src={aUrl} alt={a.label} className={cn("absolute inset-0 size-full object-contain", showB && "invisible")} />
        <img src={bUrl} alt={b.label} className={cn("absolute inset-0 size-full object-contain", !showB && "invisible")} />
        <ImageTag label={shown.label} className="left-2" />
      </button>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
        <button type="button" onClick={() => setPlaying(!playing)} className="inline-flex items-center gap-1 hover:text-foreground">
          <Glyph name={playing ? "pause" : "play"} size={13} />
          {playing ? "Pause" : "Play"}
        </button>
        <span>Click the image to switch by hand</span>
      </div>
    </div>
  );
}

type DiffState = { status: "loading" } | { status: "error"; error: string } | { status: "ok"; result: PixelDiff; width: number; height: number; sizes: [string, string] | null };

function loadPixels(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (/^https:/.test(url)) im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(im.crossOrigin ? "this image host does not allow reading pixels; save the images to the workspace and compare those" : "the image did not load"));
    im.src = url;
  });
}

function PixelDiffView({ a, b, aUrl, bUrl, threshold }: { a: CompareImage; b: CompareImage; aUrl: string; bUrl: string; threshold: number }) {
  const { palette } = useEnv();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<DiffState>({ status: "loading" });
  const color = palette.tone.bad;
  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    Promise.all([loadPixels(aUrl), loadPixels(bUrl)])
      .then(([ia, ib]) => {
        if (!live) return;
        const { width, height } = diffSize(ia.naturalWidth, ia.naturalHeight);
        if (!width || !height) throw new Error("the reference has no size");
        const read = (im: HTMLImageElement) => {
          const c = document.createElement("canvas");
          c.width = width;
          c.height = height;
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(im, 0, 0, width, height);
          return ctx.getImageData(0, 0, width, height).data;
        };
        let pa: Uint8ClampedArray;
        let pb: Uint8ClampedArray;
        try {
          pa = read(ia);
          pb = read(ib);
        } catch {
          throw new Error("this image host does not allow reading pixels; save the images to the workspace and compare those");
        }
        const result = diffPixels(pa, pb, width, height, threshold);
        const sizes: [string, string] | null =
          ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight ? [`${ia.naturalWidth}×${ia.naturalHeight}`, `${ib.naturalWidth}×${ib.naturalHeight}`] : null;
        // Draw: the reference faded, changed pixels painted in the theme's "bad" tone, a box around them.
        const out = canvas.current;
        if (out) {
          out.width = width;
          out.height = height;
          const ctx = out.getContext("2d")!;
          ctx.clearRect(0, 0, width, height);
          ctx.globalAlpha = 0.28;
          ctx.drawImage(ia, 0, 0, width, height);
          ctx.globalAlpha = 1;
          const mask = document.createElement("canvas");
          mask.width = width;
          mask.height = height;
          const mctx = mask.getContext("2d")!;
          const img = mctx.createImageData(width, height);
          for (let i = 0; i < result.mask.length; i++) if (result.mask[i]) img.data[i * 4 + 3] = 255;
          mctx.putImageData(img, 0, 0);
          mctx.globalCompositeOperation = "source-in";
          mctx.fillStyle = color;
          mctx.fillRect(0, 0, width, height);
          ctx.drawImage(mask, 0, 0);
          if (result.bounds) {
            const pad = Math.max(3, Math.round(width / 120));
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(1.5, width / 400);
            ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2]);
            ctx.strokeRect(result.bounds.x - pad, result.bounds.y - pad, result.bounds.width + pad * 2, result.bounds.height + pad * 2);
          }
        }
        setState({ status: "ok", result, width, height, sizes });
      })
      .catch((e: unknown) => live && setState({ status: "error", error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [aUrl, bUrl, threshold, color]);
  const r = state.status === "ok" ? state.result : null;
  const share = r ? (r.changed / r.total) * 100 : 0;
  return (
    <div className="min-w-0">
      {state.status === "error" ? <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">Couldn't diff the images: {state.error}</div> : null}
      <div className={cn("relative overflow-hidden rounded-lg bg-muted/40 ring-1 ring-border", state.status === "error" && "hidden")}>
        <canvas ref={canvas} className="block h-auto w-full" role="img" aria-label={r ? `${r.changed} pixels changed between ${a.label} and ${b.label}` : "Comparing pixels"} />
        {state.status === "loading" ? <Shimmer className="absolute inset-0" /> : null}
      </div>
      {r ? (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[12.5px]">
          <span className="inline-flex items-baseline gap-1.5">
            <span className="text-[18px] font-semibold leading-none tracking-[-0.02em] tabular-nums" style={{ color: r.changed ? palette.tone.bad : palette.tone.good }}>
              {r.changed.toLocaleString("en-US")}
            </span>
            <span className="text-muted-foreground">{r.changed === 1 ? "pixel changed" : "pixels changed"}</span>
          </span>
          <span className="tabular-nums text-muted-foreground">
            {share === 0 ? "0%" : share < 0.01 ? "under 0.01%" : `${share.toFixed(share < 1 ? 2 : 1)}%`} of {r.total.toLocaleString("en-US")}
            {r.bounds ? `, inside ${r.bounds.width}×${r.bounds.height} at ${r.bounds.x},${r.bounds.y}` : ""}
          </span>
          <span className="text-muted-foreground">
            {b.label} against {a.label}
          </span>
          {state.status === "ok" && state.sizes ? (
            <span className="w-full text-xs" style={{ color: palette.tone.warn }}>
              Sizes differ ({state.sizes[0]} and {state.sizes[1]}); both were drawn at {state.width}×{state.height}.
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// ---------- Provenance ----------

const FACT_LABEL: Record<string, string> = { branch: "Branch", sha: "Commit", build: "Build", version: "Version", device: "Device" };

export function ProvenanceView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.stages);
  const model = useMemo(() => (pending ? null : normalizeProvenance(props.stages, props.expected)), [pending, props.stages, props.expected]);
  const [ref, width] = useWidth<HTMLDivElement>();
  if (!model)
    return (
      <div ref={ref}>
        <Shimmer className="h-28" />
      </div>
    );
  const across = model.stages.length > 0 && width > 0 && width / model.stages.length >= 150 && model.stages.length <= 6;
  const title = str(props.title);
  const expectedText = model.expected.map(([f, v]) => `${FACT_LABEL[f].toLowerCase()} ${showFact(f, v)}`).join(", ");
  const verdict = !model.expected.length
    ? null
    : !model.checked
      ? { tone: "neutral" as Tone, icon: "circle-dashed", text: `No stage shows ${expectedText}` }
      : model.differing
        ? { tone: "bad" as Tone, icon: "circle-x", text: `${model.differing} of ${model.stages.length} ${model.stages.length === 1 ? "stage differs" : "stages differ"} from ${expectedText}` }
        : { tone: "good" as Tone, icon: "circle-check", text: `Every stage that shows it carries ${expectedText}` };
  return (
    <div ref={ref} className="min-w-0">
      {verdict || title ? (
        <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {verdict ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium" style={{ color: verdict.tone === "neutral" ? undefined : env.palette.tone[verdict.tone] }}>
              <Glyph name={verdict.icon} size={15} />
              <span className="min-w-0 [text-wrap:balance]">{verdict.text}</span>
            </span>
          ) : null}
          {title ? <span className="ml-auto truncate text-xs text-muted-foreground">{title}</span> : null}
        </div>
      ) : null}
      {across ? (
        <ol className="flex min-w-0 items-stretch">
          {model.stages.map((s, k) => (
            <li key={k} className="flex min-w-0 flex-1 items-stretch">
              {k > 0 ? (
                <span className="grid w-5 shrink-0 place-items-center text-muted-foreground" aria-hidden>
                  <Glyph name="chevron-right" size={14} />
                </span>
              ) : null}
              <StagePanel stage={s} />
            </li>
          ))}
        </ol>
      ) : (
        <ol className="relative min-w-0">
          {model.stages.map((s, k) => (
            <li key={k} className="relative flex min-w-0 gap-3 pb-3 last:pb-0">
              {k < model.stages.length - 1 ? <span className="absolute bottom-0 left-[5px] top-4 w-px bg-border" aria-hidden /> : null}
              <StageDot stage={s} />
              <StageBody stage={s} inline />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function stageColor(env: ReturnType<typeof useEnv>, s: ProvenanceStage): string {
  return s.mismatches.length ? env.palette.tone.bad : env.palette.tone[stageTone(s.status)];
}

function StageDot({ stage }: { stage: ProvenanceStage }) {
  const env = useEnv();
  return <span className="relative mt-[5px] size-[11px] shrink-0 rounded-full ring-2 ring-card" style={{ background: stageColor(env, stage) }} aria-hidden />;
}

function StagePanel({ stage }: { stage: ProvenanceStage }) {
  const env = useEnv();
  const off = stage.mismatches.length > 0;
  return (
    <div
      className="min-w-0 flex-1 rounded-xl bg-muted/40 px-3 py-2.5"
      style={{ boxShadow: off ? `inset 0 0 0 1.5px ${env.palette.tone.bad}` : "inset 0 0 0 1px var(--border)" }}
    >
      <StageBody stage={stage} />
    </div>
  );
}

function StageBody({ stage, inline }: { stage: ProvenanceStage; inline?: boolean }) {
  const env = useEnv();
  const tone = stageTone(stage.status);
  const wrong = new Map(stage.mismatches.map((m) => [m.fact as string, m]));
  const copy = (v: string) => env.perform([{ $iris: "action", kind: "copy", args: [v] }]);
  return (
    <div className="min-w-0 flex-1">
      <div className={cn("flex min-w-0 gap-x-2 gap-y-1", inline ? "flex-wrap items-center" : "flex-col items-start")}>
        <span className="max-w-full truncate text-[13px] font-semibold leading-snug">{stage.name}</span>
        {stage.status ? (
          <Chip tone={tone === "neutral" ? undefined : tone} className="shrink-0">
            {stage.status}
          </Chip>
        ) : null}
      </div>
      {stage.facts.length ? (
        <dl className={cn("mt-1.5 min-w-0 text-[12px]", inline ? "grid grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-x-4 gap-y-1" : "flex flex-col gap-1")}>
          {/* Facts sit in fixed columns, so every stage lines up and an "expected" note never pushes its neighbors. */}
          {stage.facts.map(([f, v]) => {
            const m = wrong.get(f);
            return (
              <div key={f} className="min-w-0">
                <dt className="text-[11px] text-muted-foreground">{FACT_LABEL[f] ?? f}</dt>
                <dd className="min-w-0">
                  <button
                    type="button"
                    onClick={() => copy(v)}
                    title={`Copy ${v}`}
                    className={cn("max-w-full truncate text-left hover:underline", f === "sha" || f === "build" || f === "version" || f === "branch" ? "font-mono text-[12px]" : "")}
                    style={m ? { color: env.palette.tone.bad, fontWeight: 600 } : undefined}
                  >
                    {showFact(f, v)}
                  </button>
                  {m ? <div className="text-[11px] text-muted-foreground">expected {showFact(f, m.expected)}</div> : null}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
    </div>
  );
}
