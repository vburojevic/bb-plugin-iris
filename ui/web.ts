// Web lookups from the frontend, always through Iris's server: the browser
// never fetches a tile, a place or a photo itself. Answers are kept for the
// session so cards that redraw or repeat a place ask once.
import { useEffect, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { GeoHit, Photo, WebFailure } from "../core/web";
import type { RpcContract } from "../shared/rpc";

type Rpc = ReturnType<typeof useRpc<RpcContract>>;

const failure = (e: unknown): WebFailure => ({ ok: false, code: "failed", error: e instanceof Error ? e.message : String(e) });

// ---------- on or off ----------

let status: { at: number; p: Promise<boolean> } | null = null;

/** Whether web lookups are on: null while asking. */
export function useWebLookups(): boolean | null {
  const rpc = useRpc<RpcContract>();
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (!status || Date.now() - status.at > 30_000) {
      const p = rpc.call("web_status", {}).then(
        (r) => r.enabled,
        () => false,
      );
      status = { at: Date.now(), p };
    }
    status.p.then((v) => live && setOn(v));
    return () => {
      live = false;
    };
  }, [rpc]);
  return on;
}

// ---------- tiles ----------

const tiles = new Map<string, Promise<string | null>>();
const MAX_TILES = 600;

export function loadTile(rpc: Rpc, z: number, x: number, y: number): Promise<string | null> {
  const key = `${z}/${x}/${y}`;
  const hit = tiles.get(key);
  if (hit) {
    tiles.delete(key);
    tiles.set(key, hit);
    return hit;
  }
  const p = rpc.call("map_tile", { z, x, y }).then(
    (r) => (r.ok ? r.dataUrl : null),
    () => null,
  );
  // A failed tile is asked again next time rather than kept as a hole.
  p.then((url) => url === null && tiles.delete(key));
  tiles.set(key, p);
  if (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value as string);
  return p;
}

// ---------- places ----------

export type GeoState = { status: "loading" } | { status: "found"; hit: GeoHit } | { status: "missing" } | { status: "error"; error: string; off: boolean };

const places = new Map<string, Promise<GeoState>>();

/** Looks up each query; a null query (a place with coordinates) is skipped. */
export function useGeocode(queries: (string | undefined)[]): GeoState[] {
  const rpc = useRpc<RpcContract>();
  const key = JSON.stringify(queries);
  const [states, setStates] = useState<{ key: string; list: GeoState[] }>({ key: "", list: [] });
  useEffect(() => {
    let live = true;
    const wanted = queries.map((q) => q?.replace(/\s+/g, " ").trim().toLowerCase() || null);
    const missing = [...new Set(wanted.filter((q): q is string => Boolean(q) && !places.has(q!)))];
    if (missing.length) {
      const batch = rpc.call("geocode", { queries: missing }).then(
        (r) => r,
        (e: unknown) => failure(e),
      );
      missing.forEach((q, k) =>
        places.set(
          q,
          batch.then((r): GeoState => {
            if (!r.ok) {
              places.delete(q);
              return { status: "error", error: r.error, off: r.code === "off" };
            }
            const hit = r.results[k];
            return hit ? { status: "found", hit } : { status: "missing" };
          }),
        ),
      );
    }
    const list: GeoState[] = wanted.map(() => ({ status: "loading" }));
    setStates({ key, list });
    wanted.forEach((q, k) => {
      if (!q) return;
      places.get(q)?.then((s) => live && setStates((cur) => (cur.key === key ? { key, list: cur.list.map((x, j) => (j === k ? s : x)) } : cur)));
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rpc]);
  return states.key === key ? states.list : queries.map(() => ({ status: "loading" }));
}

// ---------- photos ----------

export type PhotoState = { status: "loading" } | { status: "ok"; photo: Photo } | { status: "error"; error: string; code: WebFailure["code"] };

const photos = new Map<string, Promise<PhotoState>>();

export function usePhoto(query: string, width: number): PhotoState {
  const rpc = useRpc<RpcContract>();
  const key = `${width}:${query.replace(/\s+/g, " ").trim().toLowerCase()}`;
  const [state, setState] = useState<{ key: string; s: PhotoState }>({ key: "", s: { status: "loading" } });
  useEffect(() => {
    let live = true;
    if (!query.trim()) {
      setState({ key, s: { status: "error", error: "PhotoSearch needs a query", code: "invalid" } });
      return;
    }
    let p = photos.get(key);
    if (!p) {
      p = rpc.call("photo_search", { query: query.trim().slice(0, 200), width }).then(
        (r): PhotoState => (r.ok ? { status: "ok", photo: r.photo } : { status: "error", error: r.error, code: r.code }),
        (e: unknown): PhotoState => ({ status: "error", error: failure(e).error, code: "failed" }),
      );
      photos.set(key, p);
      p.then((s) => s.status === "error" && s.code !== "not_found" && photos.delete(key));
    }
    setState({ key, s: { status: "loading" } });
    p.then((s) => live && setState({ key, s }));
    return () => {
      live = false;
    };
  }, [key, query, width, rpc]);
  return state.key === key ? state.s : { status: "loading" };
}
