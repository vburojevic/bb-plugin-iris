// Rules for the files and assets family: a folder listing as a tree with
// sizes and git change markers, the assets found in a folder, SVG sizes, and
// PDF page lists. The views live in chunks/files.tsx and chunks/pdf.tsx.

import type { ChangeKind, ChangedFile } from "./project";

export type Marker = "A" | "M" | "D" | "R" | "U";

export interface TreeFile {
  kind: "file";
  name: string;
  /** Path from the listed folder. */
  path: string;
  size: number | null;
  marker: Marker | null;
  /** Deleted in git: listed from the changes, not on disk. */
  gone: boolean;
}

export interface TreeDir {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
  /** Sum of the known sizes under it. */
  size: number;
  /** Files under it whose size is still unknown. */
  unknown: number;
  /** Files on disk under it (deleted ghosts not counted). */
  files: number;
  changed: number;
}

export type TreeNode = TreeFile | TreeDir;

export function markerOf(kind: ChangeKind, untracked: boolean): Marker {
  if (untracked) return "U";
  return kind === "added" || kind === "copied" ? "A" : kind === "deleted" ? "D" : kind === "renamed" ? "R" : "M";
}

export const MARKER_LABEL: Record<Marker, string> = { A: "Added", M: "Modified", D: "Deleted", R: "Renamed", U: "Untracked" };
export const MARKER_TONE: Record<Marker, "good" | "warn" | "bad" | "info" | "neutral"> = { A: "good", M: "warn", D: "bad", R: "info", U: "good" };

/**
 * Changed files that fall under `prefix` (the listed folder's path from the
 * repository root, "" for the root), keyed by their path from that folder.
 */
export function changesUnder(files: readonly Pick<ChangedFile, "path" | "kind" | "untracked">[], prefix: string): Map<string, Marker> {
  const base = prefix.replace(/^\.\/?/, "").replace(/\/+$/, "");
  const out = new Map<string, Marker>();
  for (const f of files) {
    if (base && !f.path.startsWith(`${base}/`)) continue;
    out.set(base ? f.path.slice(base.length + 1) : f.path, markerOf(f.kind, f.untracked));
  }
  return out;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Builds a tree from paths relative to the listed folder; deleted files are added as ghosts. */
export function buildTree(paths: readonly string[], sizes: ReadonlyMap<string, number>, markers: ReadonlyMap<string, Marker>, sort: "name" | "size" = "name"): TreeDir {
  const root: TreeDir = { kind: "dir", name: "", path: "", children: [], size: 0, unknown: 0, files: 0, changed: 0 };
  const dirs = new Map<string, TreeDir>([["", root]]);
  const dirFor = (dirPath: string): TreeDir => {
    const hit = dirs.get(dirPath);
    if (hit) return hit;
    const cut = dirPath.lastIndexOf("/");
    const parent = dirFor(cut < 0 ? "" : dirPath.slice(0, cut));
    const d: TreeDir = { kind: "dir", name: dirPath.slice(cut + 1), path: dirPath, children: [], size: 0, unknown: 0, files: 0, changed: 0 };
    parent.children.push(d);
    dirs.set(dirPath, d);
    return d;
  };
  const seen = new Set<string>();
  const add = (p: string, gone: boolean) => {
    const clean = p.replace(/^\.\//, "").replace(/\/+$/, "");
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    const cut = clean.lastIndexOf("/");
    const marker = markers.get(clean) ?? (gone ? "D" : null);
    dirFor(cut < 0 ? "" : clean.slice(0, cut)).children.push({ kind: "file", name: clean.slice(cut + 1), path: clean, size: gone ? null : (sizes.get(clean) ?? null), marker, gone });
  };
  for (const p of paths) add(p, false);
  for (const [p, m] of markers) if (m === "D") add(p, true);
  const total = (d: TreeDir) => {
    d.size = 0;
    d.unknown = 0;
    d.files = 0;
    d.changed = 0;
    for (const c of d.children) {
      if (c.kind === "dir") {
        total(c);
        d.size += c.size;
        d.unknown += c.unknown;
        d.files += c.files;
        d.changed += c.changed;
      } else {
        if (!c.gone) d.files++;
        if (c.marker) d.changed++;
        if (c.size === null) {
          if (!c.gone) d.unknown++;
        } else d.size += c.size;
      }
    }
    d.children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      if (sort === "size") {
        const diff = (b.size ?? -1) - (a.size ?? -1);
        if (diff) return diff;
      }
      return byName.compare(a.name, b.name);
    });
  };
  total(root);
  return root;
}

/** Only the files with a marker, and the folders that hold them. */
export function onlyChanged(d: TreeDir): TreeDir {
  const children: TreeNode[] = [];
  for (const c of d.children) {
    if (c.kind === "file") {
      if (c.marker) children.push(c);
    } else if (c.changed) children.push(onlyChanged(c));
  }
  return { ...d, children };
}

/** Folders whose paths match a filter, kept with their parents; files whose path contains it. Case-insensitive. */
export function filterTree(d: TreeDir, query: string): TreeDir {
  const q = query.trim().toLowerCase();
  if (!q) return d;
  const walk = (dir: TreeDir): TreeDir | null => {
    const children: TreeNode[] = [];
    for (const c of dir.children) {
      if (c.kind === "file") {
        if (c.path.toLowerCase().includes(q)) children.push(c);
      } else {
        const sub = c.path.toLowerCase().includes(q) ? c : walk(c);
        if (sub) children.push(sub);
      }
    }
    return children.length ? { ...dir, children } : null;
  };
  return walk(d) ?? { ...d, children: [] };
}

