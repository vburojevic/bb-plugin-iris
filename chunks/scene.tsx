// Chunk "scene": <Scene> on three.js. Loaded on demand when a Scene nears the
// screen; React, the SDK and Iris's own pieces come from the main bundle
// through the shared runtime (scripts/build-chunks.mjs), so hooks and the
// card's context work here. SceneView reads the props, resolves theme colors,
// runs animate() in the card's interpreter and loads models over RPC;
// SceneCanvas owns the three.js world.

import { useRpc } from "@get-bb/plugin-sdk/app";
import { Glyph, InlineError, Shimmer, hexColor, num, str, themeVar, useEnv, useGlSlot } from "@iris/ui";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  HemisphereLight,
  LoadingManager,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Sphere,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { type SceneObject, type SceneOverride, type ThemeColors, normalizeScene, readOverrides, themeColor } from "../core/graphics";
import { isFnValue, isPendingValue } from "../core/evaluate";
import type { RpcContract } from "../shared/rpc";
import type { ViewProps } from "../ui/render";
import { GlFrame, OVERLAY_BTN } from "./gl-frame";

export interface SceneApi {
  snapshot(): string | null;
}

export interface SceneCanvasProps {
  objects: SceneObject[];
  theme: ThemeColors;
  color: (theme: ThemeColors, value: string | number | null, index: number) => string;
  models: Record<string, { status: "loading" } | { status: "ok"; data: ArrayBuffer; ext: string } | { status: "error"; error: string }>;
  frame: RefObject<((t: number) => Map<string, SceneOverride>) | null>;
  onPick: RefObject<((id: string, label: string | null) => void) | null>;
  onError: (message: string | null) => void;
  camera: { at?: number[]; look?: number[]; fov?: number } | null;
  orbit: boolean;
  autoRotate: boolean;
  ground: boolean;
  /** On screen with a live context. */
  running: boolean;
  /** animate() and autoRotate move things; false holds them still. */
  animating: boolean;
  label: string;
  api: RefObject<SceneApi | null>;
}

interface World {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls | null;
  root: Group;
  grid: GridHelper | null;
  /** Meshes by object id, for animate() and picking. */
  byId: Map<string, { obj: Object3D; base: SceneObject; index: number }>;
  invalidate(): void;
  fitted: boolean;
}

const deg = MathUtils.degToRad;


/**
 * A loading manager that lets a model use only what it carries: embedded data: and blob: URIs.
 * A .gltf that points its buffers or images at any other URL (a LAN device, localhost, a
 * tracker) gets an empty resource instead, so rendering a model never makes a request.
 */
function sealedManager(): LoadingManager {
  const manager = new LoadingManager();
  manager.setURLModifier((url) => (/^(data|blob):/i.test(url) ? url : "data:application/octet-stream;base64,"));
  return manager;
}

function textSprite(text: string, height: number, color: string, font: string): Sprite {
  const scale = 128;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `600 ${scale}px ${font}`;
  const w = Math.ceil(ctx.measureText(text).width) + scale * 0.4;
  canvas.width = w;
  canvas.height = Math.ceil(scale * 1.4);
  ctx.font = `600 ${scale}px ${font}`;
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, w / 2, canvas.height / 2);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  const sprite = new Sprite(new SpriteMaterial({ map, transparent: true, depthWrite: false }));
  sprite.scale.set((height * w) / canvas.height, height, 1);
  return sprite;
}

function geometry(o: SceneObject) {
  const [a, b, c] = o.size;
  switch (o.type) {
    case "sphere":
      return new SphereGeometry(a, 48, 32);
    case "cylinder":
      return new CylinderGeometry(a, a, b, 48);
    case "torus":
      return new TorusGeometry(a, b, 24, 96);
    case "plane":
      return new PlaneGeometry(a, b);
    default:
      return new BoxGeometry(a, b, c);
  }
}

function dispose(obj: Object3D) {
  obj.traverse((n) => {
    const m = n as Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v && typeof v === "object" && "isTexture" in v) (v as { dispose(): void }).dispose();
      mat.dispose();
    }
  });
}

