// Live project components: Changes, Commits, PullRequest, Environments and
// Threads read the card's own thread from bb and read again when bb announces
// a change they show;
// Pipeline draws a CI run it is given. In the gallery (no thread) the live
// ones draw sample data, marked as such.
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { defineRpcContract as DefineRpcContract } from "@get-bb/plugin-sdk";
import { experimental_Diff as HostDiff, experimental_useRpcKeyedQuery, useBbNavigate, useRpc, useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { isPendingValue } from "../../core/evaluate";
import { environmentChangeMatters, projectChangeMatters, threadChangeMatters, type LiveWatch } from "../../core/live-events";
import { formatValue } from "../../core/format";
import { normalizePipeline, pipelineCounts, type PipelineJob, type PipelineRun, type PipelineStatus } from "../../core/pipeline";
import {
  RUNNING,
  failure,
  parseChangesTarget,
  parseCommitLimit,
  parsePathFilter,
  parseThreadIds,
  targetKey,
  type ChangedFile,
  type ChangesResult,
  type ChangesTarget,
  type ChecksState,
  type CommitInfo,
  type EnvironmentInfo,
  type FilePatch,
  type ProjectFailure,
  type PullRequestInfo,
  type ThreadInfo,
  type ThreadStatus,
} from "../../core/project";
import type { RpcContract } from "../../shared/rpc";
import { useEnv } from "../env";
import type { Tone } from "../palette";
import type { ViewProps } from "../render";
import { Chip, Glyph, Shimmer, cn, str } from "./kit";
import { sampleChanges, sampleCommits, sampleEnvironments, samplePullRequest, sampleThreads } from "./live-samples";

// ---------- reading ----------

interface Live<T> {
  data: T | null;
  error: string | null;
  busy: boolean;
  sample: boolean;
  refresh: () => void;
  at: number | null;
  ref: RefObject<HTMLDivElement | null>;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// The one read of bb's GitHub PR Status plugin a card holds: while it is held, bb keeps that
// environment's pull request fresh from GitHub and says when it changed.
// bb gives the frontend bundle only "@get-bb/plugin-sdk/app" at install, and a git install skips
// devDependencies, so a runtime import of the SDK root fails to resolve there. defineRpcContract
// only returns its argument; this keeps its types without the import.
const defineRpcContract: typeof DefineRpcContract = (contract) => contract as never;
const prStatus = defineRpcContract({
  pullRequests: {
    input: z.object({ keys: z.array(z.string()) }),
    output: z.record(z.string(), z.unknown()),
  },
});
const NO_KEYS: string[] = [];

/** Shortest gap between two reads of one card, so a burst of edits reads once. */
const MIN_GAP_MS = 1000;
/** How long a card waits for more events before it reads. */
const SETTLE_MS = 250;
/** How often an idle card on screen redraws, so "2 minutes ago" stays true. No read. */
const CLOCK_MS = 30_000;

/**
 * Reads once, then again whenever bb announces a change the card shows (see `watchOf`), while
 * the card is on screen and the window is visible. A change seen while hidden reads on return.
 * A null `watchOf` reads once (a commit never changes). Without a thread (the gallery) it shows
 * `sample`.
 */
function useLive<T>(key: string, load: (threadId: string) => Promise<T>, sample: () => T, watchOf: ((data: T | null) => LiveWatch) | null): Live<T> {
  const { threadId } = useEnv();
  const sdk = useSdk();
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null; at: number | null }>(() => ({ key, data: threadId ? null : sample(), error: null, at: null }));
  const [busy, setBusy] = useState(false);
  const [, setClock] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);
  /** The read in flight, by its seq number; 0 when none. */
  const inFlight = useRef(0);
  // A change marks the card stale; a stale card on screen reads again, at most once a second.
  const stale = useRef(false);
  const onScreen = useRef(true);
  const lastRead = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pokeRef = useRef<() => void>(() => {});

  const refresh = useCallback(() => {
    if (!threadId) return;
    const n = ++seq.current;
    inFlight.current = n;
    lastRead.current = Date.now();
    setBusy(true);
    const settle = () => {
      if (inFlight.current === n) inFlight.current = 0;
      // Changes that arrived during the read get their own read.
      if (stale.current) pokeRef.current();
    };
    loadRef.current(threadId).then(
      (data) => {
        if (n !== seq.current) return;
        setState({ key, data, error: null, at: Date.now() });
        setBusy(false);
        settle();
      },
      (e: unknown) => {
        if (n !== seq.current) return;
        setState((s) => ({ key, data: s.key === key ? s.data : null, error: errorText(e), at: Date.now() }));
        setBusy(false);
        settle();
      },
    );
  }, [threadId, key]);

  const poke = useCallback(() => {
    stale.current = true;
    if (!onScreen.current || document.visibilityState !== "visible" || timer.current !== undefined || inFlight.current !== 0) return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      if (!stale.current || !onScreen.current || document.visibilityState !== "visible" || inFlight.current !== 0) return;
      stale.current = false;
      refresh();
    }, Math.max(SETTLE_MS, lastRead.current + MIN_GAP_MS - Date.now()));
  }, [refresh]);
  pokeRef.current = poke;

  const fresh = state.key === key;
  const data = fresh ? state.data : null;
  const watchRef = useRef<LiveWatch>({});
  watchRef.current = threadId && watchOf ? withOwnThread(watchOf(data), threadId) : {};

  useEffect(() => {
    if (!threadId) return;
    stale.current = false;
    refresh();
    const el = ref.current;
    const io =
      el && typeof IntersectionObserver !== "undefined"
        ? new IntersectionObserver((entries) => {
            onScreen.current = entries.some((e) => e.isIntersecting);
            if (onScreen.current && stale.current) poke();
          })
        : null;
    if (io && el) io.observe(el);
    const onVisible = () => {
      if (document.visibilityState === "visible" && stale.current) poke();
    };
    document.addEventListener("visibilitychange", onVisible);
    const clock = setInterval(() => {
      if (onScreen.current && document.visibilityState === "visible") setClock((c) => c + 1);
    }, CLOCK_MS);
    return () => {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(clock);
      clearTimeout(timer.current);
      timer.current = undefined;
      inFlight.current = 0;
      seq.current++;
    };
  }, [threadId, refresh, poke]);

  // bb's realtime events. A reconnect may have missed some, so it reads again too.
  const follows = threadId !== null && watchOf !== null;
  useEffect(() => {
    if (!follows) return;
    const offs = [
      sdk.subscribe({ event: "thread:changed", callback: (e) => threadChangeMatters(watchRef.current, e) && poke() }),
      sdk.subscribe({ event: "environment:changed", callback: (e) => environmentChangeMatters(watchRef.current, e) && poke() }),
      sdk.subscribe({ event: "project:changed", callback: (e) => projectChangeMatters(watchRef.current, e) && poke() }),
      sdk.subscribe({ event: "realtime:connection", callback: (e) => e.state === "connected" && e.reconnected && poke() }),
    ];
    return () => offs.forEach((off) => off());
  }, [follows, sdk, poke]);

  // Pull requests change on GitHub, not in bb: hold bb's own read so bb keeps them fresh, and read
  // again when it says one changed.
  const prList = watchRef.current.pullRequests;
  const prKeys = prList?.length ? [...prList].sort() : NO_KEYS;
  const pr = experimental_useRpcKeyedQuery({ pluginId: "bb--github-pr-status", contract: prStatus, method: "pullRequests", keys: prKeys, enabled: prKeys.length > 0 });
  const prSeen = prKeys.length && pr.data ? JSON.stringify(prKeys.map((k) => pr.data?.[k] ?? null)) : null;
  const prLast = useRef<string | null>(null);
  useEffect(() => {
    if (prSeen === null) return;
    if (prLast.current !== null && prLast.current !== prSeen) poke();
    prLast.current = prSeen;
  }, [prSeen, poke]);

  return { data, error: fresh ? state.error : null, busy, sample: !threadId, refresh, at: state.at, ref };
}

