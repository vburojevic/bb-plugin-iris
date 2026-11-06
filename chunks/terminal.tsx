// TerminalReplay (chunk "codework"): plays a recorded session at its own
// pace. The model (core/terminal.ts) keeps a scrollback terminal; moving
// forward feeds it only the new events, moving back replays from the start.
// Before the first play the card shows the session's last screen.

import { Glyph, Shimmer, cn, num, str, useEnv } from "@iris/ui";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { spanStyle } from "../core/ansi";
import { isPendingValue } from "../core/evaluate";
import { type Cast, Terminal, castClock, eventsUntil, parseCast } from "../core/terminal";
import type { ViewProps } from "../ui/render";
import { FOCUS_BOX, ICON_BTN, Problems, ownKey, tint } from "./codework-kit";

const SPEEDS = [0.5, 1, 2, 4];

function useScreen(cast: Cast, count: number) {
  const term = useRef<{ t: Terminal; applied: number; cast: Cast } | null>(null);
  return useMemo(() => {
    if (!term.current || term.current.cast !== cast || count < term.current.applied) term.current = { t: new Terminal(cast.cols, cast.rows), applied: 0, cast };
    const st = term.current;
    for (let k = st.applied; k < count; k++) st.t.write(cast.events[k].text);
    st.applied = count;
    return { lines: st.t.lines(), row: st.t.row, col: st.t.col, text: () => st.t.text() };
  }, [cast, count]);
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function TerminalReplayView({ props }: ViewProps) {
  const env = useEnv();
  const pending = isPendingValue(props.cast);
  const idle = num(props.idle);
  const cast = useMemo(() => parseCast(pending ? [] : props.cast, idle != null && idle > 0 ? idle : undefined), [pending, props.cast, idle]);
  const [time, setTime] = useState(() => cast.duration);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => {
    const s = num(props.speed);
    return s && s > 0 && s <= 16 ? s : 1;
  });
  const [started, setStarted] = useState(false);
  const loop = props.loop === true;
  const clock = useRef(time);
  clock.current = time;

  // A cast that arrives late (load() resolving) starts as its last screen.
  const lastCast = useRef(cast);
  useEffect(() => {
    if (lastCast.current === cast) return;
    lastCast.current = cast;
    if (!started) setTime(cast.duration);
    else setTime((t) => Math.min(t, cast.duration));
  }, [cast, started]);

  // autoplay starts once the cast has loaded and the reply has finished streaming.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (props.autoplay !== true || autoplayed.current || env.streaming || !cast.events.length) return;
    autoplayed.current = true;
    setStarted(true);
    setTime(0);
    setPlaying(true);
  }, [props.autoplay, env.streaming, cast]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    let shown = clock.current;
    const tick = (now: number) => {
      const dt = Math.min(0.25, (now - prev) / 1000);
      prev = now;
      let t = clock.current + dt * speed;
      if (t >= cast.duration) {
        if (loop && cast.duration > 0) t = 0;
        else {
          setTime(cast.duration);
          setPlaying(false);
          return;
        }
      }
      clock.current = t;
      // Re-render when output changes or the clock moves a tenth.
      if (Math.abs(t - shown) >= 0.1 || eventsUntil(cast.events, t) !== eventsUntil(cast.events, shown)) {
        shown = t;
        setTime(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, cast, loop]);

  // The screen fits the session's longest moment, up to height.
  const tallest = useMemo(() => {
    const t = new Terminal(cast.cols, cast.rows);
    let most = 1;
    for (const e of cast.events) {
      t.write(e.text);
      most = Math.max(most, t.rows.length);
    }
    return most;
  }, [cast]);
  const count = eventsUntil(cast.events, time);
  const screen = useScreen(cast, count);

  // Follow the output while playing.
  const scroller = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && (playing || !started)) el.scrollTop = el.scrollHeight;
  }, [screen, playing, started]);

  if (pending) return <Shimmer className="h-48" />;
  if (!cast.events.length) return <Problems list={cast.problems} what="<TerminalReplay>" />;

  const ended = time >= cast.duration - 1e-6;
  const toggle = () => {
    if (playing) return setPlaying(false);
    if (!started || ended) setTime(0);
    setStarted(true);
    setPlaying(true);
  };
  const seek = (t: number) => {
    setStarted(true);
    setTime(Math.max(0, Math.min(cast.duration, t)));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === " " && (e.target as HTMLElement).tagName === "BUTTON") return;
    if (!ownKey(e, [" ", "k", "ArrowLeft", "ArrowRight", "Home", "End"])) return;
    e.preventDefault();
    if (e.key === " " || e.key === "k") toggle();
    else if (e.key === "Home") seek(0);
    else if (e.key === "End") seek(cast.duration);
    else seek(time + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : 5));
  };

  const height = Math.min(Math.max(120, Math.min(900, num(props.height) ?? 300)), Math.max(72, tallest * 18.6 + 16));
  const title = str(props.title) ?? cast.title;
  const command = str(props.command) ?? cast.command;
  const blink = playing && !reducedMotion();
  const pct = cast.duration > 0 ? (time / cast.duration) * 100 : 100;
  const exit = cast.exit;

  return (
    <div className={cn("min-w-0 overflow-hidden rounded-[10px] bg-muted/30 ring-1 ring-border", FOCUS_BOX)} tabIndex={0} onKeyDown={onKey} role="group" aria-roledescription="terminal replay" aria-label={title ?? command ?? "Terminal replay"}>
      {title || command || exit != null ? (
        <div className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
          <Glyph name="square-terminal" size={13} className="shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate font-mono text-[12px]">
            {command ? (
              <span className="text-muted-foreground">
                $ <span className="text-foreground">{command}</span>
              </span>
            ) : (
              <span className="text-foreground">{title}</span>
            )}
            {command && title ? <span className="ml-2 font-sans text-muted-foreground">{title}</span> : null}
          </div>
          {exit != null && ended ? (
            <span className={cn("shrink-0 rounded-full px-2 py-px text-[11px] font-medium tabular-nums", exit === 0 ? "text-[color:var(--success)]" : "text-destructive")} style={{ background: tint(exit === 0 ? "var(--success)" : "var(--destructive)", 14) }}>
              exit {exit}
            </span>
          ) : null}
        </div>
      ) : null}
      <div ref={scroller} className="relative overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55]" style={{ height }} aria-live="off">
        <div style={cast.cols ? { minWidth: `${cast.cols}ch` } : undefined}>
          {screen.lines.map((line, r) => (
            <div key={r} className="min-h-[1.55em] whitespace-pre">
              {line.map((sp, j) => (
                <span key={j} style={spanStyle(sp)}>
                  {sp.text}
                </span>
              ))}
              {r === screen.row && started && !ended ? (
                <span
                  className={cn("inline-block h-[1.2em] w-[1ch] translate-y-[0.2em] align-baseline", blink && "iris-caret")}
                  style={{ background: "var(--foreground)", opacity: 0.7, marginLeft: `${Math.max(0, screen.col - line.reduce((n, sp) => n + sp.text.length, 0))}ch` }}
                  aria-hidden
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 border-t border-border px-2 py-1.5">
        <button type="button" className={cn(ICON_BTN, "size-7")} onClick={toggle} aria-label={playing ? "Pause" : ended && started ? "Replay" : "Play"}>
          <Glyph name={playing ? "pause" : ended && started ? "rotate-ccw" : "play"} size={13} />
        </button>
        <span className="w-[86px] shrink-0 text-center font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {castClock(time)} / {castClock(cast.duration)}
        </span>
        <div className="relative flex min-w-[36px] flex-1 items-center">
          <input
            type="range"
            min={0}
            max={Math.max(0.01, cast.duration)}
            step={0.01}
            value={Math.min(time, cast.duration)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Position"
            aria-valuetext={`${castClock(time)} of ${castClock(cast.duration)}`}
            className="iris-range w-full"
            style={{ ["--iris-fill" as string]: `${pct}%` }}
          />
          {cast.markers.map((m, k) => (
            <span key={k} className="pointer-events-none absolute top-1/2 h-2.5 w-[2px] -translate-y-1/2 rounded-full bg-foreground/60" style={{ left: `calc(${cast.duration ? (m.t / cast.duration) * 100 : 0}% - 1px)` }} aria-hidden />
          ))}
        </div>
        {/* On a phone one button cycles the speeds, so the scrubber keeps its room. */}
        <button
          type="button"
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
          className="iris-hit h-7 shrink-0 rounded-full px-2 font-mono text-[11px] tabular-nums ring-1 ring-border @lg/iris:hidden"
          aria-label={`Speed ${speed}×, tap for the next`}
        >
          {speed}×
        </button>
        <div className="flex shrink-0 items-center rounded-full p-0.5 ring-1 ring-border @max-lg/iris:hidden" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={speed === s}
              onClick={() => setSpeed(s)}
              className={cn("h-6 rounded-full px-1.5 font-mono text-[11px] tabular-nums transition-colors", speed === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {s}×
            </button>
          ))}
        </div>
        <button type="button" className={cn(ICON_BTN, "size-7 @max-[420px]/iris:hidden")} onClick={() => env.perform([{ $iris: "action", kind: "copy", args: [screen.text()] }])} aria-label="Copy output" title="Copy output">
          <Glyph name="copy" size={13} />
        </button>
      </div>
      {cast.markers.length ? (
        <div className="iris-scroll-x flex min-w-0 gap-1.5 overflow-x-auto border-t border-border px-2 py-1.5">
          {cast.markers.map((m, k) => (
            <button key={k} type="button" onClick={() => seek(m.t)} className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] ring-1 ring-border hover:bg-state-hover">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{castClock(m.t)}</span>
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