function place(obj: Object3D, o: { at: number[]; rotation: number[]; scale: number[] }) {
  obj.position.set(o.at[0], o.at[1], o.at[2]);
  obj.rotation.set(deg(o.rotation[0]), deg(o.rotation[1]), deg(o.rotation[2]));
  obj.scale.set(o.scale[0], o.scale[1], o.scale[2]);
}

function setMaterial(obj: Object3D, fn: (m: MeshStandardMaterial | SpriteMaterial) => void) {
  obj.traverse((n) => {
    const mat = (n as Mesh).material;
    for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) if ("color" in m) fn(m as MeshStandardMaterial);
  });
}

export function SceneCanvas(props: SceneCanvasProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const world = useRef<World | null>(null);
  const live = useRef(props);
  live.current = props;
  const [hover, setHover] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  // The renderer, camera, lights and controls: once per mount.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch (cause) {
      setFailed(cause instanceof Error ? cause.message : String(cause));
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.className = "block size-full touch-none outline-none";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", live.current.label);
    el.appendChild(canvas);
    const scene = new Scene();
    const camera = new PerspectiveCamera(live.current.camera?.fov ?? 45, 1, 0.05, 500);
    scene.add(new HemisphereLight(0xffffff, 0x444444, 1.1));
    scene.add(new AmbientLight(0xffffff, 0.25));
    const sun = new DirectionalLight(0xffffff, 1.7);
    sun.position.set(4, 7, 5);
    scene.add(sun);
    const root = new Group();
    scene.add(root);
    let raf = 0;
    let t = 0;
    let last = performance.now();
    let changed = true;
    const w: World = {
      renderer,
      scene,
      camera,
      controls: null,
      root,
      grid: null,
      byId: new Map(),
      fitted: false,
      invalidate: () => {
        changed = true;
        if (!raf && live.current.running) {
          last = performance.now();
          raf = requestAnimationFrame(tick);
        }
      },
    };
    world.current = w;
    const apply = () => {
      const frame = live.current.frame.current;
      if (!frame) return;
      let over: Map<string, SceneOverride>;
      try {
        over = frame(t);
      } catch (cause) {
        live.current.onError(cause instanceof Error ? cause.message : String(cause));
        live.current.frame.current = null;
        return;
      }
      for (const [id, o] of over) {
        const hit = w.byId.get(id);
        if (!hit) continue;
        if (o.at) hit.obj.position.set(o.at[0], o.at[1], o.at[2]);
        if (o.rotation) hit.obj.rotation.set(deg(o.rotation[0]), deg(o.rotation[1]), deg(o.rotation[2]));
        if (o.scale) hit.obj.scale.set(o.scale[0], o.scale[1], o.scale[2]);
        if (o.color !== undefined) {
          const c = live.current.color(live.current.theme, o.color, hit.index);
          setMaterial(hit.obj, (m) => m.color.set(c));
        }
        if (o.opacity !== undefined) {
          const op = o.opacity;
          setMaterial(hit.obj, (m) => {
            m.opacity = op;
            m.transparent = op < 1 || m instanceof SpriteMaterial;
          });
        }
      }
    };
    const tick = () => {
      raf = 0;
      const p = live.current;
      if (!p.running) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const moving = p.animating;
      if (moving) {
        t += dt;
        apply();
      }
      let settling = false;
      if (w.controls) {
        w.controls.autoRotate = p.autoRotate && moving;
        // With a ground grid, keep the camera above it.
        w.controls.maxPolarAngle = p.ground ? Math.PI * 0.49 : Math.PI;
        // update() reports movement while damping eases out; keep drawing until it settles.
        settling = w.controls.update(dt);
      }
      if (moving || changed || settling) {
        renderer.render(scene, camera);
        changed = false;
      }
      // invalidate() may already have queued the next frame (OrbitControls fires "change" inside update()).
      if ((moving || settling) && !raf) raf = requestAnimationFrame(tick);
    };
    const resize = () => {
      const width = Math.max(1, el.clientWidth);
      const height = Math.max(1, el.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      changed = true;
      w.invalidate();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Picking: a click that didn't drag, on an object with an id.
    const ray = new Raycaster();
    const ptr = new Vector2();
    let downAt: [number, number] | null = null;
    const hitAt = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ptr, camera);
      for (const h of ray.intersectObjects(root.children, true)) {
        for (let n: Object3D | null = h.object; n; n = n.parent) if (typeof n.userData.irisId === "string") return w.byId.get(n.userData.irisId) ?? null;
      }
      return null;
    };
    const down = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
      w.invalidate();
    };
    const up = (e: PointerEvent) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
      downAt = null;
      const hit = hitAt(e);
      const pick = live.current.onPick.current;
      if (hit && pick) pick(hit.base.id, hit.base.label ?? (hit.base.type === "text" ? hit.base.text : null));
    };
    let hoverId: string | null = null;
    const move = (e: PointerEvent) => {
      if (e.buttons) return;
      const hit = hitAt(e);
      const id = hit ? (hit.base.label ?? (live.current.onPick.current ? hit.base.id : null)) : null;
      if (id !== hoverId) {
        hoverId = id;
        setHover(id);
        canvas.style.cursor = hit && live.current.onPick.current ? "pointer" : "";
      }
    };
    const leave = () => {
      hoverId = null;
      setHover(null);
    };
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerleave", leave);
    const lost = (e: Event) => e.preventDefault();
    canvas.addEventListener("webglcontextlost", lost);

    live.current.api.current = {
      snapshot: () => {
        renderer.render(scene, camera);
        return canvas.toDataURL("image/png");
      },
    };
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointerup", up);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerleave", leave);
      canvas.removeEventListener("webglcontextlost", lost);
      w.controls?.dispose();
      dispose(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      world.current = null;
      if (live.current.api.current) live.current.api.current = null;
    };
  }, []);

  // Orbit controls follow the orbit prop.
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    if (!props.orbit) {
      w.controls?.dispose();
      w.controls = null;
      return;
    }
    const c = new OrbitControls(w.camera, w.renderer.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.autoRotateSpeed = 1.2;
    c.addEventListener("change", w.invalidate);
    c.addEventListener("start", w.invalidate);
    w.controls = c;
    w.fitted = false;
    w.invalidate();
    return () => {
      c.dispose();
      if (w.controls === c) w.controls = null;
    };
  }, [props.orbit]);

  // A new camera prop frames the scene again.
  useEffect(() => {
    if (world.current) world.current.fitted = false;
  }, [props.camera]);

  // Objects: rebuilt when what they say changes, or when the theme does.
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    for (const child of [...w.root.children]) {
      w.root.remove(child);
      dispose(child);
    }
    w.byId.clear();
    const font = getComputedStyle(host.current ?? document.body).fontFamily || "sans-serif";
    props.objects.forEach((o, index) => {
      const color = new Color(props.color(props.theme, o.color, index));
      let obj: Object3D | null = null;
      if (o.type === "text") {
        // The sprite keeps its aspect scale; at, rotation and scale (and animate) go on a holder.
        obj = new Group();
        obj.add(textSprite(o.text ?? "", o.size[0], o.color === null ? props.theme.foreground : `#${color.getHexString()}`, font));
        place(obj, o);
      } else if (o.type === "gltf") {
        const model = o.src ? props.models[o.src] : undefined;
        if (model?.status !== "ok") return;
        const holder = new Group();
        place(holder, o);
        new GLTFLoader(sealedManager()).parse(
          model.data,
          "",
          (gltf) => {
            const g = gltf.scene;
            // glTF may omit normals (flat shading is implied); three needs them to light the mesh.
            g.traverse((n) => {
              const geo = (n as Mesh).geometry;
              if (geo && !geo.getAttribute("normal")) geo.computeVertexNormals();
            });
            // Fit the model into a cube of size[0] so any export lands at a sensible scale.
            const box = new Box3().setFromObject(g);
            const size = box.getSize(new Vector3());
            const fit = o.size[0] / Math.max(1e-6, size.x, size.y, size.z);
            g.scale.setScalar(fit);
            const center = box.getCenter(new Vector3()).multiplyScalar(fit);
            g.position.set(-center.x, -box.min.y * fit, -center.z);
            holder.add(g);
            if (o.color !== null) setMaterial(g, (m) => m.color.copy(color));
            w.fitted = false;
            fitCamera(w, live.current.camera);
            w.invalidate();
          },
          (err) => live.current.onError(`${o.src}: ${err instanceof Error ? err.message : String(err)}. Use a .glb, or a .gltf with its buffers embedded`),
        );
        obj = holder;
      } else {
        const mat = new MeshStandardMaterial({ color, roughness: 0.48, metalness: 0.08, transparent: o.opacity < 1, opacity: o.opacity, wireframe: o.wireframe });
        if (o.type === "plane") mat.side = 2;
        obj = new Mesh(geometry(o), mat);
        place(obj, o);
      }
      obj.userData.irisId = o.id;
      w.root.add(obj);
      w.byId.set(o.id, { obj, base: o, index });
    });
    if (w.grid) {
      w.scene.remove(w.grid);
      dispose(w.grid);
      w.grid = null;
    }
    if (props.ground) {
      const box = new Box3().setFromObject(w.root);
      const span = box.isEmpty() ? 6 : Math.max(4, Math.ceil(Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 1.6));
      const grid = new GridHelper(span, span * 2, new Color(props.theme.muted), new Color(props.theme.muted));
      const mats = Array.isArray(grid.material) ? grid.material : [grid.material];
      for (const m of mats) {
        m.transparent = true;
        m.opacity = 0.28;
      }
      grid.position.y = box.isEmpty() ? 0 : Math.min(0, box.min.y);
      w.scene.add(grid);
      w.grid = grid;
    }
    if (!w.fitted) fitCamera(w, props.camera);
    w.invalidate();
  }, [props.objects, props.theme, props.models, props.ground, props.color, props.camera]);

  // Start and stop with visibility and the play button.
  useEffect(() => {
    world.current?.invalidate();
  }, [props.running, props.animating, props.autoRotate]);

  if (failed) return <div className="grid size-full place-items-center p-4 text-center text-[13px] text-muted-foreground">3D needs WebGL, which is not available here: {failed}</div>;
  return (
    <div ref={host} className="absolute inset-0">
      {hover ? <span className="pointer-events-none absolute bottom-2 left-2 max-w-[70%] truncate rounded-full bg-card/85 px-2.5 py-0.5 text-[12px] shadow-[0_0_0_1px_var(--border)] backdrop-blur-sm">{hover}</span> : null}
    </div>
  );
}

