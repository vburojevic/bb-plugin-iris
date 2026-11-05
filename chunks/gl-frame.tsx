// The frame around a WebGL view (Scene, Shader): caption, the canvas or its
// last frame while its context is given back, and the blocked state.
import { Glyph, Shimmer, type GlSlot } from "@iris/ui";
import type { ReactNode } from "react";

export const OVERLAY_BTN = "grid size-7 place-items-center rounded-full bg-card/85 text-foreground shadow-[0_0_0_1px_var(--border)] backdrop-blur-sm hover:bg-card focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)]";

/** The frame around a WebGL view: caption, the canvas or its poster, and the paused or blocked states. */
export function GlFrame({ title, height, slot, children, controls }: { title?: string; height: number; slot: GlSlot; children: ReactNode; controls?: ReactNode }) {
  return (
    <figure className="m-0 flex min-w-0 flex-col gap-1.5">
      {title ? <figcaption className="truncate text-[12.5px] font-medium text-muted-foreground">{title}</figcaption> : null}
      <div ref={slot.attach} className="group relative min-w-0 overflow-hidden rounded-[12px] bg-muted/25 ring-1 ring-border" style={{ height }}>
        {slot.live ? children : slot.poster ? <img src={slot.poster} alt="" className="absolute inset-0 size-full object-cover" /> : <Shimmer className="absolute inset-0 rounded-none" />}
        {slot.blocked ? (
          <div className="absolute inset-0 grid place-items-center bg-card/60 backdrop-blur-[2px]">
            <button type="button" onClick={slot.wake} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background hover:opacity-90">
              <Glyph name="play" size={14} />
              Show this view
            </button>
          </div>
        ) : null}
        {slot.live && controls ? <div className="absolute bottom-2 right-2 flex gap-1.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">{controls}</div> : null}
      </div>
    </figure>
  );
}
