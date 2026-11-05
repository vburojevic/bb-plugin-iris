// DevServers (chunk "codework"): the dev servers and ports an agent keeps in a
// file, re-read every 2 s while on screen. Ports open in the browser; a log
// opens in bb. In the gallery, with no thread, it shows a sample, marked so.

import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Chip, Glyph, Shimmer, cn, str, useEnv } from "@iris/ui";
import { useMemo, useRef } from "react";
import { type Proc, type ProcStatus, normalizeProcesses, uptime } from "../core/devservers";
import { isPendingValue } from "../core/evaluate";
import type { ViewProps } from "../ui/render";
import { Header, ICON_BTN, Problems, readFile, useNow } from "./codework-kit";

const SAMPLE = (now: number) => [
  { name: "web", pid: 48211, port: 3000, status: "running", command: "next dev --turbo", cpu: 3.2, mem: 412_000_000, started: now - 3 * 3600_000 - 12 * 60_000, log: "$BB_THREAD_STORAGE/web.log" },
  { name: "api", pid: 48230, ports: [8787, 9229], status: "running", command: "wrangler dev --inspect", cpu: 0.4, mem: 96_000_000, started: now - 3 * 3600_000 },
  { name: "storybook", pid: 48302, port: 6006, status: "starting", command: "storybook dev -p 6006", started: now - 14_000 },
  { name: "worker", pid: 48177, status: "crashed", command: "tsx watch src/worker.ts", note: "Error: Cannot find module './queue'", log: "$BB_THREAD_STORAGE/worker.log" },
];

const LOCAL_URL = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;
const ORDER: Record<ProcStatus, number> = { crashed: 0, starting: 1, running: 2, stopped: 3 };
const LABEL: Record<ProcStatus, string> = { running: "Running", starting: "Starting", stopped: "Stopped", crashed: "Crashed" };