/** Frames every object, or uses the camera the block gave. */
function fitCamera(w: World, cam: SceneCanvasProps["camera"]) {
  const look = new Vector3(...((cam?.look?.length === 3 ? cam.look : null) ?? [0, 0, 0]));
  const box = new Box3().setFromObject(w.root);
  if (!cam?.look && !box.isEmpty()) box.getCenter(look);
  if (cam?.fov) w.camera.fov = cam.fov;
  if (cam?.at?.length === 3) w.camera.position.set(cam.at[0], cam.at[1], cam.at[2]);
  else {
    const r = box.isEmpty() ? 2 : box.getBoundingSphere(new Sphere()).radius || 2;
    const dist = (r / Math.sin(deg(w.camera.fov) / 2)) * 0.92;
    const dir = new Vector3(1, 0.75, 1.35).normalize();
    w.camera.position.copy(look).addScaledVector(dir, dist);
  }
  w.camera.near = 0.05;
  w.camera.far = Math.max(100, w.camera.position.distanceTo(look) * 20);
  w.camera.updateProjectionMatrix();
  w.camera.lookAt(look);
  if (w.controls) {
    w.controls.target.copy(look);
    w.controls.update();
  }
  w.fitted = true;
}

// ---------- the view ----------

const prefersReduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type ModelState = { status: "loading" } | { status: "ok"; data: ArrayBuffer; ext: string } | { status: "error"; error: string };

