// Live cards over files a running job writes. Both re-read through the card's
// runtime (the same 2 s refresh a Card with state="live" uses), so a log or a
// progress file fills in while the person watches. In the gallery, where no
// thread exists, each plays a short sample, marked as such.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { IrisError, isPendingValue } from "../../core/evaluate";
import { type ProgressTask, type TailValue, etaSeconds, formatEta, isTailValue, logLines, rate, readProgress } from "../../core/live";
import { useEnv } from "../env";
import type { ViewProps } from "../render";
import { ERROR_LINE, WARN_LINE, normalizeEscapes, parseAnsi } from "./code";
import { Glyph, Shimmer, cn, fmt, num, str } from "./kit";

type FileState<T> = { status: "loading" } | { status: "missing" } | { status: "error"; error: string } | { status: "ok"; value: T };

/** Reads a file through the runtime so the live refresh keeps it current. */
function useLiveFile(path: string | undefined, tail: boolean): FileState<unknown> {
  const env = useEnv();
  if (!path) return { status: "error", error: "needs a file path" };
  try {
    const v = env.runtime.loadLive(path, tail ? { tail: true } : undefined);
    if (isPendingValue(v)) return { status: "loading" };
    return { status: "ok", value: v };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/file not found/.test(message)) return { status: "missing" };
    return { status: "error", error: e instanceof IrisError ? message.replace(/^load\("[^"]*"\): /, "") : message };
  }
}

/** Re-renders every `ms` while mounted, for "updated 4 s ago" and stall checks. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

function LiveChip({ state, children }: { state: "live" | "paused" | "waiting" | "done" | "stalled" | "error"; children: ReactNode }) {
  const { palette } = useEnv();
  const color = state === "live" ? palette.tone.good : state === "stalled" ? palette.tone.warn : state === "error" ? palette.tone.bad : state === "done" ? palette.tone.good : palette.tone.neutral;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", (state === "live" || state === "waiting") && "iris-pulse")} style={{ background: color }} aria-hidden />
      {children}
    </span>
  );
}

// ---------- LiveLog ----------

const SAMPLE_LOG = [
  "\u001b[2m$ npm run build\u001b[0m",
  "> iris@0.2.0 build",
  "> node scripts/build-chunks.mjs && bb plugin build",
  "\u001b[36minfo\u001b[0m  bundling chunks: icons, katex, graph",
  "\u001b[32m✓\u001b[0m icons-B5NALR6F.js  \u001b[2m454 KB, 80 KB br\u001b[0m",
  "\u001b[32m✓\u001b[0m katex-GIAPZIAV.js  \u001b[2m268 KB, 64 KB br\u001b[0m",
  "\u001b[32m✓\u001b[0m graph-CWDGTS4S.js  \u001b[2m65 KB, 21 KB br\u001b[0m",
  "\u001b[36minfo\u001b[0m  compiling app.tsx",
  "\u001b[33mwarn\u001b[0m  ui/views/chart.tsx: unused export humanize",
  "\u001b[36minfo\u001b[0m  compiling server.ts",
  "\u001b[36minfo\u001b[0m  scanning Tailwind classes in 41 files",
  "\u001b[32m✓\u001b[0m app.js  \u001b[2m212 KB\u001b[0m",
  "\u001b[32m✓\u001b[0m app.css  \u001b[2m38 KB\u001b[0m",
  "\u001b[36minfo\u001b[0m  running 172 tests",
  "\u001b[32m✓\u001b[0m tests/parse.test.ts \u001b[2m(81)\u001b[0m",
  "\u001b[32m✓\u001b[0m tests/grid.test.ts \u001b[2m(13)\u001b[0m",
  "\u001b[31m✗\u001b[0m tests/live.test.ts > tails at a line boundary",
  "  \u001b[31mError: expected 'two\\n' to be 'three\\n'\u001b[0m",
  "\u001b[32m✓\u001b[0m tests/evaluate.test.ts \u001b[2m(44)\u001b[0m",
  "\u001b[1mTests\u001b[0m  \u001b[31m1 failed\u001b[0m | \u001b[32m171 passed\u001b[0m",
];

/** The gallery's stand-in for a growing file. */
function useSampleTail(on: boolean): FileState<TailValue> {
  const [n, setN] = useState(6);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setN((k) => (k >= SAMPLE_LOG.length + 6 ? 6 : k + 1)), 900);
    return () => clearInterval(t);
  }, [on]);
  const text = SAMPLE_LOG.slice(0, Math.min(n, SAMPLE_LOG.length)).join("\n") + "\n";
  return { status: "ok", value: { text, size: text.length, truncated: false } };
}

