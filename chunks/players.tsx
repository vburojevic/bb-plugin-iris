// VideoPlayer and AudioPlayer (chunk "assets"). Rules live in core/players.ts.
// Media streams from a bb preview URL with byte ranges (chunks/file-access.ts);
// the controls are Iris's own so they follow the theme. Without a thread the
// gallery plays a bundled clip (video) or a synthesized one (audio).

import { Chip, Glyph, InlineError, Shimmer, cn, num, str, useEnv, toneColor } from "@iris/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { isPendingValue } from "../core/evaluate";
import {
  SPEEDS,
  activeIndex,
  chapterSpans,
  computePeaks,
  formatTime,
  mediaName,
  normalizeChapters,
  normalizeNotes,
  normalizeTranscript,
  parseTime,
  snapSpeed,
  stepFrame,
  type Chapter,
  type TimedNote,
} from "../core/players";
import type { ViewProps } from "../ui/render";
import { errorText, fetchBytes, leaseLapsed, probe, useFileUrl, useSample, type FileUrlState } from "./file-access";

const MAX_DECODE_BYTES = 64 * 1024 * 1024;
export const ICON_BTN =
  "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)] disabled:pointer-events-none disabled:opacity-45";
export const FOCUS_BOX = "outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--iris-accent)_45%,transparent)]";
/** The theme's primary, for single-value marks (played time, the active row). */
const accentOf = (palette: { accent: string }) => palette.accent;
const tint = (c: string, pct: number) => `color-mix(in oklab, ${c} ${pct}%, transparent)`;

export function Problems({ list, what }: { list: string[]; what: string }) {
  if (!list.length) return null;
  return <InlineError error={new Error(`${list[0]}${list.length > 1 ? ` (and ${list.length - 1} more)` : ""}`)} context={what} />;
}

export function Caption({ title, name, sample, right }: { title?: string; name: string; sample: boolean; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{title ?? name}</div>
      {title ? <span className="hidden min-w-0 truncate font-mono text-[11.5px] text-muted-foreground sm:inline">{name}</span> : null}
      {sample ? <Chip>Sample</Chip> : null}
      {right}
    </div>
  );
}

/** Where a media element's source comes from, its failure in words, and recovery from a lapsed lease. */
export function useMediaSource(src: string | undefined, sampleKind: "clip" | "synth") {
  const [file, renew] = useFileUrl(src);
  const clip = useSample("clip", file.status === "sample" && sampleKind === "clip");
  const synth = useMemo(() => (file.status === "sample" && sampleKind === "synth" ? synthUrl() : null), [file.status, sampleKind]);
  const url = file.status === "ok" ? file.url : file.status === "sample" ? (sampleKind === "clip" ? clip : synth) : null;
  const [failure, setFailure] = useState<string | null>(null);
  const resumeAt = useRef<number | null>(null);
  useEffect(() => setFailure(null), [url]);
  const onError = useCallback(
    (el: HTMLMediaElement) => {
      if (leaseLapsed(file)) {
        resumeAt.current = el.currentTime;
        renew();
        return;
      }
      const code = el.error?.code;
      if (code === 4 && file.status === "ok" && file.via === "stream") {
        // 4 is "source not supported": either the codec or an HTTP error behind it.
        void probe(file.url).then((p) => setFailure(p.ok ? `this format can't play here${p.type ? ` (${p.type})` : ""}; H.264 or VP9 video and AAC, MP3 or Opus audio do` : p.error));
        return;
      }
      setFailure(code === 4 ? "this format can't play here" : code === 2 ? "the network failed while loading" : code === 3 ? "the file couldn't be decoded" : "the media couldn't load");
    },
    [file, renew],
  );
  return { file, url, failure, onError, resumeAt, sample: file.status === "sample" };
}

export function fileProblem(file: FileUrlState, failure: string | null, what: string): ReactNode {
  if (file.status === "error") return <InlineError error={new Error(file.error)} context={what} />;
  if (failure) return <InlineError error={new Error(failure)} context={what} />;
  return null;
}

