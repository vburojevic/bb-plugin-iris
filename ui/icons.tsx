// Lucide icons drawn as inline SVG. Iris's own UI icons ship in the main
// bundle; any other name an agent writes loads the full set once, on demand.
import { useEffect, useState, type CSSProperties } from "react";
import {
  AppWindow, ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, Ban, Calculator, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeftRight, ChevronsUpDown, Circle, CircleCheck, CircleDashed, CircleMinus, CircleX, Code, Columns2, Copy, CornerDownRight, ExternalLink,
  Eye, File, Folder, FolderOpen, Info, Lightbulb, Minus, PanelRightOpen, Paperclip, PartyPopper, Pause, Play, Plus, Quote, RotateCcw, Rows2, Scan,
  Search, Sparkles, Star, TriangleAlert, X,
  CircleAlert, CircleSlash, FileDiff, FileMinus, FilePlus, FileSymlink, FolderGit2, GitBranch, GitCommitHorizontal, GitMerge,
  GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Layers, LoaderCircle, RefreshCw, Workflow,
  GlobeLock, ImageOff, Images, Lock, MapPin, MapPinOff, Route,
  ArrowLeft, Flag, Shuffle,
  StepBack, StepForward, MessageSquare, MessageSquarePlus, ListVideo, RotateCw, Maximize, Volume2, VolumeX, FolderTree, FileCode, FileText, FileImage, Type, ZoomIn, ZoomOut, ChevronUp,
  Send, ShieldCheck,
  type IconNode,
} from "lucide";
import { loadChunk } from "./chunks";
import { iconKey } from "./icon-names";

export { iconKey };

const CORE: Record<string, IconNode> = {
  AppWindow, ArrowDown, ArrowDownRight, ArrowRight, ArrowUp, ArrowUpRight, Ban, Calculator, Check, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeftRight, ChevronsUpDown, Circle, CircleCheck, CircleDashed, CircleMinus, CircleX, Code, Columns2, Copy, CornerDownRight, ExternalLink,
  Eye, File, Folder, FolderOpen, Info, Lightbulb, Minus, PanelRightOpen, Paperclip, PartyPopper, Pause, Play, Plus, Quote, RotateCcw, Rows2, Scan,
  Search, Sparkles, Star, TriangleAlert, X,
  CircleAlert, CircleSlash, FileDiff, FileMinus, FilePlus, FileSymlink, FolderGit2, GitBranch, GitCommitHorizontal, GitMerge,
  GitPullRequest, GitPullRequestClosed, GitPullRequestDraft, Layers, LoaderCircle, RefreshCw, Workflow,
  GlobeLock, ImageOff, Images, Lock, MapPin, MapPinOff, Route,
  ArrowLeft, Flag, Shuffle,
  StepBack, StepForward, MessageSquare, MessageSquarePlus, ListVideo, RotateCw, Maximize, Volume2, VolumeX, FolderTree, FileCode, FileText, FileImage, Type, ZoomIn, ZoomOut, ChevronUp,
  Send, ShieldCheck,
};

let all: Record<string, IconNode> | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

function ensureAll() {
  if (all || pending) return;
  pending = loadChunk<{ icons: Record<string, IconNode> }>("icons").then(
    (m) => {
      all = m.icons;
      for (const fn of listeners) fn();
    },
    () => {
      pending = null;
    },
  );
}

function resolve(name: string): IconNode | null | undefined {
  const key = iconKey(name);
  if (CORE[key]) return CORE[key];
  if (all) return all[key] ?? null;
  return undefined;
}

/** The shape of any Lucide icon, loading the full set if it isn't in the core one; null for an unknown name. */
export async function loadIconNode(name: string): Promise<IconNode | null> {
  const hit = resolve(name);
  if (hit !== undefined) return hit;
  ensureAll();
  await pending;
  return resolve(name) ?? null;
}

export function LucideIcon({ name, size = 16, color, className, style, strokeWidth = 2 }: { name: string; size?: number; color?: string; className?: string; style?: CSSProperties; strokeWidth?: number }) {
  const [, force] = useState(0);
  const node = resolve(name);
  useEffect(() => {
    if (node !== undefined) return;
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    ensureAll();
    return () => {
      listeners.delete(fn);
    };
  }, [node]);
  const shape = node ?? (node === null ? CORE.Circle : null);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className} style={{ color, flexShrink: 0, ...style }}>
      {shape?.map(([tag, attrs], k) => {
        const Tag = tag as "path";
        return <Tag key={k} {...(attrs as Record<string, string>)} />;
      })}
    </svg>
  );
}