/** Every card follows its own thread: an environment attached later, a turn that ends. */
function withOwnThread(watch: LiveWatch, threadId: string): LiveWatch {
  return { ...watch, threads: [threadId, ...(watch.threads ?? [])] };
}

// ---------- shared pieces ----------

function Head({ icon, title, detail, live, right }: { icon: string; title: ReactNode; detail?: ReactNode; live: Live<unknown>; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Glyph name={icon} size={15} className="text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
        <span className="min-w-0 truncate text-[13px] font-medium">{title}</span>
        {detail ? <span className="min-w-0 truncate text-xs text-muted-foreground">{detail}</span> : null}
      </div>
      {right}
      {live.sample ? (
        <Chip>Sample</Chip>
      ) : (
        <button
          type="button"
          onClick={live.refresh}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Refresh"
          title={live.at ? `Read ${formatValue(live.at, "time")}. Reads again while on screen.` : "Refresh"}
        >
          <Glyph name="refresh-cw" size={13} className={cn(live.busy && "iris-spin")} />
        </button>
      )}
    </div>
  );
}

const PROBLEM_TEXT: Partial<Record<ProjectFailure["reason"], string>> = {
  "no-thread": "This card reads its thread's project, but bb has no such thread.",
  "no-environment": "This thread has no environment, so there is no checkout to read.",
  "not-git": "This thread's environment isn't a git checkout.",
};

function Problem({ error, failure }: { error?: string | null; failure?: ProjectFailure }) {
  const text = failure ? (PROBLEM_TEXT[failure.reason] ?? failure.error) : error;
  return (
    <div className="mt-2 flex items-start gap-2 text-[13px] text-muted-foreground">
      <Glyph name="circle-alert" size={15} className="mt-px" />
      <span className="min-w-0">{text}</span>
    </div>
  );
}

function Quiet({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="mt-2 flex items-center gap-2 text-[13px] text-muted-foreground">
      <Glyph name={icon} size={15} />
      {children}
    </div>
  );
}

function ShowMore({ hidden, onClick, noun }: { hidden: number; onClick: () => void; noun: string }) {
  if (hidden <= 0) return null;
  return (
    <button type="button" onClick={onClick} className="mt-1 text-xs text-muted-foreground hover:text-foreground">
      Show {hidden} more {noun}
    </button>
  );
}

function ago(ms: number | null | undefined): string {
  return ms ? formatValue(ms, "relative") : "";
}

function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11.5px] tabular-nums">
      <span style={{ color: "var(--diff-added, var(--success))" }}>+{additions.toLocaleString("en-US")}</span>
      <span style={{ color: "var(--diff-removed, var(--destructive))" }}>−{deletions.toLocaleString("en-US")}</span>
    </span>
  );
}

/** Five blocks showing the share of added and removed lines, as code review tools draw it. */
function Ratio({ additions, deletions }: { additions: number; deletions: number }) {
  const total = additions + deletions;
  const added = total ? Math.round((additions / total) * 5) : 0;
  const removed = total ? Math.min(5 - added, Math.max(deletions ? 1 : 0, Math.round((deletions / total) * 5))) : 0;
  return (
    <span className="inline-flex shrink-0 gap-px" aria-hidden>
      {Array.from({ length: 5 }, (_, k) => (
        <span
          key={k}
          className="size-[7px] rounded-[1.5px]"
          style={{ background: k < added ? "var(--diff-added, var(--success))" : k < added + removed ? "var(--diff-removed, var(--destructive))" : "var(--border)" }}
        />
      ))}
    </span>
  );
}

