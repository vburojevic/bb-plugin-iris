// Screens (chunk "review"): every screen across columns (devices, themes, locales) in one grid,
// a status chip on each shot and Gallery's lightbox (from the main bundle) on a click.

import { useMemo, useRef, useState, type ReactNode } from "react";
import { isPendingValue } from "../core/evaluate";
import { type GalleryImage, screenMatrix } from "../core/media";
import { Chip, Glyph, Lightbox, Shimmer, str, useLoadedImages } from "@iris/ui";
import type { ViewProps } from "../ui/render";

function Notice({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
      <Glyph name={icon} size={13} />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

/** A status word's tone: passed and ok read good, failed and broken bad, changed and missing warn. */
function statusTone(status: string): string {
  const s = status.toLowerCase();
  return /^(ok|pass|passed|good|same|done|success|matches)$/.test(s)
    ? "good"
    : /^(fail|failed|failure|broken|bad|error|regression|mismatch)$/.test(s)
      ? "bad"
      : /^(changed|warn|warning|missing|new|pending|skipped|flaky)$/.test(s)
        ? "warn"
        : "neutral";
}

export function ScreensView({ props }: ViewProps) {
  const pending = isPendingValue(props.shots);
  const m = useMemo(() => screenMatrix(pending ? [] : props.shots, props.columns), [pending, props.shots, props.columns]);
  const states = useLoadedImages(m.shots.map((s) => s.src));
  const [open, setOpen] = useState<number | null>(null);
  const tiles = useRef<(HTMLButtonElement | null)[]>([]);
  const images: GalleryImage[] = useMemo(
    () => m.shots.map((s) => ({ src: s.src, caption: [s.screen, s.column, s.caption].filter(Boolean).join(" · "), alt: `${s.screen} on ${s.column}` })),
    [m.shots],
  );
  if (pending) return <Shimmer className="aspect-video w-full" />;
  if (!m.shots.length) return <Notice icon="images">Screens has no shots</Notice>;
  const close = () => {
    const k = open;
    setOpen(null);
    if (k !== null) tiles.current[k]?.focus();
  };
  const count = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;
  const summary = [count(m.screens.length, "screen"), count(m.columns.length, "column"), m.missing ? `${m.missing} missing` : null].filter(Boolean).join(" · ");
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{str(props.title)}</span>
        <span className="shrink-0 tabular-nums">{summary}</span>
      </div>
      <div className="flex flex-col gap-3">
        {m.screens.map((screen, r) => (
          // Narrow cards: the name over a row that scrolls sideways. Wide: the name in a column of its own and the shots in an even grid.
          <section key={screen} className="min-w-0 @lg/iris:grid @lg/iris:grid-cols-[7.5rem_minmax(0,1fr)] @lg/iris:gap-3">
            <h4 className="mb-1.5 truncate text-[13px] font-medium @lg/iris:mb-0 @lg/iris:pt-1.5" title={screen}>
              {screen}
            </h4>
            <div className="iris-scroll-x -m-0.5 flex gap-2 overflow-x-auto p-0.5 @lg/iris:grid" style={{ gridTemplateColumns: `repeat(${m.columns.length}, minmax(8.5rem, 1fr))` }}>
              {m.cells[r].map((k, c) => {
                const shot = k >= 0 ? m.shots[k] : null;
                const st = k >= 0 ? states[k] : null;
                return (
                  <figure key={c} className="w-[min(44%,11rem)] min-w-[8.5rem] shrink-0 @lg/iris:w-auto @lg/iris:min-w-0">
                    {shot && st ? (
                      <button
                        ref={(el) => {
                          tiles.current[k] = el;
                        }}
                        type="button"
                        onClick={() => setOpen(k)}
                        aria-label={`Open ${shot.screen} on ${shot.column}`}
                        className="group/thumb relative block h-40 w-full overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-shadow hover:ring-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/50 @lg/iris:h-48"
                      >
                        {st.status === "ok" ? (
                          <img src={st.url} alt={`${shot.screen} on ${shot.column}`} loading="lazy" className="block size-full object-contain p-1.5 transition-transform duration-300 group-hover/thumb:scale-[1.03] motion-reduce:transition-none" />
                        ) : st.status === "loading" ? (
                          <Shimmer className="size-full" />
                        ) : (
                          <span className="grid size-full place-items-center px-2 text-center text-[11px] text-muted-foreground">{st.error}</span>
                        )}
                      </button>
                    ) : (
                      <div className="grid h-40 place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground @lg/iris:h-48">Missing</div>
                    )}
                    <figcaption className="mt-1 flex min-h-5 min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="truncate" title={shot?.caption ?? m.columns[c]}>
                        {m.columns[c]}
                      </span>
                      {shot?.status ? <Chip tone={statusTone(shot.status)}>{shot.status}</Chip> : null}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        ))}
      </div>
      {open !== null ? <Lightbox images={images} states={states} index={open} onIndex={setOpen} onClose={close} /> : null}
    </div>
  );
}
