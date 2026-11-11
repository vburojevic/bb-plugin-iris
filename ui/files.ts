// Reading the thread's files from the frontend, through the plugin's server.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { RpcContract } from "../shared/rpc";
import { DEMO_THREAD } from "./demo";
import { useEnv } from "./env";

/** final: reading the file again can't help (not an image type, over the size limit). */
export type ImageState = { status: "loading" } | { status: "ok"; url: string } | { status: "error"; error: string; final?: boolean };

const imageCache = new Map<string, Promise<ImageState>>();

/** Every complete string literal in a block ("...", '...', `...` without ${}), and quoted attribute values. */
const literalCache = new Map<string, Set<string>>();
export function literalStrings(source: string): Set<string> {
  let set = literalCache.get(source);
  if (!set) {
    set = new Set<string>();
    for (const m of source.matchAll(/"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\$]|\\.)*)`/g)) {
      const body = m[1] ?? m[2] ?? m[3] ?? "";
      set.add(body);
      // The same literal with its escapes read (\u0041, \/), as the interpreter would.
      try {
        set.add(JSON.parse(`"${body.replace(/\\'/g, "'").replace(/"/g, '\\"')}"`));
      } catch {
        // Not a JSON-compatible escape: the literal as written is enough.
      }
    }
    if (literalCache.size > 200) literalCache.clear();
    literalCache.set(source, set);
  }
  return set;
}

const direct = (src: string) => /^https:\/\//.test(src) || src.startsWith("data:image/");

/** What an image source resolves to: at once for URLs, later for files the server reads. */
export function resolveImage(src: string, threadId: string | null, rpc: Pick<ReturnType<typeof useRpc<RpcContract>>, "call">, source: string): ImageState | Promise<ImageState> {
  // A remote image must be written out in the block: a URL built from data (a file, a plugin's
  // feed) would send that data to another server just by rendering.
  if (/^https:\/\//.test(src) && !literalStrings(source).has(src)) return { status: "error", error: "a web image must be written out in full in the block, not built from data" };
  if (direct(src)) return { status: "ok", url: src };
  if (/^http:\/\//.test(src)) return { status: "error", error: "only https images load" };
  if (!threadId && DEMO_THREAD) threadId = DEMO_THREAD;
  if (!threadId) return { status: "error", error: "files load only inside a thread" };
  const key = `${threadId}:${src}`;
  let p = imageCache.get(key);
  if (!p) {
    const read: Promise<ImageState> = rpc.call("load_image", { threadId, path: src }).then(
      (r): ImageState => (r.ok ? { status: "ok", url: r.dataUrl } : { status: "error", error: r.error, ...(r.final ? { final: true } : {}) }),
      (e: unknown): ImageState => ({ status: "error", error: e instanceof Error ? e.message : String(e) }),
    );
    // Only a shown image is remembered. A failed read (bb busy, the file not written yet) is
    // forgotten after a moment, so the next ask reads again instead of showing the failure for good,
    // while a block that is still streaming doesn't ask on every chunk.
    p = read.then((done) => {
      if (done.status === "error") setTimeout(() => imageCache.get(key) === p && imageCache.delete(key), FAILED_IMAGE_KEEP_MS);
      return done;
    });
    imageCache.set(key, p);
  }
  return p;
}

/** How long a failed read is kept before the next ask reads the file again. */
export const FAILED_IMAGE_KEEP_MS = 1_500;

/** While a file image that failed stays on screen, it reads again after these waits, the last repeating. */
export const IMAGE_RETRY_MS = [2_000, 5_000, 10_000, 20_000, 30_000];

function sameImage(a: ImageState, b: ImageState): boolean {
  return a.status === b.status && (a.status !== "ok" || a.url === (b as { url: string }).url) && (a.status !== "error" || a.error === (b as { error: string }).error);
}

/** An https URL loads as is; a workspace or thread-storage path is read by the server. */
export function useLoadedImage(src: string): ImageState {
  return useLoadedImages([src])[0];
}

/** Several images at once, in order; each settles on its own. A file that failed to read is read again while it shows. */
export function useLoadedImages(srcs: string[]): ImageState[] {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const key = JSON.stringify(srcs);
  const [states, setStates] = useState<{ key: string; list: ImageState[] }>(() => ({ key, list: srcs.map((): ImageState => ({ status: "loading" })) }));
  const [attempt, setAttempt] = useState({ key, n: 0 });
  const n = attempt.key === key ? attempt.n : 0;
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const list: (ImageState | Promise<ImageState>)[] = srcs.map((s) => resolveImage(s, env.threadId, rpc, env.source ?? ""));
    const now = list.map((s): ImageState => (s instanceof Promise ? { status: "loading" } : s));
    // Keep the same object when nothing changed, so a remount costs no extra render. While a file is
    // read again (a retry, the block still streaming), it keeps what it showed until the new read lands.
    setStates((cur) => {
      const next = cur.key === key ? now.map((x, k) => (x.status === "loading" && cur.list[k] && cur.list[k].status !== "loading" ? cur.list[k] : x)) : now;
      return cur.key === key && cur.list.length === next.length && cur.list.every((x, k) => sameImage(x, next[k])) ? cur : { key, list: next };
    });
    // The first failed read that can change (bb busy, the file not written yet) schedules one more round.
    const retry = () => {
      if (!live || timer !== undefined) return;
      timer = setTimeout(() => live && setAttempt({ key, n: n + 1 }), IMAGE_RETRY_MS[Math.min(n, IMAGE_RETRY_MS.length - 1)]);
    };
    list.forEach((s, k) => {
      if (!(s instanceof Promise)) return;
      s.then((done) => {
        if (!live) return;
        setStates((cur) => (cur.key === key ? { key, list: cur.list.map((x, j) => (j === k ? done : x)) } : cur));
        if (done.status === "error" && !done.final) retry();
      });
    });
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, env.threadId, rpc, env.source, n]);
  return states.key === key ? states.list : srcs.map((): ImageState => ({ status: "loading" }));
}

/** A short, readable reason an image didn't load: the file name once, never a long path. */
export function imageError(src: string, error: string): string {
  const name = src.startsWith("data:") ? "the image" : (src.split(/[\\/]/).pop() ?? src);
  return error.includes(name) ? `Couldn't show it: ${error}` : `Couldn't show ${name}: ${error}`;
}