function useModels(srcs: string[]): Record<string, ModelState> {
  const env = useEnv();
  const rpc = useRpc<RpcContract>();
  const [models, setModels] = useState<Record<string, ModelState>>({});
  const key = srcs.join("\n");
  useEffect(() => {
    let alive = true;
    for (const src of srcs) {
      if (models[src]) continue;
      if (!env.threadId) {
        setModels((m) => ({ ...m, [src]: { status: "error", error: "models load from a thread's files, so they show in chat, not here" } }));
        continue;
      }
      setModels((m) => ({ ...m, [src]: { status: "loading" } }));
      rpc.call("load_model", { threadId: env.threadId, path: src }).then(
        (r) => {
          if (!alive) return;
          if (!r.ok) return setModels((m) => ({ ...m, [src]: { status: "error", error: r.error } }));
          const bin = atob(r.base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          setModels((m) => ({ ...m, [src]: { status: "ok", data: bytes.buffer, ext: r.ext } }));
        },
        (e: unknown) => alive && setModels((m) => ({ ...m, [src]: { status: "error", error: e instanceof Error ? e.message : String(e) } })),
      );
    }
    return () => {
      alive = false;
    };
    // models is read to skip ones already requested; key carries the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, env.threadId, rpc]);
  return models;
}

export function SceneView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const height = Math.max(120, Math.min(900, num(props.height) ?? 320));
  const snapshot = useRef<(() => string | null) | null>(null);
  const slot = useGlSlot(snapshot);
  const [playing, setPlaying] = useState(() => !prefersReduced());
  const [runError, setRunError] = useState<string | null>(null);
  const pending = isPendingValue(props.objects);
  const { objects, problems } = useMemo(() => (pending ? { objects: [] as SceneObject[], problems: [] } : normalizeScene(props.objects)), [pending, props.objects]);
  // Props are fresh objects on every render; the scene rebuilds only when what they say changes.
  const signature = JSON.stringify(objects);
  const stable = useMemo(() => objects, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  const theme: ThemeColors = useMemo(
    () => ({ series: palette.series.map((c) => hexColor(c)), tone: Object.fromEntries(Object.entries(palette.tone).map(([k, v]) => [k, hexColor(v)])) as ThemeColors["tone"], foreground: themeVar(null, "--foreground", hexColor(palette.tone.neutral)), muted: hexColor(palette.tone.neutral) }),
    [palette],
  );
  const models = useModels(useMemo(() => [...new Set(stable.filter((o) => o.type === "gltf" && o.src).map((o) => o.src!))], [stable]));
  const animate = isFnValue(props.animate) ? props.animate : null;
  const frameRef: SceneCanvasProps["frame"] = useRef(null);
  frameRef.current = animate
    ? (t: number) => {
        env.runtime.interp.steps = 0;
        return readOverrides(stable, env.runtime.interp.call(animate, [t]));
      }
    : null;
  const onPick = props.onPick;
  const pickRef: SceneCanvasProps["onPick"] = useRef(null);
  pickRef.current = onPick ? (id: string, label: string | null) => env.run(onPick, [id, label]) : null;
  const api = useRef<SceneApi | null>(null);
  snapshot.current = () => api.current?.snapshot() ?? null;
  const title = str(props.title);
  const camera = (props.camera ?? null) as SceneCanvasProps["camera"];
  const cameraKey = JSON.stringify(camera);
  const stableCamera = useMemo(() => camera, [cameraKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const moving = (animate !== null || props.autoRotate === true) && !runError;
  const modelErrors = Object.entries(models).flatMap(([src, m]) => (m.status === "error" ? [`${src}: ${m.error}`] : []));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {problems.length ? <InlineError error={new Error(`${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}`)} context="<Scene>" /> : null}
      {runError ? <InlineError error={new Error(runError)} context="<Scene animate>" /> : null}
      {modelErrors.length ? <InlineError error={new Error(modelErrors[0])} context="<Scene gltf>" /> : null}
      <GlFrame
        title={title}
        height={height}
        slot={slot}
        controls={
          moving ? (
            <button type="button" className={OVERLAY_BTN} aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>
              <Glyph name={playing ? "pause" : "play"} size={13} />
            </button>
          ) : null
        }
      >
        {slot.live && !pending ? (
          <SceneCanvas
            objects={stable}
            theme={theme}
            color={themeColor}
            models={models}
            frame={frameRef}
            onPick={pickRef}
            onError={setRunError}
            camera={stableCamera}
            orbit={props.orbit !== false}
            autoRotate={props.autoRotate === true}
            ground={props.ground === true}
            running={slot.running}
            animating={moving && playing}
            label={title ?? "3D scene"}
            api={api}
          />
        ) : (
          <Shimmer className="absolute inset-0 rounded-none" />
        )}
      </GlFrame>
    </div>
  );
}
