// What chunks may use from the main bundle, imported in chunk sources as
// "@iris/ui". Chunks must use these instances, not their own copies: useEnv
// reads the card's context, and a second copy of it would be a different
// context. Getters keep this safe across the import cycle with render.tsx.
// Only functions belong here: the chunk shim calls through to the current
// main bundle, so a plugin reload never leaves a chunk on stale bindings.

import { chunkEntryUrl, sampleUrl } from "./chunks";
import { useEnv } from "./env";
import { hexColor, themeVar, useGlSlot } from "./gl";
import { inkOn, sequentialRamp, toneColor, tooClose } from "./palette";
import { InlineError } from "./render";
import { renderValue } from "./render";
import { runCells } from "../core/compute";
import { Prose } from "./views/prose";
import { Chip, Glyph, Shimmer, cn, num, str } from "./views/kit";
import { CompareView } from "./views/evidence";
import { literalStrings } from "./files";

export type { GlSlot } from "./gl";
export { chunkEntryUrl, sampleUrl };
export { Chip, CompareView, Glyph, InlineError, literalStrings, Prose, Shimmer, cn, hexColor, num, sequentialRamp, str, themeVar, useEnv, useGlSlot };
export { renderValue, runCells };
export { inkOn, toneColor, tooClose };

export const CHUNK_API = {
  get useEnv() { return useEnv; },
  get InlineError() { return InlineError; },
  get Prose() { return Prose; },
  get Chip() { return Chip; },
  get Glyph() { return Glyph; },
  get Shimmer() { return Shimmer; },
  get cn() { return cn; },
  get num() { return num; },
  get str() { return str; },
  get useGlSlot() { return useGlSlot; },
  get hexColor() { return hexColor; },
  get themeVar() { return themeVar; },
  get sampleUrl() { return sampleUrl; },
  get chunkEntryUrl() { return chunkEntryUrl; },
  get renderValue() { return renderValue; },
  get runCells() { return runCells; },
  get sequentialRamp() { return sequentialRamp; },
  get tooClose() { return tooClose; },
  get toneColor() { return toneColor; },
  get inkOn() { return inkOn; },
  get CompareView() { return CompareView; },
  get literalStrings() { return literalStrings; },
};