/** Folder paths open at first: every folder down to `levels` deep. */
export function openPaths(d: TreeDir, levels: number): Set<string> {
  const out = new Set<string>();
  const walk = (dir: TreeDir, depth: number) => {
    if (depth >= levels) return;
    for (const c of dir.children) {
      if (c.kind === "dir") {
        out.add(c.path);
        walk(c, depth + 1);
      }
    }
  };
  walk(d, 0);
  return out;
}

/** Rows in display order for the folders that are open. */
export function visibleRows(d: TreeDir, open: ReadonlySet<string>, all = false): { node: TreeNode; depth: number }[] {
  const rows: { node: TreeNode; depth: number }[] = [];
  const walk = (dir: TreeDir, depth: number) => {
    for (const c of dir.children) {
      rows.push({ node: c, depth });
      if (c.kind === "dir" && (all || open.has(c.path))) walk(c, depth + 1);
    }
  };
  walk(d, 0);
  return rows;
}

// ---------- assets ----------

export type AssetKind = "icon" | "image" | "svg";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico", "bmp"];

/** What kind of asset a path is, or null for anything that isn't an image. */
export function assetKind(path: string): AssetKind | null {
  const ext = /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? "";
  if (!IMAGE_EXTENSIONS.includes(ext)) return null;
  const lower = path.toLowerCase();
  // Xcode app icon sets and Icon Composer bundles, Android launcher icons, web app and favicon files.
  if (/\.appiconset\//.test(lower) || /\.icon\/assets\//.test(lower) || /(^|\/)mipmap-[\w-]+\/ic_launcher/.test(lower) || /(^|\/)(favicon[\w.-]*|apple-touch-icon[\w.-]*|app-?icon[\w.-]*|icon-\d+[\w.-]*|android-chrome-[\w.-]+)$/.test(lower)) return "icon";
  return ext === "svg" ? "svg" : "image";
}

export interface IconSetEntry {
  filename: string;
  label: string;
}

/** Labels from an .appiconset's Contents.json: "iPhone 60pt @3x", "Mac 512pt @2x", "iOS 1024pt". */
export function iconSetLabels(contents: unknown): Map<string, string> {
  const out = new Map<string, string>();
  const images = (contents as { images?: unknown } | null)?.images;
  if (!Array.isArray(images)) return out;
  const IDIOM: Record<string, string> = { iphone: "iPhone", ipad: "iPad", mac: "Mac", universal: "iOS", "ios-marketing": "App Store", watch: "Watch", "watch-marketing": "Watch App Store", car: "CarPlay", tv: "TV" };
  for (const im of images) {
    const r = im as Record<string, unknown>;
    if (typeof r.filename !== "string") continue;
    const idiom = typeof r.idiom === "string" ? (IDIOM[r.idiom] ?? r.idiom) : "";
    const size = typeof r.size === "string" ? `${r.size.split("x")[0]}pt` : "";
    const scale = typeof r.scale === "string" && r.scale !== "1x" ? `@${r.scale}` : "";
    const look = Array.isArray(r.appearances) ? (r.appearances as { value?: string }[]).map((a) => a.value).filter(Boolean).join(" ") : "";
    out.set(r.filename, [idiom, size, scale, look].filter(Boolean).join(" "));
  }
  return out;
}

/** An SVG's own size: width and height, else the viewBox. Units other than px are read as px. */
export function svgSize(text: string): { width: number; height: number } | null {
  // The size lives in the opening tag: find where it starts, then its closing ">" with indexOf,
  // one forward pass with no regex backtracking.
  const at = text.search(/<svg\b/i);
  const close = at < 0 ? -1 : text.indexOf(">", at);
  const tag = close < 0 ? undefined : text.slice(at, close + 1);
  if (!tag) return null;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
  const len = (v: string | undefined) => {
    if (!v || /%$/.test(v.trim())) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const vb = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const vbw = vb && vb.length === 4 && vb[2] > 0 ? vb[2] : null;
  const vbh = vb && vb.length === 4 && vb[3] > 0 ? vb[3] : null;
  let w = len(attr("width"));
  let h = len(attr("height"));
  if (w && !h && vbw && vbh) h = (w * vbh) / vbw;
  if (h && !w && vbw && vbh) w = (h * vbw) / vbh;
  w ??= vbw;
  h ??= vbh;
  return w && h ? { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100 } : null;
}

// ---------- PDF ----------

/** "1-3, 5" → [1, 2, 3, 5] within 1..count; null or "" for every page. */
export function parsePages(v: unknown, count: number): number[] {
  const all = Array.from({ length: Math.max(0, count) }, (_, k) => k + 1);
  if (v == null || v === "") return all;
  if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= count ? [v] : [];
  if (Array.isArray(v)) return [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= count))].sort((a, b) => a - b);
  if (typeof v !== "string") return all;
  const out = new Set<number>();
  for (const part of v.split(",")) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)?\s*)?$/.exec(part);
    if (!m) continue;
    const from = Number(m[1]);
    const to = part.includes("-") ? (m[2] ? Number(m[2]) : count) : from;
    for (let n = Math.max(1, from); n <= Math.min(count, to); n++) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Zoom steps for the PDF viewer, as a share of the fitted width. */
export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3] as const;

export function nextZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOMS.find((z) => z > current + 1e-3) ?? ZOOMS[ZOOMS.length - 1];
  return [...ZOOMS].reverse().find((z) => z < current - 1e-3) ?? ZOOMS[0];
}

/** Paths under a folder, cleaned: no leading "./", no trailing slash, never "..". */
export function joinPath(folder: string, rel: string): string {
  const f = folder.replace(/\/+$/, "");
  const r = rel.replace(/^\.\//, "");
  if (!f || f === ".") return r;
  return `${f}/${r}`;
}
