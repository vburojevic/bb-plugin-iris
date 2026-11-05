// Release (chunk "tools"): one card for a release, read from a JSON file the
// agent rewrites (re-read through the runtime's live refresh, like
// LiveProgress) or from inline data. Statuses map to tones in core/release.ts.
// In the gallery, with no thread, it shows a sample marked as such.

import { Chip, Glyph, InlineError, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useRef, type ReactNode } from "react";
import { IrisError, isPendingValue } from "../core/evaluate";
import { type ReleaseItem, type ReleaseModel, type ReleaseStatus, SAMPLE_RELEASE, normalizeRelease, overallStatus, platformIcon } from "../core/release";
import type { ViewProps } from "../ui/render";
import { useNow, useWidth } from "./tools-kit";

type FileState = { status: "loading" } | { status: "missing" } | { status: "error"; error: string } | { status: "ok"; value: unknown };

function useReleaseFile(path: string | undefined): FileState | null {
  const env = useEnv();
  if (!path) return null;
  try {
    const v = env.runtime.loadLive(path);
    if (isPendingValue(v)) return { status: "loading" };
    return { status: "ok", value: v };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/file not found/.test(message)) return { status: "missing" };
    return { status: "error", error: e instanceof IrisError ? message.replace(/^load\("[^"]*"\): /, "") : message };
  }
}

export function ReleaseView({ props }: ViewProps) {
  const env = useEnv();
  const inline = props.release;
  const file = str(props.file);
  const sample = !env.threadId && inline === undefined;
  const state = useReleaseFile(sample || inline !== undefined ? undefined : file);
  const sampleData = useMemo(() => ({ ...SAMPLE_RELEASE, updated: new Date(Date.now() - 4 * 60_000).toISOString() }), []);
  const data = sample ? sampleData : inline !== undefined ? inline : state?.status === "ok" ? state.value : undefined;
  const pendingInline = isPendingValue(inline);
  const parsed = useMemo(() => (data === undefined || pendingInline ? null : normalizeRelease(data)), [data, pendingInline]);

  // When did the file last change? Drives "updated 4 s ago" for files without their own time.
  const now = useNow(5000);
  const last = useRef<{ print: string | null; at: number }>({ print: null, at: Date.now() });
  const print = data === undefined ? null : JSON.stringify(data);
  if (print !== last.current.print) last.current = { print, at: Date.now() };

  if (!sample && inline === undefined && !file) return <InlineError error={new Error("needs file (a JSON file you keep current) or release (the data)")} context="<Release>" />;
  if (pendingInline || state?.status === "loading") return <Shimmer className="h-56" />;
  if (state?.status === "missing")
    return (
      <div className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
        <span className="iris-pulse size-1.5 rounded-full" style={{ background: env.palette.tone.neutral }} aria-hidden />
        Waiting for {file?.split("/").pop()}
      </div>
    );
  if (state?.status === "error") return <InlineError error={new Error(state.error)} context="<Release>" />;
  if (!parsed) return <Shimmer className="h-56" />;
  return <Dashboard model={parsed.model} problems={parsed.problems} title={str(props.title)} sample={sample} live={!!file && inline === undefined && !sample} changedAt={last.current.at} now={now} />;
}

function Dashboard({ model, problems, title, sample, live, changedAt, now }: { model: ReleaseModel; problems: string[]; title?: string; sample: boolean; live: boolean; changedAt: number; now: number }) {
  const { palette } = useEnv();
  const [box, width] = useWidth<HTMLDivElement>();
  const wide = width >= 520;
  const overall = overallStatus(model);
  const updatedAt = model.updated ? Date.parse(model.updated) : NaN;
  const updated = Number.isFinite(updatedAt) ? `Updated ${ago(now - updatedAt)}` : model.updated ? `Updated ${model.updated}` : live ? `Changed ${ago(now - changedAt)}` : null;
  const name = title ?? model.app;
  return (
    <div ref={box} className="min-w-0">
      {problems.length ? <InlineError error={new Error(`${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`)} context="<Release>" /> : null}
      <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          {name ? <div className="truncate text-[12.5px] text-muted-foreground">{name}</div> : null}
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            {model.version ? <span className="text-[26px] font-semibold leading-tight tracking-[-0.025em] tabular-nums">{model.version}</span> : null}
            {model.build ? <span className={cn("tabular-nums", model.version ? "text-[14px] text-muted-foreground" : "text-[26px] font-semibold")}>{model.version ? `build ${model.build}` : model.build}</span> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {model.channel ? <Chip icon="send">{model.channel}</Chip> : null}
            {model.commit ? <span className="font-mono text-[11.5px] text-muted-foreground">{model.commit.slice(0, 10)}</span> : null}
            {sample ? <Chip variant="outline">Sample</Chip> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <StatusPill status={overall} large />
          {updated ? (
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {live ? <span className="iris-pulse size-1.5 rounded-full" style={{ background: palette.tone.good }} aria-hidden /> : null}
              {updated}
            </span>
          ) : null}
        </div>
      </div>
      {model.progress ? (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11.5px] text-muted-foreground">
            <span>{model.progress.label ?? "Progress"}</span>
            <span className="tabular-nums">
              {model.progress.done} of {model.progress.total}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="iris-bar h-full rounded-full" style={{ width: `${(model.progress.done / model.progress.total) * 100}%`, background: palette.accent }} />
          </div>
        </div>
      ) : null}
      {model.blockers.length ? (
        <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: `color-mix(in oklab, ${palette.tone.bad} 9%, transparent)`, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${palette.tone.bad} 30%, transparent)` }}>
          <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: palette.tone.bad }}>
            <Glyph name="octagon-alert" size={14} />
            {model.blockers.length === 1 ? "1 blocker" : `${model.blockers.length} blockers`}
          </div>
          <ul className="mt-1 space-y-1">
            {model.blockers.map((b, k) => (
              <li key={k} className="min-w-0 text-[13px]">
                <span className="font-medium">{b.title}</span>
                {b.owner ? <span className="text-muted-foreground"> · {b.owner}</span> : null}
                {b.detail ? <div className="text-[12px] text-muted-foreground">{b.detail}</div> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {model.platforms.length ? (
        <Section title="Platforms">
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${wide ? 9.5 : 8.5}rem, 1fr))` }}>
            {model.platforms.map((p, k) => (
              <div key={k} className="min-w-0 rounded-xl px-2.5 py-2 ring-1 ring-border">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Glyph name={platformIcon(p.name, p.icon)} size={14} className="text-muted-foreground" />
                  <span className="truncate text-[13px] font-medium">{p.name}</span>
                </div>
                <div className="mt-1.5">{p.status ? <StatusPill status={p.status} /> : null}</div>
                {p.build || p.version || p.detail ? <div className="mt-1 truncate text-[11.5px] text-muted-foreground">{[p.version, p.build ? `build ${p.build}` : undefined, p.detail].filter(Boolean).join(" · ")}</div> : null}
              </div>
            ))}
          </div>
        </Section>
      ) : null}
      {model.checks.length || model.store.length ? (
        <div className={cn("min-w-0", wide && model.checks.length && model.store.length ? "grid grid-cols-2 gap-x-5" : "")}>
          {model.checks.length ? (
            <Section title={`Checks${summary(model.checks)}`}>
              <ItemList items={model.checks} />
            </Section>
          ) : null}
          {model.store.length ? (
            <Section title="Distribution">
              <ItemList items={model.store} />
            </Section>
          ) : null}
        </div>
      ) : null}
      {model.timeline.length ? (
        <Section title="Timeline">
          <ol className="min-w-0">
            {model.timeline.map((e, k) => {
              const color = e.tone ? palette.tone[e.tone] : "var(--muted-foreground)";
              const running = e.tone === "info" && k === model.timeline.length - 1;
              return (
                <li key={k} className="relative grid grid-cols-[3.25rem_0.75rem_minmax(0,1fr)] gap-x-2.5 pb-2 last:pb-0">
                  <time className="pt-px text-right text-[11.5px] tabular-nums text-muted-foreground">{e.time ?? ""}</time>
                  <span className="relative flex justify-center">
                    <span className={cn("relative z-[1] mt-[5px] size-2 rounded-full ring-[3px] ring-card", running && "iris-pulse")} style={{ background: color }} />
                    {k < model.timeline.length - 1 ? <span className="absolute top-3 bottom-[-0.5rem] w-px bg-border" /> : null}
                  </span>
                  <div className="min-w-0 text-[13px]">
                    {e.title}
                    {e.detail ? <div className="text-[12px] text-muted-foreground">{e.detail}</div> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}
      {model.notes ? <div className="mt-3 text-[12.5px] text-muted-foreground">{model.notes}</div> : null}
    </div>
  );
}

function summary(items: ReleaseItem[]): string {
  const passed = items.filter((i) => i.status?.tone === "good").length;
  return ` · ${passed} of ${items.length} passed`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-3.5 min-w-0">
      <div className="mb-1.5 text-[11.5px] font-medium text-muted-foreground">{title}</div>
      {children}
    </section>
  );
}

function StatusPill({ status, large }: { status: ReleaseStatus; large?: boolean }) {
  const { palette } = useEnv();
  const color = palette.tone[status.tone];
  return (
    <span
      className={cn("inline-flex max-w-full items-center gap-1.5 truncate rounded-full font-medium", large ? "h-6 px-2.5 text-[12.5px]" : "h-5 px-2 text-[11.5px]")}
      style={{ background: `color-mix(in oklab, ${color} 14%, transparent)`, color: status.tone === "neutral" ? "var(--muted-foreground)" : color }}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", status.running && "iris-pulse")} style={{ background: color }} aria-hidden />
      <span className="truncate">{status.label}</span>
    </span>
  );
}

const MARK: Record<string, string> = { good: "circle-check", bad: "circle-x", warn: "clock", info: "loader-circle", neutral: "circle-dashed" };

function ItemList({ items }: { items: ReleaseItem[] }) {
  const env = useEnv();
  const { palette } = env;
  return (
    <ul className="min-w-0 [&>li+li]:border-t [&>li+li]:border-border/60">
      {items.map((i, k) => {
        const tone = i.status?.tone ?? "neutral";
        const body = (
          <>
            <Glyph name={MARK[tone]} size={15} color={palette.tone[tone]} className={cn("mt-px", i.status?.running && tone === "info" && "animate-spin [animation-duration:2.4s] motion-reduce:animate-none")} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px]">{i.name}</div>
              {i.detail ? <div className="truncate text-[11.5px] text-muted-foreground">{i.detail}</div> : null}
            </div>
            {i.status ? (
              <span className="shrink-0 text-[11.5px]" style={{ color: tone === "neutral" ? "var(--muted-foreground)" : palette.tone[tone] }}>
                {i.status.label}
              </span>
            ) : null}
          </>
        );
        return (
          <li key={k} className="min-w-0">
            {i.url ? (
              <button type="button" onClick={() => env.perform([{ $iris: "action", kind: "openUrl", args: [i.url] }])} className="flex w-full min-w-0 items-start gap-2 rounded-md py-1.5 text-left hover:bg-state-hover">
                {body}
              </button>
            ) : (
              <div className="flex min-w-0 items-start gap-2 py-1.5">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
