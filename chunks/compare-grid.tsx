// CompareGrid (chunk "compare"): many before and after pairs, each diffed with
// Compare's pixel diff (core/evidence.ts), in a grid that sorts and filters by
// change. A click opens the pair in Compare itself (from the main bundle).
//
// Fast with hundreds of pairs: one background queue diffs two pairs at a time,
// tiles on screen first. Each job decodes both images once, keeps only the
// counts, a small thumbnail and a small mask of the changes, and lets the
// full images go. Paths stream through bb preview leases (file_url,
// folder_files), so nothing is base64-encoded on the way.

import { useRpc } from "@get-bb/plugin-sdk/app";
import { Chip, CompareView, Glyph, InlineError, Shimmer, cn, literalStrings, num, str, useEnv } from "@iris/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  type ComparePair,
  type GridFilter,
  type GridItem,
  type GridSort,
  type PairDiff,
  type PairStatus,
  filterItems,
  folderPair,
  gridCounts,
  matchFolders,
  normalizePairs,
  pairStatus,
  readFilter,
  readSort,
  shareText,
  sortItems,
} from "../core/compare";
import { isPendingValue } from "../core/evaluate";
import { diffPixels, diffSize } from "../core/evidence";
import type { RpcContract } from "../shared/rpc";
import type { ViewProps } from "../ui/render";
import { absolute, errorText, inFolder, probe, useFolder, type FolderState } from "./file-access";

const MAX_PAIRS = 500;
/** Tiles shown before "Show more", so a big run stays a card, not a wall. */
const PAGE = 48;
const PARALLEL = 2;
const THUMB = 360;

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

/** One side of a pair: the card path Compare opens, and a URL when it is already known (a folder lease). */
interface Side {
  path: string;
  url?: string;
}
interface Pair {
  key: string;
  label: string;
  ref: Side | null;
  cand: Side | null;
}

interface JobResult {
  diff?: PairDiff;
  /** A small picture of the candidate (or the side that exists). */
  thumb?: string;
  /** Changed pixels and their box, drawn over the thumbnail. */
  marks?: string;
  aspect?: number;
  /** The full URL of the side that exists, for a missing pair's detail. */
  url?: string;
  /** A side that was given but whose file isn't there. */
  gone?: "ref" | "cand";
  error?: string;
}

// ---------- reading images ----------

const urlCache = new Map<string, { at: number; until: number; url: Promise<string> }>();

/** A URL for a source: https and data: as they are, paths through a bb preview lease. */
function resolveSide(side: Side, threadId: string | null, rpc: Rpc, source: string): Promise<string> {
  if (side.url) return Promise.resolve(side.url);
  const src = side.path;
  // As for Compare: a web image loads only when the block writes its URL out, never one built from data.
  if (/^https:\/\//.test(src) && !literalStrings(source).has(src)) return Promise.reject(new Error("a web image must be written out in full in the block, not built from data"));
  if (/^https:\/\//.test(src) || /^(data:image\/|blob:)/.test(src)) return Promise.resolve(src);
  if (/^http:\/\//.test(src)) return Promise.reject(new Error("only https images load"));
  if (!threadId) return Promise.reject(new Error("files load only inside a thread"));
  const key = `${threadId}\0${src}`;
  const hit = urlCache.get(key);
  if (hit && Date.now() < hit.until - 5_000) return hit.url;
  const url = rpc.call("file_url", { threadId, path: src }).then((r) => {
    if (!r.ok) throw new Error(r.error);
    const entry = urlCache.get(key);
    if (entry && r.expiresAtMs) entry.until = r.expiresAtMs;
    return absolute(r.url);
  });
  urlCache.set(key, { at: Date.now(), until: Infinity, url });
  url.catch(() => urlCache.delete(key));
  if (urlCache.size > 2000) urlCache.delete(urlCache.keys().next().value as string);
  return url;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image();
    if (/^https:/.test(url) && !url.startsWith(location.origin)) im.crossOrigin = "anonymous";
    im.decoding = "async";
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error(im.crossOrigin ? "this image host does not allow reading pixels" : "the image did not load"));
    im.src = url;
  });
}