function bytes(n: number): string {
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

export function DevServersView({ props }: ViewProps) {
  const env = useEnv();
  const navigate = useBbNavigate();
  const { palette } = env;
  const file = str(props.file);
  const inline = props.processes;
  const sample = !env.threadId && inline === undefined;
  const now = useNow(1000);
  const state = sample || inline !== undefined || !file ? null : readFile(env, file, { live: true });
  const source: unknown = sample ? SAMPLE(sampleEpoch(now)) : inline !== undefined ? inline : state?.status === "ok" ? state.value : undefined;
  const parsed = useMemo(() => (source === undefined || isPendingValue(source) ? null : normalizeProcesses(source)), [source]);

  // When did the list last change? Drives "updated 4 s ago".
  const last = useRef<{ key: string | null; at: number }>({ key: null, at: Date.now() });
  const key = parsed ? JSON.stringify(parsed.items) : null;
  if (key !== null && key !== last.current.key) last.current = { key, at: Date.now() };

  const tone = (s: ProcStatus) => (s === "running" ? palette.tone.good : s === "starting" ? palette.tone.warn : s === "crashed" ? palette.tone.bad : palette.tone.neutral);
  const title = str(props.title);

  if (!file && inline === undefined) return <Problems list={["needs a file, or processes"]} what="<DevServers>" />;
  if (state?.status === "error") return <Problems list={[state.error]} what="<DevServers>" />;
  if (isPendingValue(inline) || state?.status === "loading") return <Shimmer className="h-28" />;

  const items = [...(parsed?.items ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const counts = (Object.keys(LABEL) as ProcStatus[]).map((s) => [s, items.filter((p) => p.status === s).length] as const).filter(([, n]) => n);
  const missing = state?.status === "missing";
  // Port links are plain http to this machine, which the card's openUrl action
  // refuses, so they go to bb's browser directly; anything else still goes
  // through openUrl's https rule.
  const open = (url: string) => {
    if (LOCAL_URL.test(url)) navigate.openUrl(url);
    else env.perform([{ $iris: "action", kind: "openUrl", args: [url] }]);
  };

  return (
    <div className="@container flex min-w-0 flex-col gap-2.5">
      <Problems list={parsed?.problems ?? []} what="<DevServers>" />
      <Header
        title={title}
        right={
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
            {sample ? <Chip tone="neutral">Sample</Chip> : null}
            {counts.map(([s, n]) => (
              <span key={s} className="tabular-nums" style={s === "crashed" ? { color: palette.tone.bad } : undefined}>
                {n} {LABEL[s].toLowerCase()}
              </span>
            ))}
            {file && !sample ? (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className={cn("size-1.5 rounded-full", !missing && "iris-pulse")} style={{ background: missing ? palette.tone.neutral : palette.tone.good }} aria-hidden />
                {missing ? "Waiting for the file" : `Updated ${ago(now - last.current.at)}`}
              </span>
            ) : null}
          </div>
        }
      />
      {items.length === 0 ? (
        <div className="flex items-center gap-2 rounded-[10px] px-3 py-3 text-[13px] text-muted-foreground ring-1 ring-border">
          <Glyph name="server-off" size={15} />
          {missing ? `${file} doesn't exist yet` : "No dev servers running"}
        </div>
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-border overflow-hidden rounded-[10px] ring-1 ring-border" aria-label={title ?? "Dev servers"}>
          {items.map((p, k) => (
            <ProcRow key={`${p.pid ?? p.name}:${k}`} p={p} color={tone(p.status)} now={now} onOpen={open} onLog={(path) => env.perform([{ $iris: "action", kind: "openFile", args: [path, null] }])} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The gallery's start times stay put while its clock ticks. */
let sampleStart = 0;
function sampleEpoch(now: number): number {
  if (!sampleStart) sampleStart = now;
  return sampleStart;
}

function ProcRow({ p, color, now, onOpen, onLog }: { p: Proc; color: string; now: number; onOpen: (url: string) => void; onLog: (path: string) => void }) {
  const live = p.status === "running" || p.status === "starting";
  const facts = [p.pid != null ? `pid ${p.pid}` : null, p.cpu != null ? `${p.cpu.toFixed(p.cpu < 10 ? 1 : 0)}% CPU` : null, p.mem != null ? bytes(p.mem) : null, p.started != null && live ? `up ${uptime(now - p.started)}` : null].filter(Boolean);
  return (
    <li className="flex min-w-0 items-start gap-2.5 px-3 py-2">
      <span className="mt-[7px] flex size-2 shrink-0 items-center justify-center" title={LABEL[p.status]}>
        <span className={cn("size-2 rounded-full", p.status === "starting" && "iris-pulse")} style={{ background: color }} />
        <span className="sr-only">{LABEL[p.status]}</span>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-[13.5px] font-semibold">{p.name}</span>
          {p.ports.map((port, k) =>
            live && p.url ? (
              <button
                key={port}
                type="button"
                onClick={() => onOpen(k === 0 ? p.url! : p.url!.replace(/:\d+(?=\/|$)/, `:${port}`))}
                className="inline-flex items-center gap-1 rounded-full px-2 py-px font-mono text-[11.5px] ring-1 ring-border hover:bg-state-hover"
                title={`Open ${k === 0 ? p.url : `port ${port}`}`}
              >
                :{port}
                <Glyph name="arrow-up-right" size={11} className="text-muted-foreground" />
              </button>
            ) : (
              <span key={port} className="rounded-full px-2 py-px font-mono text-[11.5px] text-muted-foreground ring-1 ring-border">
                :{port}
              </span>
            ),
          )}
          {!p.ports.length && p.url && live ? (
            <button type="button" onClick={() => onOpen(p.url!)} className="truncate font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:underline">
              {p.url}
            </button>
          ) : null}
          {p.status !== "running" ? (
            <span className="text-[11.5px] font-medium" style={{ color }}>
              {LABEL[p.status]}
            </span>
          ) : null}
        </div>
        {p.command ? <div className="truncate font-mono text-[11.5px] text-muted-foreground" title={p.command}>{p.command}</div> : null}
        {facts.length ? <div className="text-[11.5px] tabular-nums text-muted-foreground @[520px]:hidden">{facts.join(" · ")}</div> : null}
        {p.note ? (
          <div className="mt-0.5 truncate font-mono text-[11.5px]" style={{ color: p.status === "crashed" ? color : undefined }} title={p.note}>
            {p.note}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {facts.length ? <span className="hidden text-right text-[11.5px] tabular-nums text-muted-foreground @[520px]:inline">{facts.join(" · ")}</span> : null}
        {p.log ? (
          <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => onLog(p.log!)} aria-label={`Open the log of ${p.name}`} title="Open log">
            <Glyph name="file-text" size={13} />
          </button>
        ) : null}
      </div>
    </li>
  );
}
