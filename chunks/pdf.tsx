// PdfViewer (chunk "pdf", with pdf.js; its worker is the "pdf-worker" chunk).
// pdf.js reads the file from its bb preview URL with range requests, so a big
// PDF opens without being read whole; pages draw as they scroll in.

import { Chip, Glyph, InlineError, Shimmer, chunkEntryUrl, cn, num, str } from "@iris/ui";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from "pdfjs-dist";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ZOOMS, nextZoom, parsePages } from "../core/files";
import { mediaName } from "../core/players";
import type { ViewProps } from "../ui/render";
import { errorText, leaseLapsed, useFileUrl } from "./file-access";

const ICON_BTN =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--iris-accent)] disabled:pointer-events-none disabled:opacity-40";

let workerSet = false;
function ensureWorker() {
  if (workerSet) return;
  GlobalWorkerOptions.workerSrc = chunkEntryUrl("pdf-worker");
  workerSet = true;
}

type Doc = { status: "loading" } | { status: "error"; error: string } | { status: "ok"; doc: PDFDocumentProxy };

function useDocument(source: { url: string } | { data: Uint8Array } | null): Doc {
  const [state, setState] = useState<Doc>({ status: "loading" });
  const key = source ? ("url" in source ? source.url : `data:${source.data.length}`) : null;
  useEffect(() => {
    if (!source) return setState({ status: "loading" });
    ensureWorker();
    setState({ status: "loading" });
    const task = getDocument({
      ...("url" in source ? { url: source.url, withCredentials: true } : { data: source.data.slice() }),
      rangeChunkSize: 256 * 1024,
      disableAutoFetch: true,
      enableXfa: false,
    });
    let live = true;
    task.promise.then(
      (doc) => live && setState({ status: "ok", doc }),
      (e: unknown) => {
        if (!live) return;
        const msg = errorText(e);
        setState({ status: "error", error: /Missing PDF|404/i.test(msg) ? "file not found" : /Invalid PDF/i.test(msg) ? "not a PDF Iris can read" : /password/i.test(msg) ? "the PDF is password protected" : msg });
      },
    );
    return () => {
      live = false;
      void task.destroy();
    };
    // key stands for source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

export function PdfViewerView({ props }: ViewProps) {
  const src = str(props.src);
  const [file, renew] = useFileUrl(src);
  const sample = file.status === "sample";
  const sampleData = useMemo(() => (sample ? samplePdf() : null), [sample]);
  const source = file.status === "ok" ? { url: file.url } : sampleData ? { data: sampleData } : null;
  const doc = useDocument(source);
  // A lease that ran out while the PDF sat open: ask for a fresh one.
  useEffect(() => {
    if (doc.status === "error" && leaseLapsed(file)) renew();
  }, [doc.status, file, renew]);
  const height = Math.max(200, Math.min(1400, num(props.height) ?? 560));
  const [zoom, setZoom] = useState(() => {
    const z = num(props.zoom) ?? 1;
    return Math.max(ZOOMS[0], Math.min(ZOOMS[ZOOMS.length - 1], z));
  });
  const scroller = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [current, setCurrent] = useState(1);
  const [jump, setJump] = useState("");
  const name = src ? mediaName(src) : "sample.pdf";
  const count = doc.status === "ok" ? doc.doc.numPages : 0;
  const pages = useMemo(() => parsePages(props.pages, count), [props.pages, count]);
  const first = Math.round(num(props.page) ?? 1);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [doc.status]);

  // Start on the asked-for page once the pages have laid out.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !pages.length || !width) return;
    started.current = true;
    if (first > 1) requestAnimationFrame(() => goTo(first, "auto"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages.length, width]);

  // The page nearest the top of the viewer is the current one.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pages.length) return;
    const onScroll = () => {
      const top = el.scrollTop + 24;
      let best = pages[0];
      for (const child of el.querySelectorAll<HTMLElement>("[data-page]")) {
        if (child.offsetTop <= top) best = Number(child.dataset.page);
        else break;
      }
      setCurrent(best);
    };
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [pages, zoom, width]);

  const goTo = (n: number, behavior: ScrollBehavior = "smooth") => {
    const el = scroller.current;
    const target = el?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (el && target) el.scrollTo({ top: target.offsetTop - 8, behavior });
  };
  const step = (d: 1 | -1) => {
    const k = pages.indexOf(current);
    const next = pages[Math.max(0, Math.min(pages.length - 1, (k < 0 ? 0 : k) + d))];
    if (next) goTo(next);
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input")) return;
    if (e.key === "ArrowRight" || e.key === "PageDown") step(1);
    else if (e.key === "ArrowLeft" || e.key === "PageUp") step(-1);
    else if (e.key === "+" || e.key === "=") setZoom((z) => nextZoom(z, 1));
    else if (e.key === "-") setZoom((z) => nextZoom(z, -1));
    else return;
    e.preventDefault();
  };

  if (file.status === "error") return <InlineError error={new Error(file.error)} context="<PdfViewer>" />;
  if (doc.status === "error") return <InlineError error={new Error(doc.error)} context="<PdfViewer>" />;
  const at = pages.indexOf(current);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
        <div className="flex min-w-[10rem] flex-1 items-center gap-1.5">
          <Glyph name="file-text" size={15} className="text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{str(props.title) ?? name}</span>
          {sample ? <Chip>Sample</Chip> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" className={ICON_BTN} onClick={() => step(-1)} disabled={at <= 0} aria-label="Previous page">
          <Glyph name="chevron-up" size={15} />
        </button>
        <form
          className="flex items-center gap-1 text-[12px] tabular-nums text-muted-foreground"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(jump);
            if (pages.includes(n)) goTo(n);
            setJump("");
          }}
        >
          <input
            value={jump}
            onChange={(e) => setJump(e.target.value.replace(/\D/g, ""))}
            placeholder={String(current)}
            aria-label="Go to page"
            inputMode="numeric"
            className="h-7 w-10 rounded-md bg-transparent text-center text-foreground ring-1 ring-border outline-none placeholder:text-foreground focus:ring-[color-mix(in_oklab,var(--iris-accent)_60%,transparent)]"
          />
          <span>of {count || "…"}</span>
        </form>
        <button type="button" className={ICON_BTN} onClick={() => step(1)} disabled={at >= pages.length - 1} aria-label="Next page">
          <Glyph name="chevron-down" size={15} />
        </button>
        <span className="mx-0.5 h-4 w-px bg-border" aria-hidden />
        <button type="button" className={ICON_BTN} onClick={() => setZoom((z) => nextZoom(z, -1))} disabled={zoom <= ZOOMS[0]} aria-label="Zoom out">
          <Glyph name="zoom-out" size={15} />
        </button>
        <button type="button" className={cn(ICON_BTN, "w-auto px-1.5 text-[12px] tabular-nums")} onClick={() => setZoom(1)} aria-label="Fit width" title="Fit width">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" className={ICON_BTN} onClick={() => setZoom((z) => nextZoom(z, 1))} disabled={zoom >= ZOOMS[ZOOMS.length - 1]} aria-label="Zoom in">
          <Glyph name="zoom-in" size={15} />
        </button>
        </div>
      </div>
      <div
        ref={scroller}
        tabIndex={0}
        onKeyDown={onKey}
        aria-label={`${name}, page ${current} of ${count}`}
        className="relative min-w-0 overflow-auto overscroll-contain rounded-lg bg-muted/60 p-2 outline-none ring-1 ring-border focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--iris-accent)_45%,transparent)]"
        style={{ height }}
      >
        {doc.status === "loading" || !width ? (
          <Shimmer className="mx-auto aspect-[1/1.3] w-full max-w-[640px]" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            {pages.map((n) => (
              <PdfPage key={n} doc={doc.doc} n={n} width={Math.max(120, (width - 16) * zoom)} root={scroller.current} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** One page: a placeholder of the right shape until it nears the viewer, then a canvas at device pixels. */
function PdfPage({ doc, n, width, root }: { doc: PDFDocumentProxy; n: number; width: number; root: HTMLElement | null }) {
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [near, setNear] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    doc.getPage(n).then(
      (p) => live && setPage(p),
      (e: unknown) => live && setError(errorText(e)),
    );
    return () => {
      live = false;
    };
  }, [doc, n]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: "800px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  const base = page?.getViewport({ scale: 1 });
  const scale = base ? width / base.width : 1;
  const h = base ? base.height * scale : width * 1.294;
  useEffect(() => {
    const c = canvas.current;
    if (!page || !near || !c) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const viewport = page.getViewport({ scale: scale * dpr });
    c.width = Math.floor(viewport.width);
    c.height = Math.floor(viewport.height);
    let task: RenderTask | null = null;
    // Re-rendering on every zoom step would thrash; wait for the zoom to settle.
    const timer = setTimeout(() => {
      task = page.render({ canvas: c, viewport });
      task.promise.catch((e: unknown) => {
        if (!/cancel/i.test(errorText(e))) setError(errorText(e));
      });
    }, 60);
    return () => {
      clearTimeout(timer);
      task?.cancel();
    };
  }, [page, near, scale]);
  return (
    <div ref={box} data-page={n} className="relative shrink-0 overflow-hidden rounded-[3px] bg-card shadow-sm ring-1 ring-border" style={{ width, height: h }}>
      {near && page ? <canvas ref={canvas} className="block size-full" aria-label={`Page ${n}`} /> : null}
      {error ? <div className="absolute inset-0 grid place-items-center p-4 text-center text-[12px] text-muted-foreground">Page {n} couldn't draw: {error}</div> : null}
      <span className="pointer-events-none absolute bottom-1.5 right-2 rounded bg-card px-1.5 py-0.5 text-[10.5px] tabular-nums text-muted-foreground ring-1 ring-border">{n}</span>
    </div>
  );
}

/** A three-page PDF built in memory for the gallery: a cover, a chart page and a table page. */
function samplePdf(): Uint8Array {
  const pages = [
    "BT /F1 30 Tf 72 680 Td (Quarterly review) Tj ET BT /F1 14 Tf 72 650 Td (A sample PDF drawn by pdf.js) Tj ET 0.42 0.44 0.48 rg 72 420 468 180 re f 1 1 1 rg BT /F1 22 Tf 96 500 Td (Sync is live for every user) Tj ET",
    "BT /F1 22 Tf 72 700 Td (Weekly active users) Tj ET 0.42 0.44 0.48 rg 90 420 50 120 re f 160 420 50 170 re f 230 420 50 150 re f 300 420 50 230 re f 370 420 50 260 re f 0.2 0.2 0.25 RG 1 w 80 420 m 440 420 l S",
    "BT /F1 22 Tf 72 700 Td (Next steps) Tj ET BT /F1 13 Tf 72 660 Td (1. Ship the importer fix) Tj 0 -24 Td (2. Widget shows today's total) Tj 0 -24 Td (3. Export to CSV) Tj ET",
  ];
  const objects: string[] = [];
  const add = (body: string) => objects.push(body) && objects.length;
  const catalog = add("");
  const pagesObj = add("");
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids: number[] = [];
  for (const content of pages) {
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, k) => {
    offsets.push(out.length);
    out += `${k + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