function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** A small picture of an image, for the tile. */
function thumbOf(im: HTMLImageElement): string {
  const w = im.naturalWidth || 1;
  const h = im.naturalHeight || 1;
  const s = Math.min(1, THUMB / Math.max(w, h * 0.75));
  const c = canvas(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)));
  c.getContext("2d")!.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL("image/webp", 0.82);
}

const NOT_FOUND = /not found|no such file|ENOENT/i;

/** One side's image, or why it isn't there: "gone" when the file doesn't exist. */
async function loadSide(side: Side | null, threadId: string | null, rpc: Rpc, source: string): Promise<{ im: HTMLImageElement; url: string } | { gone: true } | { error: string } | null> {
  if (!side) return null;
  let url: string;
  try {
    url = await resolveSide(side, threadId, rpc, source);
  } catch (e) {
    return NOT_FOUND.test(errorText(e)) ? { gone: true } : { error: errorText(e) };
  }
  try {
    return { im: await loadImage(url), url };
  } catch (e) {
    // A lease stream that fails says why only to a request of its own; an https source as given keeps its own error.
    if (url !== side.path && !/^(data|blob):/.test(url)) {
      const p = await probe(url);
      if (!p.ok) return NOT_FOUND.test(p.error) ? { gone: true } : { error: p.error };
    }
    return { error: errorText(e) };
  }
}

/** Diffs a pair the way Compare does (same size rule, same threshold) and keeps only what the tile needs. */
async function runPair(pair: Pair, threshold: number, color: string, threadId: string | null, rpc: Rpc, source: string): Promise<JobResult> {
  const [a, b] = await Promise.all([loadSide(pair.ref, threadId, rpc, source), loadSide(pair.cand, threadId, rpc, source)]);
  const failed = [a, b].find((x) => x && "error" in x) as { error: string } | undefined;
  if (failed) throw new Error(failed.error);
  const ia = a && "im" in a ? a : null;
  const ib = b && "im" in b ? b : null;
  const gone: JobResult["gone"] = a && "gone" in a ? "ref" : b && "gone" in b ? "cand" : undefined;
  const shown = ib ?? ia;
  if (!shown) throw new Error("file not found");
  const aspect = (shown.im.naturalWidth || 1) / (shown.im.naturalHeight || 1);
  const thumb = thumbOf(shown.im);
  if (!ia || !ib) return { thumb, aspect, url: shown.url, gone };
  return measure(ia.im, ib.im, threshold, color, thumb, aspect);
}