function PathText({ path, previous }: { path: string; previous?: string | null }) {
  const cut = path.lastIndexOf("/");
  return (
    <span className="min-w-0 truncate font-mono text-[12px]" title={previous ? `${previous} → ${path}` : path}>
      {previous ? <span className="text-muted-foreground">{previous} → </span> : null}
      {cut >= 0 ? <span className="text-muted-foreground">{path.slice(0, cut + 1)}</span> : null}
      {path.slice(cut + 1)}
    </span>
  );
}

// ---------- Changes ----------

const KIND_ICON: Record<ChangedFile["kind"], string> = {
  added: "file-plus",
  deleted: "file-minus",
  renamed: "file-symlink",
  copied: "file-symlink",
  modified: "file-diff",
  type_changed: "file-diff",
};

const FILE_CAP = 30;

function scopeLine(r: Extract<ChangesResult, { ok: true }>): { title: string; detail: string } {
  const s = r.scope;
  if (s.kind === "commit") return { title: s.subject ?? `Commit ${s.sha?.slice(0, 7)}`, detail: s.subject ? (s.sha?.slice(0, 7) ?? "") : "" };
  if (s.kind === "uncommitted") return { title: "Uncommitted changes", detail: s.branch ? `on ${s.branch}` : "" };
  if (s.onBase) return { title: s.branch ?? "Changes", detail: "uncommitted work on the base branch" };
  if (s.noBase) return { title: s.branch ?? "Changes", detail: `uncommitted work only; bb found no merge base with ${s.base ?? "the default branch"}` };
  return { title: s.branch ?? "Detached checkout", detail: s.base ? `against ${s.base}, uncommitted included` : "" };
}

export function ChangesView({ props }: ViewProps) {
  const parsedTarget = parseChangesTarget(props.target);
  const parsedPaths = parsePathFilter(props.paths);
  if (!parsedTarget.ok || !parsedPaths.ok) return <Problem error={!parsedTarget.ok ? parsedTarget.error : !parsedPaths.ok ? parsedPaths.error : ""} />;
  return <ChangesBody target={parsedTarget.value} paths={parsedPaths.value} title={str(props.title)} open={props.open === true ? true : props.open === false ? false : undefined} />;
}

function ChangesBody({ target, paths, title, open, nested }: { target: ChangesTarget; paths: string[] | null; title?: string; open?: boolean; nested?: boolean }) {
  const rpc = useRpc<RpcContract>();
  const wire = targetKey(target);
  const key = JSON.stringify([wire, paths]);
  // A commit never changes; read it once.
  const live = useLive(
    key,
    (threadId) => rpc.call("project_changes", { threadId, target: wire, paths }),
    () => sampleChanges(target.kind === "commit" ? target.sha : null),
    target.kind === "commit" ? null : (r) => ({ environments: r?.ok ? [r.environmentId] : [] }),
  );
  const [all, setAll] = useState(false);
  const r = live.data;
  if (!r) return <div ref={live.ref}>{live.error ? <Problem error={live.error} /> : <Shimmer className="h-24" />}</div>;
  if (!r.ok) {
    return (
      <div ref={live.ref}>
        {nested ? null : <Head icon="git-branch" title={title ?? "Changes"} live={live} />}
        <Problem failure={r} />
      </div>
    );
  }
  const line = scopeLine(r);
  const additions = r.files.reduce((s, f) => s + f.additions, 0);
  const deletions = r.files.reduce((s, f) => s + f.deletions, 0);
  const shown = all ? r.files : r.files.slice(0, FILE_CAP);
  const openAll = open ?? r.files.length === 1;
  return (
    <div ref={live.ref} className="min-w-0">
      {nested ? null : (
        <Head
          icon={target.kind === "commit" ? "git-commit-horizontal" : "git-branch"}
          title={title ?? line.title}
          detail={title ? `${line.title} ${line.detail}` : line.detail}
          live={live}
          right={r.files.length ? <Counts additions={additions} deletions={deletions} /> : null}
        />
      )}
      <div className={cn("text-xs text-muted-foreground", nested ? "mt-0" : "mt-1")}>
        {r.files.length.toLocaleString("en-US")} {r.files.length === 1 ? "file" : "files"} changed
        {paths ? ` matching ${paths.join(", ")}` : ""}
        {paths && r.totalFiles > r.files.length ? ` (${r.totalFiles} in all)` : ""}
        {r.truncated ? ". bb cut the list short" : ""}
      </div>
      {r.files.length ? (
        <ul className="mt-2 overflow-hidden rounded-[10px] ring-1 ring-border [&>li+li]:border-t [&>li+li]:border-border">
          {shown.map((f) => (
            <FileRow key={f.path} file={f} patch={r.patches[f.path] ?? null} target={target} sample={live.sample} startOpen={openAll} />
          ))}
        </ul>
      ) : (
        <Quiet icon="circle-check">{paths ? "No changed files match" : "Nothing changed yet"}</Quiet>
      )}
      <ShowMore hidden={all ? 0 : r.files.length - shown.length} onClick={() => setAll(true)} noun="files" />
    </div>
  );
}

