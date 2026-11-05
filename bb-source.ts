// Server side of load("bb:<source>"): bb's own live data, read through the plugin
// SDK and scoped to the card's thread. Answers are plain JSON a card draws with
// any component; each is cached for a moment so many live cards re-reading every
// 2 s cost one bb call.

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { parseBbSource } from "./core/bb-data";
import type { ProjectSource } from "./project-source";

type Answer = { ok: true; value: unknown } | { ok: false; error: string };

/** How long an answer stays fresh: thread state changes fast, git and PRs slower, account-wide data slowest. */
const CACHE_MS: Record<string, number> = { thread: 3000, threads: 4000, pr: 10_000, commits: 8000, changes: 8000, environments: 8000, usage: 30_000, machines: 15_000, plugins: 30_000 };
const MAX_THREADS = 60;
const MAX_USAGE_THREADS = 30;

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createBbSource(bb: BbPluginApi, project: ProjectSource) {
  const sdk = bb.sdk;
  const cache = new Map<string, { at: number; answer: Promise<Answer> }>();

  async function contextOf(threadId: string) {
    try {
      const r = asRecord(await sdk.threads.context({ threadId }));
      const usage = asRecord(r.usage);
      if (!r.usage) return { context: null, cost: null };
      const used = num(usage.usedTokens) ?? 0;
      const window = num(usage.modelContextWindow) ?? 0;
      const snapshot = asRecord(usage.snapshot);
      const categories = Array.isArray(snapshot.categories)
        ? (snapshot.categories as unknown[]).map(asRecord).filter((c) => c.kind === "used" || c.kind === "reserved").map((c) => ({ label: str(c.label) ?? "", tokens: num(c.tokens) ?? 0 }))
        : [];
      const cost = asRecord(usage.cost);
      return {
        context: { used, window, percent: window ? Math.round((used / window) * 1000) / 10 : null, model: str(snapshot.model), estimated: usage.estimated === true, categories },
        cost: num(cost.amount) !== null ? { amount: num(cost.amount), currency: str(cost.currency) ?? "USD" } : null,
      };
    } catch {
      return { context: null, cost: null };
    }
  }

  async function queuedCount(threadId: string): Promise<number | null> {
    try {
      const r = (await sdk.threads.queuedMessages.list({ threadId })) as unknown;
      const list = Array.isArray(r) ? r : (asRecord(r).messages as unknown[]) ?? (asRecord(r).items as unknown[]);
      return Array.isArray(list) ? list.length : null;
    } catch {
      return null;
    }
  }

  const statusOf = (row: Record<string, unknown>) => {
    const runtime = asRecord(row.runtime);
    return str(runtime.status) ?? str(row.status) ?? "unknown";
  };

  async function ownThread(threadId: string): Promise<Record<string, unknown> | null> {
    const row = asRecord(await sdk.threads.get({ threadId }));
    return row.id && row.deletedAt == null ? row : null;
  }

  async function thread(threadId: string): Promise<Answer> {
    const row = await ownThread(threadId);
    if (!row) return { ok: false, error: "this thread isn't available" };
    const [usage, queued] = await Promise.all([contextOf(threadId), queuedCount(threadId)]);
    return {
      ok: true,
      value: {
        id: threadId,
        title: str(row.title) ?? str(row.titleFallback) ?? "",
        status: statusOf(row),
        waitingOnYou: row.hasPendingInteraction === true,
        queued,
        branch: str(row.environmentBranchName),
        ...usage,
      },
    };
  }

  async function threads(threadId: string, query: Record<string, string>): Promise<Answer> {
    const own = await ownThread(threadId);
    const projectId = own ? str(own.projectId) : null;
    // Never wider than this thread's project: without one, there is nothing to list.
    if (!projectId) return { ok: false, error: "this thread's project isn't available" };
    const rows = (query.scope === "project" ? await sdk.threads.list({ projectId, hasParent: false, archived: false, limit: MAX_THREADS }) : await sdk.threads.list({ parentThreadId: threadId, limit: MAX_THREADS })) as unknown[];
    const list = rows.map(asRecord).filter((r) => r.deletedAt == null && r.projectId === projectId);
    const out = list.map((r) => ({
      id: str(r.id),
      title: str(r.title) ?? str(r.titleFallback) ?? "",
      status: statusOf(r),
      waitingOnYou: r.hasPendingInteraction === true,
      queuedWork: typeof r.queuedWork === "string" ? r.queuedWork : (str(asRecord(r.queuedWork).state) ?? "none"),
      updatedAt: num(r.updatedAt),
      branch: str(r.environmentBranchName),
    }));
    if (query.usage) {
      const withUsage = await Promise.all(out.slice(0, MAX_USAGE_THREADS).map(async (row) => ({ ...row, ...(row.id ? await contextOf(row.id) : {}) })));
      return { ok: true, value: [...withUsage, ...out.slice(MAX_USAGE_THREADS)] };
    }
    return { ok: true, value: out };
  }

  async function usage(): Promise<Answer> {
    const r = asRecord(await sdk.system.usageLimits());
    const lines: unknown[] = [];
    for (const [provider, entry] of Object.entries(r)) {
      const e = asRecord(entry);
      if (e.status !== "ok" || !Array.isArray(e.windows)) continue;
      for (const w of (e.windows as unknown[]).map(asRecord)) {
        const cost = asRecord(w.cost);
        lines.push({
          provider,
          plan: str(e.planLabel),
          label: str(w.label) ?? "",
          usedPercent: num(w.usedPercent),
          resetsAt: str(w.resetsAt),
          spentUsd: num(cost.usedUsdCents) !== null ? (num(cost.usedUsdCents) as number) / 100 : null,
          limitUsd: num(cost.limitUsdCents) !== null ? (num(cost.limitUsdCents) as number) / 100 : null,
        });
      }
    }
    return { ok: true, value: lines };
  }

  async function machines(): Promise<Answer> {
    const r = (await sdk.hosts.list()) as unknown;
    const list = Array.isArray(r) ? r : ((asRecord(r).hosts as unknown[]) ?? []);
    return { ok: true, value: list.map(asRecord).map((h) => ({ name: str(h.name) ?? str(h.id) ?? "", status: str(h.status) ?? "unknown", lastSeenAt: h.lastSeenAt ?? null })) };
  }

  async function plugins(): Promise<Answer> {
    const r = (await sdk.plugins.list()) as unknown;
    const list = Array.isArray(r) ? r : ((asRecord(r).plugins as unknown[]) ?? []);
    return { ok: true, value: list.map(asRecord).map((p) => ({ id: str(p.id) ?? "", version: str(p.version), status: str(p.status) ?? "unknown", detail: str(p.statusDetail)?.slice(0, 200) ?? null })) };
  }

  async function fromProject(threadId: string, name: string): Promise<Answer> {
    if (name === "commits") {
      const r = await project.commits(threadId);
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, value: { branch: r.branch, base: r.base, ahead: r.ahead, behind: r.behind, commits: r.commits.map((c) => ({ sha: c.shortSha, subject: c.subject, author: c.author, at: c.authoredAt })) } };
    }
    if (name === "pr") {
      const r = await project.pullRequest(threadId);
      if (!r.ok) return { ok: false, error: r.error };
      const pr = (r as unknown as { pullRequest: Record<string, unknown> | null }).pullRequest;
      if (!pr) return { ok: true, value: null };
      return { ok: true, value: { number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.state === "draft", checks: pr.checks, review: asRecord(pr.review).state ?? null, mergeable: pr.mergeability } };
    }
    if (name === "changes") {
      const r = await project.changes(threadId, { kind: "branch" }, null);
      if (!r.ok) return { ok: false, error: r.error };
      const files = r.files.map((f) => ({ path: f.path, status: f.untracked ? "untracked" : f.kind, added: f.additions, removed: f.deletions }));
      return { ok: true, value: { files, added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0), truncated: r.truncated } };
    }
    const r = await project.environments(threadId);
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, value: r.environments.map((e) => ({ branch: e.branch, current: e.current, threads: e.threads.map((t) => ({ id: t.id, title: t.title, status: t.status, waitingOnYou: t.needsInput })), changedFiles: e.changedFiles, ahead: e.ahead, pullRequest: e.pullRequest })) };
  }

  async function answer(threadId: string | null, spec: string): Promise<Answer> {
    const parsed = parseBbSource(spec);
    if (!parsed.ok) return parsed;
    const { name, query } = parsed;
    const needsThread = !["usage", "machines", "plugins"].includes(name);
    if (needsThread && !threadId) return { ok: false, error: `bb:${name} reads the card's thread, so it shows only inside a thread` };
    try {
      if (name === "thread") return await thread(threadId as string);
      if (name === "threads") return await threads(threadId as string, query);
      if (name === "usage") return await usage();
      if (name === "machines") return await machines();
      if (name === "plugins") return await plugins();
      return await fromProject(threadId as string, name);
    } catch (e) {
      return { ok: false, error: `bb couldn't read bb:${name}: ${message(e)}` };
    }
  }

  return {
    read(threadId: string | null, spec: string): Promise<Answer> {
      const key = `${threadId ?? ""}\0${spec}`;
      const parsed = parseBbSource(spec);
      const ttl = parsed.ok ? (CACHE_MS[parsed.name] ?? 3000) : 0;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < ttl) return hit.answer;
      const p = answer(threadId, spec);
      cache.set(key, { at: Date.now(), answer: p });
      if (cache.size > 500) cache.delete(cache.keys().next().value as string);
      return p;
    },
  };
}