function measure(ia: HTMLImageElement, ib: HTMLImageElement, threshold: number, color: string, thumb: string, aspect: number): JobResult {
  const { width, height } = diffSize(ia.naturalWidth, ia.naturalHeight);
  if (!width || !height) throw new Error("the reference has no size");
  const read = (im: HTMLImageElement) => {
    const ctx = canvas(width, height).getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(im, 0, 0, width, height);
    return ctx.getImageData(0, 0, width, height).data;
  };
  let pa: Uint8ClampedArray;
  let pb: Uint8ClampedArray;
  try {
    pa = read(ia);
    pb = read(ib);
  } catch {
    throw new Error("this image host does not allow reading pixels; save the images to the workspace");
  }
  const r = diffPixels(pa, pb, width, height, threshold);
  const sizesDiffer = ia.naturalWidth !== ib.naturalWidth || ia.naturalHeight !== ib.naturalHeight;
  const diff: PairDiff = { status: "ok", changed: r.changed, total: r.total, sizesDiffer, bounds: r.bounds };
  // Marks: the mask shrunk to thumbnail size (a cell is marked when any pixel in it changed), in the theme's "bad" tone.
  let marks: string | undefined;
  if (r.changed && !sizesDiffer) {
    const s = Math.min(1, THUMB / Math.max(width, height * 0.75));
    const tw = Math.max(1, Math.round(width * s));
    const th = Math.max(1, Math.round(height * s));
    const small = canvas(tw, th);
    const ctx = small.getContext("2d")!;
    const img = ctx.createImageData(tw, th);
    for (let i = 0; i < r.mask.length; i++) {
      if (!r.mask[i]) continue;
      const x = i % width;
      const y = (i - x) / width;
      img.data[(Math.min(th - 1, Math.floor(y * s)) * tw + Math.min(tw - 1, Math.floor(x * s))) * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, tw, th);
    ctx.globalCompositeOperation = "source-over";
    if (r.bounds) {
      const pad = 3;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(r.bounds.x * s - pad, r.bounds.y * s - pad, r.bounds.width * s + pad * 2, r.bounds.height * s + pad * 2);
    }
    marks = small.toDataURL("image/png");
  }
  return { diff, thumb, marks, aspect };
}

/**
 * Runs every pair through runPair, PARALLEL at a time, the ones on screen
 * first. see(key) tells the queue a tile came into view.
 */
function usePairJobs(pairs: Pair[], threshold: number, color: string) {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const [results, setResults] = useState<Map<string, JobResult>>(() => new Map());
  const visible = useRef(new Set<string>());
  const pump = useRef<() => void>(() => undefined);
  const key = useMemo(() => JSON.stringify(pairs.map((p) => [p.key, p.ref?.url ?? p.ref?.path, p.cand?.url ?? p.cand?.path])), [pairs]);
  useEffect(() => {
    let live = true;
    const done = new Map<string, JobResult>();
    const running = new Set<string>();
    let flush = 0;
    setResults(new Map());
    const publish = () => {
      if (flush) return;
      flush = requestAnimationFrame(() => {
        flush = 0;
        if (live) setResults(new Map(done));
      });
    };
    const next = () => {
      let first: Pair | undefined;
      for (const p of pairs) {
        if (done.has(p.key) || running.has(p.key)) continue;
        if (visible.current.has(p.key)) return p;
        first ??= p;
      }
      return first;
    };
    const run = () => {
      while (live && running.size < PARALLEL) {
        const p = next();
        if (!p) return;
        running.add(p.key);
        runPair(p, threshold, color, env.threadId, rpc, env.source ?? "")
          .catch((e: unknown): JobResult => ({ error: errorText(e) }))
          .then((r) => {
            running.delete(p.key);
            if (!live) return;
            done.set(p.key, r.error ? { ...r, diff: p.ref && p.cand ? { status: "error", error: r.error } : undefined } : r);
            publish();
            // Let the page breathe between jobs.
            setTimeout(run, 0);
          });
      }
    };
    pump.current = run;
    run();
    return () => {
      live = false;
      cancelAnimationFrame(flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, threshold, color, env.threadId, rpc, env.source]);
  const see = useCallback((k: string, on: boolean) => {
    if (on) visible.current.add(k);
    else visible.current.delete(k);
    if (on) pump.current();
  }, []);
  return { results, see };
}

// ---------- the pairs, from props ----------

function sampleScreens(accent: string): Pair[] {
  // One color, the theme's primary, at a few strengths, like Iris's other samples.
  const screen = (title: number, button: [number, number], rows = 3) => {
    const body =
      `<rect width="360" height="240" fill="${accent}" fill-opacity=".07"/>` +
      `<rect x="28" y="24" width="304" height="192" rx="14" fill="${accent}" fill-opacity=".1"/>` +
      `<rect x="52" y="48" width="${title}" height="14" rx="7" fill="${accent}" fill-opacity=".75"/>` +
      Array.from({ length: rows }, (_, k) => `<rect x="52" y="${80 + k * 24}" width="${256 - k * 40}" height="12" rx="6" fill="${accent}" fill-opacity=".22"/>`).join("") +
      `<rect x="${button[0]}" y="166" width="${button[1]}" height="30" rx="15" fill="${accent}"/>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240">${body}</svg>`)}`;
  };
  const list: [string, string | null, string | null][] = [
    ["home.png", screen(150, [52, 110]), screen(150, [52, 110])],
    ["settings.png", screen(150, [52, 110]), screen(150, [198, 110])],
    ["profile.png", screen(120, [52, 110]), screen(120, [52, 110])],
    ["billing.png", screen(170, [52, 110]), screen(118, [52, 110])],
    ["onboarding.png", screen(140, [52, 140]), null],
    ["search.png", screen(100, [52, 110], 2), screen(100, [52, 110], 2)],
    ["share.png", null, screen(130, [52, 110], 1)],
    ["notifications.png", screen(160, [52, 110]), screen(160, [52, 110], 2)],
  ];
  return list.map(([name, a, b]) => ({ key: name, label: name, ref: a ? { path: a } : null, cand: b ? { path: b } : null }));
}

const joinPath = (folder: string, rel: string) => (folder === "." || !folder ? rel : `${folder.replace(/\/+$/, "")}/${rel}`);

function folderPairs(ref: FolderState, cand: FolderState): Pair[] {
  if (ref.status !== "ok" || cand.status !== "ok") return [];
  const side = (f: Extract<FolderState, { status: "ok" }>, rel: string | null): Side | null => (rel ? { path: joinPath(f.folder, rel), url: f.base ? inFolder(f.base, rel) : undefined } : null);
  return matchFolders(ref.files, cand.files).map((m) => ({ key: m.key, label: m.key, ref: side(ref, m.ref), cand: side(cand, m.cand) }));
}

// ---------- the view ----------

const STATUS: Record<PairStatus, { tone: "good" | "bad" | "warn" | "neutral" | "info"; icon: string }> = {
  changed: { tone: "bad", icon: "scan" },
  missing: { tone: "warn", icon: "image-off" },
  same: { tone: "good", icon: "check" },
  pending: { tone: "neutral", icon: "loader" },
  error: { tone: "neutral", icon: "circle-alert" },
};
const FILTER_LABEL: Record<GridFilter, string> = { all: "All", changed: "Changed", missing: "Missing", same: "Same" };
const SORT_LABEL: Record<GridSort, string> = { change: "Most changed", name: "Name", order: "As given" };
const fmt = (n: number) => n.toLocaleString("en-US");

export function CompareGridView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const pending = isPendingValue(props.pairs) || isPendingValue(props.folders);
  const folders = pending ? null : folderPair(props.folders);
  const [refFolder] = useFolder(folders?.ref ?? ".", 2000, !!folders);
  const [candFolder] = useFolder(folders?.cand ?? ".", 2000, !!folders);
  const given = useMemo(() => normalizePairs(pending ? null : props.pairs), [pending, props.pairs]);
  const sample = !!folders && refFolder.status === "sample";
  const all = useMemo((): Pair[] => {
    if (folders) return sample ? sampleScreens(palette.accent) : folderPairs(refFolder, candFolder);
    return given.pairs.map((p: ComparePair) => ({ key: p.key, label: p.label, ref: p.ref ? { path: p.ref } : null, cand: p.cand ? { path: p.cand } : null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!folders, sample, palette.accent, refFolder, candFolder, given]);
  const pairs = useMemo(() => all.slice(0, MAX_PAIRS), [all]);
  const threshold = Math.max(0, Math.min(255, num(props.threshold) ?? 16));
  const { results, see } = usePairJobs(pairs, threshold, palette.tone.bad);
  const [sort, setSort] = useState<GridSort>(() => readSort(props.sort));
  const [filter, setFilter] = useState<GridFilter>(() => readFilter(props.filter));
  const [open, setOpen] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);

  const items = useMemo(
    () =>
      pairs.map((pair, index): GridItem => {
        const r = results.get(pair.key);
        // A side whose file turned out not to exist reads as missing.
        const sides = { key: pair.key, label: pair.label, ref: r?.gone === "ref" ? null : (pair.ref?.path ?? null), cand: r?.gone === "cand" ? null : (pair.cand?.path ?? null) };
        return { pair: sides, diff: r?.diff, status: pairStatus(sides, r?.diff), index };
      }),
    [pairs, results],
  );
  const counts = gridCounts(items);
  const list = useMemo(() => filterItems(sortItems(items, sort), filter), [items, sort, filter]);
  const byKey = useMemo(() => new Map(pairs.map((p) => [p.key, p])), [pairs]);
  const aspect = useMemo(() => {
    for (const p of pairs) {
      const a = results.get(p.key)?.aspect;
      // Phone screenshots sit in a 3:4 box, so tiles stay short.
      if (a) return Math.max(0.75, Math.min(2, a));
    }
    return 4 / 3;
  }, [pairs, results]);

  // One observer for every tile: it tells the queue what is on screen. Made
  // on the first tile, because tile refs attach before effects run.
  const io = useRef<IntersectionObserver | null>(null);
  useEffect(() => () => io.current?.disconnect(), []);
  const watch = useCallback(
    (el: HTMLElement | null) => {
      if (!el || typeof IntersectionObserver === "undefined") return;
      io.current ??= new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            const k = (e.target as HTMLElement).dataset.pair;
            if (k) see(k, e.isIntersecting);
          }
        },
        { rootMargin: "300px" },
      );
      io.current.observe(el);
    },
    [see],
  );

  if (pending) return <Shimmer className="h-48 w-full" />;
  const problem =
    props.folders != null && !folders
      ? "folders needs {ref, cand}, two folder paths"
      : folders && refFolder.status === "error"
        ? `${folders.ref}: ${refFolder.error}`
        : folders && candFolder.status === "error"
          ? `${folders.cand}: ${candFolder.error}`
          : null;
  const loadingFolders = folders && !sample && (refFolder.status === "loading" || candFolder.status === "loading");
  const done = counts.all - counts.pending;
  const title = str(props.title);

  if (open && byKey.has(open)) {
    const at = list.findIndex((i) => i.pair.key === open);
    return (
      <Detail
        pair={byKey.get(open)!}
        item={items.find((i) => i.pair.key === open)!}
        result={results.get(open)}
        threshold={threshold}
        position={at >= 0 ? `${at + 1} of ${list.length}` : null}
        onBack={() => setOpen(null)}
        onStep={at >= 0 && list.length > 1 ? (d) => setOpen(list[(at + d + list.length) % list.length].pair.key) : null}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      {given.problems.length ? <InlineError error={new Error(`${given.problems[0]}${given.problems.length > 1 ? ` (and ${given.problems.length - 1} more)` : ""}`)} context="<CompareGrid>" /> : null}
      {problem ? <InlineError error={new Error(problem)} context="<CompareGrid>" /> : null}
      {title ? <div className="min-w-0 truncate text-[13.5px] font-semibold">{title}</div> : null}
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Show" className="iris-scroll-x inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-muted/70 p-0.5">
          {(Object.keys(FILTER_LABEL) as GridFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => {
                setFilter(f);
                setShown(PAGE);
              }}
              className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors", filter === f ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}
            >
              {f !== "all" ? <span aria-hidden className="size-1.5 rounded-full" style={{ background: palette.tone[STATUS[f].tone] }} /> : null}
              {FILTER_LABEL[f]}
              <span className="tabular-nums text-muted-foreground">{fmt(counts[f])}</span>
            </button>
          ))}
        </div>
        <label className="relative inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground focus-within:outline-2 focus-within:outline-[var(--iris-accent)]">
          <Glyph name="arrow-down-wide-narrow" size={13} />
          <span aria-hidden>{SORT_LABEL[sort]}</span>
          <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as GridSort)} className="absolute inset-0 cursor-pointer opacity-0">
            {(Object.keys(SORT_LABEL) as GridSort[]).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {sample ? <Chip>Sample</Chip> : null}
      </div>
      {counts.all && counts.pending ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${(done / counts.all) * 100}%`, background: palette.accent }} />
          </div>
          <span className="tabular-nums">
            Compared {fmt(done)} of {fmt(counts.all)}
          </span>
        </div>
      ) : counts.all ? (
        <Summary counts={counts} />
      ) : null}
      {all.length > MAX_PAIRS ? <div className="text-xs text-muted-foreground">Showing the first {fmt(MAX_PAIRS)} of {fmt(all.length)} pairs.</div> : null}
      {loadingFolders ? (
        <TileSkeleton />
      ) : !counts.all ? (
        problem ? null : <Note>{folders ? "Neither folder has images." : "CompareGrid needs pairs or folders."}</Note>
      ) : !list.length ? (
        <Note>No pair is {FILTER_LABEL[filter].toLowerCase()}.</Note>
      ) : (
        // Its own scroll area, so a long run stays a card in the chat.
        <div className="-m-1 max-h-[720px] overflow-y-auto p-1">
          <ul className="grid min-w-0 gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr))" }}>
            {list.slice(0, shown).map((i) => (
              <li key={i.pair.key} data-pair={i.pair.key} ref={watch} className="min-w-0" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 220px" }}>
                <Tile item={i} result={results.get(i.pair.key)} aspect={aspect} onOpen={() => setOpen(i.pair.key)} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {list.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + PAGE)} className="self-start rounded-full px-3 py-1 text-[12.5px] text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground">
          Show {fmt(Math.min(PAGE, list.length - shown))} more
        </button>
      ) : null}
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">{children}</div>;
}

