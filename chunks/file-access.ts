// How the files and media chunks reach the thread's files. The server leases
// the file's folder from bb (shared/rpc.ts file_url, folder_files) and the
// browser streams from that URL with byte ranges; a lease that lapses is
// renewed on the next error. Without a thread (the gallery) views use the
// bundled samples (sampleUrl).

import { useRpc } from "@get-bb/plugin-sdk/app";
import { literalStrings, sampleUrl, useEnv } from "@iris/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FolderFilesResult, RpcContract } from "../shared/rpc";

export type FileUrlState =
  | { status: "loading" }
  | { status: "sample" }
  | { status: "ok"; url: string; via: "stream" | "data" | "direct"; expiresAtMs: number | null }
  | { status: "error"; error: string };

/** A relative lease URL made absolute against the origin the chunk came from. */
export function absolute(url: string): string {
  return /^(data:|blob:|https?:)/.test(url) ? url : new URL(url, import.meta.url).href;
}

/** A file inside a leased folder: each path segment encoded. */
export function inFolder(base: string, rel: string): string {
  return absolute(`${base.replace(/\/+$/, "")}/${rel.split("/").map(encodeURIComponent).join("/")}`);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The URL to stream `src` from. https URLs pass through; paths go to the
 * server. renew() asks again (a lease that expired, a file that changed).
 */
export function useFileUrl(src: string | undefined): [FileUrlState, () => void] {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const [state, setState] = useState<FileUrlState>({ status: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!src) return setState({ status: "error", error: "needs a src" });
    // Like web images: a media URL must be written out in the block, so data a card read
    // (a file, a plugin feed) can't be sent to another server by building a URL from it.
    if (/^https:\/\//.test(src)) {
      if (!literalStrings(env.source ?? "").has(src)) return setState({ status: "error", error: "a web URL must be written out in full in the block, not built from data" });
      return setState({ status: "ok", url: src, via: "direct", expiresAtMs: null });
    }
    if (/^http:\/\//.test(src)) return setState({ status: "error", error: "only https URLs load" });
    if (!env.threadId) return setState({ status: "sample" });
    let live = true;
    setState({ status: "loading" });
    rpc.call("file_url", { threadId: env.threadId, path: src }).then(
      (r) => live && setState(r.ok ? { status: "ok", url: absolute(r.url), via: r.via, expiresAtMs: r.expiresAtMs } : { status: "error", error: r.error }),
      (e: unknown) => live && setState({ status: "error", error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [src, env.threadId, env.source, rpc, round]);
  const renew = useCallback(() => setRound((n) => n + 1), []);
  return [state, renew];
}

/** True when a URL's lease has run out and asking again would help. */
export function leaseLapsed(state: FileUrlState): boolean {
  return state.status === "ok" && state.expiresAtMs !== null && Date.now() > state.expiresAtMs - 5_000;
}

/** Why a stream failed, in words: reads the status with a one-byte range request. */
export async function probe(url: string): Promise<{ ok: true; size: number | null; type: string | null } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, { headers: { range: "bytes=0-0" }, credentials: "same-origin" });
    if (r.status === 404) return { ok: false, error: "file not found" };
    if (!r.ok) return { ok: false, error: `bb answered ${r.status}` };
    const total = /\/(\d+)$/.exec(r.headers.get("content-range") ?? "")?.[1];
    const size = total ? Number(total) : r.headers.get("content-length") ? Number(r.headers.get("content-length")) : null;
    void r.body?.cancel();
    return { ok: true, size: size !== null && Number.isFinite(size) ? size : null, type: r.headers.get("content-type") };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

/** Sizes of files in a leased folder, HEAD by HEAD with a few in flight; reports as they land. */
export function headSizes(base: string, paths: readonly string[], onSize: (path: string, size: number | null) => void, signal: AbortSignal, parallel = 8): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < paths.length && !signal.aborted) {
      const p = paths[next++];
      try {
        const r = await fetch(inFolder(base, p), { method: "HEAD", credentials: "same-origin", signal });
        const n = Number(r.headers.get("content-length"));
        onSize(p, r.ok && Number.isFinite(n) ? n : null);
      } catch {
        if (!signal.aborted) onSize(p, null);
      }
    }
  };
  return Promise.all(Array.from({ length: Math.min(parallel, paths.length) }, worker)).then(() => undefined);
}

export type FolderState = { status: "loading" } | { status: "sample" } | { status: "error"; error: string } | Extract<FolderFilesResult, { ok: true }> & { status: "ok" };

/** A folder's files and its lease. Nothing is read while enabled is false. */
export function useFolder(path: string, limit: number, enabled = true): [FolderState, () => void] {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const [state, setState] = useState<FolderState>({ status: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    if (!env.threadId) return setState({ status: "sample" });
    let live = true;
    setState((s) => (s.status === "ok" ? s : { status: "loading" }));
    rpc.call("folder_files", { threadId: env.threadId, path, limit }).then(
      (r) => live && setState(r.ok ? { ...r, status: "ok" } : { status: "error", error: r.error }),
      (e: unknown) => live && setState({ status: "error", error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [path, limit, enabled, env.threadId, rpc, round]);
  const refresh = useCallback(() => setRound((n) => n + 1), []);
  return [state, refresh];
}

/** Bytes of a file (or a sample), for decoding audio, parsing fonts and the sample clip. Capped. */
export async function fetchBytes(url: string, cap: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(url, { credentials: "same-origin", signal });
  if (r.status === 404) throw new Error("file not found");
  if (!r.ok) throw new Error(`bb answered ${r.status}`);
  const size = Number(r.headers.get("content-length"));
  if (Number.isFinite(size) && size > cap) {
    void r.body?.cancel();
    throw new Error(`the file is ${Math.round(size / 1048576)} MB, over the ${Math.round(cap / 1048576)} MB limit`);
  }
  const buf = await r.arrayBuffer();
  if (buf.byteLength > cap) throw new Error(`the file is over the ${Math.round(cap / 1048576)} MB limit`);
  return buf;
}

/** A bundled sample as an object URL (so it seeks without range requests); kept for the page's life. */
const samples = new Map<string, Promise<string>>();
export function sampleObjectUrl(name: "clip" | "font"): Promise<string> {
  let p = samples.get(name);
  if (!p) {
    p = fetch(sampleUrl(name))
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`sample ${name}: ${r.status}`))))
      .then((b) => URL.createObjectURL(b));
    samples.set(name, p);
    p.catch(() => samples.delete(name));
  }
  return p;
}

/** Resolves to a sample's object URL while mounted. */
export function useSample(name: "clip" | "font", enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (enabled) sampleObjectUrl(name).then((u) => alive.current && setUrl(u), () => undefined);
    return () => {
      alive.current = false;
    };
  }, [name, enabled]);
  return enabled ? url : null;
}
