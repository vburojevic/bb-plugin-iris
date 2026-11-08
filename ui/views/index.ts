import type { View } from "../render";
import { CalloutView, BadgeView, EmptyView, GaugeView, HeadingView, IconView, ImageView, ItemView, KeyValueView, LinkView, ListView, MetricView, ProgressView, TextView } from "./content";
import { CalendarHeatmapView, HeatmapView, JsonView, SegmentedBarView, SparklineView, TableView } from "./data";
import { CardView, DetailsView, DividerView, GridView, RowView, StackView, TabView, TabsView } from "./layout";
import { ChartView } from "./chart";
import { CodeView, DiagramView, DiffView, LogsView, SnippetView, StackTraceView, TreeView } from "./code";
import { BenchmarkView, CoverageView, DeltaView, FindingsView, TestsView } from "./project";
import { AcceptanceView, CompareView, ProvenanceView } from "./evidence";
import { ChangesView, CommitsView, EnvironmentsView, PipelineView, PullRequestView, ThreadsView } from "./live";
import { BoardView, CalendarView, DecisionView, EstimateView, PlanView, RoadmapView, StatusView, StepsView, TimelineView } from "./planning";
import { ButtonView, ChecklistView, ColorInputView, DateInputView, InputView, RadioView, RatingView, SegmentedView, SelectView, SliderView, StepperView, TextAreaView, ToggleView } from "./inputs";
import { ChoicesView, FollowUpsView, SubmitView } from "./pickers";
import { GalleryView, HotspotsView, MapView, PhotoSearchView } from "./media";
import { AnnotateView, DeviceFrameView, SwatchesView, TypeSpecimenView } from "./design";
import { DataGridView } from "./grid";
import { FunctionPlotView, MathView } from "./math";
import { GraphView } from "./graph";
import { LiveLogView, LiveProgressView } from "./livecards";
import { FlashcardsView, QuizView, SceneView, ShaderView, TimerView, WalkthroughView } from "./lazy";
import { ErDiagramView, HttpExchangeView, QueryPlanView, SheetView, WaterfallView } from "./lazy";
import { CodeTourView, DevServersView, RedlineView, TerminalReplayView } from "./lazy";
import { StringsTableView, WhiteboardView } from "./lazy";
import { AssetGalleryView, AudioPlayerView, FileTreeView, FontPreviewView, PdfViewerView, VideoPlayerView } from "./lazy";
import { CellsView, CronView, DateDiffView, ReleaseView, TimeZonesView } from "./lazy";
import { AccessibilityAuditView, GeoHeatmapView } from "./lazy";
import { BudgetView, ForecastView } from "./lazy";
import { CompareGridView, VideoCompareView } from "./lazy";
import { DocReviewView, MarkUpView, RankView, ScreensView, VariantView, VariantsView } from "./lazy";

export const VIEWS: Record<string, View> = {
  Card: CardView, Stack: StackView, Row: RowView, Grid: GridView, Tabs: TabsView, Tab: TabView, Details: DetailsView, Divider: DividerView,
  Text: TextView, Heading: HeadingView, Callout: CalloutView, Metric: MetricView, Badge: BadgeView, Icon: IconView, KeyValue: KeyValueView,
  List: ListView, Item: ItemView, Link: LinkView, Image: ImageView, Progress: ProgressView, Gauge: GaugeView, Empty: EmptyView,
  Table: TableView, Json: JsonView, SegmentedBar: SegmentedBarView, Sparkline: SparklineView, CalendarHeatmap: CalendarHeatmapView, Heatmap: HeatmapView,
  Chart: ChartView, Diagram: DiagramView, Tree: TreeView,
  Code: CodeView, Snippet: SnippetView, Diff: DiffView, Logs: LogsView, StackTrace: StackTraceView,
  Tests: TestsView, Findings: FindingsView, Coverage: CoverageView, Benchmark: BenchmarkView, Delta: DeltaView,
  Acceptance: AcceptanceView, Compare: CompareView, Provenance: ProvenanceView,
  Changes: ChangesView, Commits: CommitsView, PullRequest: PullRequestView, Environments: EnvironmentsView, Threads: ThreadsView, Pipeline: PipelineView,
  Plan: PlanView, Steps: StepsView, Timeline: TimelineView, Decision: DecisionView, Board: BoardView, Roadmap: RoadmapView, Estimate: EstimateView, Calendar: CalendarView, Status: StatusView,
  Slider: SliderView, Stepper: StepperView, Toggle: ToggleView, Segmented: SegmentedView, Select: SelectView, Radio: RadioView, Checklist: ChecklistView,
  Input: InputView, TextArea: TextAreaView, DateInput: DateInputView, Rating: RatingView, Button: ButtonView,
  FollowUps: FollowUpsView, Choices: ChoicesView, Submit: SubmitView, Variants: VariantsView, Variant: VariantView, ColorInput: ColorInputView, Rank: RankView,
  Gallery: GalleryView, Screens: ScreensView, Hotspots: HotspotsView, Map: MapView, PhotoSearch: PhotoSearchView,
  DeviceFrame: DeviceFrameView, MarkUp: MarkUpView, Swatches: SwatchesView, TypeSpecimen: TypeSpecimenView, Annotate: AnnotateView,
  DataGrid: DataGridView, Math: MathView, FunctionPlot: FunctionPlotView, Graph: GraphView, LiveLog: LiveLogView, LiveProgress: LiveProgressView,
  Quiz: QuizView, Flashcards: FlashcardsView, Walkthrough: WalkthroughView, Timer: TimerView,
  Scene: SceneView, Shader: ShaderView,
  Sheet: SheetView, HttpExchange: HttpExchangeView, Waterfall: WaterfallView, ErDiagram: ErDiagramView, QueryPlan: QueryPlanView,
  CodeTour: CodeTourView, Redline: RedlineView, DocReview: DocReviewView, TerminalReplay: TerminalReplayView, DevServers: DevServersView,
  Whiteboard: WhiteboardView, StringsTable: StringsTableView,
  VideoPlayer: VideoPlayerView, AudioPlayer: AudioPlayerView, FileTree: FileTreeView, AssetGallery: AssetGalleryView, PdfViewer: PdfViewerView, FontPreview: FontPreviewView,
  Cells: CellsView, TimeZones: TimeZonesView, Cron: CronView, DateDiff: DateDiffView, Release: ReleaseView,
  AccessibilityAudit: AccessibilityAuditView, GeoHeatmap: GeoHeatmapView,
  Budget: BudgetView, Forecast: ForecastView,
  CompareGrid: CompareGridView, VideoCompare: VideoCompareView,
};
