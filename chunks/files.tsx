// FileTree, AssetGallery and FontPreview (chunk "assets"). Rules live in
// core/files.ts and core/font.ts. Listings come from the server (folder_files);
// sizes, images and font bytes stream from the folder's bb preview URL.

import { useRpc } from "@get-bb/plugin-sdk/app";
import { Chip, Glyph, InlineError, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isPendingValue } from "../core/evaluate";
import {
  MARKER_LABEL,
  MARKER_TONE,
  assetKind,
  buildTree,
  changesUnder,
  filterTree,
  iconSetLabels,
  joinPath,
  onlyChanged,
  openPaths,
  svgSize,
  visibleRows,
  type AssetKind,
  type Marker,
  type TreeDir,
} from "../core/files";
import { PROBE_RANGES, collectionStart, fontSignature, hexCode, mapTables, readFont, sfntTables, visibleCodepoint, woff2Directory, woffDirectory, type FontInfo, type TableGetter } from "../core/font";
import { formatBytes } from "../core/format";
import type { RpcContract } from "../shared/rpc";
import type { ViewProps } from "../ui/render";
import { errorText, fetchBytes, headSizes, inFolder, sampleObjectUrl, useFileUrl, useFolder, type FolderState } from "./file-access";

const ICON_BTN =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)] disabled:opacity-45";
const PILL = (on: boolean) =>
  cn(
    "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--iris-accent)]",
    on ? "bg-foreground text-background ring-foreground" : "text-muted-foreground ring-border hover:bg-state-hover hover:text-foreground",
  );
/** The theme's primary, for single-value marks (size bars, changed folders, the picked glyph). */
const accentOf = (palette: { accent: string }) => palette.accent;
const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;
const MAX_FONT_BYTES = 24 * 1024 * 1024;

function Problem({ error, what }: { error: string; what: string }) {
  return <InlineError error={new Error(error)} context={what} />;
}

function openPath(env: ReturnType<typeof useEnv>, path: string) {
  env.perform([{ $iris: "action", kind: "openFile", args: [path, null] }]);
}

function fileIcon(name: string): string {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp", "heic"].includes(ext)) return "file-image";
  if (["md", "mdx", "txt", "rst", "pdf", "rtf"].includes(ext)) return "file-text";
  if (["ttf", "otf", "woff", "woff2"].includes(ext)) return "type";
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "swift", "rs", "go", "py", "rb", "kt", "java", "c", "h", "m", "cpp", "css", "html", "json", "yml", "yaml", "toml", "sh"].includes(ext)) return "file-code";
  return "file";
}

// ---------- FileTree ----------

const SAMPLE_TREE: { files: [string, number][]; markers: [string, Marker][] } = {
  files: [
    ["README.md", 4_210],
    ["package.json", 1_812],
    ["src/app.tsx", 6_904],
    ["src/routes/home.tsx", 3_388],
    ["src/routes/settings.tsx", 5_120],
    ["src/lib/sync.ts", 12_644],
    ["src/lib/format.ts", 2_045],
    ["src/lib/cache.ts", 3_970],
    ["assets/icon.png", 48_311],
    ["assets/hero.webp", 212_480],
    ["tests/sync.test.ts", 7_402],
  ],
  markers: [
    ["src/lib/sync.ts", "M"],
    ["src/lib/cache.ts", "A"],
    ["src/routes/settings.tsx", "M"],
    ["tests/sync.test.ts", "U"],
    ["src/lib/legacy-sync.ts", "D"],
  ],
};

