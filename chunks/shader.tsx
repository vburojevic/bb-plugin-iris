// Shader (chunk "play"): a Shadertoy-style fragment shader on plain WebGL2,
// no library. The wrapper and the error mapping live in core/graphics.ts.
import { Glyph, InlineError, hexColor, num, str, themeVar, useEnv, useGlSlot } from "@iris/ui";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { type PreparedShader, type ShaderIssue, parseShaderLog, prepareShader } from "../core/graphics";
import type { ViewProps } from "../ui/render";
import { GlFrame, OVERLAY_BTN } from "./gl-frame";

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

interface Compiled {
  issues: ShaderIssue[];
  /** The source these issues belong to; an edited shader compiles again. */
  source: string;
}

const prefersReduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function ShaderView({ props, text }: ViewProps) {
  const env = useEnv();
  const code = text ?? "";
  const height = Math.max(80, Math.min(900, num(props.height) ?? 240));
  const snapshot = useRef<(() => string | null) | null>(null);
  const slot = useGlSlot(snapshot);
  const [playing, setPlaying] = useState(() => props.paused !== true && !prefersReduced());
  const [result, setResult] = useState<Compiled | null>(null);
  const prepared = useMemo(() => prepareShader(code), [code]);
  const lines = code.split("\n").length;
  const missingMain = prepared.mode === "shadertoy" && code.trim() && !/\bmainImage\s*\(/.test(code);
  const failed = result !== null && result.source === prepared.source && result.issues.length > 0;
  const title = str(props.title);
  if (env.streaming) return <GlFrame title={title} height={height} slot={{ ...slot, live: false, poster: null, blocked: false }}>{null}</GlFrame>;
  if (!code.trim()) return <InlineError error={new Error("put GLSL between <Shader> and </Shader>")} context="<Shader>" />;
  if (missingMain) return <InlineError error={new Error("write void mainImage(out vec4 fragColor, in vec2 fragCoord), or a full #version 300 es shader")} context="<Shader>" />;
  const running = slot.running && playing && !failed;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {failed ? <ShaderErrors code={code} issues={result!.issues} /> : null}
      {!failed ? (
        <GlFrame
          title={title}
          height={height}
          slot={slot}
          controls={
            <button type="button" className={OVERLAY_BTN} aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying((p) => !p)}>
              <Glyph name={playing ? "pause" : "play"} size={13} />
            </button>
          }
        >
          <ShaderCanvas prepared={prepared} lines={lines} speed={num(props.speed) ?? 1} running={running} title={title} onResult={setResult} snapshot={snapshot} />
        </GlFrame>
      ) : null}
    </div>
  );
}

