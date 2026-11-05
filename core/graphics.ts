// Scene and Shader rules that need no browser: object normalization, the
// per-frame merge of an animate() result, theme color names, and the
// Shadertoy wrapper with compile errors mapped back to the person's lines.

import { readField, toText } from "./evaluate";

export const SCENE_TYPES = ["box", "sphere", "cylinder", "torus", "plane", "text", "gltf"] as const;
export type SceneType = (typeof SCENE_TYPES)[number];
export type Vec3 = [number, number, number];

export interface SceneObject {
  id: string;
  type: SceneType;
  at: Vec3;
  /** Degrees around x, y, z. */
  rotation: Vec3;
  scale: Vec3;
  /** box [w, h, d]; sphere [r]; cylinder [r, h]; torus [r, tube]; plane [w, d]; text [height]. */
  size: number[];
  /** A theme color name, a series number, or null for the next series color. */
  color: string | number | null;
  opacity: number;
  wireframe: boolean;
  text: string | null;
  src: string | null;
  label: string | null;
}

/** What animate(t) may change on an object each frame. */
export interface SceneOverride {
  at?: Vec3;
  rotation?: Vec3;
  scale?: Vec3;
  color?: string | number;
  opacity?: number;
}

const DEFAULT_SIZE: Record<SceneType, number[]> = {
  box: [1, 1, 1],
  sphere: [0.6],
  cylinder: [0.5, 1],
  torus: [0.6, 0.2],
  plane: [6, 6],
  text: [0.4],
  gltf: [1],
};

export function vec3(v: unknown, fallback: Vec3, uniform = false): Vec3 {
  if (typeof v === "number" && Number.isFinite(v)) return uniform ? [v, v, v] : fallback;
  if (!Array.isArray(v)) return fallback;
  const n = v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : NaN));
  if (n.length === 1 && uniform && !Number.isNaN(n[0])) return [n[0], n[0], n[0]];
  return [0, 1, 2].map((k) => (Number.isNaN(n[k] ?? NaN) ? fallback[k] : n[k])) as Vec3;
}

function sizes(v: unknown, type: SceneType): number[] {
  const d = DEFAULT_SIZE[type];
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return type === "box" ? [v, v, v] : [v, ...d.slice(1)];
  if (!Array.isArray(v)) return d;
  return d.map((x, k) => (typeof v[k] === "number" && Number.isFinite(v[k]) && v[k] > 0 ? (v[k] as number) : x));
}

function colorValue(v: unknown): string | number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export function normalizeScene(raw: unknown): { objects: SceneObject[]; problems: string[] } {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" ? Object.values(raw) : [];
  const objects: SceneObject[] = [];
  const problems: string[] = [];
  const ids = new Set<string>();
  list.forEach((o, k) => {
    const rawType = toText(readField(o, "type") ?? readField(o, "shape") ?? "box").toLowerCase();
    const type = (rawType === "cube" ? "box" : rawType === "model" || rawType === "glb" ? "gltf" : rawType) as SceneType;
    if (!SCENE_TYPES.includes(type)) {
      problems.push(`Object ${k + 1}: type "${rawType}" is not one of ${SCENE_TYPES.join(", ")}`);
      return;
    }
    const src = readField(o, "src") ?? readField(o, "path");
    if (type === "gltf" && typeof src !== "string") {
      problems.push(`Object ${k + 1}: a gltf needs src, a .glb or .gltf path in the workspace`);
      return;
    }
    const txt = readField(o, "text") ?? readField(o, "label");
    if (type === "text" && (txt == null || txt === "")) {
      problems.push(`Object ${k + 1}: a text object needs text`);
      return;
    }
    let id = toText(readField(o, "id") ?? `${type}${k + 1}`);
    while (ids.has(id)) id = `${id}_`;
    ids.add(id);
    const opacity = readField(o, "opacity");
    objects.push({
      id,
      type,
      at: vec3(readField(o, "at") ?? readField(o, "position"), [0, 0, 0]),
      rotation: vec3(readField(o, "rotation"), [type === "plane" ? -90 : 0, 0, 0]),
      scale: vec3(readField(o, "scale"), [1, 1, 1], true),
      size: sizes(readField(o, "size"), type),
      color: colorValue(readField(o, "color")),
      opacity: typeof opacity === "number" ? Math.min(1, Math.max(0, opacity)) : 1,
      wireframe: readField(o, "wireframe") === true,
      text: type === "text" ? toText(txt) : null,
      src: typeof src === "string" ? src : null,
      label: typeof readField(o, "label") === "string" && type !== "text" ? (readField(o, "label") as string) : null,
    });
  });
  return { objects, problems };
}

/**
 * Reads what animate(t) returned: an object keyed by id, or a list in object
 * order. Unknown ids and bad values are ignored, so one typo never stops the
 * scene.
 */
