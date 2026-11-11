// The frontend <-> server contract. Both schemas run at the wire boundary.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { ChangesResult, CommitsResult, EnvironmentsResult, PatchResult, PullRequestResult, ThreadsResult } from "../core/project";
import type { GeocodeResult, PhotoResult, TileResult } from "../core/web";

const json = z.unknown();
const threadId = z.string().min(1).max(64);

export const rpcContract = defineRpcContract({
  /** Reads a workspace or thread-storage file for load() and Snippet, parsed by extension unless raw; tail gives the end of a growing log as {text, size, truncated}. */
  load_file: {
    input: z.object({ threadId: z.string().min(1), path: z.string().min(1).max(2000), raw: z.boolean().optional(), tail: z.boolean().optional() }),
    output: z.union([z.object({ ok: z.literal(true), value: json }), z.object({ ok: z.literal(false), error: z.string() })]),
  },
  /** An image from the workspace or thread storage as a data URL. */
  load_image: {
    input: z.object({ threadId: z.string().min(1), path: z.string().min(1).max(2000) }),
    // final: reading again can't help (not an image type, over the size limit).
    output: z.union([z.object({ ok: z.literal(true), dataUrl: z.string() }), z.object({ ok: z.literal(false), error: z.string(), final: z.boolean().optional() })]),
  },
  /** A 3D model (.glb or .gltf) from the workspace or thread storage, base64, for Scene. */
  load_model: {
    input: z.object({ threadId: z.string().min(1), path: z.string().min(1).max(2000) }),
    output: z.union([z.object({ ok: z.literal(true), base64: z.string(), ext: z.enum(["glb", "gltf"]) }), z.object({ ok: z.literal(false), error: z.string() })]),
  },
  /** A workspace or thread-storage file to stream (players, PDFs, fonts): a bb preview URL that answers byte ranges, or a data URL when bb can't lease one. */
  file_url: {
    input: z.object({ threadId, path: z.string().min(1).max(2000) }),
    output: z.custom<FileUrlResult>(),
  },
  /** Files under a folder (recursive; dependency and build folders such as node_modules skipped) and a preview URL for the folder, for FileTree and AssetGallery. */
  folder_files: {
    input: z.object({ threadId, path: z.string().max(2000), limit: z.number().int().min(1).max(2000).optional() }),
    output: z.custom<FolderFilesResult>(),
  },
  /** Where a thread's files live, so links can open them. */
  thread_info: {
    input: z.object({ threadId: z.string().min(1) }),
    output: z.object({
      environmentId: z.string().nullable(),
      hostId: z.string().nullable(),
      workspacePath: z.string().nullable(),
      storagePath: z.string().nullable(),
    }),
  },
  /** A card's saved state (sliders, tabs, toggles), shared across devices. */
  state_get: {
    input: z.object({ key: z.string().min(1).max(300) }),
    output: z.object({ state: z.record(z.string(), json).nullable() }),
  },
  state_set: {
    input: z.object({ key: z.string().min(1).max(300), state: z.record(z.string(), json) }),
    output: z.object({ ok: z.boolean() }),
  },
  // Live project components. Each reads the card's own thread: its checkout, its project.
  /** Changed files with counts and the patches of small files. target: null (the branch's work), "uncommitted" or a sha. */
  project_changes: {
    input: z.object({ threadId, target: z.string().max(64).nullable(), paths: z.array(z.string().max(1024)).max(50).nullable() }),
    output: z.custom<ChangesResult>(),
  },
  /** One changed file's patch, for files whose patch didn't come with the list. */
  project_patch: {
    input: z.object({ threadId, target: z.string().max(64).nullable(), path: z.string().min(1).max(1024), revision: z.string().min(1).max(200) }),
    output: z.custom<PatchResult>(),
  },
  project_commits: { input: z.object({ threadId }), output: z.custom<CommitsResult>() },
  project_pull_request: { input: z.object({ threadId }), output: z.custom<PullRequestResult>() },
  project_environments: { input: z.object({ threadId }), output: z.custom<EnvironmentsResult>() },
  /** ids: null for the thread's subthreads. */
  /** Live data from bb itself for load("bb:<source>"), scoped to the card's thread. */
  bb_data: {
    input: z.object({ threadId: z.string().min(1).max(64).nullable(), spec: z.string().min(3).max(300) }),
    output: z.union([z.object({ ok: z.literal(true), value: json }), z.object({ ok: z.literal(false), error: z.string() })]),
  },
  project_threads: {
    input: z.object({ threadId, ids: z.array(z.string().max(80)).max(100).nullable() }),
    output: z.custom<ThreadsResult>(),
  },
  // Web lookups. The server builds every URL from these fields; a block never names one.
  /** Whether web lookups are on in Iris's settings. */
  web_status: { input: z.object({}), output: z.object({ enabled: z.boolean() }) },
  /** One OpenStreetMap tile as a data URL. */
  map_tile: {
    input: z.object({ z: z.number().int().min(0).max(19), x: z.number().int().min(0), y: z.number().int().min(0) }),
    output: z.custom<TileResult>(),
  },
  /** Places by name; each result is null when nothing matched. */
  geocode: {
    input: z.object({ queries: z.array(z.string().min(1).max(200)).min(1).max(25) }),
    output: z.custom<GeocodeResult>(),
  },
  /** A credited photo from Wikimedia Commons for a description. */
  photo_search: {
    input: z.object({ query: z.string().min(1).max(200), width: z.number().int().min(100).max(2000).optional() }),
    output: z.custom<PhotoResult>(),
  },
});

export type RpcContract = typeof rpcContract;

export type FileUrlResult = { ok: true; url: string; via: "stream" | "data"; expiresAtMs: number | null; name: string } | { ok: false; error: string };

export type FolderFilesResult =
  | {
      ok: true;
      /** Paths from the folder, "/"-separated. */
      files: string[];
      truncated: boolean;
      /** The folder's preview URL (append a file's encoded path), or null when bb couldn't lease one. */
      base: string | null;
      expiresAtMs: number | null;
      /** The folder as a card path: workspace-relative or under $BB_THREAD_STORAGE. */
      folder: string;
      /** The folder's path from the workspace root, for git markers; null in thread storage. */
      repoPrefix: string | null;
    }
  | { ok: false; error: string };