/** currentTime as state: every animation frame while playing, on events otherwise. */
function useClock(el: HTMLMediaElement | null) {
  const [t, setT] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [buffered, setBuffered] = useState(0);
  useEffect(() => {
    if (!el) return;
    let raf = 0;
    const tick = () => {
      setT(el.currentTime);
      if (!el.paused) raf = requestAnimationFrame(tick);
    };
    const sync = () => {
      setT(el.currentTime);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      setPlaying(!el.paused && !el.ended);
      const b = el.buffered;
      setBuffered(b.length && el.duration ? b.end(b.length - 1) / el.duration : 0);
    };
    const play = () => {
      sync();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const events = ["loadedmetadata", "durationchange", "timeupdate", "seeked", "pause", "ended", "progress", "emptied"] as const;
    for (const e of events) el.addEventListener(e, sync);
    el.addEventListener("play", play);
    sync();
    return () => {
      cancelAnimationFrame(raf);
      for (const e of events) el.removeEventListener(e, sync);
      el.removeEventListener("play", play);
    };
  }, [el]);
  return { t, duration, playing, buffered };
}

function playToggle(el: HTMLMediaElement | null) {
  if (!el) return;
  if (el.paused || el.ended) void el.play().catch(() => undefined);
  else el.pause();
}

function seek(el: HTMLMediaElement | null, to: number) {
  if (!el) return;
  const d = Number.isFinite(el.duration) ? el.duration : Infinity;
  el.currentTime = Math.max(0, Math.min(d, to));
}

export function SpeedSelect({ value, onChange, label = "Speed" }: { value: number; onChange: (v: number) => void; label?: string }) {
  return (
    <label className="relative inline-flex h-8 shrink-0 items-center rounded-full px-2.5 text-[12.5px] font-medium tabular-nums text-muted-foreground ring-1 ring-border hover:bg-state-hover hover:text-foreground focus-within:outline-2 focus-within:outline-[var(--iris-accent)]">
      <span aria-hidden>{value}×</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className="absolute inset-0 cursor-pointer opacity-0">
        {SPEEDS.map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
    </label>
  );
}

/** Keys shared by both players. Returns true when handled. */
function mediaKeys(e: KeyboardEvent, el: HTMLMediaElement | null, extra?: (key: string) => boolean): boolean {
  if (!el || e.metaKey || e.ctrlKey || e.altKey) return false;
  const target = e.target as HTMLElement;
  if (target.closest("input, textarea, select")) return false;
  const k = e.key;
  if (k === " " || k === "k") {
    if (target.closest("button") && k === " ") return false;
    playToggle(el);
  } else if (k === "ArrowLeft" || k === "j") seek(el, el.currentTime - (k === "j" ? 10 : 5));
  else if (k === "ArrowRight" || k === "l") seek(el, el.currentTime + (k === "l" ? 10 : 5));
  else if (k === "m") el.muted = !el.muted;
  else if (k === "Home") seek(el, 0);
  else if (!extra?.(k)) return false;
  e.preventDefault();
  return true;
}

// ---------- scrubber ----------

export function Scrubber({
  t,
  duration,
  buffered,
  spans,
  marks,
  onSeek,
  accent,
  fps,
}: {
  t: number;
  duration: number;
  buffered: number;
  spans: { from: number; to: number; title: string }[];
  marks: { at: number; color: string; text: string }[];
  onSeek: (to: number) => void;
  accent: string;
  fps?: number;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const at = (e: ReactPointerEvent) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || !r.width) return 0;
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const ratio = duration ? Math.min(1, t / duration) : 0;
  const segs = spans.length > 1 ? spans : [{ from: 0, to: 1, title: "" }];
  const hoverChapter = hover !== null ? spans.find((s) => hover >= s.from && hover < s.to)?.title : undefined;
  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={-1}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={formatTime(t)}
      className="group/scrub relative h-6 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        if (!duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        onSeek(at(e) * duration);
      }}
      onPointerMove={(e) => {
        setHover(at(e));
        if (drag && duration) onSeek(at(e) * duration);
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onPointerLeave={() => !drag && setHover(null)}
    >
      <div className="absolute inset-x-0 top-1/2 flex h-1.5 -translate-y-1/2 gap-[3px] transition-[height] group-hover/scrub:h-2">
        {segs.map((s, k) => {
          const fill = Math.max(0, Math.min(1, (ratio - s.from) / (s.to - s.from || 1)));
          const buf = Math.max(0, Math.min(1, (buffered - s.from) / (s.to - s.from || 1)));
          return (
            <div key={k} className="relative h-full overflow-hidden rounded-full bg-muted" style={{ flexGrow: Math.max(0.0001, s.to - s.from), flexBasis: 0 }}>
              <div className="absolute inset-y-0 left-0 bg-foreground/15" style={{ width: `${buf * 100}%` }} />
              <div className="absolute inset-y-0 left-0" style={{ width: `${fill * 100}%`, background: accent }} />
            </div>
          );
        })}
      </div>
      {duration
        ? marks.map((m, k) => (
            <span
              key={k}
              aria-hidden
              title={`${formatTime(m.at)} ${m.text}`}
              className="pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--card,var(--background))]"
              style={{ left: `${Math.min(100, (m.at / duration) * 100)}%`, background: m.color }}
            />
          ))
        : null}
      <span
        aria-hidden
        className={cn("pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm transition-transform", drag ? "scale-110" : "scale-0 group-hover/scrub:scale-100")}
        style={{ left: `${ratio * 100}%`, background: accent }}
      />
      {hover !== null && duration ? (
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-full mb-1 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-1.5 py-0.5 text-[11px] tabular-nums text-popover-foreground shadow-md ring-1 ring-border"
          style={{ left: `${Math.max(4, Math.min(96, hover * 100))}%` }}
        >
          {formatTime(hover * duration, fps ? { fps } : {})}
          {hoverChapter ? <span className="text-muted-foreground"> · {hoverChapter}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function TimeButton({ at, onClick, active }: { at: number; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("shrink-0 rounded px-1 font-mono text-[11.5px] tabular-nums hover:bg-state-hover", active ? "text-foreground" : "text-muted-foreground")}
      aria-label={`Jump to ${formatTime(at)}`}
    >
      {formatTime(at)}
    </button>
  );
}

// ---------- VideoPlayer ----------

export function VideoPlayerView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const accent = accentOf(palette);
  const src = str(props.src);
  const media = useMediaSource(src, "clip");
  const [el, setEl] = useState<HTMLVideoElement | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const { t, duration, playing, buffered } = useClock(el);
  const fps = Math.max(1, Math.min(240, num(props.fps) ?? 30));
  const [rate, setRate] = useState(() => snapSpeed(props.speed));
  const [muted, setMuted] = useState(props.muted === true);
  const [aspect, setAspect] = useState<number | null>(null);
  const pending = isPendingValue(props.chapters) || isPendingValue(props.notes);
  const chapters = useMemo(() => normalizeChapters(pending ? null : props.chapters), [pending, props.chapters]);
  const notes = useMemo(() => normalizeNotes(pending ? null : props.notes), [pending, props.notes]);
  const start = parseTime(props.start);
  const name = src ? mediaName(src) : "video";

  useEffect(() => {
    if (el) el.playbackRate = rate;
  }, [el, rate, media.url]);
  useEffect(() => {
    if (el) el.muted = muted;
  }, [el, muted]);
  useEffect(() => {
    if (!el) return;
    const onVol = () => setMuted(el.muted);
    el.addEventListener("volumechange", onVol);
    return () => el.removeEventListener("volumechange", onVol);
  }, [el]);

  const spans = useMemo(() => chapterSpans(chapters.items, duration), [chapters.items, duration]);
  const chapterAt = activeIndex(chapters.items, t);
  const noteAt = activeIndex(notes.items, t);
  const noteColor = (n: TimedNote) => (toneColor(palette, n.tone) ?? accent);
  const step = (d: 1 | -1) => {
    if (!el) return;
    el.pause();
    el.currentTime = stepFrame(el.currentTime, fps, d, el.duration);
  };
  const jump = (to: number, play = false) => {
    seek(el, to);
    if (play && el?.paused) void el.play().catch(() => undefined);
  };
  const comment = () => {
    const at = formatTime(t);
    env.perform([{ $iris: "action", kind: "insert", args: [`At ${at} in ${name}: `] }]);
  };
  const fullscreen = () => {
    const b = box.current;
    if (!b) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void b.requestFullscreen?.().catch(() => undefined);
  };
  const onKey = (e: KeyboardEvent) =>
    mediaKeys(e, el, (k) => {
      if (k === ",") step(-1);
      else if (k === ".") step(1);
      else if (k === "f") fullscreen();
      else if (k === "<" || k === ">") setRate((r) => SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, SPEEDS.indexOf(r as (typeof SPEEDS)[number]) + (k === ">" ? 1 : -1)))]);
      else return false;
      return true;
    });

  const problem = fileProblem(media.file, media.failure, "<VideoPlayer>");
  const paused = !playing;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Problems list={[...chapters.problems, ...notes.problems]} what="<VideoPlayer>" />
      <Caption title={str(props.title)} name={name} sample={media.sample} />
      <div tabIndex={0} onKeyDown={onKey} className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl", FOCUS_BOX)} aria-label={`Video ${name}. Space plays, arrows skip, comma and period step a frame`}>
        <div ref={box} className="relative overflow-hidden rounded-lg bg-muted [&:fullscreen]:rounded-none" style={{ aspectRatio: aspect ? String(aspect) : "16 / 9", maxHeight: 460 }}>
          {problem ? (
            <div className="absolute inset-0 grid place-items-center p-4">{problem}</div>
          ) : media.url ? (
            <video
              ref={setEl}
              key={media.url}
              src={media.url}
              preload="metadata"
              playsInline
              loop={props.loop === true}
              className="size-full object-contain"
              onClick={() => playToggle(el)}
              onDoubleClick={fullscreen}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
                v.playbackRate = rate;
                const resume = media.resumeAt.current;
                media.resumeAt.current = null;
                if (resume !== null) v.currentTime = resume;
                else if (start !== null) v.currentTime = start;
              }}
              onError={(e) => media.onError(e.currentTarget)}
            />
          ) : (
            <Shimmer className="size-full rounded-none" />
          )}
          {media.url && !problem && paused && t === 0 ? (
            <button type="button" onClick={() => playToggle(el)} aria-label="Play" className="absolute inset-0 m-auto grid size-14 place-items-center rounded-full bg-card text-foreground shadow-md ring-1 ring-border transition-transform hover:scale-105">
              <Glyph name="play" size={24} className="translate-x-px" />
            </button>
          ) : null}
        </div>
        <Scrubber
          t={t}
          duration={duration}
          buffered={buffered}
          spans={spans}
          marks={notes.items.map((n) => ({ at: n.at, color: noteColor(n), text: n.text }))}
          onSeek={(to) => seek(el, to)}
          accent={accent}
          fps={fps}
        />
        <div className="flex min-w-0 items-center gap-0.5 sm:gap-1">
          <button type="button" className={ICON_BTN} onClick={() => playToggle(el)} aria-label={paused ? "Play" : "Pause"} disabled={!el}>
            <Glyph name={paused ? "play" : "pause"} size={16} />
          </button>
          <button type="button" className={ICON_BTN} onClick={() => step(-1)} aria-label="Previous frame (comma)" title="Previous frame (,)" disabled={!el}>
            <Glyph name="step-back" size={15} />
          </button>
          <button type="button" className={ICON_BTN} onClick={() => step(1)} aria-label="Next frame (period)" title="Next frame (.)" disabled={!el}>
            <Glyph name="step-forward" size={15} />
          </button>
          <span className="ml-1 min-w-0 truncate font-mono text-[12px] tabular-nums text-muted-foreground">
            <span className="text-foreground">{formatTime(t, paused && t > 0 ? { fps } : {})}</span> / {formatTime(duration)}
          </span>
          {chapterAt >= 0 && chapters.items.length > 1 ? <span className="hidden min-w-0 truncate text-[12px] text-muted-foreground sm:inline">· {chapters.items[chapterAt].title}</span> : null}
          <div className="flex-1" />
          <button type="button" className={cn(ICON_BTN, "inline-flex w-auto gap-1.5 px-2.5 text-[12.5px] font-medium")} onClick={comment} title="Put the current time in the composer" disabled={!el}>
            <Glyph name="message-square-plus" size={14} />
            <span className="hidden sm:inline">Comment</span>
          </button>
          <SpeedSelect value={rate} onChange={setRate} />
          <button type="button" className={ICON_BTN} onClick={() => setMuted((m) => !m)} aria-label={muted ? "Unmute" : "Mute"} disabled={!el}>
            <Glyph name={muted ? "volume-x" : "volume-2"} size={15} />
          </button>
          <button type="button" className={ICON_BTN} onClick={fullscreen} aria-label="Full screen" disabled={!el}>
            <Glyph name="maximize" size={14} />
          </button>
        </div>
      </div>
      {chapters.items.length || notes.items.length ? (
        <div className={cn("grid min-w-0 gap-3", chapters.items.length && notes.items.length && "sm:grid-cols-2")}>
          {chapters.items.length ? <ChapterList chapters={chapters.items} at={chapterAt} onJump={(c) => jump(c.at)} accent={accent} /> : null}
          {notes.items.length ? <NoteList notes={notes.items} at={noteAt} onJump={(n) => jump(n.at)} color={noteColor} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ListHead({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 px-1 text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
      <Glyph name={icon} size={12} />
      {children}
    </div>
  );
}

function ChapterList({ chapters, at, onJump, accent }: { chapters: Chapter[]; at: number; onJump: (c: Chapter) => void; accent: string }) {
  return (
    <div className="min-w-0">
      <ListHead icon="list-video">Chapters</ListHead>
      <ol className="flex flex-col">
        {chapters.map((c, k) => (
          <li key={k}>
            <button
              type="button"
              onClick={() => onJump(c)}
              className={cn("flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-state-hover", k === at && "font-medium")}
              style={k === at ? { background: tint(accent, 12) } : undefined}
              aria-current={k === at ? "true" : undefined}
            >
              <span className="w-4 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground">{k + 1}</span>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">{formatTime(c.at)}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function NoteList({ notes, at, onJump, color }: { notes: TimedNote[]; at: number; onJump: (n: TimedNote) => void; color: (n: TimedNote) => string }) {
  return (
    <div className="min-w-0">
      <ListHead icon="message-square">Notes</ListHead>
      <ul className="flex flex-col">
        {notes.map((n, k) => (
          <li key={k}>
            <button
              type="button"
              onClick={() => onJump(n)}
              className="flex w-full min-w-0 items-start gap-2 rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-state-hover"
              style={k === at ? { background: tint(color(n), 12) } : undefined}
              aria-current={k === at ? "true" : undefined}
            >
              <span aria-hidden className="mt-[5px] size-2 shrink-0 rounded-full" style={{ background: color(n) }} />
              <span className="min-w-0 flex-1">{n.text}</span>
              <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">{formatTime(n.at)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------- AudioPlayer ----------

type Wave = { status: "loading" } | { status: "ok"; peaks: number[] } | { status: "error"; error: string };

/** Peaks from the decoded audio, once per URL. */
const waveCache = new Map<string, Promise<number[]>>();
function useWave(url: string | null): Wave {
  const [wave, setWave] = useState<Wave>({ status: "loading" });
  useEffect(() => {
    if (!url) return setWave({ status: "loading" });
    let live = true;
    let p = waveCache.get(url);
    if (!p) {
      p = fetchBytes(url, MAX_DECODE_BYTES)
        .then((buf) => new OfflineAudioContext(1, 1, 44_100).decodeAudioData(buf))
        .then((audio) => computePeaks(Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, k) => audio.getChannelData(k)), 1200));
      waveCache.set(url, p);
      p.catch(() => waveCache.delete(url));
      if (waveCache.size > 24) waveCache.delete(waveCache.keys().next().value as string);
    }
    setWave({ status: "loading" });
    p.then(
      (peaks) => live && setWave({ status: "ok", peaks }),
      (e: unknown) => live && setWave({ status: "error", error: errorText(e) }),
    );
    return () => {
      live = false;
    };
  }, [url]);
  return wave;
}

/** Max-pools fine peaks down to the number of bars that fit. */
function bars(peaks: number[], count: number): number[] {
  const n = Math.max(1, count);
  return Array.from({ length: n }, (_, k) => {
    const from = Math.floor((k * peaks.length) / n);
    const to = Math.max(from + 1, Math.floor(((k + 1) * peaks.length) / n));
    let m = 0;
    for (let i = from; i < to; i++) m = Math.max(m, peaks[i] ?? 0);
    return m;
  });
}

function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, w];
}

function Waveform({ wave, t, duration, onSeek, accent, ticks }: { wave: Wave; t: number; duration: number; onSeek: (to: number) => void; accent: string; ticks: number[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const box = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const H = 64;
  const count = Math.max(24, Math.floor(width / 4));
  const heights = wave.status === "ok" ? bars(wave.peaks, count) : null;
  const ratio = duration ? Math.min(1, t / duration) : 0;
  const at = (e: ReactPointerEvent) => {
    const r = box.current?.getBoundingClientRect();
    return r && r.width ? Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) : 0;
  };
  const svg = (color: string) =>
    heights ? (
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} className="block" aria-hidden>
        {heights.map((h, k) => {
          const bh = Math.max(2, h * (H - 4));
          return <rect key={k} x={(k * width) / count + 0.5} y={(H - bh) / 2} width={Math.max(1, width / count - 1.5)} height={bh} rx={1} fill={color} />;
        })}
      </svg>
    ) : null;
  return (
    <div
      ref={(el) => {
        box.current = el;
        ref(el);
      }}
      role="slider"
      tabIndex={-1}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={formatTime(t)}
      className="relative cursor-pointer touch-none select-none"
      style={{ height: H }}
      onPointerDown={(e) => {
        if (!duration) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(true);
        onSeek(at(e) * duration);
      }}
      onPointerMove={(e) => {
        setHover(at(e));
        if (drag && duration) onSeek(at(e) * duration);
      }}
      onPointerUp={() => setDrag(false)}
      onPointerCancel={() => setDrag(false)}
      onPointerLeave={() => !drag && setHover(null)}
    >
      {heights ? (
        <>
          <div className="absolute inset-0 opacity-30">{svg("var(--muted-foreground)")}</div>
          <div className="absolute inset-y-0 left-0 overflow-hidden" style={{ width: `${ratio * 100}%` }}>
            {svg(accent)}
          </div>
        </>
      ) : wave.status === "loading" ? (
        <Shimmer className="absolute inset-x-0 top-1/2 h-8 -translate-y-1/2" />
      ) : (
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-muted">
          <div className="h-full" style={{ width: `${ratio * 100}%`, background: accent }} />
        </div>
      )}
      {duration
        ? ticks.map((s, k) => <span key={k} aria-hidden className="pointer-events-none absolute bottom-0 h-1.5 w-px bg-muted-foreground/50" style={{ left: `${(s / duration) * 100}%` }} />)
        : null}
      <span aria-hidden className="pointer-events-none absolute inset-y-1 w-0.5 -translate-x-1/2 rounded-full" style={{ left: `${ratio * 100}%`, background: accent }} />
      {hover !== null && duration ? (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-y-2 w-px bg-foreground/40" style={{ left: `${hover * 100}%` }} />
          <span
            aria-hidden
            className="pointer-events-none absolute -top-5 -translate-x-1/2 whitespace-nowrap rounded-md bg-popover px-1.5 py-0.5 text-[11px] tabular-nums text-popover-foreground shadow-md ring-1 ring-border"
            style={{ left: `${Math.max(4, Math.min(96, hover * 100))}%` }}
          >
            {formatTime(hover * duration)}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function AudioPlayerView({ props }: ViewProps) {
  const env = useEnv();
  const { palette } = env;
  const accent = accentOf(palette);
  const src = str(props.src);
  const media = useMediaSource(src, "synth");
  const [el, setEl] = useState<HTMLAudioElement | null>(null);
  const { t, duration, playing } = useClock(el);
  const wave = useWave(media.url);
  const [rate, setRate] = useState(() => snapSpeed(props.speed));
  const pending = isPendingValue(props.transcript);
  const transcript = useMemo(() => normalizeTranscript(pending ? null : props.transcript), [pending, props.transcript]);
  const lines = transcript.items;
  const at = activeIndex(lines.map((l, k) => ({ at: l.at, end: l.end ?? lines[k + 1]?.at ?? null })), t);
  const follow = props.follow !== false;
  const height = Math.max(80, Math.min(900, num(props.height) ?? 220));
  const start = parseTime(props.start);
  const name = src ? mediaName(src) : "audio";
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (el) el.playbackRate = rate;
  }, [el, rate, media.url]);
  // Keep the current line in view inside the transcript box, never scrolling the page.
  useEffect(() => {
    const box = list.current;
    if (!follow || !box || at < 0 || !playing) return;
    const row = box.children[at] as HTMLElement | undefined;
    if (!row) return;
    const top = row.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
  }, [at, follow, playing]);

  const jump = (to: number) => {
    seek(el, to);
    if (el?.paused) void el.play().catch(() => undefined);
  };
  const problem = fileProblem(media.file, media.failure, "<AudioPlayer>");
  const paused = !playing;
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <Problems list={transcript.problems} what="<AudioPlayer>" />
      <Caption title={str(props.title)} name={name} sample={media.sample} />
      {media.url && !problem ? (
        <audio
          ref={setEl}
          key={media.url}
          src={media.url}
          preload="metadata"
          onLoadedMetadata={(e) => {
            const a = e.currentTarget;
            a.playbackRate = rate;
            const resume = media.resumeAt.current;
            media.resumeAt.current = null;
            if (resume !== null) a.currentTime = resume;
            else if (start !== null) a.currentTime = start;
          }}
          onError={(e) => media.onError(e.currentTarget)}
        />
      ) : null}
      {problem ?? (
        <div tabIndex={0} onKeyDown={(e) => mediaKeys(e, el)} className={cn("flex min-w-0 items-center gap-3 rounded-xl", FOCUS_BOX)} aria-label={`Audio ${name}. Space plays, arrows skip 5 seconds`}>
          <button
            type="button"
            onClick={() => playToggle(el)}
            disabled={!el}
            aria-label={paused ? "Play" : "Pause"}
            className="grid size-11 shrink-0 place-items-center rounded-full text-background transition-opacity hover:opacity-90 disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]"
            style={{ background: accent }}
          >
            <Glyph name={paused ? "play" : "pause"} size={18} className={paused ? "translate-x-px" : undefined} />
          </button>
          <div className="min-w-0 flex-1">
            <Waveform wave={wave} t={t} duration={duration} onSeek={(to) => seek(el, to)} accent={accent} ticks={lines.map((l) => l.at)} />
            <div className="mt-1 flex items-center gap-1 text-[12px] tabular-nums text-muted-foreground">
              <span className="font-mono">
                <span className="text-foreground">{formatTime(t)}</span> / {formatTime(duration)}
              </span>
              {wave.status === "error" ? <span className="min-w-0 truncate" title={wave.error}>· no waveform: {wave.error}</span> : null}
              <div className="flex-1" />
              <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => el && seek(el, el.currentTime - 5)} aria-label="Back 5 seconds" disabled={!el}>
                <Glyph name="rotate-ccw" size={14} />
              </button>
              <button type="button" className={cn(ICON_BTN, "size-7")} onClick={() => el && seek(el, el.currentTime + 5)} aria-label="Forward 5 seconds" disabled={!el}>
                <Glyph name="rotate-cw" size={14} />
              </button>
              <SpeedSelect value={rate} onChange={setRate} />
            </div>
          </div>
        </div>
      )}
      {lines.length ? (
        <ol ref={list} className="relative flex min-w-0 flex-col overflow-y-auto overscroll-contain rounded-lg ring-1 ring-border" style={{ maxHeight: height }} aria-label="Transcript">
          {lines.map((l, k) => {
            const on = k === at;
            return (
              <li key={k} className="border-b border-border/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => jump(l.at)}
                  aria-current={on ? "true" : undefined}
                  className={cn("flex w-full min-w-0 items-baseline gap-2.5 px-3 py-1.5 text-left text-[13px] leading-snug transition-colors hover:bg-state-hover", !on && at >= 0 && k < at && "text-muted-foreground")}
                  style={on ? { background: tint(accent, 13) } : undefined}
                >
                  <span className="w-10 shrink-0 font-mono text-[11.5px] tabular-nums text-muted-foreground">{formatTime(l.at)}</span>
                  <span className="min-w-0 flex-1">
                    {l.speaker ? (
                      <span className="mr-1.5 font-medium">
                        {l.speaker}
                      </span>
                    ) : null}
                    {l.text}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

// ---------- the gallery's audio sample ----------

let synthCache: string | null = null;

/** About 9.6 s of speech-like bursts in three phrases, as a 16 kHz WAV object URL (matches the catalog example). */
function synthUrl(): string {
  if (synthCache) return synthCache;
  const rate = 16_000;
  const seconds = 9.6;
  const n = Math.floor(rate * seconds);
  const data = new Int16Array(n);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const phrases: [number, number, number][] = [
    [0.15, 2.9, 170],
    [3.3, 6.2, 120],
    [6.6, 9.3, 180],
  ];
  for (const [from, to, pitch] of phrases) {
    let s = from;
    while (s < to) {
      const len = 0.09 + rand() * 0.22;
      const amp = 0.25 + rand() * 0.65;
      const a = Math.floor(s * rate);
      const b = Math.min(n, Math.floor(Math.min(to, s + len) * rate));
      const f = pitch * (0.85 + rand() * 0.3);
      for (let i = a; i < b; i++) {
        const x = (i - a) / Math.max(1, b - a);
        const env = Math.sin(Math.PI * x) ** 1.5 * amp;
        const tt = i / rate;
        const v = Math.sin(2 * Math.PI * f * tt) * 0.6 + Math.sin(4 * Math.PI * f * tt) * 0.25 + Math.sin(6 * Math.PI * f * tt) * 0.1 + (rand() - 0.5) * 0.12;
        data[i] = Math.max(-32767, Math.min(32767, v * env * 22_000));
      }
      s += len + 0.02 + rand() * 0.08;
    }
  }
  const header = new DataView(new ArrayBuffer(44));
  const text = (o: number, v: string) => [...v].forEach((c, k) => header.setUint8(o + k, c.charCodeAt(0)));
  text(0, "RIFF");
  header.setUint32(4, 36 + n * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, rate, true);
  header.setUint32(28, rate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  text(36, "data");
  header.setUint32(40, n * 2, true);
  synthCache = URL.createObjectURL(new Blob([header.buffer, data.buffer], { type: "audio/wav" }));
  return synthCache;
}
