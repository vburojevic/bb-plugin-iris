// The iris-react chunk, loaded into the parent on first use: the TSX
// compiler and the frame runtime as text. Compiling here is a pure string
// transform; the compiled app only ever runs inside the sandboxed frame.
import { transform } from "sucrase";
import runtime from "virtual:react-frame-runtime";
import { checkImports, missingKitImports, type AppProblem } from "../core/react-kit";
import { KIT_CSS } from "./react-frame/styles";

export { runtime, KIT_CSS as css };

export const MAX_SOURCE = 200_000;

export type Compiled = { ok: true; code: string } | { ok: false; problems: AppProblem[] };

/** TSX to a CommonJS-style module body; sucrase keeps every line where it was. */
export function compileApp(source: string): Compiled {
  if (source.length > MAX_SOURCE) return { ok: false, problems: [{ message: `The app is ${Math.round(source.length / 1000)} KB, over the ${MAX_SOURCE / 1000} KB limit` }] };
  if (!source.trim()) return { ok: false, problems: [{ message: "The block is empty: write a module whose default export is a component" }] };
  const problems = checkImports(source);
  try {
    const { code } = transform(source, {
      transforms: ["typescript", "jsx", "imports"],
      jsxRuntime: "automatic",
      production: true,
      disableESTransforms: true,
      filePath: "iris-app.tsx",
    });
    problems.push(...missingKitImports(code));
    return problems.length ? { ok: false, problems } : { ok: true, code };
  } catch (error) {
    const loc = (error as { loc?: { line?: number } }).loc;
    const message = (error instanceof Error ? error.message : String(error)).replace(/^Error transforming [^:]*: /, "").replace(/\s*\(\d+:\d+\)\s*$/, "");
    return { ok: false, problems: [{ message: `Syntax error: ${message}`, line: loc?.line }, ...problems] };
  }
}