function TileSkeleton() {
  return (
    <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 9.5rem), 1fr))" }}>
      {Array.from({ length: 4 }, (_, k) => (
        <Shimmer key={k} className="aspect-[4/3] w-full rounded-lg" />
      ))}
    </div>
  );
}

function Summary({ counts }: { counts: ReturnType<typeof gridCounts> }) {
  const parts = [
    counts.changed ? `${fmt(counts.changed)} changed` : null,
    counts.missing ? `${fmt(counts.missing)} missing a side` : null,
    counts.error ? `${fmt(counts.error)} couldn't load` : null,
    `${fmt(counts.same)} the same`,
  ].filter(Boolean);
  return <div className="text-xs text-muted-foreground">{counts.changed || counts.missing || counts.error ? parts.join(", ") : `All ${fmt(counts.all)} pairs are the same`}</div>;
}

function statusText(item: GridItem, result: JobResult | undefined): string {
  const d = item.diff;
  if (item.status === "missing") return !item.pair.ref ? "No reference" : "No candidate";
  if (item.status === "pending") return "Comparing";
  if (item.status === "error") return result?.error ? "Couldn't load" : "Couldn't compare";
  if (d?.status !== "ok") return "";
  if (item.status === "same") return "Same";
  if (!d.changed) return "Size differs";
  return `${fmt(d.changed)} px · ${shareText(d.changed, d.total)}`;
}

