// VideoCompare (chunk "compare"): two videos on one timeline. Both stream
// through bb preview leases as VideoPlayer's do (useMediaSource); the shared
// controls come from chunks/players.tsx and the timing rules from
// core/compare.ts.
//
// Sync: a timeline time t (the first video's seconds) is the truth. While
// playing, whichever video is inside the timeline and actually advancing
// leads, and the other follows it, nudged by playback rate for small drift
// and seeked for large. Where neither video is inside (a gap made by the
// offset), a wall clock carries t. Pausing lines both up on the same frame.

import { Chip, Glyph, Shimmer, cn, num, str, useEnv, toneColor, useWipeDrag } from "@iris/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { catchUp, normalizeVideos, offsetText, timeline, videoTime } from "../core/compare";
import { isPendingValue } from "../core/evaluate";
import { activeIndex, formatTime, mediaName, normalizeNotes, snapSpeed, stepFrame, type TimedNote } from "../core/players";
import type { ViewProps } from "../ui/render";
import { FOCUS_BOX, ICON_BTN, NoteList, Problems, Scrubber, SpeedSelect, fileProblem, useMediaSource } from "./players";

type Mode = "side" | "wipe";

interface Engine {
  t: number;
  playing: boolean;
  offset: number;
  rate: number;
  loop: boolean;
  a: HTMLVideoElement | null;
  b: HTMLVideoElement | null;
  durA: number;
  durB: number;
  touched: boolean;
}

const durationOf = (v: HTMLVideoElement | null) => (v && Number.isFinite(v.duration) ? v.duration : 0);

