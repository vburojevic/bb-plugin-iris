// Loads a chunk from Iris's own HTTP route with a plain dynamic import, the
// same way bb loads app.js. Hashed file names make the response immutable.
//
// Chunks that render React import "react", "react/jsx-runtime",
// "@get-bb/plugin-sdk/app" and "@iris/ui" (ui/chunk-api.ts).
// scripts/build-chunks.mjs maps those to the holder below, keyed by plugin id
// (a dev copy and the live Iris each get their own) and replaced on every
// evaluation of this bundle, so a plugin reload re-points loaded chunks.
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as sdk from "@get-bb/plugin-sdk/app";
import manifest from "../dist/chunks/manifest.json";
import { CHUNK_API } from "./chunk-api";

declare const __BB_PLUGIN_ID__: string | undefined;
const PLUGIN_ID = typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : "iris";

/** Keep in sync with SHARED_KEY in scripts/build-chunks.mjs. Bump the suffix when the shape changes. */
const SHARED_KEY = "__iris_shared_v1";

function installShared() {
  const g = globalThis as unknown as Record<string, Record<string, { current: Record<string, unknown> }> | undefined>;
  const all = (g[SHARED_KEY] ??= {});
  const holder = (all[PLUGIN_ID] ??= { current: {} });
  holder.current = { react: React, jsxRuntime, sdk, iris: CHUNK_API };
}

const loading = new Map<string, Promise<unknown>>();
let installed = false;

function chunkUrl(file: string): string {
  // The static playground site serves the same chunks from its own folder.
  const base = (globalThis as { __IRIS_CHUNK_BASE__?: string }).__IRIS_CHUNK_BASE__;
  if (base) return new URL(file, base).href;
  return new URL(`/api/v1/plugins/${encodeURIComponent(PLUGIN_ID)}/http/c/${file}`, import.meta.url).href;
}

export type ChunkName = keyof typeof manifest.entries;

export function loadChunk<T>(name: ChunkName): Promise<T> {
  let p = loading.get(name);
  if (!p) {
    if (!installed) {
      installShared();
      installed = true;
    }
    const file = (manifest.entries as Record<string, string>)[name];
    const url = chunkUrl(file);
    // A computed specifier keeps bb's bundler from inlining the chunk.
    p = import(/* @vite-ignore */ url);
    loading.set(name, p);
    p.catch(() => loading.delete(name));
  }
  return p as Promise<T>;
}

/** A chunk entry's URL by its manifest name (pdf.js loads its worker from it). */
export function chunkEntryUrl(name: string): string {
  const file = (manifest.entries as Record<string, string>)[name];
  if (!file) throw new Error(`Iris has no chunk named ${name}`);
  return chunkUrl(file);
}

/** A bundled sample file (the gallery's clip and font) by its manifest name. */
export function sampleUrl(name: string): string {
  const file = (manifest as { samples?: Record<string, string> }).samples?.[name];
  if (!file) throw new Error(`Iris has no sample named ${name}`);
  return chunkUrl(file);
}

const styles = new Map<string, Promise<void>>();

/** Adds a chunk's stylesheet to the page once; resolves when it has loaded. */
export function loadStyle(name: keyof typeof manifest.styles): Promise<void> {
  let p = styles.get(name);
  if (!p) {
    const href = chunkUrl((manifest.styles as Record<string, string>)[name]);
    p = new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLLinkElement>(`link[data-iris-style="${name}"]`);
      if (existing?.sheet) return resolve();
      const link = existing ?? document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.irisStyle = name;
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => (link.remove(), reject(new Error(`Iris couldn't load the ${name} styles`))), { once: true });
      if (!existing) document.head.append(link);
    });
    styles.set(name, p);
    p.catch(() => styles.delete(name));
  }
  return p;
}