function FileRow({ file, patch, target, sample, startOpen }: { file: ChangedFile; patch: FilePatch | null; target: ChangesTarget; sample: boolean; startOpen: boolean }) {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const [open, setOpen] = useState(startOpen && !file.binary && !file.tooLarge);
  // A patch read on demand belongs to one revision; a newer revision reads it again.
  const [read, setRead] = useState<{ revision: string; patch: FilePatch | null; error: string | null } | null>(null);
  const loaded = read && read.revision === file.revision ? read : null;
  const diffable = !file.binary && !file.tooLarge;
  const have = patch ?? loaded?.patch ?? null;
  const wire = targetKey(target);

  useEffect(() => {
    if (!open || have || loaded || !diffable || sample || !env.threadId) return;
    let live = true;
    const revision = file.revision;
    rpc.call("project_patch", { threadId: env.threadId, target: wire, path: file.path, revision }).then(
      (r) => live && setRead(r.ok ? { revision, patch: r.patch, error: null } : { revision, patch: null, error: r.error }),
      (e: unknown) => live && setRead({ revision, patch: null, error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [open, have, loaded, diffable, sample, env.threadId, rpc, wire, file.path, file.revision]);

  const openFile = () => env.perform([{ $iris: "action", kind: "openFile", args: [file.path, null] }]);
  return (
    <li className="min-w-0">
      <div className="group flex min-w-0 items-center gap-2 px-2.5 py-1.5 hover:bg-muted/40">
        <button type="button" onClick={() => diffable && setOpen(!open)} disabled={!diffable} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default" aria-expanded={open}>
          <Glyph name="chevron-right" size={13} className={cn("text-muted-foreground transition-transform", open && "rotate-90", !diffable && "opacity-0")} />
          <Glyph name={KIND_ICON[file.kind]} size={14} className="text-muted-foreground" />
          <PathText path={file.path} previous={file.kind === "renamed" ? file.previousPath : null} />
          {file.untracked ? <Chip>new</Chip> : null}
        </button>
        {file.binary ? <span className="text-xs text-muted-foreground">binary</span> : <Counts additions={file.additions} deletions={file.deletions} />}
        <Ratio additions={file.additions} deletions={file.deletions} />
        {file.kind !== "deleted" ? (
          <button type="button" onClick={openFile} className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Open ${file.path}`}>
            <Glyph name="external-link" size={13} />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="min-w-0 border-t border-border bg-muted/20 text-[12.5px]">
          {have ? (
            <>
              <HostDiff patch={have.patch} path={file.path} view="unified" overflow="scroll" />
              {have.truncated ? <div className="px-3 py-1.5 text-xs text-muted-foreground">The diff is cut short; open the file for the rest.</div> : null}
            </>
          ) : loaded?.error ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">{loaded.error}</div>
          ) : sample ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No diff in the sample.</div>
          ) : (
            <Shimmer className="m-2.5 h-16" />
          )}
        </div>
      ) : null}
      {file.tooLarge ? <div className="px-2.5 pb-1.5 pl-[52px] text-xs text-muted-foreground">Too large to diff here</div> : null}
    </li>
  );
}

// ---------- Commits ----------

export function CommitsView({ props }: ViewProps) {
  const rpc = useRpc<RpcContract>();
  const limit = parseCommitLimit(props.limit);
  const live = useLive("commits", (threadId) => rpc.call("project_commits", { threadId }), sampleCommits, (r) => ({ environments: r?.ok ? [r.environmentId] : [] }));
  const [all, setAll] = useState(false);
  const r = live.data;
  if (!r) return <div ref={live.ref}>{live.error ? <Problem error={live.error} /> : <Shimmer className="h-24" />}</div>;
  if (!r.ok) {
    return (
      <div ref={live.ref}>
        <Head icon="git-commit-horizontal" title={str(props.title) ?? "Commits"} live={live} />
        <Problem failure={r} />
      </div>
    );
  }
  const shown = all ? r.commits : r.commits.slice(0, limit);
  const ahead = r.ahead ?? r.commits.length;
  const detail = r.onBase
    ? "this is the base branch"
    : r.noBase
      ? `bb found no merge base with ${r.base ?? "the default branch"}`
      : [r.base ? `${ahead} ${ahead === 1 ? "commit" : "commits"} ahead of ${r.base}` : null, r.behind ? `${r.behind} behind` : null].filter(Boolean).join(", ");
  return (
    <div ref={live.ref} className="min-w-0">
      <Head icon="git-commit-horizontal" title={str(props.title) ?? r.branch ?? "Detached checkout"} detail={detail} live={live} />
      {r.onBase ? (
        <Quiet icon="git-branch">Commits shows a branch's own commits; this checkout is on {r.base}.</Quiet>
      ) : r.noBase ? (
        <Quiet icon="git-branch">The base branch isn't fetched in this checkout, so the branch's own commits are unknown.</Quiet>
      ) : shown.length ? (
        <ol className="mt-2 overflow-hidden rounded-[10px] ring-1 ring-border [&>li+li]:border-t [&>li+li]:border-border">
          {shown.map((c) => (
            <CommitRow key={c.sha} commit={c} />
          ))}
        </ol>
      ) : (
        <Quiet icon="git-commit-horizontal">No commits on this branch yet</Quiet>
      )}
      <ShowMore hidden={all || r.onBase ? 0 : r.commits.length - shown.length} onClick={() => setAll(true)} noun="commits" />
    </div>
  );
}

function CommitRow({ commit }: { commit: CommitInfo }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="min-w-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full min-w-0 items-center gap-2.5 px-2.5 py-1.5 text-left hover:bg-muted/40" aria-expanded={open}>
        <Glyph name="chevron-right" size={13} className={cn("text-muted-foreground transition-transform", open && "rotate-90")} />
        <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground @max-lg/iris:hidden">{commit.shortSha}</span>
        {/* On a phone the subject takes the row and the sha and time sit under it. */}
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] @max-lg/iris:line-clamp-2 @lg/iris:truncate">{commit.subject}</span>
          <span className="block font-mono text-[11px] text-muted-foreground @lg/iris:hidden">
            {commit.shortSha} · <span className="font-sans">{ago(commit.authoredAt)}</span>
          </span>
        </span>
        <span className="hidden w-28 shrink-0 truncate text-xs text-muted-foreground @lg/iris:inline">{commit.author}</span>
        <span className="hidden w-[6.5rem] shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground @lg/iris:inline" title={formatValue(commit.authoredAt, "datetime")}>
          {ago(commit.authoredAt)}
        </span>
      </button>
      {open ? (
        <div className="border-t border-border bg-muted/20 px-2.5 py-2">
          <ChangesBody target={{ kind: "commit", sha: commit.sha }} paths={null} nested />
        </div>
      ) : null}
    </li>
  );
}

// ---------- PullRequest ----------

const PR_STATE: Record<PullRequestInfo["state"], { label: string; tone: Tone; icon: string }> = {
  open: { label: "Open", tone: "good", icon: "git-pull-request" },
  draft: { label: "Draft", tone: "neutral", icon: "git-pull-request-draft" },
  merged: { label: "Merged", tone: "info", icon: "git-merge" },
  closed: { label: "Closed", tone: "bad", icon: "git-pull-request-closed" },
};

const CHECKS: Record<ChecksState, { label: string; tone: Tone; icon: string }> = {
  passing: { label: "Checks passing", tone: "good", icon: "circle-check" },
  failing: { label: "Checks failing", tone: "bad", icon: "circle-x" },
  pending: { label: "Checks running", tone: "warn", icon: "circle-dashed" },
  no_checks: { label: "No checks", tone: "neutral", icon: "circle-minus" },
  unknown: { label: "Checks unknown", tone: "neutral", icon: "circle-minus" },
};

const REVIEW: Record<PullRequestInfo["review"]["state"], { label: string; tone: Tone; icon: string }> = {
  approved: { label: "Approved", tone: "good", icon: "circle-check" },
  changes_requested: { label: "Changes requested", tone: "bad", icon: "circle-x" },
  review_required: { label: "Review required", tone: "warn", icon: "circle-dashed" },
  review_requested: { label: "Review requested", tone: "warn", icon: "circle-dashed" },
  none: { label: "No review needed", tone: "neutral", icon: "circle-minus" },
};

const MERGE: Record<PullRequestInfo["mergeability"], { label: string; tone: Tone; icon: string }> = {
  mergeable: { label: "No conflicts", tone: "good", icon: "circle-check" },
  conflicts: { label: "Has conflicts", tone: "bad", icon: "circle-x" },
  blocked: { label: "Blocked", tone: "warn", icon: "circle-minus" },
  draft: { label: "Draft", tone: "neutral", icon: "circle-minus" },
  unknown: { label: "Mergeability unknown", tone: "neutral", icon: "circle-minus" },
};

export function PullRequestView() {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const live = useLive("pr", (threadId) => rpc.call("project_pull_request", { threadId }), samplePullRequest, (r) => (r?.ok ? { environments: [r.environmentId], pullRequests: [r.environmentId] } : {}));
  const r = live.data;
  if (!r) return <div ref={live.ref}>{live.error ? <Problem error={live.error} /> : <Shimmer className="h-24" />}</div>;
  if (!r.ok || !r.pullRequest) {
    return (
      <div ref={live.ref}>
        <Head icon="git-pull-request" title="Pull request" detail={r.ok ? (r.branch ?? undefined) : undefined} live={live} />
        {!r.ok ? <Problem failure={r} /> : r.unavailable ? <Problem error={`bb couldn't ask GitHub: ${r.unavailable}`} /> : <Quiet icon="git-pull-request">No pull request for {r.branch ?? "this checkout"} yet</Quiet>}
      </div>
    );
  }
  const pr = r.pullRequest;
  const state = PR_STATE[pr.state];
  const done = pr.state === "merged" || pr.state === "closed";
  const open = () => env.perform([{ $iris: "action", kind: "openUrl", args: [pr.url] }]);
  const color = env.palette.tone;
  const checks = CHECKS[pr.checks.state];
  return (
    <div ref={live.ref} className="min-w-0">
      <Head icon={state.icon} title={<span style={{ color: color[state.tone] }}>{state.label}</span>} detail={`${pr.base} ← ${pr.head}`} live={live} />
      <button type="button" onClick={open} className="mt-1.5 block max-w-full text-left text-[15px] font-semibold leading-snug tracking-[-0.01em] hover:underline">
        {pr.title} <span className="font-normal text-muted-foreground">#{pr.number}</span>
      </button>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {pr.updatedAt ? <span>Updated {ago(pr.updatedAt)}</span> : null}
        {pr.inMergeQueue ? <Chip tone="info">In merge queue</Chip> : null}
        {pr.autoMerge ? <Chip tone="info">Auto-merge on</Chip> : null}
      </div>
      {done ? null : (
        <ul className="mt-3 space-y-2 text-[13px]">
          <StatusLine icon={checks.icon} tone={checks.tone} label={checks.label}>
            {pr.checks.total ? <CheckBar checks={pr.checks} /> : null}
          </StatusLine>
          <StatusLine icon={REVIEW[pr.review.state].icon} tone={REVIEW[pr.review.state].tone} label={REVIEW[pr.review.state].label}>
            {pr.review.requests ? <span className="text-xs text-muted-foreground">{pr.review.requests} requested</span> : null}
          </StatusLine>
          <StatusLine icon={MERGE[pr.mergeability].icon} tone={MERGE[pr.mergeability].tone} label={MERGE[pr.mergeability].label} />
        </ul>
      )}
      {/* A plain link on the status column's edge: its icon lines up with the status icons above. */}
      <button type="button" onClick={open} className="iris-hit mt-3 inline-flex items-center gap-2 text-[12.5px] text-muted-foreground hover:text-foreground">
        <Glyph name="external-link" size={15} />
        Open on GitHub
      </button>
    </div>
  );
}

function StatusLine({ icon, tone, label, children }: { icon: string; tone: Tone; label: string; children?: ReactNode }) {
  const env = useEnv();
  return (
    <li className="flex min-w-0 items-center gap-2">
      <Glyph name={icon} size={15} color={env.palette.tone[tone]} />
      <span className="shrink-0">{label}</span>
      <span className="ml-auto flex min-w-0 items-center">{children}</span>
    </li>
  );
}

function CheckBar({ checks }: { checks: PullRequestInfo["checks"] }) {
  const env = useEnv();
  const t = env.palette.tone;
  const total = checks.total || 1;
  const other = Math.max(0, checks.total - checks.passed - checks.failed - checks.pending);
  return (
    <span className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <span className="text-right [text-wrap:balance]">
        {[checks.passed ? `${checks.passed} passed` : null, checks.failed ? `${checks.failed} failed` : null, checks.pending ? `${checks.pending} running` : null, other ? `${other} other` : null].filter(Boolean).join(", ")}
      </span>
      {/* On a phone the counts say it; the bar gives them its room. */}
      <span className="flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-muted @max-lg/iris:hidden">
        <span className="iris-bar h-full" style={{ width: `${(checks.passed / total) * 100}%`, background: t.good }} />
        <span className="iris-bar h-full" style={{ width: `${(checks.failed / total) * 100}%`, background: t.bad }} />
        <span className="iris-bar h-full" style={{ width: `${(checks.pending / total) * 100}%`, background: t.warn }} />
      </span>
    </span>
  );
}

// ---------- Threads ----------

function threadTone(t: { status: ThreadStatus; needsInput: boolean; archived?: boolean }): { tone: Tone; label: string; running: boolean } {
  if (t.needsInput) return { tone: "warn", label: "Needs you", running: false };
  if (t.status === "error") return { tone: "bad", label: "Failed", running: false };
  if (RUNNING[t.status]) return { tone: "info", label: t.status === "active" ? "Working" : t.status === "waiting-for-host" ? "Waiting for machine" : "Starting", running: true };
  if (t.archived) return { tone: "neutral", label: "Archived", running: false };
  return { tone: "good", label: "Idle", running: false };
}

function StatusDot({ tone, running }: { tone: Tone; running: boolean }) {
  const env = useEnv();
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-full", running && "iris-pulse")} style={{ background: env.palette.tone[tone] }} />;
}

export function ThreadsView({ props }: ViewProps) {
  const rpc = useRpc<RpcContract>();
  const navigate = useBbNavigate();
  const parsed = parseThreadIds(props.ids);
  const ids = parsed.ok ? parsed.value : null;
  // Bad ids read nothing: the card shows why at once and follows nothing.
  const live = useLive(
    parsed.ok ? JSON.stringify(ids) : `invalid:${parsed.error}`,
    (threadId) => (parsed.ok ? rpc.call("project_threads", { threadId, ids }) : Promise.resolve(failure("invalid", parsed.error))),
    sampleThreads,
    parsed.ok
      ? (r) => ({
          threads: ids ?? (r?.ok ? r.threads.map((t) => t.id) : []),
          newThreads: ids === null,
          // A row shows its thread's branch, which moves with its environment.
          environments: r?.ok ? r.threads.flatMap((t) => (t.found && t.environmentId ? [t.environmentId] : [])) : [],
        })
      : null,
  );
  if (!parsed.ok) return <div ref={live.ref}><Problem error={parsed.error} /></div>;
  const r = live.data;
  const title = str(props.title) ?? (ids ? "Threads" : "Subthreads");
  if (!r) return <div ref={live.ref}>{live.error ? <Problem error={live.error} /> : <Shimmer className="h-24" />}</div>;
  if (!r.ok) {
    return (
      <div ref={live.ref}>
        <Head icon="layers" title={title} live={live} />
        <Problem failure={r} />
      </div>
    );
  }
  const found = r.threads.filter((t): t is ThreadInfo => t.found);
  const working = found.filter((t) => !t.needsInput && RUNNING[t.status]).length;
  const waiting = found.filter((t) => t.needsInput).length;
  const failed = found.filter((t) => !t.needsInput && t.status === "error").length;
  const detail = [working ? `${working} working` : null, waiting ? `${waiting} waiting on you` : null, failed ? `${failed} failed` : null].filter(Boolean).join(", ") || (found.length ? `${found.length} settled` : "");
  const go = (id: string) => {
    if (!live.sample) navigate.toThread(id);
  };
  return (
    <div ref={live.ref} className="min-w-0">
      <Head icon="layers" title={title} detail={detail} live={live} />
      {r.threads.length ? (
        <ul className="mt-2 overflow-hidden rounded-[10px] ring-1 ring-border [&>li+li]:border-t [&>li+li]:border-border">
          {r.threads.map((t) =>
            t.found ? (
              <li key={t.id}>
                <button type="button" onClick={() => go(t.id)} className={cn("flex w-full min-w-0 items-center gap-2.5 px-2.5 py-2 text-left hover:bg-muted/40", t.archived && "opacity-70")}>
                  <StatusDot {...threadTone(t)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px]">{t.title}</span>
                    {/* On a phone the status and time move to this second line, so the title keeps the width. */}
                    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-muted-foreground">
                      {t.branch ? <span className="min-w-0 max-w-full truncate font-mono">{t.branch}</span> : null}
                      {t.background ? (
                        <span className="shrink-0" title="Background agents, commands and workflows running">
                          {t.branch ? "· " : ""}+{t.background} in background
                        </span>
                      ) : null}
                      <span className="inline-flex shrink-0 items-center gap-1.5 @lg/iris:hidden">
                        <ThreadChip t={t} />
                        <span className="whitespace-nowrap tabular-nums">{ago(t.updatedAt)}</span>
                      </span>
                    </span>
                  </span>
                  <span className="contents @max-lg/iris:hidden">
                    <ThreadChip t={t} />
                    <span className="min-w-[4.5rem] shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">{ago(t.updatedAt)}</span>
                  </span>
                </button>
              </li>
            ) : (
              <li key={t.id} className="flex items-center gap-2.5 px-2.5 py-2 text-[13px] text-muted-foreground">
                <Glyph name="circle-slash" size={13} />
                <span className="font-mono text-[12px]">{t.id}</span>
                <span className="ml-auto text-xs">Not found in this project</span>
              </li>
            ),
          )}
        </ul>
      ) : (
        <Quiet icon="layers">{ids ? "No threads to show" : "This thread has no subthreads yet"}</Quiet>
      )}
      {r.truncated ? <div className="mt-1 text-xs text-muted-foreground">Showing the first 200</div> : null}
    </div>
  );
}

function ThreadChip({ t }: { t: { status: ThreadStatus; needsInput: boolean; archived?: boolean } }) {
  const s = threadTone(t);
  return <Chip tone={s.tone === "good" || s.tone === "neutral" ? undefined : s.tone}>{s.label}</Chip>;
}

// ---------- Environments ----------

export function EnvironmentsView({ props }: ViewProps) {
  const rpc = useRpc<RpcContract>();
  const live = useLive("environments", (threadId) => rpc.call("project_environments", { threadId }), sampleEnvironments, (r) =>
    r?.ok
      ? {
          newThreads: true,
          environments: r.environments.map((e) => e.id),
          threads: r.environments.flatMap((e) => e.threads.map((t) => t.id)),
          pullRequests: r.environments.filter((e) => e.changedFiles !== null || e.pullRequest !== null).map((e) => e.id),
        }
      : { newThreads: true },
  );
  const r = live.data;
  const title = str(props.title) ?? "Environments";
  if (!r) return <div ref={live.ref}>{live.error ? <Problem error={live.error} /> : <Shimmer className="h-28" />}</div>;
  if (!r.ok) {
    return (
      <div ref={live.ref}>
        <Head icon="folder-git-2" title={title} live={live} />
        <Problem failure={r} />
      </div>
    );
  }
  const total = r.environments.length + r.more;
  return (
    <div ref={live.ref} className="min-w-0">
      <Head icon="folder-git-2" title={title} detail={`${total} in this project`} live={live} />
      {r.environments.length ? (
        <ul className="mt-2 overflow-hidden rounded-[10px] ring-1 ring-border [&>li+li]:border-t [&>li+li]:border-border">
          {r.environments.map((e) => (
            <EnvironmentRow key={e.id} e={e} sample={live.sample} />
          ))}
        </ul>
      ) : (
        <Quiet icon="folder-git-2">No environments in this project</Quiet>
      )}
      {r.more ? <div className="mt-1 text-xs text-muted-foreground">{r.more} older environments not shown</div> : null}
    </div>
  );
}

function EnvironmentRow({ e, sample }: { e: EnvironmentInfo; sample: boolean }) {
  const env = useEnv();
  const navigate = useBbNavigate();
  const [all, setAll] = useState(false);
  const threads = all ? e.threads : e.threads.slice(0, 3);
  const pr = e.pullRequest;
  const folder = e.path ? e.path.split("/").filter(Boolean).pop() : null;
  return (
    <li className="min-w-0 px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Glyph name={e.isWorktree ? "folder-git-2" : "folder"} size={14} className="mt-[3px] self-start text-muted-foreground" />
        {/* The branch and its folder stay together; the chips wrap beside or under them as a group. */}
        <span className="min-w-[9rem] flex-1 basis-0">
          <span className="block truncate font-mono text-[12.5px] font-medium">{e.branch ?? e.name ?? folder ?? e.id}</span>
          {folder && folder !== e.branch ? <span className="block truncate font-mono text-[11px] text-muted-foreground" title={e.path ?? undefined}>{folder}</span> : null}
        </span>
        <span className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {e.current ? <Chip tone="info">This thread</Chip> : null}
          {e.changedFiles ? <Chip>{e.changedFiles} changed</Chip> : e.changedFiles === 0 ? <span className="text-xs text-muted-foreground">clean</span> : null}
          {pr ? (
            <button type="button" onClick={() => !sample && env.perform([{ $iris: "action", kind: "openUrl", args: [pr.url] }])} title={pr.title} className="inline-flex">
              <Chip tone={PR_STATE[pr.state].tone} icon={PR_STATE[pr.state].icon}>
                #{pr.number}
                {pr.state === "open" || pr.state === "draft" ? (
                  <span aria-label={CHECKS[pr.checks].label} className="ml-0.5 inline-block size-1.5 rounded-full" style={{ background: env.palette.tone[CHECKS[pr.checks].tone] }} />
                ) : null}
              </Chip>
            </button>
          ) : null}
        </span>
      </div>
      {threads.length ? (
        <ul className="mt-1 space-y-0.5 pl-[22px]">
          {threads.map((t) => {
            const s = threadTone(t);
            return (
              <li key={t.id}>
                <button type="button" onClick={() => !sample && navigate.toThread(t.id)} className="flex w-full min-w-0 items-center gap-2 text-left text-[12.5px] hover:underline">
                  <StatusDot tone={s.tone} running={s.running} />
                  <span className="min-w-0 truncate">{t.title}</span>
                  {s.tone === "warn" || s.tone === "bad" ? <span className="shrink-0 text-[12px]" style={{ color: env.palette.tone[s.tone] }}>{s.label}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {e.threads.length > threads.length ? (
        <button type="button" onClick={() => setAll(true)} className="mt-0.5 pl-[22px] text-xs text-muted-foreground hover:text-foreground">
          {e.threads.length - threads.length} more threads
        </button>
      ) : null}
    </li>
  );
}

// ---------- Pipeline ----------

const PIPE: Record<PipelineStatus, { tone: Tone; icon: string; label: string }> = {
  passed: { tone: "good", icon: "circle-check", label: "Passed" },
  failed: { tone: "bad", icon: "circle-x", label: "Failed" },
  running: { tone: "info", icon: "loader-circle", label: "Running" },
  queued: { tone: "neutral", icon: "circle-dashed", label: "Queued" },
  cancelled: { tone: "warn", icon: "circle-slash", label: "Cancelled" },
  skipped: { tone: "neutral", icon: "circle-minus", label: "Skipped" },
  neutral: { tone: "neutral", icon: "circle", label: "" },
};

function PipeIcon({ status, size = 15 }: { status: PipelineStatus; size?: number }) {
  const env = useEnv();
  const p = PIPE[status];
  return <Glyph name={p.icon} size={size} color={env.palette.tone[p.tone]} className={cn(status === "running" && "iris-spin")} />;
}

export function PipelineView({ props }: ViewProps) {
  if (isPendingValue(props.run)) return <Shimmer className="h-24" />;
  const runs = normalizePipeline(props.run);
  if (!runs.length) return <Quiet icon="workflow">No runs in this report</Quiet>;
  const counts = pipelineCounts(runs);
  const title = str(props.title);
  return (
    <div className="min-w-0 space-y-3">
      {title ? <div className="text-[13px] font-medium">{title}</div> : null}
      {runs.length > 1 ? (
        <div className="flex flex-wrap gap-1.5">
          {(["failed", "running", "queued", "passed", "cancelled", "skipped"] as const).map((s) =>
            counts[s] ? (
              <Chip key={s} tone={PIPE[s].tone === "neutral" ? undefined : PIPE[s].tone}>
                {counts[s]} {PIPE[s].label.toLowerCase()}
              </Chip>
            ) : null,
          )}
        </div>
      ) : null}
      {runs.map((r, k) => (
        <RunBlock key={k} run={r} />
      ))}
    </div>
  );
}

/** No duration for work that never ran or took no measurable time. */
function duration(ms: number | null, status?: PipelineStatus): string {
  if (ms == null || ms < 500 || status === "skipped" || status === "queued") return "";
  return formatValue(ms, "duration");
}

function RunBlock({ run }: { run: PipelineRun }) {
  const env = useEnv();
  const open = () => run.url && env.perform([{ $iris: "action", kind: "openUrl", args: [run.url] }]);
  return (
    <section className="min-w-0">
      <div className="flex min-w-0 items-center gap-2">
        <PipeIcon status={run.status} />
        <span className="min-w-0 truncate text-[13px] font-medium">{run.name}</span>
        {run.title ? <span className="min-w-0 truncate text-xs text-muted-foreground">{run.title}</span> : null}
        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">{duration(run.durationMs, run.status)}</span>
        {run.url ? (
          <button type="button" onClick={open} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Open the run">
            <Glyph name="external-link" size={13} />
          </button>
        ) : null}
      </div>
      {run.jobs.length ? (
        <ul className="mt-1.5 overflow-hidden rounded-[10px] ring-1 ring-border [&>li+li]:border-t [&>li+li]:border-border">
          {run.jobs.map((j, k) => (
            <JobRow key={k} job={j} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function JobRow({ job }: { job: PipelineJob }) {
  const env = useEnv();
  const [open, setOpen] = useState(job.status === "failed" || job.status === "running");
  const has = job.steps.length > 0;
  const steps = open ? job.steps.filter((s) => s.status !== "skipped" || job.steps.length <= 12) : [];
  return (
    <li className="min-w-0">
      <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5 hover:bg-muted/40">
        <button type="button" onClick={() => has && setOpen(!open)} disabled={!has} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default" aria-expanded={has ? open : undefined}>
          <Glyph name="chevron-right" size={13} className={cn("text-muted-foreground transition-transform", open && "rotate-90", !has && "opacity-0")} />
          <PipeIcon status={job.status} size={14} />
          <span className={cn("min-w-0 truncate text-[13px]", job.status === "skipped" && "text-muted-foreground")}>{job.name}</span>
        </button>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{duration(job.durationMs, job.status)}</span>
        {job.url ? (
          <button type="button" onClick={() => env.perform([{ $iris: "action", kind: "openUrl", args: [job.url] }])} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label={`Open ${job.name}`}>
            <Glyph name="external-link" size={13} />
          </button>
        ) : null}
      </div>
      {steps.length ? (
        <ol className="border-t border-border bg-muted/20 py-1 pl-[46px] pr-2.5">
          {steps.map((s, k) => (
            <li key={k} className="flex min-w-0 items-center gap-2 py-0.5 text-[12.5px]">
              <PipeIcon status={s.status} size={12} />
              <span className={cn("min-w-0 flex-1 truncate", s.status === "failed" ? "font-medium" : s.status === "passed" ? "" : "text-muted-foreground")}>{s.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{duration(s.durationMs, s.status)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