export function VideoCompareView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const accent = palette.accent;
  const pending = isPendingValue(props.videos) || isPendingValue(props.notes);
  const videos = useMemo(() => normalizeVideos(pending ? null : props.videos), [pending, props.videos]);
  const notes = useMemo(() => normalizeNotes(pending ? null : props.notes), [pending, props.notes]);
  const ma = useMediaSource(videos[0]?.src, "clip");
  const mb = useMediaSource(videos[1]?.src, "clip");
  const fps = Math.max(1, Math.min(240, num(props.fps) ?? 30));
  const [a, setA] = useState<HTMLVideoElement | null>(null);
  const [b, setB] = useState<HTMLVideoElement | null>(null);
  const [mode, setMode] = useState<Mode>(props.mode === "wipe" ? "wipe" : "side");
  const [offset, setOffsetState] = useState(() => num(props.offset) ?? 0);
  const [rate, setRate] = useState(() => snapSpeed(props.speed));
  const [muted, setMuted] = useState(props.muted === true);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [durs, setDurs] = useState<[number, number]>([0, 0]);
  const [aspects, setAspects] = useState<[number | null, number | null]>([null, null]);
  const [wipe, setWipe] = useState(50);

  const e = useRef<Engine>({ t: 0, playing: false, offset, rate, loop: props.loop === true, a: null, b: null, durA: 0, durB: 0, touched: false }).current;
  e.a = a;
  e.b = b;
  e.offset = offset;
  e.rate = rate;
  e.loop = props.loop === true;
  e.durA = durs[0];
  e.durB = durs[1];
  const { lo, hi } = timeline(offset, durs[0], durs[1]);

  /** Puts both videos where timeline time T says. */
  const place = useCallback(
    (T: number) => {
      for (const [v, shift, dur] of [
        [e.a, 0, e.durA],
        [e.b, e.offset, e.durB],
      ] as const) {
        if (!v || !dur) continue;
        const at = videoTime(T, shift, dur);
        if (Math.abs(v.currentTime - at.time) > 0.0005) v.currentTime = at.time;
      }
    },
    [e],
  );

  const seekTo = useCallback(
    (T: number) => {
      const r = timeline(e.offset, e.durA, e.durB);
      const to = Math.max(r.lo, Math.min(r.hi, T));
      e.t = to;
      e.touched = true;
      setT(to);
      place(to);
    },
    [e, place],
  );

  const pause = useCallback(() => {
    e.playing = false;
    setPlaying(false);
    e.a?.pause();
    e.b?.pause();
    place(e.t);
  }, [e, place]);

  const play = useCallback(() => {
    const r = timeline(e.offset, e.durA, e.durB);
    if (!(r.hi > r.lo)) return;
    if (e.t >= r.hi - 0.02) seekTo(r.lo);
    e.playing = true;
    e.touched = true;
    setPlaying(true);
  }, [e, seekTo]);

  const toggle = useCallback(() => (e.playing ? pause() : play()), [e, pause, play]);

  // The playing loop.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const starting = new WeakSet<HTMLVideoElement>();
    const sides = () =>
      [
        [e.a, 0, e.durA],
        [e.b, e.offset, e.durB],
      ] as const;
    const advancing = (v: HTMLVideoElement | null, inside: boolean) => !!v && inside && !v.paused && !v.seeking && v.readyState >= 3;
    const tick = () => {
      if (!e.playing) return;
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const r = timeline(e.offset, e.durA, e.durB);
      const [sa, sb] = sides();
      const ia = videoTime(e.t, 0, e.durA);
      const ib = videoTime(e.t, e.offset, e.durB);
      let leader: HTMLVideoElement | null = null;
      let T = e.t;
      if (advancing(sa[0], ia.inside)) {
        leader = sa[0];
        T = sa[0]!.currentTime;
      } else if (advancing(sb[0], ib.inside)) {
        leader = sb[0];
        T = sb[0]!.currentTime - e.offset;
      } else if (!ia.inside && !ib.inside) {
        // A gap the offset made: the wall clock carries the timeline.
        T = e.t + dt * e.rate;
      }
      // Otherwise a video that should play is still starting or buffering: hold.
      if (T >= r.hi - 1e-3) {
        if (e.loop && r.hi > r.lo) {
          e.t = r.lo;
          setT(r.lo);
          place(r.lo);
          raf = requestAnimationFrame(tick);
          return;
        }
        e.t = r.hi;
        setT(r.hi);
        pause();
        return;
      }
      e.t = T;
      setT(T);
      for (const [v, shift, dur] of [sa, sb]) {
        if (!v || !dur) continue;
        const at = videoTime(T, shift, dur);
        if (!at.inside) {
          if (!v.paused) v.pause();
          if (Math.abs(v.currentTime - at.time) > 0.05 && !v.seeking) v.currentTime = at.time;
          continue;
        }
        if (v.paused) {
          if (!starting.has(v)) {
            starting.add(v);
            if (Math.abs(v.currentTime - at.time) > 0.05) v.currentTime = at.time;
            v.playbackRate = e.rate;
            void v
              .play()
              .catch(() => undefined)
              .finally(() => starting.delete(v));
          }
          continue;
        }
        if (v === leader) {
          if (v.playbackRate !== e.rate) v.playbackRate = e.rate;
          continue;
        }
        if (v.seeking || v.readyState < 2) continue;
        const fix = catchUp(v.currentTime, at.time, e.rate);
        if (fix.seek) v.currentTime = at.time;
        if (Math.abs(v.playbackRate - fix.rate) > 1e-3) v.playbackRate = fix.rate;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, e, pause, place]);

  // Durations, sizes and the first placement.
  useEffect(() => {
    const els = [a, b];
    const read = () => {
      setDurs([durationOf(a), durationOf(b)]);
      setAspects([a?.videoWidth ? a.videoWidth / a.videoHeight : null, b?.videoWidth ? b.videoWidth / b.videoHeight : null]);
    };
    for (const v of els) v?.addEventListener("loadedmetadata", read);
    for (const v of els) v?.addEventListener("durationchange", read);
    read();
    return () => {
      for (const v of els) v?.removeEventListener("loadedmetadata", read);
      for (const v of els) v?.removeEventListener("durationchange", read);
    };
  }, [a, b]);
  useEffect(() => {
    // Until someone plays or seeks, start at the timeline's first frame.
    if (!e.touched && hi > lo) {
      e.t = lo;
      setT(lo);
    }
    if (!e.playing) place(e.t);
  }, [lo, hi, e, place]);
  useEffect(() => {
    if (a) a.muted = muted;
    if (b) b.muted = true;
  }, [a, b, muted]);
  useEffect(() => {
    if (!e.playing) return;
    for (const v of [a, b]) if (v) v.playbackRate = rate;
  }, [a, b, rate, e]);

  const setOffset = (o: number) => {
    const next = Math.round(o * 1000) / 1000;
    e.offset = next;
    setOffsetState(next);
    const r = timeline(next, e.durA, e.durB);
    const to = Math.max(r.lo, Math.min(r.hi, e.t));
    e.t = to;
    setT(to);
    place(to);
  };
  const step = (d: 1 | -1) => {
    pause();
    seekTo(e.t >= 0 ? stepFrame(e.t, fps, d, Infinity) : e.t + d / fps);
  };
  const nudge = (frames: number) => setOffset(offset + frames / fps);

  const onKey = (ev: KeyboardEvent) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const target = ev.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    const k = ev.key;
    if (k === " " || k === "k") {
      if (k === " " && target.closest("button")) return;
      toggle();
    } else if (k === "ArrowLeft" || k === "ArrowRight") {
      if (target.closest('[role="slider"]')) return;
      seekTo(e.t + (k === "ArrowLeft" ? -5 : 5));
    } else if (k === "," || k === ".") step(k === "," ? -1 : 1);
    else if (k === "[" || k === "]") nudge(k === "[" ? (ev.shiftKey ? -10 : -1) : ev.shiftKey ? 10 : 1);
    else if (k === "{" || k === "}") nudge(k === "{" ? -10 : 10);
    else if (k === "Home") seekTo(lo);
    else if (k === "m") setMuted((m) => !m);
    else return;
    ev.preventDefault();
  };

  if (pending) return <Shimmer className="aspect-video w-full" />;
  if (videos.length < 2) return <div className="rounded-lg bg-muted px-3 py-6 text-center text-xs text-muted-foreground">VideoCompare needs two videos, the reference first</div>;

  const ta = videoTime(t, 0, durs[0]);
  const tb = videoTime(t, offset, durs[1]);
  const ready = !!a && !!b && hi > lo;
  const name = `${mediaName(videos[0].src)} and ${mediaName(videos[1].src)}`;
  const span = Math.max(0, hi - lo);
  const noteColor = (n: TimedNote) => (toneColor(palette, n.tone) ?? accent);
  const noteAt = activeIndex(notes.items, t);
  const sample = ma.sample || mb.sample;
  const title = str(props.title);
  const wiping = mode === "wipe";
  const boxAspect = aspects[0] ?? aspects[1] ?? 16 / 9;
  const comment = () =>
    env.perform([{ $iris: "action", kind: "insert", args: [`At ${videos[0].label} ${formatTime(ta.time, { fps })}, ${videos[1].label} ${formatTime(tb.time, { fps })}: `] }]);

  const panes = [
    { v: videos[0], media: ma, set: setA, at: ta, aspect: aspects[0], muted },
    { v: videos[1], media: mb, set: setB, at: tb, aspect: aspects[1], muted: true },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Problems list={notes.problems} what="<VideoCompare>" />
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title ?? name}</div>
        {title ? <span className="hidden min-w-0 truncate font-mono text-[11.5px] text-muted-foreground @lg/iris:inline">{name}</span> : null}
        {sample ? <Chip>Sample</Chip> : null}
      </div>
      <div tabIndex={0} onKeyDown={onKey} className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl", FOCUS_BOX)} aria-label={`Videos ${name}. Space plays both, comma and period step a frame, brackets shift the offset`}>
        <div className={cn("relative min-w-0", wiping ? "overflow-hidden rounded-lg bg-muted" : "grid gap-2")} style={wiping ? { aspectRatio: String(boxAspect), maxHeight: 520 } : { gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 14rem), 1fr))" }}>
          {panes.map((p, k) => {
            const problem = fileProblem(p.media.file, p.media.failure, `<VideoCompare> ${p.v.label}`);
            const out = ready && !p.at.inside;
            return (
              <div
                key={k}
                className={cn(wiping ? "absolute inset-0" : "relative overflow-hidden rounded-lg bg-muted")}
                style={wiping ? (k === 0 ? { clipPath: `inset(0 ${100 - wipe}% 0 0)`, zIndex: 1 } : undefined) : { aspectRatio: String(p.aspect ?? boxAspect), maxHeight: 460 }}
              >
                {problem ? (
                  <div className="absolute inset-0 grid place-items-center p-4">{problem}</div>
                ) : p.media.url ? (
                  <video
                    ref={p.set}
                    src={p.media.url}
                    preload="auto"
                    playsInline
                    muted={p.muted}
                    className={cn("size-full object-contain transition-opacity", out && "opacity-45")}
                    onClick={wiping ? undefined : toggle}
                    onLoadedMetadata={() => place(e.t)}
                    onError={(ev) => p.media.onError(ev.currentTarget)}
                  />
                ) : (
                  <Shimmer className="size-full rounded-none" />
                )}
                <span
                  className={cn(
                    "pointer-events-none absolute top-2 inline-flex max-w-[46%] items-center gap-1.5 truncate rounded-full bg-card/85 px-2 py-0.5 text-[11.5px] font-medium text-foreground shadow-[0_0_0_1px_var(--border)] backdrop-blur",
                    wiping && k === 1 ? "right-2" : "left-2",
                  )}
                >
                  <span className="truncate">{p.v.label}</span>
                  {ready ? <span className="shrink-0 font-mono font-normal tabular-nums text-muted-foreground">{out ? (p.at.before ? "not started" : "ended") : formatTime(p.at.time, playing ? {} : { fps })}</span> : null}
                </span>
              </div>
            );
          })}
          {wiping ? <WipeHandle pos={wipe} onMove={setWipe} labels={[videos[0].label, videos[1].label]} /> : null}
          {ready && !playing && t <= lo + 1e-3 ? (
            <button type="button" onClick={play} aria-label="Play both" className="absolute inset-0 z-10 m-auto grid size-14 place-items-center rounded-full bg-card text-foreground shadow-md ring-1 ring-border transition-transform hover:scale-105">
              <Glyph name="play" size={24} className="translate-x-px" />
            </button>
          ) : null}
        </div>
        <Scrubber
          t={t - lo}
          duration={span}
          buffered={0}
          spans={[]}
          marks={notes.items.map((n) => ({ at: Math.max(0, Math.min(span, n.at - lo)), color: noteColor(n), text: n.text }))}
          onSeek={(x) => seekTo(x + lo)}
          accent={accent}
          fps={fps}
        />
        <div className="flex min-w-0 items-center gap-0.5 @lg/iris:gap-1">
          <button type="button" className={ICON_BTN} onClick={toggle} aria-label={playing ? "Pause both" : "Play both"} disabled={!ready}>
            <Glyph name={playing ? "pause" : "play"} size={16} />
          </button>
          <button type="button" className={cn(ICON_BTN, "@max-lg/iris:hidden")} onClick={() => step(-1)} aria-label="Previous frame (comma)" title="Previous frame (,)" disabled={!ready}>
            <Glyph name="step-back" size={15} />
          </button>
          <button type="button" className={cn(ICON_BTN, "@max-lg/iris:hidden")} onClick={() => step(1)} aria-label="Next frame (period)" title="Next frame (.)" disabled={!ready}>
            <Glyph name="step-forward" size={15} />
          </button>
          <span className="ml-1 shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
            <span className="text-foreground">{formatTime(t - lo, playing ? {} : { fps })}</span> / {formatTime(span)}
          </span>
          <div className="flex-1" />
          <button type="button" className={cn(ICON_BTN, "inline-flex w-auto gap-1.5 px-2.5 text-[12.5px] font-medium")} onClick={comment} title="Put both times in the composer" disabled={!ready}>
            <Glyph name="message-square-plus" size={14} />
            <span className="hidden @lg/iris:inline">Comment</span>
          </button>
          <SpeedSelect value={rate} onChange={setRate} />
          <button type="button" className={ICON_BTN} onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} title={`Sound comes from ${videos[0].label}`} disabled={!a}>
            <Glyph name={muted ? "volume-x" : "volume-2"} size={15} />
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div role="radiogroup" aria-label="Layout" className="inline-flex gap-0.5 rounded-full bg-muted/70 p-0.5">
            {(["side", "wipe"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[13px] transition-colors", mode === m ? "bg-card font-medium text-foreground shadow-[0_0_0_1px_var(--border)]" : "text-muted-foreground hover:text-foreground")}
              >
                <Glyph name={m === "side" ? "columns-2" : "chevrons-left-right"} size={13} />
                {m === "side" ? "Side by side" : "Wipe"}
              </button>
            ))}
          </div>
          <div className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground">
            <span>Offset</span>
            <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => nudge(-1)} aria-label="Shift the second video one frame earlier ([)" title="One frame earlier ([, Shift for 10)">
              <Glyph name="minus" size={14} />
            </button>
            <span className="min-w-[4.5rem] text-center font-mono tabular-nums text-foreground" aria-live="polite">
              {offsetText(offset)}
            </span>
            <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => nudge(1)} aria-label="Shift the second video one frame later (])" title="One frame later (], Shift for 10)">
              <Glyph name="plus" size={14} />
            </button>
            {offset !== (num(props.offset) ?? 0) ? (
              <button type="button" className="ml-1 rounded-full px-2 py-0.5 text-[12px] hover:bg-state-hover hover:text-foreground" onClick={() => setOffset(num(props.offset) ?? 0)}>
                Reset
              </button>
            ) : null}
          </div>
        </div>
      </div>
      {notes.items.length ? <NoteList notes={notes.items} at={noteAt} onJump={(n) => seekTo(n.at)} color={noteColor} /> : null}
    </div>
  );
}

function WipeHandle({ pos, onMove, labels }: { pos: number; onMove: (p: number) => void; labels: [string, string] }) {
  const drag = useWipeDrag(onMove);
  const key = (ev: KeyboardEvent) => {
    const s = ev.shiftKey ? 10 : 2;
    const next = ev.key === "ArrowLeft" ? pos - s : ev.key === "ArrowRight" ? pos + s : null;
    if (next == null) return;
    ev.preventDefault();
    ev.stopPropagation();
    onMove(Math.max(0, Math.min(100, next)));
  };
  return (
    <div
      {...drag}
      className="absolute inset-0 z-[2] cursor-ew-resize touch-pan-y select-none"
    >
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-card shadow-[0_0_0_1px_var(--border)]" style={{ left: `${pos}%` }} />
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Divider between ${labels[0]} and ${labels[1]}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        aria-valuetext={`${Math.round(pos)}% ${labels[0]}`}
        onKeyDown={key}
        className="absolute top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-card text-foreground shadow-[0_0_0_1px_var(--border)] outline-none focus-visible:ring-2 focus-visible:ring-foreground/40"
        style={{ left: `${pos}%` }}
      >
        <Glyph name="chevrons-left-right" size={15} />
      </div>
    </div>
  );
}