function ShaderErrors({ code, issues }: { code: string; issues: ShaderIssue[] }) {
  const { palette } = useEnv();
  const first = issues[0];
  const byLine = new Map<number, string[]>();
  for (const i of issues) if (i.line !== null) byLine.set(i.line, [...(byLine.get(i.line) ?? []), i.message]);
  const message = `${first.line !== null ? `line ${first.line}: ` : ""}${first.message}${issues.length > 1 ? ` (${issues.length - 1} more)` : ""}`;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <InlineError error={new Error(`the shader does not compile, ${message}`)} context="<Shader>" />
      <pre className="max-h-72 min-w-0 overflow-auto rounded-[10px] bg-muted/30 py-1.5 font-mono text-[12px] leading-[1.55] ring-1 ring-border">
        {code.split("\n").map((l, k) => {
          const msgs = byLine.get(k + 1);
          return (
            <div key={k} className="flex min-w-max" style={msgs ? { background: `color-mix(in oklab, ${palette.tone.bad} 12%, transparent)` } : undefined}>
              <span className="w-10 shrink-0 select-none pr-3 text-right text-muted-foreground" style={msgs ? { color: palette.tone.bad } : undefined}>
                {k + 1}
              </span>
              <span className="whitespace-pre pr-3">{l || " "}</span>
              {msgs ? (
                <span className="whitespace-pre pr-3 font-sans text-[11.5px]" style={{ color: palette.tone.bad }}>
                  {msgs.join("; ")}
                </span>
              ) : null}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function ShaderCanvas({ prepared, lines, speed, running, title, onResult, snapshot }: { prepared: PreparedShader; lines: number; speed: number; running: boolean; title?: string; onResult: (r: Compiled) => void; snapshot: RefObject<(() => string | null) | null> }) {
  const { palette } = useEnv();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const gl = useRef<{ draw: (advance: boolean) => void; dispose: () => void; theme: (c: number[][]) => void } | null>(null);
  const live = useRef({ running, speed });
  live.current = { running, speed };

  // Theme colors as uniforms, recomputed with the theme.
  const theme = useMemo(() => {
    const el = canvas.current;
    const vec = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const series = [0, 1, 2, 3].map((k) => vec(hexColor(palette.series[k % palette.series.length])));
    return [...series, vec(themeVar(null, "--card", hexColor(palette.tone.neutral))), vec(themeVar(null, "--foreground", hexColor(palette.tone.neutral)))];
    // canvas.current is read on purpose: the palette object changes with the theme.
  }, [palette]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
    if (!ctx) {
      onResult({ source: prepared.source, issues: [{ line: null, message: "WebGL2 is not available here" }] });
      return;
    }
    const g = ctx;
    const compile = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src);
      g.compileShader(s);
      return s;
    };
    const vs = compile(g.VERTEX_SHADER, VERTEX);
    const fs = compile(g.FRAGMENT_SHADER, prepared.source);
    if (!g.getShaderParameter(fs, g.COMPILE_STATUS)) {
      const issues = parseShaderLog(g.getShaderInfoLog(fs) ?? "", prepared, lines);
      onResult({ source: prepared.source, issues: issues.length ? issues : [{ line: null, message: "the driver gave no reason" }] });
      g.getExtension("WEBGL_lose_context")?.loseContext();
      return;
    }
    const prog = g.createProgram()!;
    g.attachShader(prog, vs);
    g.attachShader(prog, fs);
    g.bindAttribLocation(prog, 0, "p");
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
      onResult({ source: prepared.source, issues: parseShaderLog(g.getProgramInfoLog(prog) ?? "link failed", prepared, lines) });
      g.getExtension("WEBGL_lose_context")?.loseContext();
      return;
    }
    onResult({ source: prepared.source, issues: [] });
    g.useProgram(prog);
    const buf = g.createBuffer();
    g.bindBuffer(g.ARRAY_BUFFER, buf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), g.STATIC_DRAW);
    g.enableVertexAttribArray(0);
    g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
    const u = (n: string) => g.getUniformLocation(prog, n);
    const U = { res: u("iResolution"), time: u("iTime"), dt: u("iTimeDelta"), frame: u("iFrame"), mouse: u("iMouse"), date: u("iDate"), palette: u("iPalette"), bg: u("iBackground"), fg: u("iForeground") };
    let time = 0;
    let frame = 0;
    let last = performance.now();
    const mouse = [0, 0, 0, 0];
    let colors = theme;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.round(el.clientWidth * dpr));
      const h = Math.max(1, Math.round(el.clientHeight * dpr));
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
    };
    const draw = (advance: boolean) => {
      resize();
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000) * live.current.speed;
      last = now;
      if (advance) {
        time += dt;
        frame++;
      }
      const d = new Date();
      g.viewport(0, 0, el.width, el.height);
      g.uniform3f(U.res, el.width, el.height, 1);
      g.uniform1f(U.time, time);
      g.uniform1f(U.dt, advance ? dt : 0);
      g.uniform1i(U.frame, frame);
      g.uniform4f(U.mouse, mouse[0], mouse[1], mouse[2], mouse[3]);
      g.uniform4f(U.date, d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000);
      g.uniform3fv(U.palette, colors.slice(0, 4).flat());
      g.uniform3fv(U.bg, colors[4]);
      g.uniform3fv(U.fg, colors[5]);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };
    let raf = 0;
    const loop = () => {
      raf = 0;
      if (!live.current.running) return;
      draw(true);
      raf = requestAnimationFrame(loop);
    };
    const point = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dpr = el.width / Math.max(1, r.width);
      return [(e.clientX - r.left) * dpr, (r.bottom - e.clientY) * dpr];
    };
    const down = (e: PointerEvent) => {
      const [x, y] = point(e);
      mouse.splice(0, 4, x, y, x, y);
      el.setPointerCapture(e.pointerId);
      if (!live.current.running) draw(false);
    };
    const move = (e: PointerEvent) => {
      if (mouse[2] <= 0) return;
      const [x, y] = point(e);
      mouse[0] = x;
      mouse[1] = y;
      if (!live.current.running) draw(false);
    };
    const up = () => {
      mouse[2] = -Math.abs(mouse[2]);
      mouse[3] = -Math.abs(mouse[3]);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    const ro = new ResizeObserver(() => {
      if (!live.current.running) draw(false);
    });
    ro.observe(el);
    draw(false);
    gl.current = {
      draw: (advance) => {
        if (advance && !raf) {
          last = performance.now();
          raf = requestAnimationFrame(loop);
        } else if (!advance) draw(false);
      },
      dispose: () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        el.removeEventListener("pointerdown", down);
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        g.getExtension("WEBGL_lose_context")?.loseContext();
      },
      theme: (c) => {
        colors = c;
        if (!live.current.running) draw(false);
      },
    };
    snapshot.current = () => {
      draw(false);
      return el.toDataURL("image/png");
    };
    return () => {
      gl.current?.dispose();
      gl.current = null;
      snapshot.current = null;
    };
    // theme is applied through gl.current.theme; recompiling on a theme change is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, lines, onResult, snapshot]);

  useEffect(() => {
    gl.current?.theme(theme);
  }, [theme]);
  useEffect(() => {
    if (running) gl.current?.draw(true);
  }, [running]);

  return <canvas ref={canvas} data-iris-drag="" role="img" aria-label={title ?? "Shader"} className="absolute inset-0 block size-full touch-none" />;
}
