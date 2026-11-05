// The Iris mark inside bb: four blades around a square window, drawn in the
// theme's accent so it follows the person's theme like everything else in Iris.
import { useId } from "react";
import { MARK_PATH } from "./brand-mark";

export function IrisMark({ size = 40 }: { size?: number }) {
  const title = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-labelledby={title}>
      <title id={title}>Iris</title>
      <path d={MARK_PATH} style={{ fill: "var(--iris-accent, var(--primary))" }} />
    </svg>
  );
}
