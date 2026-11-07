// Iris backend: the agent tools (iris_check, iris_docs, iris_ask and the
// reference carriers), the instructions agents get, the file reads behind
// load() and Snippet, saved card state, and the `bb iris` command.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PluginCliError, defineCli, cliCommand, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { check, formatReport } from "./core/check";
import { parseDataFile } from "./core/data";
import { isPluginSource, loadPluginData, parsePluginSource } from "./core/plugin-data";
import { tailText } from "./core/live";
import type { LoadResult } from "./core/program";
import { CODE_WORK_INSTRUCTIONS, docsFor, examplesForGroups, indexSections, mainInstructions, type Stance } from "./core/prompt";
import { CATALOG, GROUPS } from "./core/catalog";
import { rpcContract, type FileUrlResult, type FolderFilesResult } from "./shared/rpc";
import { cardsContract, pinsContract } from "./shared/pins-rpc";
import { cardsInMessage, isCardKey, personInputs, type CardRef } from "./core/cards";
import { MAX_PINS, MAX_PIN_SOURCE, type Pin, type PinBy, cardFromFile, cardTitle, normalizePins, pinId, removePin, upsertPin, validPinId } from "./core/pins";
import { failure, parseChangesTarget, parsePathFilter, parseThreadIds } from "./core/project";
import { createProjectSource } from "./project-source";
import { createBbSource } from "./bb-source";
import { isBbSource } from "./core/bb-data";
import { WEB_MIGRATIONS, createWebSource } from "./web-source";