function Tile({ item, result, aspect, onOpen }: { item: GridItem; result: JobResult | undefined; aspect: number; onOpen: () => void }) {
  const { palette } = useEnv();
  const tone = palette.tone[STATUS[item.status].tone];
  const label = statusText(item, result);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={result?.error ?? item.pair.label}
      aria-label={`${item.pair.label}: ${label}. Open in Compare`}
      className="group flex w-full min-w-0 flex-col overflow-hidden rounded-lg bg-card text-left ring-1 ring-border transition-shadow hover:ring-foreground/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]"
    >
      <div className="relative w-full overflow-hidden bg-muted/40" style={{ aspectRatio: String(aspect) }}>
        {result?.thumb ? (
          <>
            <img src={result.thumb} alt="" draggable={false} className={cn("absolute inset-0 size-full object-contain", item.status === "missing" && "opacity-60")} />
            {result.marks ? <img src={result.marks} alt="" draggable={false} className="absolute inset-0 size-full object-contain opacity-90" /> : null}
          </>
        ) : result ? (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <Glyph name="image-off" size={18} />
          </div>
        ) : (
          <Shimmer className="absolute inset-0 rounded-none" />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-2 py-1.5">
        <span className="truncate text-[12.5px] font-medium text-foreground">{item.pair.label}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] tabular-nums text-muted-foreground">
          <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: item.status === "pending" ? "var(--muted-foreground)" : tone }} />
          <span className="truncate" style={item.status === "changed" ? { color: tone } : undefined}>
            {label}
          </span>
        </span>
      </div>
    </button>
  );
}

