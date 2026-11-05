// Checks on what a component's data says, beyond prop types: a quiz answer
// that points past its options, a scene object with an unknown type. check()
// reports these so the agent fixes them before the person sees a gap.
import { normalizeScene } from "./graphics";
import { normalizeCards, normalizeQuiz, normalizeSteps } from "./learn";
import { isPendingValue } from "./evaluate";
import { normalizeTour } from "./tour";
import { parseCast } from "./terminal";
import { normalizeProcesses } from "./devservers";
import { redlineProblems } from "./redline";
import { normalizeBoard } from "./board";
import { readStrings } from "./l10n";
import { cellProblems } from "./compute";
import { businessSpan, cronProblems, normalizeZones, parseDay, readHolidays, readHour } from "./time";
import { normalizeRelease } from "./release";
import { readAudit } from "./a11y";
import { readGeo } from "./geo";
import { normalizeKanban } from "./kanban";
import { normalizeBudget } from "./budget";
import { forecast } from "./forecast";

type ContentCheck = (props: Record<string, unknown>) => string[];

const when = (key: string, fn: (v: unknown) => string[]): ContentCheck => (props) => (props[key] === undefined || isPendingValue(props[key]) ? [] : fn(props[key]));

export const CONTENT_CHECKS: Record<string, ContentCheck> = {
  Quiz: when("questions", (v) => normalizeQuiz(v).problems),
  Flashcards: when("cards", (v) => normalizeCards(v).problems),
  Walkthrough: when("steps", (v) => normalizeSteps(v).problems),
  Scene: when("objects", (v) => normalizeScene(v).problems),
  CodeTour: when("steps", (v) => normalizeTour(v).problems),
  Redline: (props) => redlineProblems(isPendingValue(props.before) ? undefined : props.before, isPendingValue(props.after) ? undefined : props.after),
  TerminalReplay: when("cast", (v) => parseCast(v).problems),
  DevServers: when("processes", (v) => normalizeProcesses(v).problems),
  Whiteboard: (props) => (isPendingValue(props.items) || isPendingValue(props.arrows) ? [] : normalizeBoard(props.items, props.arrows).problems),
  StringsTable: (props) => {
    const v = props.strings;
    if (v === undefined || isPendingValue(v) || (v && typeof v === "object" && Object.values(v).some(isPendingValue))) return [];
    const locales = Array.isArray(props.locales) ? props.locales.map(String) : undefined;
    return readStrings(v, { source: typeof props.source === "string" ? props.source : undefined, locales }).problems;
  },
  Cells: when("cells", cellProblems),
  TimeZones: (props) => {
    if (isPendingValue(props.zones)) return [];
    const out = normalizeZones(props.zones, props.hours).problems;
    if (props.at !== undefined && readHour(props.at) === null) out.push(`at "${String(props.at)}" is not a time (use "15:00" or 15)`);
    if (props.date !== undefined && !parseDay(props.date)) out.push(`date "${String(props.date)}" is not a date (YYYY-MM-DD)`);
    return out;
  },
  Cron: (props) => cronProblems(props.expr, props.tz),
  DateDiff: (props) => {
    if ([props.from, props.to, props.holidays].some(isPendingValue)) return [];
    const { list, problems } = readHolidays(props.holidays);
    try {
      businessSpan(String(props.from ?? ""), String(props.to ?? ""), { holidays: list });
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
    }
    return problems;
  },
  Release: when("release", (v) => normalizeRelease(v).problems),
  AccessibilityAudit: when("report", (v) => readAudit(v).problems),
  GeoHeatmap: (props) => (props.data === undefined || isPendingValue(props.data) ? [] : readGeo(props.data, props).problems),
  Board: (props) => (isPendingValue(props.items) ? [] : normalizeKanban(props.items, isPendingValue(props.columns) ? undefined : props.columns).problems),
  Budget: (props) => (props.file !== undefined || [props.lines, props.points, props.by].some(isPendingValue) ? [] : normalizeBudget(props.lines, props).problems),
  Forecast: (props) => ([props.points, props.dates].some(isPendingValue) ? [] : forecast(props).problems),
};