export function readOverrides(objects: SceneObject[], result: unknown): Map<string, SceneOverride> {
  const out = new Map<string, SceneOverride>();
  if (result == null || typeof result !== "object") return out;
  const entries: [string, unknown][] = Array.isArray(result)
    ? result.map((v, k) => [objects[k]?.id ?? "", v] as [string, unknown])
    : Object.keys(result).map((k) => [k, readField(result, k)] as [string, unknown]);
  const known = new Set(objects.map((o) => o.id));
  for (const [id, v] of entries) {
    if (!known.has(id) || v == null || typeof v !== "object") continue;
    const base = objects.find((o) => o.id === id)!;
    const o: SceneOverride = {};
    const at = readField(v, "at") ?? readField(v, "position");
    if (at !== undefined) o.at = vec3(at, base.at);
    const rot = readField(v, "rotation");
    if (rot !== undefined) o.rotation = vec3(rot, base.rotation);
    const scale = readField(v, "scale");
    if (scale !== undefined) o.scale = vec3(scale, base.scale, true);
    const color = colorValue(readField(v, "color"));
    if (color !== null) o.color = color;
    const opacity = readField(v, "opacity");
    if (typeof opacity === "number" && Number.isFinite(opacity)) o.opacity = Math.min(1, Math.max(0, opacity));
    out.set(id, o);
  }
  return out;
}

export interface ThemeColors {
  series: string[];
  tone: Record<"neutral" | "info" | "good" | "warn" | "bad", string>;
  foreground: string;
  muted: string;
}

/**
 * Theme names only, never a hex the agent made up: a tone (info, good, warn,
 * bad, neutral), accent, foreground, muted, or a series number (1 is the
 * accent). Anything else falls back to the object's series color.
 */
export function themeColor(theme: ThemeColors, value: string | number | null, index: number): string {
  const series = (n: number) => theme.series[(((n % theme.series.length) + theme.series.length) % theme.series.length)] ?? theme.foreground;
  if (typeof value === "number") return series(Math.round(value) - 1);
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (v in theme.tone) return theme.tone[v as keyof ThemeColors["tone"]];
    if (v === "accent" || v === "primary") return series(0);
    if (v === "foreground" || v === "text") return theme.foreground;
    if (v === "muted") return theme.muted;
    const m = /^(?:series-?|color-?)?(\d+)$/.exec(v);
    if (m) return series(Number(m[1]) - 1);
  }
  return series(index);
}

export const COLOR_NAMES = "a tone (info, good, warn, bad, neutral), accent, foreground, muted, or a series number 1-6";

// ---------- Shader ----------

export interface PreparedShader {
  source: string;
  /** Lines added before the person's first line. */
  offset: number;
  /** Shadertoy mainImage wrapped for WebGL2, or a full shader used as written. */
  mode: "shadertoy" | "full";
}

const HEADER = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 iResolution;
uniform float iTime;
uniform float iTimeDelta;
uniform int iFrame;
uniform vec4 iMouse;
uniform vec4 iDate;
uniform vec3 iPalette[4];
uniform vec3 iBackground;
uniform vec3 iForeground;
out vec4 iris_FragColor;
`;

export const SHADER_UNIFORMS = ["iResolution", "iTime", "iTimeDelta", "iFrame", "iMouse", "iDate", "iPalette", "iBackground", "iForeground"] as const;

export function prepareShader(code: string): PreparedShader {
  if (/^\s*#version\s+300\s+es/.test(code)) return { source: code, offset: 0, mode: "full" };
  const body = code.replace(/^\s*#version[^\n]*\n/, "");
  const source = `${HEADER}#line 1\n${body}\nvoid main() {\n  vec4 c = vec4(0.0, 0.0, 0.0, 1.0);\n  mainImage(c, gl_FragCoord.xy);\n  iris_FragColor = vec4(c.rgb, 1.0);\n}\n`;
  return { source, offset: 0, mode: "shadertoy" };
}

export interface ShaderIssue {
  /** 1-based line in the person's code; null when the driver gave none. */
  line: number | null;
  message: string;
}

/** Reads a WebGL info log ("ERROR: 0:12: 'x' : undeclared identifier"). */
export function parseShaderLog(log: string, prepared: PreparedShader, codeLines: number): ShaderIssue[] {
  const out: ShaderIssue[] = [];
  for (const raw of log.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/.exec(line);
    if (m) {
      const n = Number(m[1]) - prepared.offset;
      out.push({ line: n >= 1 && n <= codeLines ? n : null, message: m[2].replace(/\s+/g, " ").trim() });
    } else if (!/^\d+ compilation errors?/i.test(line)) out.push({ line: null, message: line });
  }
  return out;
}