function Detail({
  pair,
  item,
  result,
  threshold,
  position,
  onBack,
  onStep,
}: {
  pair: Pair;
  item: GridItem;
  result: JobResult | undefined;
  threshold: number;
  position: string | null;
  onBack: () => void;
  onStep: ((d: 1 | -1) => void) | null;
}) {
  const { palette } = useEnv();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => box.current?.focus({ preventScroll: true }), [pair.key]);
  const missing = !item.pair.ref || !item.pair.cand;
  const btn = "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground disabled:opacity-45";
  return (
    <div
      ref={box}
      tabIndex={-1}
      className="flex min-w-0 flex-col gap-2.5 outline-none"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onBack();
        } else if (onStep && (e.key === "[" || e.key === "]")) {
          e.preventDefault();
          onStep(e.key === "]" ? 1 : -1);
        }
      }}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button type="button" onClick={onBack} className={btn} title="Back to the grid (Escape)">
          <Glyph name="layout-grid" size={13} />
          All pairs
        </button>
        <button type="button" onClick={() => onStep?.(-1)} disabled={!onStep} className={cn(btn, "w-7 justify-center px-0")} aria-label="Previous pair ([)" title="Previous pair ([)">
          <Glyph name="chevron-left" size={14} />
        </button>
        <button type="button" onClick={() => onStep?.(1)} disabled={!onStep} className={cn(btn, "w-7 justify-center px-0")} aria-label="Next pair (])" title="Next pair (])">
          <Glyph name="chevron-right" size={14} />
        </button>
        {position ? <span className="text-xs tabular-nums text-muted-foreground">{position}</span> : null}
        <span className="min-w-0 truncate text-[13.5px] font-semibold">{pair.label}</span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span aria-hidden className="size-1.5 rounded-full" style={{ background: palette.tone[STATUS[item.status].tone] }} />
          {statusText(item, result)}
        </span>
      </div>
      {missing ? (
        result?.url ? (
          <figure className="min-w-0">
            <img src={result.url} alt={pair.label} className="block max-h-[560px] w-full rounded-lg bg-muted/40 object-contain ring-1 ring-border" />
            <figcaption className="mt-1.5 text-xs text-muted-foreground">{item.pair.ref ? "Reference only: the candidate is missing" : "Candidate only: there is no reference"}</figcaption>
          </figure>
        ) : result?.error ? (
          <Note>Couldn't show it: {result.error}</Note>
        ) : (
          <Shimmer className="aspect-video w-full" />
        )
      ) : (
        <CompareView
          key={pair.key}
          props={{ images: [{ src: pair.ref!.path, label: "Reference" }, { src: pair.cand!.path, label: "Candidate" }], threshold, mode: item.status === "changed" ? "diff" : "wipe" }}
        />
      )}
    </div>
  );
}