export function FileTreeView({ props }: ViewProps) {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const { palette } = env;
  const path = str(props.path) ?? ".";
  const limit = Math.max(1, Math.min(2000, Math.round(num(props.limit) ?? 400)));
  const changesMode = str(props.changes) === "uncommitted" ? "uncommitted" : str(props.changes) === "none" ? "none" : "branch";
  const [folder, refresh] = useFolder(path, limit);
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const [markers, setMarkers] = useState<Map<string, Marker>>(new Map());
  const [query, setQuery] = useState(str(props.filter) ?? "");
  const [changedOnly, setChangedOnly] = useState(props.changedOnly === true);
  const sort = str(props.sort) === "size" ? "size" : "name";
  const sample = folder.status === "sample";

  // Sizes: one HEAD per file against the folder's preview URL, a few at a time.
  const files = folder.status === "ok" ? folder.files : null;
  const base = folder.status === "ok" ? folder.base : null;
  useEffect(() => {
    if (sample) return setSizes(new Map(SAMPLE_TREE.files));
    if (!files || !base) return;
    const ctl = new AbortController();
    const found = new Map<string, number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      setSizes(new Map(found));
    };
    void headSizes(
      base,
      files,
      (p, n) => {
        if (n !== null) found.set(p, n);
        timer ??= setTimeout(flush, 120);
      },
      ctl.signal,
    ).then(() => !ctl.signal.aborted && flush());
    return () => {
      ctl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [files, base, sample]);

  // Git markers come from the same read as <Changes>.
  const prefix = folder.status === "ok" ? folder.repoPrefix : null;
  useEffect(() => {
    if (sample) return setMarkers(new Map(SAMPLE_TREE.markers));
    if (changesMode === "none" || prefix === null || !env.threadId) return setMarkers(new Map());
    let live = true;
    rpc.call("project_changes", { threadId: env.threadId, target: changesMode === "uncommitted" ? "uncommitted" : null, paths: null }).then(
      (r) => live && setMarkers(r.ok ? changesUnder(r.files, prefix === "" ? "" : prefix) : new Map()),
      () => live && setMarkers(new Map()),
    );
    return () => {
      live = false;
    };
  }, [sample, changesMode, prefix, env.threadId, rpc, files]);

  const paths = sample ? SAMPLE_TREE.files.map(([p]) => p) : files;
  const tree = useMemo(() => (paths ? buildTree(paths, sizes, markers, sort) : null), [paths, sizes, markers, sort]);
  const [open, setOpen] = useState<Set<string> | null>(null);
  const levels = Math.max(0, Math.round(num(props.open) ?? 1));
  useEffect(() => {
    if (tree && open === null) setOpen(openPaths(tree, levels));
  }, [tree, open, levels]);

  if (folder.status === "loading") return <Shimmer className="h-40" />;
  if (folder.status === "error") return <Problem error={folder.error} what="<FileTree>" />;
  if (!tree) return <Shimmer className="h-40" />;

  const shown = filterTree(changedOnly ? onlyChanged(tree) : tree, query);
  const searching = query.trim() !== "" || changedOnly;
  const rows = visibleRows(shown, open ?? new Set(), searching);
  const largest = Math.max(1, ...[...sizes.values()]);
  const counts = new Map<Marker, number>();
  for (const m of markers.values()) counts.set(m, (counts.get(m) ?? 0) + 1);
  const display = folder.status === "ok" ? folder.folder : "my-app";
  const toggle = (p: string) =>
    setOpen((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const allDirs = () => {
    const out = new Set<string>();
    for (const r of visibleRows(tree, new Set(), true)) if (r.node.kind === "dir") out.add(r.node.path);
    return out;
  };
  const click = (rel: string) => {
    const full = sample ? rel : joinPath(display, rel);
    if (props.onClick !== undefined) env.run(props.onClick, [full]);
    else if (!sample) openPath(env, full);
  };
  const toneColor = (m: Marker) => palette.tone[MARKER_TONE[m]];
  const truncated = folder.status === "ok" && folder.truncated;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Glyph name="folder-tree" size={15} className="text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 truncate text-[13.5px] font-semibold">{str(props.title) ?? (display === "." ? "Workspace" : display)}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {tree.files} {tree.files === 1 ? "file" : "files"}
            {truncated ? "+" : ""} · {formatBytes(tree.size)}
            {tree.unknown && base ? <span> · sizing {tree.unknown}</span> : null}
          </span>
        </div>
        {sample ? <Chip>Sample</Chip> : null}
        {(["A", "M", "D", "R", "U"] as Marker[]).map((m) =>
          counts.get(m) ? (
            <span key={m} className="hidden text-[11.5px] font-semibold tabular-nums @lg/iris:inline" style={{ color: toneColor(m) }} title={MARKER_LABEL[m]}>
              {m} {counts.get(m)}
            </span>
          ) : null,
        )}
        {!sample ? (
          <button type="button" onClick={refresh} className={ICON_BTN} aria-label="Read the folder again">
            <Glyph name="refresh-cw" size={13} />
          </button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <label className="relative flex h-7 min-w-0 flex-1 items-center basis-40">
          <Glyph name="search" size={13} className="pointer-events-none absolute left-2.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter files"
            aria-label="Filter files"
            className="h-7 w-full min-w-0 rounded-full bg-transparent pl-7 pr-3 text-[12.5px] ring-1 ring-border outline-none placeholder:text-muted-foreground focus:ring-[color-mix(in_oklab,var(--iris-accent)_60%,transparent)]"
          />
        </label>
        {/* The controls wrap as one group, never one stray button on a line. */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {markers.size ? (
            <button type="button" className={PILL(changedOnly)} onClick={() => setChangedOnly((v) => !v)} aria-pressed={changedOnly}>
              <Glyph name="git-branch" size={12} />
              Changed only
            </button>
          ) : null}
          <button type="button" className={ICON_BTN} onClick={() => setOpen(allDirs())} aria-label="Open every folder" title="Open every folder">
            <Glyph name="chevrons-up-down" size={14} />
          </button>
          <button type="button" className={ICON_BTN} onClick={() => setOpen(new Set())} aria-label="Close every folder" title="Close every folder">
            <Glyph name="chevrons-down-up" size={14} />
          </button>
        </div>
      </div>
      <div role="tree" aria-label={display} className="max-h-[440px] min-w-0 overflow-y-auto overscroll-contain rounded-lg py-1 ring-1 ring-border">
        {rows.length ? (
          rows.map(({ node, depth }) => {
            const isDir = node.kind === "dir";
            const expanded = isDir && (searching || (open?.has(node.path) ?? false));
            const marker = node.kind === "file" ? node.marker : null;
            const size = node.kind === "file" ? node.size : node.size;
            const unknown = node.kind === "dir" ? node.unknown > 0 && node.size === 0 : node.size === null && !node.gone;
            return (
              <button
                key={`${node.kind}:${node.path}`}
                type="button"
                role="treeitem"
                aria-expanded={isDir ? expanded : undefined}
                aria-level={depth + 1}
                onClick={() => (isDir ? !searching && toggle(node.path) : !(node.kind === "file" && node.gone) && click(node.path))}
                className={cn("group/row relative flex h-7 w-full min-w-0 items-center gap-1.5 pr-3 text-left text-[12.5px] hover:bg-state-hover", node.kind === "file" && node.gone && "cursor-default")}
                style={{ paddingLeft: 8 + depth * 16 }}
                title={node.kind === "file" && node.gone ? `${node.path} (deleted)` : node.path}
              >
                {isDir ? <Glyph name="chevron-right" size={13} className={cn("text-muted-foreground transition-transform", expanded && "rotate-90")} /> : <span className="w-[13px] shrink-0" />}
                <Glyph name={isDir ? (expanded ? "folder-open" : "folder") : fileIcon(node.name)} size={14} className="text-muted-foreground" />
                <span className={cn("min-w-0 flex-1 truncate", isDir && "font-medium", node.kind === "file" && node.gone && "text-muted-foreground line-through")}>{node.name}</span>
                {node.kind === "dir" && node.changed ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: accentOf(palette) }} aria-label={`${node.changed} changed`} /> : null}
                {marker ? (
                  <span className="w-3.5 shrink-0 text-center font-mono text-[11px] font-bold" style={{ color: toneColor(marker) }} title={MARKER_LABEL[marker]} aria-label={MARKER_LABEL[marker]}>
                    {marker}
                  </span>
                ) : null}
                <span className={cn("relative w-[4.5rem] shrink-0 text-right text-[11.5px] tabular-nums", isDir ? "text-muted-foreground" : "")}>
                  {node.kind === "file" && node.gone ? "" : unknown ? "…" : formatBytes(size ?? 0)}
                  {/* Bars only for files that weigh something next to the largest; tiny ones read as specks. */}
                  {node.kind === "file" && !node.gone && size !== null && size / largest >= 0.08 ? (
                    <span aria-hidden className="absolute -bottom-1 right-0 h-0.5 rounded-full" style={{ width: `${(size / largest) * 100}%`, background: tint(accentOf(palette), 55) }} />
                  ) : null}
                </span>
              </button>
            );
          })
        ) : (
          <div className="px-3 py-4 text-center text-[12.5px] text-muted-foreground">{searching ? "No files match" : "No files here: the folder is empty, missing or holds only skipped build folders"}</div>
        )}
      </div>
      {truncated ? <div className="text-[11.5px] text-muted-foreground">Showing the first {limit} files; raise limit (up to 2000) or pick a smaller folder.</div> : null}
      {folder.status === "ok" && !folder.base ? <div className="text-[11.5px] text-muted-foreground">bb couldn't serve this folder, so sizes are missing.</div> : null}
    </div>
  );
}

// ---------- AssetGallery ----------

interface Asset {
  path: string;
  name: string;
  kind: AssetKind;
  url: string;
  /** The icon set or bundle it belongs to. */
  set?: string;
  label?: string;
  size?: number | null;
}

const KIND_TITLE: Record<AssetKind, string> = { icon: "App icons", image: "Images", svg: "SVGs" };
const KIND_ORDER: AssetKind[] = ["icon", "image", "svg"];

function sampleAssets(palette: ReturnType<typeof useEnv>["palette"]): Asset[] {
  // One color, the theme's primary, at a few strengths: samples stay single-color like the rest of Iris.
  const a = accentOf(palette);
  const svgUrl = (w: number, h: number, body: string) => {
    const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
    return { url: `data:image/svg+xml;utf8,${encodeURIComponent(s)}`, size: s.length };
  };
  const icon = (w: number) => svgUrl(w, w, `<rect width="${w}" height="${w}" rx="${w * 0.22}" fill="${a}" fill-opacity=".22"/><circle cx="${w / 2}" cy="${w / 2}" r="${w * 0.24}" fill="none" stroke="${a}" stroke-width="${w * 0.07}"/>`);
  const scene = (w: number, h: number, strength: number) => svgUrl(w, h, `<rect width="${w}" height="${h}" fill="${a}" fill-opacity="${strength}"/><circle cx="${w * 0.7}" cy="${h * 0.35}" r="${h * 0.14}" fill="${a}"/><path d="M0 ${h * 0.75} Q${w * 0.3} ${h * 0.5} ${w * 0.55} ${h * 0.7} T${w} ${h * 0.62} V${h} H0Z" fill="${a}" fill-opacity=".8"/>`);
  const glyph = (body: string) => svgUrl(24, 24, `<g fill="none" stroke="${a}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</g>`);
  const list: [string, AssetKind, { url: string; size: number }, string?, string?][] = [
    ["AppIcon.appiconset/icon-1024.png", "icon", icon(1024), "AppIcon", "App Store 1024pt"],
    ["AppIcon.appiconset/icon-180.png", "icon", icon(180), "AppIcon", "iPhone 60pt @3x"],
    ["AppIcon.appiconset/icon-120.png", "icon", icon(120), "AppIcon", "iPhone 60pt @2x"],
    ["images/onboarding-hero.png", "image", scene(1200, 800, 0.25)],
    ["images/empty-state.png", "image", scene(640, 480, 0.15)],
    ["images/share-card.png", "image", scene(1200, 630, 0.35)],
    ["icons/sync.svg", "svg", glyph(`<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>`)],
    ["icons/star.svg", "svg", glyph(`<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>`)],
    ["icons/bell.svg", "svg", glyph(`<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>`)],
  ];
  return list.map(([p, kind, s, set, label]) => ({ path: p, name: p.split("/").pop()!, kind, url: s.url, size: s.size, set, label }));
}

export function AssetGalleryView({ props }: ViewProps) {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const { palette } = env;
  const path = str(props.path) ?? ".";
  const limit = Math.max(1, Math.min(600, Math.round(num(props.limit) ?? 120)));
  const tile = Math.max(64, Math.min(240, num(props.size) ?? 112));
  const sort = str(props.sort) === "size" ? "size" : "name";
  const kindsProp = isPendingValue(props.kinds) ? null : props.kinds;
  const kinds = Array.isArray(kindsProp) ? KIND_ORDER.filter((k) => kindsProp.includes(k)) : KIND_ORDER;
  const [folder, refresh] = useFolder(path, 2000);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const [dims, setDims] = useState<Map<string, { width: number; height: number }>>(new Map());
  const [fallback, setFallback] = useState<Map<string, string>>(new Map());
  const [bg, setBg] = useState<"muted" | "card" | "inverse">("muted");
  const [picked, setPicked] = useState<string | null>(null);
  const sample = folder.status === "sample";

  const assets = useMemo<Asset[]>(() => {
    if (sample) return sampleAssets(palette);
    if (folder.status !== "ok") return [];
    const out: Asset[] = [];
    for (const p of folder.files) {
      const kind = assetKind(p);
      if (!kind || !kinds.includes(kind)) continue;
      const set = /([^/]+\.(?:appiconset|icon))\//i.exec(p)?.[1];
      out.push({ path: p, name: p.split("/").pop()!, kind, url: folder.base ? inFolder(folder.base, p) : "", set });
      if (out.length >= limit) break;
    }
    return out;
    // kinds is derived from props; its join keeps the memo stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder, sample, palette, kinds.join(","), limit]);

  // Contents.json labels for icon sets, sizes by HEAD, SVG sizes from their text.
  const base = folder.status === "ok" ? folder.base : null;
  useEffect(() => {
    if (sample || !base || folder.status !== "ok") return;
    const ctl = new AbortController();
    const sets = [...new Set(folder.files.filter((p) => /\.appiconset\/Contents\.json$/i.test(p)))];
    void Promise.all(
      sets.map((p) =>
        fetch(inFolder(base, p), { credentials: "same-origin", signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : null))
          .then((json) => {
            const dir = p.slice(0, -"Contents.json".length);
            return [...iconSetLabels(json)].map(([f, l]) => [`${dir}${f}`, l] as [string, string]);
          })
          .catch(() => [] as [string, string][]),
      ),
    ).then((all) => !ctl.signal.aborted && setLabels(new Map(all.flat())));
    const found = new Map<string, number>();
    void headSizes(base, assets.map((a) => a.path), (p, n) => n !== null && found.set(p, n), ctl.signal).then(() => !ctl.signal.aborted && setSizes(new Map(found)));
    const svgs = assets.filter((a) => a.path.toLowerCase().endsWith(".svg")).slice(0, 200);
    void Promise.all(
      svgs.map((a) =>
        fetch(a.url, { credentials: "same-origin", signal: ctl.signal })
          .then((r) => (r.ok ? r.text() : ""))
          .then((t) => [a.path, svgSize(t)] as const)
          .catch(() => [a.path, null] as const),
      ),
    ).then((list) => {
      if (ctl.signal.aborted) return;
      setDims((cur) => {
        const next = new Map(cur);
        for (const [p, d] of list) if (d) next.set(p, d);
        return next;
      });
    });
    return () => ctl.abort();
  }, [assets, base, sample, folder]);

  // No preview URL: images come through the server as data URLs, the way <Image> loads them.
  useEffect(() => {
    if (sample || base || folder.status !== "ok" || !env.threadId) return;
    let live = true;
    const threadId = env.threadId;
    void Promise.all(
      assets.slice(0, 60).map((a) =>
        rpc
          .call("load_image", { threadId, path: joinPath(folder.folder, a.path) })
          .then((r) => [a.path, r.ok ? r.dataUrl : ""] as const)
          .catch(() => [a.path, ""] as const),
      ),
    ).then((list) => live && setFallback(new Map(list.filter(([, u]) => u))));
    return () => {
      live = false;
    };
  }, [assets, base, sample, folder, env.threadId, rpc]);

  if (folder.status === "loading") return <Shimmer className="h-40" />;
  if (folder.status === "error") return <Problem error={folder.error} what="<AssetGallery>" />;
  const display = folder.status === "ok" ? folder.folder : "Assets.xcassets";
  const sized = (a: Asset) => sizes.get(a.path) ?? a.size ?? null;
  const groups = KIND_ORDER.filter((k) => kinds.includes(k))
    .map((k) => ({
      kind: k,
      items: assets
        .filter((a) => a.kind === k)
        .sort((x, y) => (sort === "size" ? (sized(y) ?? 0) - (sized(x) ?? 0) : 0) || (x.set ?? "").localeCompare(y.set ?? "") || x.path.localeCompare(y.path, undefined, { numeric: true })),
    }))
    .filter((g) => g.items.length);
  const pick = assets.find((a) => a.path === picked) ?? null;
  // Theme surfaces only: muted, the card itself, and the foreground for checking transparent edges.
  const bgStyle = (mode: typeof bg) => ({ background: mode === "card" ? "var(--card, var(--background))" : mode === "inverse" ? "var(--foreground)" : "var(--muted)" });
  const urlOf = (a: Asset) => a.url || fallback.get(a.path) || "";
  const meta = (a: Asset) => {
    const d = dims.get(a.path);
    const s = sized(a);
    return [d ? `${Math.round(d.width)}×${Math.round(d.height)}` : null, s !== null ? formatBytes(s) : null].filter(Boolean).join(" · ");
  };
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Glyph name="images" size={15} className="text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
          <span className="min-w-0 truncate text-[13.5px] font-semibold">{str(props.title) ?? (display === "." ? "Assets" : display)}</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {assets.length} {assets.length === 1 ? "asset" : "assets"}
            {assets.length >= limit ? "+" : ""}
          </span>
        </div>
        {sample ? <Chip>Sample</Chip> : null}
        <div className="flex shrink-0 items-center rounded-full p-0.5 ring-1 ring-border" role="radiogroup" aria-label="Background">
          {(["muted", "card", "inverse"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={bg === m}
              aria-label={`${m === "muted" ? "Muted" : m === "card" ? "Card" : "Inverted"} background`}
              title={`${m === "muted" ? "Muted" : m === "card" ? "Card" : "Inverted"} background`}
              onClick={() => setBg(m)}
              className={cn("size-6 rounded-full ring-1 ring-border transition-transform", bg === m ? "scale-100 ring-2 ring-[var(--iris-accent)]" : "scale-90 opacity-70 hover:opacity-100")}
              style={bgStyle(m)}
            />
          ))}
        </div>
        {!sample ? (
          <button type="button" onClick={refresh} className={ICON_BTN} aria-label="Read the folder again">
            <Glyph name="refresh-cw" size={13} />
          </button>
        ) : null}
      </div>
      {pick ? (
        <div className="flex min-w-0 flex-col gap-3 rounded-xl p-3 ring-1 ring-border @lg/iris:flex-row">
          <div className="grid aspect-square w-full shrink-0 place-items-center overflow-hidden rounded-lg @lg/iris:w-56" style={bgStyle(bg)}>
            {urlOf(pick) ? <img src={urlOf(pick)} alt={pick.name} className="max-h-full max-w-full object-contain p-3" /> : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1 break-all text-[13.5px] font-semibold">{pick.name}</div>
              <button type="button" className={ICON_BTN} onClick={() => setPicked(null)} aria-label="Close details">
                <Glyph name="x" size={14} />
              </button>
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              {[
                ["Path", pick.path],
                ["Kind", KIND_TITLE[pick.kind].replace(/s$/, "")],
                ["Pixels", dims.get(pick.path) ? `${Math.round(dims.get(pick.path)!.width)} × ${Math.round(dims.get(pick.path)!.height)}` : "…"],
                ["File size", sized(pick) !== null ? formatBytes(sized(pick)!) : "…"],
                ...(pick.set ? [["Set", pick.set]] : []),
                ...(labels.get(pick.path) ?? pick.label ? [["Slot", labels.get(pick.path) ?? pick.label!]] : []),
              ].map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 break-all font-mono text-[12px]">{v}</dd>
                </div>
              ))}
            </dl>
            {!sample ? (
              <div className="mt-auto flex gap-1.5 pt-1">
                <button type="button" className={PILL(false)} onClick={() => openPath(env, joinPath(display, pick.path))}>
                  <Glyph name="external-link" size={12} />
                  Open
                </button>
                <button type="button" className={PILL(false)} onClick={() => env.perform([{ $iris: "action", kind: "copy", args: [joinPath(display, pick.path)] }])}>
                  <Glyph name="copy" size={12} />
                  Copy path
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      {groups.length ? (
        groups.map((g) => (
          <section key={g.kind} className="min-w-0">
            <div className="mb-1.5 flex items-baseline gap-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              {KIND_TITLE[g.kind]}
              <span className="tabular-nums normal-case tracking-normal">{g.items.length}</span>
            </div>
            <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tile}px, 1fr))` }}>
              {g.items.map((a) => {
                const url = urlOf(a);
                const label = labels.get(a.path) ?? a.label;
                return (
                  <button
                    key={a.path}
                    type="button"
                    onClick={() => setPicked(a.path === picked ? null : a.path)}
                    aria-pressed={a.path === picked}
                    title={a.path}
                    className={cn("group/tile flex min-w-0 flex-col gap-1 rounded-lg p-1 text-left hover:bg-state-hover focus-visible:outline-2 focus-visible:outline-[var(--iris-accent)]", a.path === picked && "ring-2 ring-[var(--iris-accent)]")}
                  >
                    <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-md ring-1 ring-border" style={bgStyle(bg)}>
                      {url ? (
                        <img
                          src={url}
                          alt={a.name}
                          loading="lazy"
                          className={cn("max-h-full max-w-full object-contain", a.kind === "svg" ? "size-1/2" : "p-2")}
                          onLoad={(e) => {
                            const im = e.currentTarget;
                            if (a.kind === "svg" && dims.has(a.path)) return;
                            if (im.naturalWidth) setDims((cur) => (cur.has(a.path) ? cur : new Map(cur).set(a.path, { width: im.naturalWidth, height: im.naturalHeight })));
                          }}
                        />
                      ) : (
                        <Shimmer className="size-full rounded-none" />
                      )}
                    </span>
                    <span className="min-w-0 truncate px-0.5 text-[12px] font-medium">{label ?? a.name}</span>
                    <span className="min-w-0 truncate px-0.5 text-[11px] tabular-nums text-muted-foreground">{meta(a) || "…"}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      ) : (
        <div className="rounded-lg px-3 py-5 text-center text-[12.5px] text-muted-foreground ring-1 ring-border">No images, SVGs or app icons under {display}</div>
      )}
    </div>
  );
}

// ---------- FontPreview ----------

type Loaded = { status: "loading" } | { status: "error"; error: string } | { status: "ok"; info: FontInfo; family: string; bytes: number; probed: boolean };

async function inflate(bytes: Uint8Array, format: "deflate" | "brotli"): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Table access for any supported container; WOFF2 needs the browser's brotli. */
async function fontTables(bytes: Uint8Array): Promise<{ get: TableGetter; format: FontInfo["format"] } | null> {
  const sig = fontSignature(bytes);
  if (sig === "sfnt" || sig === "otto") return { get: sfntTables(bytes), format: sig === "otto" ? "OpenType" : "TrueType" };
  if (sig === "ttcf") return { get: sfntTables(bytes, collectionStart(bytes)), format: "Collection" };
  const WANT = new Set(["name", "cmap", "maxp", "head", "hhea", "OS/2", "fvar"]);
  if (sig === "woff") {
    const map = new Map<string, Uint8Array>();
    for (const t of woffDirectory(bytes)) {
      if (!WANT.has(t.tag)) continue;
      const raw = bytes.subarray(t.offset, t.offset + t.compLength);
      map.set(t.tag, t.compLength < t.origLength ? await inflate(raw, "deflate") : raw);
    }
    return { get: mapTables(map), format: "WOFF" };
  }
  if (sig === "woff2") {
    const dir = woff2Directory(bytes);
    if (!dir) return null;
    let data: Uint8Array;
    try {
      data = await inflate(bytes.subarray(dir.dataOffset, dir.dataOffset + dir.compressedLength), "brotli");
    } catch {
      return null;
    }
    const map = new Map<string, Uint8Array>();
    for (const t of dir.tables) if (WANT.has(t.tag) && !t.transformed) map.set(t.tag, data.subarray(t.offset, t.offset + t.length));
    return { get: mapTables(map), format: "WOFF2" };
  }
  return null;
}

/** Code points the loaded face draws, found by measuring against two fallbacks (when the cmap can't be read). */
function probeCodepoints(family: string): number[] {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return [];
  const out: number[] = [];
  const width = (font: string, ch: string) => {
    ctx.font = font;
    return ctx.measureText(ch).width;
  };
  for (const [from, to] of PROBE_RANGES) {
    for (let c = from; c <= to; c++) {
      const ch = String.fromCodePoint(c);
      const a = width(`40px "${family}", monospace`, ch);
      const b = width(`40px "${family}", serif`, ch);
      if (a === b && a !== width("40px monospace", ch)) out.push(c);
    }
  }
  return out;
}

let fontSeq = 0;

function useFont(url: string | null): Loaded {
  const [state, setState] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    if (!url) return setState({ status: "loading" });
    let live = true;
    let face: FontFace | null = null;
    setState({ status: "loading" });
    (async () => {
      const buf = await fetchBytes(url, MAX_FONT_BYTES);
      const bytes = new Uint8Array(buf);
      if (!fontSignature(bytes)) throw new Error("not a font file Iris can read (ttf, otf, ttc, woff or woff2)");
      const family = `iris-font-${++fontSeq}`;
      face = new FontFace(family, buf);
      await face.load();
      document.fonts.add(face);
      const tables = await fontTables(bytes).catch(() => null);
      const info = tables ? readFont(tables.get, tables.format) : readFont(() => null, fontSignature(bytes) === "woff2" ? "WOFF2" : "TrueType");
      const probed = !info.codepoints;
      if (probed) info.codepoints = probeCodepoints(family);
      if (live) setState({ status: "ok", info, family, bytes: bytes.length, probed });
    })().catch((e: unknown) => live && setState({ status: "error", error: /FontFace|load/i.test(errorText(e)) ? "the browser couldn't load this font" : errorText(e) }));
    return () => {
      live = false;
      if (face) document.fonts.delete(face);
    };
  }, [url]);
  return state;
}

export function FontPreviewView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const src = str(props.src);
  const [file] = useFileUrl(src);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file.status === "sample") void sampleObjectUrl("font").then(setSampleUrl, () => undefined);
  }, [file.status]);
  const url = file.status === "ok" ? file.url : file.status === "sample" ? sampleUrl : null;
  const font = useFont(url);
  const [text, setText] = useState(str(props.sample) ?? "The quick brown fox jumps over the lazy dog");
  const [size, setSize] = useState(() => Math.max(8, Math.min(160, num(props.size) ?? 44)));
  const [axes, setAxes] = useState<Record<string, number>>({});
  const [all, setAll] = useState(false);
  const [glyph, setGlyph] = useState<number | null>(null);
  const limit = Math.max(0, Math.round(num(props.glyphs) ?? 240));
  const name = src ? (src.split("/").pop() ?? src) : "font";
  const sample = file.status === "sample";

  if (file.status === "error") return <Problem error={file.error} what="<FontPreview>" />;
  if (font.status === "error") return <Problem error={font.error} what="<FontPreview>" />;
  if (font.status === "loading") return <Shimmer className="h-48" />;
  const { info, family } = font;
  const variation = info.axes.length ? info.axes.map((a) => `"${a.tag}" ${axes[a.tag] ?? a.def}`).join(", ") : undefined;
  const faceStyle = { fontFamily: `"${family}", var(--font-sans, sans-serif)`, fontVariationSettings: variation };
  const points = (info.codepoints ?? []).filter(visibleCodepoint);
  const shown = all ? points.slice(0, 4000) : points.slice(0, limit);
  const accent = accentOf(palette);
  const facts = [info.format, info.glyphs !== null ? `${info.glyphs.toLocaleString()} glyphs` : null, `${points.length.toLocaleString()} characters`, formatBytes(font.bytes), info.version ? `v${info.version}` : null].filter(Boolean) as string[];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-start gap-2">
        <Glyph name="type" size={15} className="mt-0.5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 truncate text-[13.5px] font-semibold">{str(props.title) ?? info.family ?? name}</span>
            {info.style ? <span className="text-[12.5px] text-muted-foreground">{info.style}</span> : null}
          </div>
          {/* Facts sit apart by space, not dots, so a wrapped line never starts with a separator. */}
          <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 text-[11.5px] tabular-nums text-muted-foreground">
            <span className="font-mono">{name}</span>
            {facts.map((f) => (
              <span key={f}>{f}</span>
            ))}
            {info.designer ? <span>{info.designer}</span> : null}
          </div>
        </div>
        {sample ? <Chip>Sample</Chip> : null}
      </div>
      <div className="min-w-0 rounded-xl px-4 py-3 ring-1 ring-border">
        <div
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-label="Sample text"
          onInput={(e) => setText(e.currentTarget.textContent ?? "")}
          className="min-w-0 break-words outline-none"
          style={{ ...faceStyle, fontSize: size, lineHeight: 1.2 }}
        >
          {text}
        </div>
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-2.5 text-[12px] text-muted-foreground">
          <AxisSlider label="Size" value={size} min={8} max={160} step={1} unit="px" onChange={setSize} accent={accent} />
          {info.axes.map((a) => (
            <AxisSlider key={a.tag} label={a.name} value={axes[a.tag] ?? a.def} min={a.min} max={a.max} step={a.max - a.min > 20 ? 1 : 0.1} onChange={(v) => setAxes((cur) => ({ ...cur, [a.tag]: v }))} accent={accent} />
          ))}
        </div>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 @lg/iris:grid-cols-3">
        {[
          ["Aa Bb Cc", 28],
          ["0123456789", 22],
          ["!?&@#%(){}", 22],
        ].map(([t, s]) => (
          <div key={t as string} className="truncate rounded-lg px-3 py-2 ring-1 ring-border" style={{ ...faceStyle, fontSize: s as number }}>
            {t}
          </div>
        ))}
      </div>
      {limit > 0 && points.length ? (
        <div className="min-w-0">
          <div className="mb-1.5 flex items-baseline gap-2 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
            Glyphs
            <span className="tabular-nums normal-case tracking-normal">
              {font.probed ? `${points.length} found by probing common ranges` : points.length.toLocaleString()}
            </span>
          </div>
          {glyph !== null ? (
            <div className="mb-2 flex min-w-0 items-center gap-4 rounded-xl px-4 py-3 ring-1 ring-border">
              <div className="grid size-28 shrink-0 place-items-center rounded-lg bg-muted text-[72px] leading-none" style={faceStyle}>
                {String.fromCodePoint(glyph)}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 text-[12.5px]">
                <div className="font-mono text-[13px] font-semibold">{hexCode(glyph)}</div>
                <div className="text-muted-foreground">
                  Decimal {glyph} · HTML <span className="font-mono">&amp;#x{glyph.toString(16).toUpperCase()};</span>
                </div>
                <div className="flex gap-1.5 pt-1">
                  <button type="button" className={PILL(false)} onClick={() => env.perform([{ $iris: "action", kind: "copy", args: [String.fromCodePoint(glyph)] }])}>
                    <Glyph name="copy" size={12} />
                    Copy character
                  </button>
                  <button type="button" className={ICON_BTN} onClick={() => setGlyph(null)} aria-label="Close glyph">
                    <Glyph name="x" size={14} />
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div className="grid gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(44px, 1fr))" }}>
            {shown.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setGlyph(c === glyph ? null : c)}
                title={hexCode(c)}
                aria-label={hexCode(c)}
                className="grid aspect-square place-items-center bg-[var(--card,var(--background))] text-[22px] leading-none hover:bg-state-hover focus-visible:relative focus-visible:outline-2 focus-visible:outline-[var(--iris-accent)]"
                style={{ ...faceStyle, ...(c === glyph ? { background: tint(accent, 18) } : null) }}
              >
                {String.fromCodePoint(c)}
              </button>
            ))}
          </div>
          {points.length > shown.length || all ? (
            <button type="button" className={cn(PILL(false), "mt-2")} onClick={() => setAll((v) => !v)}>
              {all ? "Show fewer" : `Show all ${points.length.toLocaleString()}`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function AxisSlider({ label, value, min, max, step, unit, onChange, accent }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void; accent: string }): ReactNode {
  return (
    <label className="flex min-w-0 items-center gap-2">
      <span className="shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="iris-range w-28 min-w-0" style={{ ["--iris-fill" as string]: `${((value - min) / (max - min || 1)) * 100}%`, accentColor: accent }} />
      <span className="w-12 shrink-0 tabular-nums text-foreground">
        {Math.round(value * 10) / 10}
        {unit ?? ""}
      </span>
    </label>
  );
}

export type { FolderState };
