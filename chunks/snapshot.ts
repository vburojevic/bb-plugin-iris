// Chunk "snapshot": a card drawn to a PNG in the browser, for the toolbar's Copy as image.
// Loaded on the first copy only, so cards that are never copied never pay for it.
import { domToBlob } from "modern-screenshot";

/** Space around the card in the image, in CSS pixels. */
const PAD = 16;

/**
 * The element as a PNG on the given background, at twice its size (or the screen's density when
 * higher), without its toolbar. The background is the surface the card sits on, so the image
 * looks like the card does in bb.
 */
export async function cardPng(el: HTMLElement, background: string): Promise<Blob> {
  const rect = el.getBoundingClientRect();
  const blob = await domToBlob(el, {
    type: "image/png",
    scale: Math.max(2, Math.min(3, globalThis.devicePixelRatio || 1)),
    width: Math.ceil(rect.width) + PAD * 2,
    height: Math.ceil(rect.height) + PAD * 2,
    backgroundColor: background,
    style: { margin: "0", padding: `${PAD}px`, boxSizing: "border-box" },
    filter: (node) => !(node instanceof Element && (node.classList.contains("iris-tools") || node.classList.contains("iris-readout") || node.hasAttribute("data-iris-snapshot-skip"))),
  });
  if (!blob) throw new Error("the card couldn't be drawn as an image");
  return blob;
}