export function LiveLogView({ props }: ViewProps) {
  const env = useEnv();
  const sample = !env.threadId;
  const file = str(props.file);
  const real = useLiveFile(sample ? undefined : file, true);
  const fake = useSampleTail(sample);
  const state = (sample ? fake : real) as FileState<unknown>;
  const value: TailValue | null = state.status === "ok" ? (isTailValue(state.value) ? state.value : { text: String(state.value ?? ""), size: String(state.value ?? "").length, truncated: false }) : null;
  const keep = Math.max(50, Math.min(5000, num(props.tail) ?? 1000));
  const lines = useMemo(() => {
    if (!value) return [];
    const all = logLines(normalizeEscapes(value.text));
    return all.length > keep ? all.slice(-keep) : all;
  }, [value?.text, keep]); // eslint-disable-line react-hooks/exhaustive-deps
  const clipped = value ? value.truncated || logLines(value.text).length > keep : false;

  // When did the text last change? Drives "updated 4 s ago".
  const now = useNow(1000);
  const last = useRef<{ text: string | null; at: number }>({ text: null, at: Date.now() });
  if (value && value.text !== last.current.text) last.current = { text: value.text, at: Date.now() };

  // Follow the end until the person scrolls up; pause there; offer a way back.
  const scroller = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  const pausedAt = useRef(0);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [lines, follow]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atEnd !== follow) {
      if (!atEnd) pausedAt.current = lines.length;
      setFollow(atEnd);
    }
  };
  const fresh = follow ? 0 : Math.max(0, lines.length - pausedAt.current);
  const height = Math.max(120, Math.min(900, num(props.height) ?? 320));
  const errors = useMemo(() => lines.filter((l) => ERROR_LINE.test(l)).length, [lines]);
  const quiet = now - last.current.at;
  const chip =
    state.status === "missing" ? (
      <LiveChip state="waiting">Waiting for the file</LiveChip>
    ) : state.status === "error" ? (
      <LiveChip state="error">Can't read</LiveChip>
    ) : !follow ? (
      <LiveChip state="paused">Paused</LiveChip>
    ) : (
      <LiveChip state="live">{sample ? "Sample" : quiet > 10_000 ? `Live, updated ${ago(quiet)}` : "Live"}</LiveChip>
    );
  const title = str(props.command) ? (
    <span className="text-muted-foreground">
      $ <span className="text-foreground">{str(props.command)}</span>
    </span>
  ) : (
    (str(props.title) ?? file?.split("/").pop())
  );

  return (
    <div className="min-w-0 overflow-hidden rounded-[10px] bg-muted/30 ring-1 ring-border">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
        <div className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">{title}</div>
        {errors ? <span className="shrink-0 tabular-nums text-destructive">{errors} error lines</span> : null}
        {value ? <span className="shrink-0 tabular-nums text-muted-foreground">{fmt(value.size, "bytes")}</span> : null}
        {chip}
      </div>
      <div className="relative">
        {state.status === "loading" ? (
          <Shimmer className="m-3 h-20" />
        ) : state.status === "missing" ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            Waiting for <span className="font-mono">{file}</span> to appear. Start the job with its output redirected there.
          </div>
        ) : state.status === "error" ? (
          <div className="px-3 py-4 text-xs text-destructive">{state.error}</div>
        ) : (
          <div ref={scroller} onScroll={onScroll} className="iris-scroll-x overflow-auto py-1.5 font-mono text-[12px] leading-[1.6]" style={{ maxHeight: height }} role="log" aria-live={follow ? "polite" : "off"} aria-label={`${str(props.command) ?? file ?? "log"} output`}>
            {clipped ? <div className="px-3 pb-1 text-[11px] text-muted-foreground">Earlier output is not shown; only the last {fmt(lines.length, "number")} lines.</div> : null}
            {lines.length ? null : <div className="px-3 py-3 text-xs text-muted-foreground">The file is empty so far.</div>}
            {lines.map((l, k) => (
              <div key={k} className={cn("flex px-3", props.wrap === true ? "min-w-0" : "min-w-max", ERROR_LINE.test(l) ? "bg-destructive/[0.07]" : WARN_LINE.test(l) ? "bg-[color:var(--warning)]/[0.06]" : "")}>
                {!clipped ? <span className="mr-3 w-8 shrink-0 select-none text-right text-muted-foreground/60 tabular-nums">{k + 1}</span> : null}
                <span className={props.wrap === true ? "min-w-0 whitespace-pre-wrap break-words" : "whitespace-pre"}>
                  {parseAnsi(l).map((sp, j) => (
                    <span key={j} style={{ color: sp.fg != null ? `var(--ansi-${sp.fg})` : undefined, fontWeight: sp.bold ? 600 : undefined, opacity: sp.dim ? 0.65 : undefined }}>
                      {sp.text}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
        {!follow ? (
          <button
            type="button"
            onClick={() => {
              setFollow(true);
              const el = scroller.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="absolute right-3 bottom-2 inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-medium shadow-[0_0_0_1px_var(--border),0_6px_16px_-8px_rgb(0_0_0/0.5)] hover:bg-state-hover"
          >
            <Glyph name="arrow-down" size={12} />
            {fresh ? `${fmt(fresh, "number")} new ${fresh === 1 ? "line" : "lines"}` : "Jump to latest"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------- LiveProgress ----------

/** The gallery's stand-in: a job that runs, finishes, and starts over. */
function useSampleProgress(on: boolean): FileState<unknown> {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setT((k) => (k >= 44 ? 0 : k + 1)), 700);
    return () => clearInterval(id);
  }, [on]);
  const done = Math.min(1200, Math.round(1200 * Math.min(1, t / 38) ** 0.9));
  return { status: "ok", value: { label: done >= 1200 ? "Photos migrated" : "Copying photos to the new library", done, total: 1200 } };
}

export function LiveProgressView({ props }: ViewProps) {
  const env = useEnv();
  const given = props.value !== undefined;
  const sample = !given && !env.threadId;
  const real = useLiveFile(given || sample ? undefined : str(props.file), false);
  const fake = useSampleProgress(sample);
  const state: FileState<unknown> = given ? (isPendingValue(props.value) ? { status: "loading" } : { status: "ok", value: props.value }) : sample ? fake : real;
  const tasks = state.status === "ok" ? readProgress(state.value) : [];
  const now = useNow(1000);

  // Samples of (time, done) per task for the rate and stall checks.
  const history = useRef(new Map<string, { at: number; done: number }[]>());
  const changed = useRef(new Map<string, number>());
  tasks.forEach((t, k) => {
    const key = `${k}:${t.label ?? ""}`;
    const h = history.current.get(key) ?? [];
    const lastDone = h[h.length - 1]?.done;
    if (lastDone !== t.done) {
      if (lastDone != null && t.done < lastDone) h.length = 0; // started over
      h.push({ at: Date.now(), done: t.done });
      if (h.length > 120) h.shift();
      history.current.set(key, h);
      changed.current.set(key, Date.now());
    }
  });

  if (state.status === "loading") return <Shimmer className="h-16" />;
  if (state.status === "missing")
    return (
      <div className="flex items-center gap-2 rounded-[10px] px-3 py-3 text-xs text-muted-foreground ring-1 ring-border">
        <LiveChip state="waiting">Waiting</LiveChip>
        <span>
          for <span className="font-mono">{str(props.file)}</span> to appear
        </span>
      </div>
    );
  if (state.status === "error") return <div className="text-xs text-destructive">{str(props.file)}: {state.error}</div>;
  if (!tasks.length) return <div className="text-xs text-muted-foreground">No progress in the file yet. It should hold {"{done, total, label?, eta?}"}.</div>;

  const stallAfter = Math.max(10, num(props.stallAfter) ?? 90) * 1000;
  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      {tasks.map((t, k) => {
        const key = `${k}:${t.label ?? ""}`;
        return <TaskBar key={key} task={t} big={k === 0} label={str(t.label) ?? (k === 0 ? str(props.label) : undefined)} unit={t.unit ?? str(props.unit)} samples={history.current.get(key) ?? []} quietFor={now - (changed.current.get(key) ?? now)} stallAfter={stallAfter} now={now} sample={sample && k === 0} />;
      })}
    </div>
  );
}

function TaskBar({ task, big, label, unit, samples, quietFor, stallAfter, now, sample }: { task: ProgressTask; big: boolean; label?: string; unit?: string; samples: { at: number; done: number }[]; quietFor: number; stallAfter: number; now: number; sample: boolean }) {
  const { palette } = useEnv();
  const known = task.total > 0;
  const pct = known ? Math.max(0, Math.min(1, task.done / task.total)) : 0;
  const status = task.status?.toLowerCase();
  const failed = status === "failed" || status === "error";
  const complete = !failed && (status === "done" || status === "complete" || status === "passed" || (known && task.done >= task.total));
  const stalled = !complete && !failed && quietFor > stallAfter;
  const speed = rate(samples);
  const given = etaSeconds(task.eta, now);
  const left = given ?? (speed && known ? (task.total - task.done) / speed : null);
  const color = failed ? palette.tone.bad : complete ? palette.tone.good : stalled ? palette.tone.warn : palette.series[0];
  const count = known ? `${fmt(task.done, "number")} of ${fmt(task.total, "number")}${unit ? ` ${unit}` : ""}` : `${fmt(task.done, "number")}${unit ? ` ${unit}` : ""}`;
  const detail = [count, speed && !complete ? `${fmt(Number(speed.toPrecision(3)), "number")}/s` : null, complete ? null : typeof task.eta === "string" && given == null ? task.eta : left != null ? `${formatEta(left)} left` : null].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-w-0 items-baseline gap-3">
        <div className={cn("min-w-0 flex-1 truncate", big ? "text-[13.5px] font-medium" : "text-[12.5px]")}>{label ?? (complete ? "Done" : "In progress")}</div>
        {complete ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium" style={{ color }}>
            <Glyph name="check" size={13} />
            Done
          </span>
        ) : failed ? (
          <span className="shrink-0 text-[12.5px] font-medium" style={{ color }}>
            Failed
          </span>
        ) : known ? (
          <span className={cn("shrink-0 font-semibold tabular-nums tracking-[-0.01em]", big ? "text-[20px] leading-none" : "text-[13px]")}>{Math.floor(pct * 100)}%</span>
        ) : null}
      </div>
      <div className={cn("relative overflow-hidden rounded-full bg-muted", big ? "h-2" : "h-1.5")} role="progressbar" aria-valuemin={0} aria-valuemax={known ? task.total : undefined} aria-valuenow={known ? task.done : undefined} aria-label={label ?? "Progress"}>
        {known ? (
          <div className={cn("iris-bar h-full rounded-full", !complete && !stalled && !failed && "iris-progress-run")} style={{ width: `${Math.max(pct * 100, task.done > 0 ? 1.5 : 0)}%`, background: color }} />
        ) : (
          <div className="iris-progress-indeterminate absolute inset-y-0 w-1/3 rounded-full" style={{ background: color }} />
        )}
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground tabular-nums">
        <span className="min-w-0 truncate">{detail}</span>
        {stalled ? <span style={{ color }}>No progress for {ago(quietFor).replace(" ago", "")}</span> : null}
        {sample ? <span className="ml-auto">Sample</span> : null}
      </div>
    </div>
  );
}