// Tool parameters go to bb as plain JSON Schema, and each tool validates its input with zod
// itself. bb never converts a zod schema from this plugin inside its own long-running process,
// where zod's shared global registry can outlive a broken plugin generation and fail reloads.
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
function params(_schema: z.ZodType, json: Record<string, unknown>): { parameters: Record<string, unknown> } {
  return { parameters: json };
}
function validated<S extends z.ZodType, C>(schema: S, run: (input: z.infer<S>, ctx: C) => Promise<ToolResult>) {
  return async (input: unknown, ctx: C): Promise<ToolResult> => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { content: [{ type: "text", text: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ")}` }], isError: true };
    return run(parsed.data, ctx);
  };
}
const ASK_PARAMS = z
      .object({
        title: z.string().min(1).max(120),
        source: z.string().max(100_000).optional(),
        html: z.string().max(400_000).optional(),
        react: z.string().max(200_000).optional(),
        timeoutMinutes: z.number().int().min(1).max(10_080).optional(),
      })
      .refine((v) => [v.source, v.html, v.react].filter(Boolean).length === 1, { message: "Pass exactly one of source, react or html" });


const MAX_DATA_BYTES = 8 * 1024 * 1024;
/** A live log can grow past the data limit; only its last TAIL_CHARS reach the card. */
const MAX_TAIL_FILE_BYTES = 64 * 1024 * 1024;
const TAIL_CHARS = 256 * 1024;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_MODEL_BYTES = 16 * 1024 * 1024;
const STORAGE_PREFIX = "$BB_THREAD_STORAGE/";
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif" };
const MAX_PERSON_THREADS = 5000;
const LEASE_TTL_MS = 60 * 60_000;
const LEASE_RENEW_MS = 10 * 60_000;
const MAX_MEDIA_DATA_BYTES = 32 * 1024 * 1024;
const MAX_LIST_FILES = 2000;
/** Dependency and build output folders FileTree and AssetGallery skip. */
const SKIPPED_FOLDERS = ["node_modules", ".pnpm-store", "bower_components", "Pods", "Carthage", "DerivedData", ".build", ".dd", ".swiftpm", "target", "build", ".next", ".nuxt", ".svelte-kit", ".turbo", ".parcel-cache", ".cache", "coverage", ".venv", "venv", "__pycache__", ".gradle", ".dart_tool"];
const MEDIA_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", ogv: "video/ogg",
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", flac: "audio/flac",
  pdf: "application/pdf", ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2", ttc: "font/collection",
};

interface Root {
  path: string;
  hostId: string;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    stance: {
      type: "select",
      label: "How often agents draw",
      description: "Eager: agents show anything that can be shown. Balanced: UI only where it reads better than prose.",
      options: ["eager", "balanced"],
      experimental_optionLabels: { eager: "Eager", balanced: "Balanced" },
      default: "eager",
    },
    rollout: {
      type: "select",
      label: "Where agents learn Iris",
      description: "Everywhere: every top-level thread, whoever started it (a person, a side chat or a plugin). Trial: only threads started with `bb iris try`, for testing next to another UI plugin.",
      options: ["everywhere", "trial"],
      experimental_optionLabels: { everywhere: "Everywhere", trial: "Trial threads only" },
      default: "everywhere",
    },
    workers: {
      type: "boolean",
      label: "Teach agent-spawned threads too",
      description: "Off: only top-level threads learn Iris; threads that agents spawn under them do not, which saves about 3,500 tokens of instructions in every worker session.",
      default: false,
    },
    skipPlugins: {
      type: "string",
      label: "Plugins whose threads skip Iris",
      description: "Plugin ids, comma-separated, whose own top-level threads don't learn Iris (helper threads no person reads). Empty: every top-level thread learns it. Applies after a plugin reload.",
      default: "",
    },
    webLookups: {
      type: "boolean",
      label: "Web lookups",
      description: "Maps, place search and photos, fetched by Iris's server from OpenStreetMap, Photon and Wikimedia Commons and cached here. Off: Iris makes no web requests, maps show only their list of places and photos stay hidden.",
      default: true,
    },
  });
  const initial = await settings.get();
  const stance = (initial.stance === "balanced" ? "balanced" : "eager") as Stance;
  const workers = initial.workers === true;
  const trialOnly = initial.rollout === "trial";
  const skipPlugins = new Set(String(initial.skipPlugins ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  let webLookups = initial.webLookups !== false;
  settings.onChange((next) => {
    webLookups = next.webLookups !== false;
  });

  // ---------- files ----------

  const rootCache = new Map<string, { at: number; roots: Promise<{ workspace: Root | null; storage: Root | null; environmentId: string | null }> }>();
  function threadRoots(threadId: string) {
    const hit = rootCache.get(threadId);
    if (hit && Date.now() - hit.at < 60_000) return hit.roots;
    const roots = (async () => {
      const [thread, storage] = await Promise.all([bb.sdk.threads.get({ threadId, include: "environment" }), bb.sdk.threads.storageLocation({ threadId }).catch(() => null)]);
      const env = "environment" in thread ? (thread.environment as { id?: string; path?: string; hostId?: string } | null) : null;
      return {
        workspace: env && typeof env.path === "string" && typeof env.hostId === "string" ? { path: env.path, hostId: env.hostId } : null,
        storage: storage ? { path: storage.storageRootPath, hostId: storage.hostId } : null,
        environmentId: env && typeof env.id === "string" ? env.id : null,
      };
    })();
    rootCache.set(threadId, { at: Date.now(), roots });
    roots.catch(() => rootCache.delete(threadId));
    return roots;
  }

  const inside = (root: string, target: string) => {
    const rel = path.relative(path.resolve(root), target);
    return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  };

  /** Where a requested path lands: only inside the thread's workspace, its thread storage, or another thread's storage folder. */
  async function resolvePath(threadId: string, requested: string): Promise<{ ok: true; root: Root; target: string; storage: boolean; own: boolean } | { ok: false; error: string }> {
    let roots;
    try {
      roots = await threadRoots(threadId);
    } catch (cause) {
      return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
    }
    let target: string | null = null;
    let root: Root | null = null;
    if (requested.startsWith(STORAGE_PREFIX) || requested.startsWith("$BB_THREAD_STORAGE")) {
      root = roots.storage;
      if (root) target = path.resolve(root.path, requested.replace(/^\$BB_THREAD_STORAGE\/?/, ""));
    } else if (path.isAbsolute(requested)) {
      const t = path.resolve(requested);
      if (roots.storage && inside(roots.storage.path, t)) root = roots.storage;
      else if (roots.workspace && inside(roots.workspace.path, t)) root = roots.workspace;
      else if (roots.storage && path.basename(roots.storage.path) === threadId) {
        // Another thread's storage on the same machine (a parent thread showing its subthreads' screenshots):
        // only inside a real thread folder of bb's thread-storage directory, never loose files there.
        const all = path.dirname(roots.storage.path);
        const other = path.relative(all, t).split(path.sep)[0];
        if (inside(all, t) && /^thr_[a-z0-9]+$/.test(other)) root = { path: path.join(all, other), hostId: roots.storage.hostId };
      }
      target = root ? t : null;
    } else {
      root = roots.workspace;
      if (root) target = path.resolve(root.path, requested);
    }
    if (!root || !target || !inside(root.path, target)) return { ok: false, error: `${path.basename(requested)} is outside this thread's workspace and bb's thread storage` };
    // Thread storage, this thread's or another's (no git), as opposed to the workspace.
    return { ok: true, root, target, storage: root !== roots.workspace, own: root === roots.storage };
  }

  /** Only the thread's workspace and its thread storage can be read. */
  async function readFile(threadId: string, requested: string, maxBytes: number): Promise<{ ok: true; content: string; encoding: "utf8" | "base64" } | { ok: false; error: string }> {
    const where = await resolvePath(threadId, requested);
    if (!where.ok) return where;
    const { root, target } = where;
    try {
      const result = await bb.sdk.files.read({ path: target, rootPath: root.path, hostId: root.hostId });
      if (!("content" in result)) return { ok: false, error: "the file could not be read" };
      if (result.sizeBytes > maxBytes) return { ok: false, error: `the file is ${Math.round(result.sizeBytes / 1024)} KB, over the ${Math.round(maxBytes / 1024)} KB limit` };
      return { ok: true, content: result.content, encoding: result.contentEncoding };
    } catch (cause) {
      const status = typeof cause === "object" && cause !== null && "status" in cause ? (cause as { status: unknown }).status : null;
      return { ok: false, error: status === 404 ? "file not found" : cause instanceof Error ? cause.message : String(cause) };
    }
  }

  async function loadFile(threadId: string, requested: string, raw: boolean, tail = false): Promise<LoadResult> {
    if (tail) {
      const file = await readFile(threadId, requested, MAX_TAIL_FILE_BYTES);
      if (!file.ok) return file;
      if (file.encoding !== "utf8") return { ok: false, error: "not a text file" };
      const { text, truncated } = tailText(file.content, TAIL_CHARS);
      return { ok: true, value: { text, size: Buffer.byteLength(file.content), truncated } };
    }
    const file = await readFile(threadId, requested, MAX_DATA_BYTES);
    if (!file.ok) return file;
    if (file.encoding !== "utf8") return { ok: false, error: "not a text file" };
    if (raw) return { ok: true, value: file.content.startsWith("﻿") ? file.content.slice(1) : file.content };
    return parseDataFile(requested, file.content);
  }

  // ---------- streamed files (players, assets, PDFs, fonts) ----------
  // bb serves files through a preview lease (sdk.files.createPreview): an
  // unguessable URL that answers byte ranges, so a video or PDF plays and
  // seeks without being read whole. A lease covers the thread's workspace or
  // its thread storage, the same files load() may read, and never a folder
  // picked from the path: bb checks every request against the lease's root,
  // so a symlink inside the root can't lead outside it. Leases expire after
  // LEASE_TTL_MS. When bb can't lease, a file up to MAX_MEDIA_DATA_BYTES comes
  // as a data URL.

  const leases = new Map<string, { at: number; lease: Promise<{ baseUrl: string; expiresAtMs: number }> }>();
  function leaseRoot(root: Root) {
    const key = `${root.hostId}\0${root.path}`;
    const hit = leases.get(key);
    if (hit && hit.at + LEASE_TTL_MS - LEASE_RENEW_MS > Date.now()) return hit.lease;
    const lease = bb.sdk.files.createPreview({ hostId: root.hostId, rootPath: root.path, ttlMs: LEASE_TTL_MS }).then((r) => ({ baseUrl: r.baseUrl, expiresAtMs: r.expiresAtMs }));
    leases.set(key, { at: Date.now(), lease });
    lease.catch(() => leases.delete(key));
    if (leases.size > 500) leases.delete(leases.keys().next().value as string);
    return lease;
  }
  /** A path below a root as "/"-joined, encoded URL segments. */
  const relUrl = (root: Root, target: string) => path.relative(root.path, target).split(path.sep).map(encodeURIComponent).join("/");

  async function fileUrl(threadId: string, requested: string): Promise<FileUrlResult> {
    const where = await resolvePath(threadId, requested);
    if (!where.ok) return where;
    if (path.resolve(where.target) === path.resolve(where.root.path)) return { ok: false, error: "needs a file, not a folder" };
    const name = path.basename(where.target);
    try {
      const lease = await leaseRoot(where.root);
      return { ok: true, url: `${lease.baseUrl}/${relUrl(where.root, where.target)}`, via: "stream", expiresAtMs: lease.expiresAtMs, name };
    } catch (cause) {
      bb.log.warn(`file lease failed, reading ${name} whole: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    const file = await readFile(threadId, requested, MAX_MEDIA_DATA_BYTES);
    if (!file.ok) return file;
    const ext = /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? "";
    const base64 = file.encoding === "base64" ? file.content : Buffer.from(file.content, "utf8").toString("base64");
    return { ok: true, url: `data:${MEDIA_TYPES[ext] ?? "application/octet-stream"};base64,${base64}`, via: "data", expiresAtMs: null, name };
  }

  /**
   * Files under a folder, scoped to it so big workspaces stay fast. bb's
   * scoped listing doesn't read .gitignore, so dependency and build output
   * folders are skipped by name instead.
   */
  async function listFolder(root: Root, target: string, limit: number): Promise<{ files: string[]; truncated: boolean }> {
    const listing = await bb.sdk.files.list({ hostId: root.hostId, path: target, limit, includeHidden: false, excludeNames: [...SKIPPED_FOLDERS] });
    return { files: listing.files.map((f) => f.path), truncated: listing.truncated };
  }

  async function folderFiles(threadId: string, requested: string, limit: number): Promise<FolderFilesResult> {
    const where = await resolvePath(threadId, requested || ".");
    if (!where.ok) return where;
    const { root, target, storage, own } = where;
    let listing;
    try {
      listing = await listFolder(root, target, limit);
    } catch (cause) {
      const status = typeof cause === "object" && cause !== null && "status" in cause ? (cause as { status: unknown }).status : null;
      return { ok: false, error: status === 404 ? "folder not found" : cause instanceof Error ? cause.message : String(cause) };
    }
    let lease: { baseUrl: string; expiresAtMs: number } | null = null;
    try {
      lease = await leaseRoot(root);
    } catch {
      lease = null;
    }
    const rel = path.relative(root.path, target).split(path.sep).join("/");
    const sub = relUrl(root, target);
    return {
      ok: true,
      files: listing.files,
      truncated: listing.truncated,
      base: lease ? (sub ? `${lease.baseUrl}/${sub}` : lease.baseUrl) : null,
      expiresAtMs: lease?.expiresAtMs ?? null,
      folder: own ? `$BB_THREAD_STORAGE${rel ? `/${rel}` : ""}` : storage ? path.join(root.path, rel) : rel || ".",
      repoPrefix: storage ? null : rel,
    };
  }

  // ---------- on-demand chunks (dist/chunks, committed) ----------

  serveChunks(bb);

  const project = createProjectSource(bb);
  const bbData = createBbSource(bb, project);

  const db = bb.storage.database();
  bb.storage.migrate(db, WEB_MIGRATIONS);
  const web = createWebSource({ db, enabled: () => webLookups });

  // ---------- RPC ----------

  bb.rpc.register(rpcContract, {
    load_file: ({ threadId, path: p, raw, tail }) => loadFile(threadId, p, raw === true, tail === true),
    bb_data: ({ threadId, spec }) => bbData.read(threadId, spec),
    async load_image({ threadId, path: p }) {
      const ext = /\.([^./\\]+)$/.exec(p)?.[1]?.toLowerCase();
      if (!ext || !IMAGE_TYPES[ext]) return { ok: false as const, error: `only ${Object.keys(IMAGE_TYPES).join(", ")} images can be shown` };
      const file = await readFile(threadId, p, MAX_IMAGE_BYTES);
      if (!file.ok) return file;
      const base64 = file.encoding === "base64" ? file.content : Buffer.from(file.content, "utf8").toString("base64");
      return { ok: true as const, dataUrl: `data:${IMAGE_TYPES[ext]};base64,${base64}` };
    },
    async load_model({ threadId, path: p }) {
      const ext = /\.([^./\\]+)$/.exec(p)?.[1]?.toLowerCase();
      if (ext !== "glb" && ext !== "gltf") return { ok: false as const, error: "models must be .glb or .gltf files" };
      const file = await readFile(threadId, p, MAX_MODEL_BYTES);
      if (!file.ok) return file;
      const base64 = file.encoding === "base64" ? file.content : Buffer.from(file.content, "utf8").toString("base64");
      return { ok: true as const, base64, ext: ext as "glb" | "gltf" };
    },
    file_url: ({ threadId, path: p }) => fileUrl(threadId, p),
    folder_files: ({ threadId, path: p, limit }) => folderFiles(threadId, p, Math.min(MAX_LIST_FILES, limit ?? 400)),
    async thread_info({ threadId }) {
      try {
        const r = await threadRoots(threadId);
        return { environmentId: r.environmentId, hostId: r.workspace?.hostId ?? r.storage?.hostId ?? null, workspacePath: r.workspace?.path ?? null, storagePath: r.storage?.path ?? null };
      } catch {
        return { environmentId: null, hostId: null, workspacePath: null, storagePath: null };
      }
    },
    async state_get({ key }) {
      const state = await bb.storage.kv.get<Record<string, unknown>>(`state:${key}`);
      return { state: state ?? null };
    },
    async state_set({ key, state }) {
      const size = JSON.stringify(state).length;
      if (size > 200_000) return { ok: false };
      await bb.storage.kv.set(`state:${key}`, state);
      return { ok: true };
    },
    async project_changes({ threadId, target, paths }) {
      const t = parseChangesTarget(target);
      if (!t.ok) return failure("invalid", t.error);
      const p = parsePathFilter(paths);
      if (!p.ok) return failure("invalid", p.error);
      return project.changes(threadId, t.value, p.value);
    },
    async project_patch({ threadId, target, path: file, revision }) {
      const t = parseChangesTarget(target);
      if (!t.ok) return failure("invalid", t.error);
      return project.patch(threadId, t.value, file, revision);
    },
    project_commits: ({ threadId }) => project.commits(threadId),
    project_pull_request: ({ threadId }) => project.pullRequest(threadId),
    project_environments: ({ threadId }) => project.environments(threadId),
    async project_threads({ threadId, ids }) {
      const parsed = parseThreadIds(ids);
      if (!parsed.ok) return failure("invalid", parsed.error);
      return project.threads(threadId, parsed.value);
    },
    web_status: () => ({ enabled: webLookups }),
    map_tile: ({ z, x, y }) => web.tile(z, x, y),
    geocode: ({ queries }) => web.geocode(queries),
    photo_search: ({ query, width }) => web.photo(query, width),
  });

  // ---------- pinned cards ----------
  // A thread keeps up to MAX_PINS live cards beside its conversation. The person pins from a card's
  // toolbar; the thread's agent pins with iris_pin or `bb iris pin`; any client can use the
  // discoverable pins.* RPCs. Every change is checked first, written once, and announced so open
  // views refresh.

  const pinsKey = (threadId: string) => `state:pins:${threadId}`;
  const legacyPinKey = (threadId: string) => `state:pin:${threadId}`;
  const pinLocks = new Map<string, Promise<unknown>>();
  /** One change at a time per thread, so two quick pins never overwrite each other. */
  function withPins<T>(threadId: string, fn: () => Promise<T>): Promise<T> {
    const prev = pinLocks.get(threadId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    pinLocks.set(threadId, next.catch(() => undefined));
    return next;
  }
  async function readPins(threadId: string): Promise<Pin[]> {
    const stored = await bb.storage.kv.get<unknown>(pinsKey(threadId));
    // Before 1.10 a thread had one pin under its own key: it reads as the person's pin.
    return normalizePins(stored ?? (await bb.storage.kv.get<unknown>(legacyPinKey(threadId))));
  }
  async function writePins(threadId: string, pins: Pin[]): Promise<void> {
    await bb.storage.kv.set(pinsKey(threadId), { pins });
    await bb.storage.kv.set(legacyPinKey(threadId), { source: null });
    bb.realtime.publish("iris-pins", { threadId });
  }

  type PinInput = { id?: string; title?: string; source?: string; file?: string; by: PinBy };
  type PinResult = { ok: true; pin: Pin; replaced: boolean; report: string } | { ok: false; error: string };
  async function pinCard(threadId: string, input: PinInput): Promise<PinResult> {
    if (Boolean(input.source) === Boolean(input.file)) return { ok: false, error: "give the card's source or a file holding it, not both" };
    if (input.id !== undefined && !validPinId(input.id)) return { ok: false, error: `"${input.id}" can't be a pin id: use lowercase letters, digits and dashes` };
    let body = input.source ?? "";
    // A path the shell expanded inside this thread's storage reads back as $BB_THREAD_STORAGE/..., for
    // the person and in iris_pins.
    if (input.file && path.isAbsolute(input.file)) {
      try {
        const storage = (await threadRoots(threadId)).storage?.path;
        const rel = storage ? path.relative(storage, input.file) : null;
        if (rel !== null && rel && !rel.startsWith("..") && !path.isAbsolute(rel)) input = { ...input, file: `$BB_THREAD_STORAGE/${rel.split(path.sep).join("/")}` };
      } catch {
        // keep the path as given
      }
    }
    if (input.file) {
      const read = await loadFile(threadId, input.file, true);
      if (!read.ok) return { ok: false, error: `couldn't read ${input.file}: ${read.error}` };
      if (typeof read.value !== "string") return { ok: false, error: `${input.file} isn't a text file` };
      body = cardFromFile(read.value);
    }
    if (isReactApp(body)) return { ok: false, error: "only ```iris cards can be pinned, not iris-react apps" };
    if (body.length > MAX_PIN_SOURCE) return { ok: false, error: `the card is longer than ${MAX_PIN_SOURCE.toLocaleString("en-US")} characters; pin a file it loads its data from instead` };
    // Only the card itself can block a pin. A file it loads may not exist yet or a feed may be slow
    // right now: the pinned card shows that live, so the check reports it but doesn't refuse.
    const own = check(body, { load: () => new Promise<LoadResult>(() => undefined) });
    if (!own.ok) return { ok: false, error: `The card has errors, so it wasn't pinned. Fix them and pin again.\n${formatReport(own)}` };
    const report = await checkSource(body, threadId);
    const title = input.title ?? cardTitle(body, input.file ? path.basename(input.file).replace(/\.[^.]+$/, "") : "Iris card");
    const pin: Pin = { id: input.id ?? pinId(title, input.file ?? body), title, ...(input.file ? { file: input.file } : { source: body }), by: input.by, at: Date.now() };
    return withPins(threadId, async () => {
      const change = upsertPin(await readPins(threadId), pin);
      if (!change.ok) return { ok: false as const, error: change.error };
      await writePins(threadId, change.pins);
      return { ok: true as const, pin, replaced: change.replaced, report };
    });
  }
  async function unpinCards(threadId: string, id: string | undefined, all: boolean): Promise<{ ok: boolean; removed: string[] }> {
    return withPins(threadId, async () => {
      const pins = await readPins(threadId);
      if (all) {
        if (pins.length) await writePins(threadId, []);
        return { ok: pins.length > 0, removed: pins.map((p) => p.id) };
      }
      const change = removePin(pins, id ?? "");
      if (change.ok) await writePins(threadId, change.pins);
      return { ok: change.ok, removed: change.ok ? [id ?? ""] : [] };
    });
  }
  /** What the agent is told after a pin: where it shows and what the person can do with it. */
  function pinnedText(r: Extract<PinResult, { ok: true }>, count: number): string {
    const follows = r.pin.file ? ` It re-reads ${r.pin.file} every 3 seconds while it shows, so rewrite that file to update it.` : "";
    return `${r.replaced ? "Replaced" : "Pinned"} "${r.pin.title}" (id ${r.pin.id}) beside this thread's conversation, ${count} of ${MAX_PINS} pins. The person sees it in the thread's right panel (Info tab, under Pinned cards), marked as pinned by the agent, with Unpin.${follows}\n\n${r.report}`;
  }
  const pinList = (pins: Pin[]) =>
    pins.length ? pins.map((p) => `- ${p.id}: "${p.title}", ${p.file ? `follows ${p.file}` : "card source"}, pinned by ${p.by === "agent" ? "the agent" : "the person"}`).join("\n") : "No pinned cards in this thread.";

  // ---------- the thread's own cards ----------
  // The agent reads back what the person set in its cards (a slider, a pick, notes) without asking.

  const MAX_CARDS = 30;
  type CardWithInputs = Omit<CardRef, "source"> & { n: number; inputs: Record<string, unknown> };
  async function threadCards(threadId: string): Promise<CardWithInputs[]> {
    // Finished items, newest first, a page of 100 at a time until MAX_CARDS cards turn up (at most 5
    // pages), then read oldest first. An agent message's text is final in its item/completed event.
    type Row = { seq?: number | string; type?: string; data?: { item?: { type?: string; id?: string; text?: string } } };
    const pages: Row[] = [];
    let before: string | undefined;
    for (let page = 0; page < 5; page++) {
      const rows = (await bb.sdk.threads.events.list({ threadId, types: ["item/completed"], order: "desc", limit: "100", ...(before ? { beforeSeq: before } : {}) })) as unknown as Row[];
      if (!Array.isArray(rows) || !rows.length) break;
      pages.push(...rows);
      const found = pages.reduce((n, r) => n + (r.data?.item?.type === "agentMessage" ? (r.data.item.text?.match(/```iris/g)?.length ?? 0) : 0), 0);
      if (rows.length < 100 || found >= MAX_CARDS) break;
      before = String(rows[rows.length - 1].seq);
    }
    const events = pages.reverse();
    // One entry per message, its last completed text, kept in the order the messages first appeared.
    const messages = new Map<string, string>();
    for (const e of Array.isArray(events) ? events : []) {
      const item = e.type === "item/completed" ? e.data?.item : undefined;
      if (item?.type === "agentMessage" && typeof item.id === "string" && typeof item.text === "string") messages.set(item.id, item.text);
    }
    const cards: CardRef[] = [...messages].flatMap(([id, text]) => cardsInMessage(id, text));
    const recent = cards.slice(-MAX_CARDS);
    const keys = await bb.storage.kv.list(`state:${threadId}:`);
    return Promise.all(
      recent.map(async ({ source: _source, ...card }, k) => {
        const key = keys.find((x) => isCardKey(x, { ...card, source: "" }));
        return { ...card, n: cards.length - recent.length + k + 1, inputs: key ? personInputs(await bb.storage.kv.get<unknown>(key)) : {} };
      }),
    );
  }
  const cardList = (cards: CardWithInputs[]) =>
    cards.length
      ? cards.map((c) => `#${c.n} "${c.title}" (${c.language})${Object.keys(c.inputs).length ? `: ${JSON.stringify(c.inputs)}` : ": nothing set"}`).join("\n")
      : "No Iris cards in this thread yet.";

  bb.rpc.register(cardsContract, { "cards.list": async ({ threadId }) => ({ cards: await threadCards(threadId) }) }, { experimental_discoverable: true, experimental_description: "Iris: the thread's cards and what the person set in them." });

  bb.rpc.register(
    pinsContract,
    {
      "pins.list": async ({ threadId }) => ({ pins: await readPins(threadId) }),
      "pins.set": ({ threadId, id, title, source, file, by }) => pinCard(threadId, { id, title, source, file, by: by ?? "agent" }),
      "pins.remove": ({ threadId, id, all }) => unpinCards(threadId, id, all === true),
    },
    { experimental_discoverable: true, experimental_description: "Iris: the live cards pinned beside a thread's conversation." },
  );

  // ---------- agent tools ----------

  /** iris-react apps compile with the same chunk the frontend loads; nothing is run. */
  async function checkReact(source: string): Promise<string> {
    const dir = chunkDir();
    const file = dir ? (JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { entries: Record<string, string> }).entries["react-app"] : null;
    if (!dir || !file) return "Error: the iris-react compiler is missing (dist/chunks)";
    const chunk = (await import(pathToFileURL(path.join(dir, file)).href)) as { compileApp(s: string): { ok: true; code: string } | { ok: false; problems: { message: string; line?: number }[] } };
    const result = chunk.compileApp(source);
    if (result.ok) {
      const used = [...new Set([...result.code.matchAll(/\b_iris\.([A-Za-z]\w*)/g)].map((m) => m[1]))];
      return `OK: the iris-react app compiles.${used.length ? ` From "iris": ${used.join(", ")}.` : ""} Runtime errors show under the app with their line.`;
    }
    return result.problems.map((p) => `Error${p.line ? ` (line ${p.line})` : ""}: ${p.message}`).join("\n");
  }

  /** A TSX module rather than Iris markup. */
  const isReactApp = (source: string) => /^\s*export\s+default\b/m.test(source) || /^\s*import\s[^;]*\bfrom\s*["'](react|iris|lucide-react)["']/m.test(source);

  async function checkSource(source: string, threadId: string | null): Promise<string> {
    if (isReactApp(source)) return checkReact(source);
    // First pass finds the files load() asks for; the second checks with them read.
    const asked = new Set<string>();
    check(source, { load: (p, raw, tail) => (asked.add(`${tail ? "tail:" : raw ? "raw:" : ""}${p}`), new Promise<LoadResult>(() => undefined)) });
    const preloaded = new Map<string, LoadResult>();
    const live: string[] = [];
    const bbReads: Promise<void>[] = [];
    for (const key of asked) {
      const raw = key.startsWith("raw:");
      const tail = key.startsWith("tail:");
      const p = raw ? key.slice(4) : tail ? key.slice(5) : key;
      // bb's own data is read here for real, so the check sees what the card will (in parallel, at most 5 s each).
      if (isBbSource(p)) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<LoadResult>((resolve) => (timer = setTimeout(() => resolve({ ok: false, error: "bb didn't answer within 5 s; not checked" }), 5000)));
        bbReads.push(
          Promise.race([bbData.read(threadId, p), timeout]).then((r) => {
            clearTimeout(timer);
            preloaded.set(key, r);
          }),
        );
        continue;
      }
      // A plugin's data is read here as the card reads it: from bb's own loopback address, where the
      // plugin's iris/ routes answer (at most 5 s). Unreachable, it stays pending and is named below.
      if (isPluginSource(p)) {
        const parsed = parsePluginSource(p);
        if (!parsed.ok) {
          preloaded.set(key, parsed);
          continue;
        }
        let base: string | null = null;
        try {
          base = bb.server.loopbackBaseUrl;
        } catch {
          base = null;
        }
        if (!base) {
          live.push(p);
          continue;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<LoadResult | null>((resolve) => (timer = setTimeout(() => resolve(null), 5000)));
        bbReads.push(
          Promise.race([loadPluginData(p, threadId, raw || tail, fetch, base), timeout]).then((r) => {
            clearTimeout(timer);
            if (r === null) live.push(p);
            else if (tail && r.ok) preloaded.set(key, { ok: true, value: { text: String(r.value), size: String(r.value).length, truncated: false } });
            else preloaded.set(key, r);
          }),
        );
        continue;
      }
      preloaded.set(key, threadId ? await loadFile(threadId, p, raw, tail) : { ok: false, error: "no thread to read files from" });
    }
    await Promise.all(bbReads);
    const report = formatReport(check(source, { preloaded, load: () => new Promise<LoadResult>(() => undefined) }));
    return live.length ? `${report}\n\nDidn't answer within 5 s, so not checked here (the card reads them live): ${[...new Set(live)].join(", ")}` : report;
  }

  // A dev copy installed under another id (bb-plugin-iris-dev-*) gets its own
  // gallery and fence language but never registers agent tools or instructions,
  // so it can't collide with the live Iris.
  const devInstance = bb.pluginId !== "iris";
  bb.cli.register(cliSpec());
  if (devInstance) {
    bb.log.info(`Iris dev instance ${bb.pluginId}: no agent tools or instructions`);
    return;
  }

  const [docsIndex, examplesIndex] = indexSections();

  bb.agents.registerTool({
    name: "iris_check",
    description:
      "Checks an ```iris block before you send it: syntax, unknown components or props, missing required props, files load() can't read, errors that only appear when an input moves to its ends, and a text outline of what the person will see. An ```iris-react module is compiled and its imports checked.",
    instructions: mainInstructions(stance),
    ...params(
      z.object({ source: z.string().min(1).max(200_000) }),
      { type: "object", properties: { source: { type: "string", minLength: 1, maxLength: 200_000, description: "The block's content without the ``` lines (Iris markup or an iris-react module)" } }, required: ["source"], additionalProperties: false },
    ),
    presentation: { label: { pending: "Checking Iris card", completed: "Checked Iris card" }, suppress: true },
    execute: validated(z.object({ source: z.string().min(1).max(200_000) }), async ({ source }, ctx) => {
      const report = await checkSource(source, ctx.threadId ?? null);
      return { content: [{ type: "text", text: report }], isError: report.includes("\nError") || report.startsWith("Error") };
    }),
  });

  bb.agents.registerTool({
    name: "iris_docs",
    description: "Returns every prop (type, default, meaning) and a working example for the Iris components you name; \"React\" gives the iris-react kit, \"bb\" the bb: live data shapes.",
    instructions: docsIndex.text,
    ...params(
      z.object({ components: z.array(z.string().min(1).max(40)).min(1).max(10) }),
      { type: "object", properties: { components: { type: "array", items: { type: "string", minLength: 1, maxLength: 40 }, minItems: 1, maxItems: 10, description: 'Component names, e.g. ["Chart", "Table"]' } }, required: ["components"], additionalProperties: false },
    ),
    presentation: { label: { pending: "Reading Iris docs", completed: "Read Iris docs" }, suppress: true },
    execute: validated(z.object({ components: z.array(z.string().min(1).max(40)).min(1).max(10) }), async ({ components }) => ({ content: [{ type: "text", text: docsFor(components) }] })),
  });

  const families = GROUPS.filter((g) => CATALOG.some((c) => c.group === g));
  bb.agents.registerTool({
    name: "iris_examples",
    description: "Returns working Iris examples for every component in the families you name.",
    instructions: examplesIndex.text,
    parameters: {
      type: "object",
      properties: { families: { type: "array", items: { type: "string", enum: [...families] }, minItems: 1, maxItems: 6, description: 'Component families, e.g. ["Planning", "Charts"]' } },
      required: ["families"],
      additionalProperties: false,
    },
    presentation: { label: { pending: "Reading Iris examples", completed: "Read Iris examples" }, suppress: true },
    async execute(input: unknown) {
      const asked = Array.isArray((input as { families?: unknown })?.families) ? ((input as { families: unknown[] }).families.filter((f) => typeof f === "string") as string[]) : [];
      const known = asked.filter((f) => (families as string[]).includes(f));
      if (!known.length) return { content: [{ type: "text", text: `Name one or more families: ${families.join(", ")}` }], isError: true };
      return { content: [{ type: "text", text: examplesForGroups(known) }] };
    },
  });

  bb.agents.registerTool({
    name: "iris_ask",
    description:
      "Asks the person a rich question and waits for the answer: the picker replaces the composer and the thread shows it is waiting on them. Write the picker in Iris markup with <state> for each answer and a <Submit /> button; the answer comes back as JSON of the state values. Use it for picks that need more than a few options: compare designs, tune weights, edit a table, approve a plan. Plain questions go through the host's own ask mode.",
    instructions:
      "# iris_ask\nA waiting picker for rich answers. Pass `source` (Iris markup: <state> per answer, inputs bound to them, then <Submit />), `react` (an iris-react module that calls iris.submit(value) from a click) or `html` (a full page that calls window.iris.submit(value)). Prefer `source`: it draws natively in every bb client, including the phone app; `react` and `html` run in a sandboxed frame some clients can't show. The answer arrives as a message: the submitted JSON, or a cancellation. Keep it to one decision. Example source: <state pick=\"B\" note=\"\" />\\n<Radio bind=\"pick\" label=\"Which layout?\" options={[{ value: \"A\", label: \"Sidebar\" }, { value: \"B\", label: \"Tabs\", detail: \"Recommended\" }]} />\\n<TextArea bind=\"note\" label=\"Anything to change?\" />\\n<Submit />",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 120, description: "The question, shown above the picker" },
        source: { type: "string", maxLength: 100_000, description: "Iris markup for the picker" },
        html: { type: "string", maxLength: 400_000, description: "A full HTML page instead of markup; it answers with window.iris.submit(value)" },
        react: { type: "string", maxLength: 200_000, description: 'An iris-react module instead of markup; it answers with iris.submit(value) from "iris"' },
        timeoutMinutes: { type: "integer", minimum: 1, maximum: 10_080, description: "How long to wait; default 60" },
      },
      required: ["title"],
      additionalProperties: false,
    },
    presentation: { label: { pending: "Waiting for your answer", completed: "Answered" } },
    execute: validated(ASK_PARAMS, async ({ title, source, html, react, timeoutMinutes }, ctx) => {
      if (source) {
        const report = check(source);
        if (!report.ok) return { content: [{ type: "text", text: `The picker has errors; fix them and ask again.\n${formatReport(report)}` }], isError: true };
      }
      if (react) {
        const report = await checkReact(react);
        if (report.startsWith("Error")) return { content: [{ type: "text", text: `The picker app has errors; fix them and ask again.\n${report}` }], isError: true };
      }
      if (!ctx.threadId) return { content: [{ type: "text", text: "iris_ask works only inside a thread" }], isError: true };
      const result = await bb.ui.requestInput(
        {
          threadId: ctx.threadId,
          rendererId: "iris-ask",
          title,
          payload: source ? { title, source } : react ? { title, react } : { title, html: html ?? "" },
          timeoutMs: (timeoutMinutes ?? 60) * 60_000,
          presentation: { label: { pending: `Waiting: ${title}`, completed: `Answered: ${title}` } },
          describeSubmission: (value) => ({ title: `Answered: ${title}`, detail: summarize(value) }),
        },
        { signal: ctx.signal },
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }),
  });

  // ---------- pin tools: the thread's own pins only ----------

  const PIN_PARAMS = z
    .object({
      source: z.string().min(1).max(100_000).optional(),
      file: z.string().min(1).max(2000).optional(),
      title: z.string().min(1).max(120).optional(),
      id: z.string().min(1).max(40).optional(),
    })
    .strict();
  bb.agents.registerTool({
    name: "iris_pin",
    description:
      "Pins a live Iris card beside this thread's conversation, where it stays in view and keeps refreshing while the chat scrolls on (a build, a fleet's status, a job). Give source (Iris markup) or file (a thread storage or workspace path holding the card, re-read every 3 s, so rewriting the file updates the pin). The card is checked first; one with errors isn't pinned. Pinning again with the same id replaces the pin. At most 5 pins per thread.",
    ...params(PIN_PARAMS, {
      type: "object",
      properties: {
        source: { type: "string", minLength: 1, maxLength: 100_000, description: "The card's Iris markup, without the ``` lines" },
        file: { type: "string", minLength: 1, maxLength: 2000, description: "A path such as $BB_THREAD_STORAGE/status.iris whose content is the card; the pin follows the file" },
        title: { type: "string", minLength: 1, maxLength: 120, description: "Shown above the pin; default the card's title" },
        id: { type: "string", minLength: 1, maxLength: 40, description: "Stable id (lowercase, digits, dashes); default from the title" },
      },
      additionalProperties: false,
    }),
    presentation: { label: { pending: "Pinning a card", completed: "Pinned a card" } },
    execute: validated(PIN_PARAMS, async (input, ctx: { threadId?: string | null }) => {
      if (!ctx.threadId) return { content: [{ type: "text", text: "iris_pin works only inside a thread" }], isError: true };
      const r = await pinCard(ctx.threadId, { ...input, by: "agent" });
      if (!r.ok) return { content: [{ type: "text", text: r.error }], isError: true };
      return { content: [{ type: "text", text: pinnedText(r, (await readPins(ctx.threadId)).length) }] };
    }),
  });

  const UNPIN_PARAMS = z.object({ id: z.string().min(1).max(40).optional(), all: z.boolean().optional() }).strict();
  bb.agents.registerTool({
    name: "iris_unpin",
    description: "Unpins a card from beside this thread's conversation by its id, or every pin with all: true.",
    ...params(UNPIN_PARAMS, {
      type: "object",
      properties: { id: { type: "string", minLength: 1, maxLength: 40, description: "The pin's id, from iris_pins" }, all: { type: "boolean", description: "Unpin every card in this thread" } },
      additionalProperties: false,
    }),
    presentation: { label: { pending: "Unpinning", completed: "Unpinned" } },
    execute: validated(UNPIN_PARAMS, async ({ id, all }, ctx: { threadId?: string | null }) => {
      if (!ctx.threadId) return { content: [{ type: "text", text: "iris_unpin works only inside a thread" }], isError: true };
      if (!id && !all) return { content: [{ type: "text", text: "Name the pin's id, or pass all: true" }], isError: true };
      const r = await unpinCards(ctx.threadId, id, all === true);
      return r.ok ? { content: [{ type: "text", text: `Unpinned ${r.removed.join(", ")}.` }] } : { content: [{ type: "text", text: `No pin "${id}" here.\n${pinList(await readPins(ctx.threadId))}` }], isError: true };
    }),
  });

  bb.agents.registerTool({
    name: "iris_pins",
    description: "Lists the cards pinned beside this thread's conversation: id, title, source or file, and who pinned each.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    presentation: { label: { pending: "Reading pins", completed: "Read pins" }, suppress: true },
    async execute(_input: unknown, ctx: { threadId?: string | null }) {
      if (!ctx.threadId) return { content: [{ type: "text", text: "iris_pins works only inside a thread" }], isError: true };
      return { content: [{ type: "text", text: pinList(await readPins(ctx.threadId)) }] };
    },
  });

  bb.agents.registerTool({
    name: "iris_cards",
    description: "Lists this thread's Iris cards, newest last, with what the person set in each (slider values, picks, typed notes, stored values), so you can act on a card's state without asking.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    presentation: { label: { pending: "Reading cards", completed: "Read cards" }, suppress: true },
    async execute(_input: unknown, ctx: { threadId?: string | null }) {
      if (!ctx.threadId) return { content: [{ type: "text", text: "iris_cards works only inside a thread" }], isError: true };
      return { content: [{ type: "text", text: cardList(await threadCards(ctx.threadId)) }] };
    },
  });

  // ---------- instructions ----------

  const personThreads = new Set<string>();
  const toolNames = ["iris_check", "iris_ask", "iris_docs", "iris_examples", "iris_pin", "iris_unpin", "iris_pins", "iris_cards"];
  bb.agents.configure((context) => {
    const trial = context.pluginMetadata?.iris === "trial";
    // Every top-level thread is one a person reads, whoever started it (the person, a side chat,
    // or a plugin that runs its own top-level threads). Child threads spawned by agents stay off
    // unless the workers setting is on or the thread's Iris metadata says audience "person".
    const audience = context.pluginMetadata?.audience;
    const skipped = context.origin.pluginId !== null && skipPlugins.has(context.origin.pluginId);
    const forPerson = trial || audience === "person" || (context.thread.parentThreadId === null && audience !== "agent" && !skipped);
    personThreads.delete(context.thread.id);
    if ((trialOnly && !trial) || (!forPerson && !workers)) return { tools: [], skills: [] };
    personThreads.add(context.thread.id);
    if (personThreads.size > MAX_PERSON_THREADS) personThreads.delete(personThreads.values().next().value as string);
    return { tools: toolNames, skills: [] };
  });
  bb.agents.contributeInstructions(({ threadId }) => (personThreads.has(threadId) ? CODE_WORK_INSTRUCTIONS : null));

  // ---------- CLI (hoisted: a dev instance registers it too, under its own id) ----------

  function cliSpec() {
    return defineCli({
      name: bb.pluginId,
      summary: "Iris: live UI in bb chat",
      commands: {
        check: cliCommand({
          summary: "Check an Iris block or iris-react app from a file and print what the person will see",
          positionals: [{ name: "file", description: "A file holding the block (with or without the ``` lines)", required: true }] as const,
          async run({ positionals }, ctx) {
            const fs = await import("node:fs/promises");
            const source = await fs.readFile(positionals.file, "utf8");
            const body = source.replace(/^\s*```[\w-]*[^\n]*\n/, "").replace(/```\s*$/, "");
            if (isReactApp(body)) {
              const text = await checkReact(body);
              return { exitCode: text.startsWith("Error") ? 1 : 0, stdout: `${text}\n` };
            }
            // From a thread's shell it reads that thread's files, bb data and plugin feeds, as iris_check does.
            const report = await checkSource(body, ctx.threadId ?? null);
            return { exitCode: report.startsWith("Error") || report.includes("\nError") ? 1 : 0, stdout: `${report}\n` };
          },
        }),
        pin: cliCommand({
          summary: "Pin a card beside this thread's conversation; the pin follows the file, so rewriting it updates the card",
          description: "Checked first: a card with errors isn't pinned. With --once the card's source is stored instead of the file's path. Pinning again with the same --id replaces the pin. At most 5 pins per thread.",
          positionals: [{ name: "file", description: "A file holding the card, e.g. $BB_THREAD_STORAGE/status.iris (with or without the ``` lines)", required: true }] as const,
          options: {
            title: { type: "string", description: "Shown above the pin; default the card's title" },
            id: { type: "string", description: "Stable id (lowercase, digits, dashes); default from the title" },
            once: { type: "boolean", description: "Pin the card as it is now instead of following the file" },
          },
          async run(input, ctx) {
            const threadId = ctx.threadId;
            if (!threadId) throw new PluginCliError("pin acts on the thread it runs in", { code: "thread_required", hint: "Run it from an agent's shell in bb, where BB_THREAD_ID is set" });
            let source: string | undefined;
            if (input.options.once) {
              const read = await loadFile(threadId, input.positionals.file, true);
              if (!read.ok || typeof read.value !== "string") throw new PluginCliError(`couldn't read ${input.positionals.file}${read.ok ? "" : `: ${read.error}`}`, { code: "unreadable" });
              source = cardFromFile(read.value);
            }
            const r = await pinCard(threadId, { id: input.options.id, title: input.options.title, ...(source ? { source } : { file: input.positionals.file }), by: "agent" });
            if (!r.ok) return { exitCode: 1, stdout: "", stderr: `${r.error}\n` };
            return { exitCode: 0, stdout: `${pinnedText(r, (await readPins(threadId)).length)}\n` };
          },
        }),
        unpin: cliCommand({
          summary: "Unpin a card from beside this thread's conversation",
          positionals: [{ name: "id", description: "The pin's id, from `bb iris pins`" }] as const,
          options: { all: { type: "boolean", description: "Unpin every card in this thread" } },
          async run(input, ctx) {
            const threadId = ctx.threadId;
            if (!threadId) throw new PluginCliError("unpin acts on the thread it runs in", { code: "thread_required", hint: "Run it from an agent's shell in bb, where BB_THREAD_ID is set" });
            if (!input.positionals.id && !input.options.all) throw new PluginCliError("name the pin's id, or pass --all", { code: "invalid" });
            const r = await unpinCards(threadId, input.positionals.id, input.options.all === true);
            return r.ok ? { exitCode: 0, stdout: `Unpinned ${r.removed.join(", ")}.\n` } : { exitCode: 1, stdout: "", stderr: `No pin "${input.positionals.id}" here.\n${pinList(await readPins(threadId))}\n` };
          },
        }),
        cards: cliCommand({
          summary: "List this thread's Iris cards with what the person set in each",
          options: { json: { type: "boolean", description: "Print the cards as JSON" } },
          async run(input, ctx) {
            const threadId = ctx.threadId;
            if (!threadId) throw new PluginCliError("cards reads the thread it runs in", { code: "thread_required", hint: "Run it from an agent's shell in bb, where BB_THREAD_ID is set" });
            const cards = await threadCards(threadId);
            return { exitCode: 0, stdout: `${input.options.json ? JSON.stringify(cards, null, 2) : cardList(cards)}\n` };
          },
        }),
        pins: cliCommand({
          summary: "List the cards pinned beside this thread's conversation",
          options: { json: { type: "boolean", description: "Print the pins as JSON" } },
          async run(input, ctx) {
            const threadId = ctx.threadId;
            if (!threadId) throw new PluginCliError("pins reads the thread it runs in", { code: "thread_required", hint: "Run it from an agent's shell in bb, where BB_THREAD_ID is set" });
            const pins = await readPins(threadId);
            return { exitCode: 0, stdout: `${input.options.json ? JSON.stringify(pins, null, 2) : pinList(pins)}\n` };
          },
        }),
        try: cliCommand({
          summary: "Try a prompt in a subthread whose agent knows Iris",
          description: "The subthread belongs to this thread. Open it in bb to see the cards; `bb thread wait <id>` waits for the reply.",
          options: {
            model: { type: "string", description: "Model ID; omitted, the project's default" },
            provider: { type: "string", description: "Provider ID; omitted, the project's remembered provider" },
            title: { type: "string", description: "Subthread title" },
          },
          positionals: [{ name: "prompt", description: "The message to send", required: true }] as const,
          async run(input, ctx) {
            const parentId = ctx.threadId;
            if (!parentId) throw new PluginCliError("try runs inside a thread", { code: "thread_required", hint: "Run it from an agent's shell in bb, where BB_THREAD_ID is set" });
            const parent = await bb.sdk.threads.get({ threadId: parentId });
            const thread = await bb.sdk.threads.spawn({
              projectId: parent.projectId,
              environment: parent.environmentId === null ? { type: "project-default" } : { type: "reuse", environmentId: parent.environmentId },
              parentThreadId: parentId,
              lifecycleOwnerThreadId: parentId,
              prompt: input.positionals.prompt,
              title: input.options.title ?? `Iris: ${input.positionals.prompt.slice(0, 60)}`,
              providerId: input.options.provider,
              model: input.options.model,
              // No audience flag: other UI plugins that key on it stay out of the trial.
              pluginMetadata: { iris: "trial" },
            });
            return { exitCode: 0, stdout: `${thread.id}\n` };
          },
        }),
        components: cliCommand({
          summary: "List every Iris component with its one-line summary",
          async run() {
            return { exitCode: 0, stdout: `${CATALOG.map((c) => `${c.name.padEnd(16)} ${c.group.padEnd(10)} ${c.summary}`).join("\n")}\n` };
          },
        }),
        docs: cliCommand({
          summary: "Print every prop and an example for the named components",
          positionals: [{ name: "names", description: "Component names", required: true, variadic: true }] as const,
          async run({ positionals }) {
            return { exitCode: 0, stdout: `${docsFor(positionals.names)}\n` };
          },
        }),
      },
    });
  }

  bb.log.info(`Iris loaded: ${CATALOG.length} components, stance ${stance}`);
}

function summarize(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text.length > 400 ? `${text.slice(0, 397)}...` : text;
  } catch {
    return "";
  }
}

/** Serves each file in dist/chunks on its own exact route, precompressed. */
function chunkDir(): string | undefined {
  const here = import.meta.dirname ?? path.dirname(fileURLToPath(import.meta.url));
  return [path.join(here, "dist", "chunks"), path.join(here, "chunks")].find((d) => existsSync(path.join(d, "manifest.json")));
}

function serveChunks(bb: BbPluginApi) {
  const dir = chunkDir();
  if (!dir) {
    bb.log.warn("no dist/chunks/manifest.json: run node scripts/build-chunks.mjs");
    return;
  }
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as { files: Record<string, number> };
  for (const name of Object.keys(manifest.files)) {
    const file = path.join(dir, name);
    const identity = readFileSync(file);
    const br = existsSync(`${file}.br`) ? readFileSync(`${file}.br`) : null;
    const gzip = existsSync(`${file}.gz`) ? readFileSync(`${file}.gz`) : null;
    const type = name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".woff2") ? "font/woff2" : name.endsWith(".mp4") ? "video/mp4" : name.endsWith(".ttf") ? "font/ttf" : "text/javascript; charset=utf-8";
    bb.http.route(
      "GET",
      `/c/${name}`,
      (c) => {
        const accept = c.req.header("accept-encoding") ?? "";
        const [body, encoding] = br && /\bbr\b/.test(accept) ? [br, "br"] : gzip && /\bgzip\b/.test(accept) ? [gzip, "gzip"] : [identity, null];
        const headers: Record<string, string> = { "content-type": type, "cache-control": "public, max-age=31536000, immutable", vary: "accept-encoding", "x-content-type-options": "nosniff" };
        if (encoding) headers["content-encoding"] = encoding;
        return new Response(new Uint8Array(body), { status: 200, headers });
      },
      { auth: "local" },
    );
  }

  // Iris's own sample of the public plugin data contract: load("plugin:iris/example") in any card.
  bb.http.route(
    "GET",
    "/iris/example",
    () => {
      const now = Date.now();
      const minute = Math.floor(now / 60_000);
      const points = Array.from({ length: 12 }, (_, k) => ({ t: new Date((minute - 11 + k) * 60_000).toISOString(), value: Math.round(50 + 30 * Math.sin((minute - 11 + k) / 3)) }));
      const body = { source: "iris", updated: new Date(now).toISOString(), seconds: new Date(now).getSeconds(), points };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
    },
    { auth: "local" },
  );
}
