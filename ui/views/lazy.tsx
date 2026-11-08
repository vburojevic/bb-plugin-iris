// Views that live in on-demand chunks. The main bundle keeps only this shell:
// it loads the chunk (for heavy views, once the element nears the screen),
// shows a placeholder meanwhile, and then renders the chunk's view with the
// same props. Chunk views see the card through "@iris/ui" (ui/chunk-api.ts).

import { useEffect, useRef, useState } from "react";
import { type ChunkName, loadChunk } from "../chunks";
import type { View, ViewProps } from "../render";
import { InlineError } from "../render";
import { Shimmer } from "./kit";

type ChunkViews = Record<string, View>;
const loaded = new Map<ChunkName, ChunkViews>();

function lazyView(chunk: ChunkName, name: string, opts: { height: number; whenNear?: boolean }): View {
  function LazyView(p: ViewProps) {
    const [mod, setMod] = useState<ChunkViews | null>(() => loaded.get(chunk) ?? null);
    const [error, setError] = useState<string | null>(null);
    const [near, setNear] = useState(!opts.whenNear);
    const spot = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (near || mod) return;
      const el = spot.current;
      if (!el || typeof IntersectionObserver === "undefined") return setNear(true);
      const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "600px" });
      io.observe(el);
      return () => io.disconnect();
    }, [near, mod]);
    useEffect(() => {
      if (mod || !near) return;
      let alive = true;
      loadChunk<ChunkViews>(chunk).then(
        (m) => {
          loaded.set(chunk, m);
          if (alive) setMod(m);
        },
        (e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)),
      );
      return () => {
        alive = false;
      };
    }, [mod, near]);
    if (error) return <InlineError error={new Error(`this part of Iris could not load: ${error}`)} context={`<${name}>`} />;
    const Real = mod?.[`${name}View`];
    if (!Real) {
      const h = typeof p.props.height === "number" ? Math.max(80, Math.min(900, p.props.height)) : opts.height;
      return (
        <div ref={spot} className="min-w-0" style={{ height: h }}>
          <Shimmer className="size-full" />
        </div>
      );
    }
    return <Real {...p} />;
  }
  LazyView.displayName = `Lazy(${name})`;
  return LazyView;
}

export const QuizView = lazyView("play", "Quiz", { height: 220 });
export const FlashcardsView = lazyView("play", "Flashcards", { height: 240 });
export const WalkthroughView = lazyView("play", "Walkthrough", { height: 220 });
export const TimerView = lazyView("play", "Timer", { height: 72 });
export const ShaderView = lazyView("play", "Shader", { height: 240, whenNear: true });
export const SceneView = lazyView("scene", "Scene", { height: 320, whenNear: true });
export const SheetView = lazyView("sheet", "Sheet", { height: 260 });
export const HttpExchangeView = lazyView("inspect", "HttpExchange", { height: 220 });
export const WaterfallView = lazyView("inspect", "Waterfall", { height: 260 });
export const ErDiagramView = lazyView("inspect", "ErDiagram", { height: 320, whenNear: true });
export const QueryPlanView = lazyView("inspect", "QueryPlan", { height: 260 });
export const CodeTourView = lazyView("codework", "CodeTour", { height: 300 });
export const RedlineView = lazyView("codework", "Redline", { height: 160 });
export const TerminalReplayView = lazyView("codework", "TerminalReplay", { height: 360 });
export const DevServersView = lazyView("codework", "DevServers", { height: 140 });
export const WhiteboardView = lazyView("board", "Whiteboard", { height: 420 });
export const StringsTableView = lazyView("l10n", "StringsTable", { height: 320 });
export const VideoPlayerView = lazyView("assets", "VideoPlayer", { height: 300, whenNear: true });
export const AudioPlayerView = lazyView("assets", "AudioPlayer", { height: 120, whenNear: true });
export const FileTreeView = lazyView("assets", "FileTree", { height: 240, whenNear: true });
export const AssetGalleryView = lazyView("assets", "AssetGallery", { height: 240, whenNear: true });
export const FontPreviewView = lazyView("assets", "FontPreview", { height: 280, whenNear: true });
export const PdfViewerView = lazyView("pdf", "PdfViewer", { height: 560, whenNear: true });
export const CellsView = lazyView("tools", "Cells", { height: 200 });
export const TimeZonesView = lazyView("tools", "TimeZones", { height: 220 });
export const CronView = lazyView("tools", "Cron", { height: 260 });
export const DateDiffView = lazyView("tools", "DateDiff", { height: 220 });
export const ReleaseView = lazyView("tools", "Release", { height: 360 });
export const BudgetView = lazyView("track", "Budget", { height: 220 });
export const ForecastView = lazyView("track", "Forecast", { height: 340 });
export const AccessibilityAuditView = lazyView("interact", "AccessibilityAudit", { height: 320, whenNear: true });
export const GeoHeatmapView = lazyView("interact", "GeoHeatmap", { height: 300, whenNear: true });
export const EditableBoardView = lazyView("interact", "EditableBoard", { height: 200 });
export const CompareGridView = lazyView("compare", "CompareGrid", { height: 320, whenNear: true });
export const VideoCompareView = lazyView("compare", "VideoCompare", { height: 340, whenNear: true });
export const EvalReportView = lazyView("agents", "EvalReport", { height: 320 });
export const AgentTraceView = lazyView("agents", "AgentTrace", { height: 300 });
export const ContextMeterView = lazyView("agents", "ContextMeter", { height: 200 });
export const ToolCallView = lazyView("agents", "ToolCall", { height: 40 });
export const TestHistoryView = lazyView("debug", "TestHistory", { height: 240 });
export const FlamegraphView = lazyView("debug", "Flamegraph", { height: 360, whenNear: true });
export const BisectView = lazyView("debug", "Bisect", { height: 260 });
export const BlastRadiusView = lazyView("debug", "BlastRadius", { height: 300 });
export const SchemaDiffView = lazyView("debug", "SchemaDiff", { height: 300 });
export const DecisionLogView = lazyView("craft", "DecisionLog", { height: 320 });
export const ThemePreviewView = lazyView("craft", "ThemePreview", { height: 360 });
