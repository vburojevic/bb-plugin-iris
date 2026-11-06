// The documents iris-app and iris-react frames load. Pure strings, so the
// security properties (policy first, nothing breaks out of a script) are
// tested directly in tests/react-app.test.ts.

export type AppKind = "html" | "react";

export const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

/** JSON that is safe anywhere inside a <script> element. */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const BRIDGE = (storage: Record<string, string>, kind: AppKind) => `
<script>
(() => {
  const post = (type, data) => parent.postMessage({ __iris: true, type, data }, "*");
  const store = ${scriptJson(storage)};
  const shim = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); post("storage", store); },
    removeItem: (k) => { delete store[k]; post("storage", store); },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; post("storage", store); },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  try { Object.defineProperty(window, "localStorage", { value: shim, configurable: true }); } catch {}
  window.iris = {
    send: (text) => post("action", { kind: "send", args: [String(text)] }),
    insert: (text) => post("action", { kind: "insert", args: [String(text)] }),
    copy: (text) => post("action", { kind: "copy", args: [String(text)] }),
    openUrl: (url) => post("action", { kind: "openUrl", args: [String(url)] }),
    submit: (value) => post("submit", value === undefined ? null : JSON.parse(JSON.stringify(value))),
  };
  ${
    kind === "react"
      ? // The kit's root has no margins to collapse, so its box is the content's height, and it can shrink.
        `const size = () => { const r = document.getElementById("root"); post("height", Math.ceil(r ? r.getBoundingClientRect().height : document.documentElement.scrollHeight)); };`
      : // The body's own box, not the document's scroll height: that never drops below the frame's
        // current height, so a short page would keep the first 320 px for good. A page that sizes
        // its body to the viewport keeps its height as before.
        `const mb = (el) => parseFloat(getComputedStyle(el).marginBottom) || 0;
  const size = () => {
    const b = document.body;
    if (!b) return post("height", Math.ceil(document.documentElement.scrollHeight));
    let h = b.getBoundingClientRect().bottom + mb(b);
    for (const c of b.children) { const r = c.getBoundingClientRect(); if (r.width || r.height) h = Math.max(h, r.bottom + mb(c) + mb(b)); }
    // Content past the frame's bottom (a fixed-height body, deep overflow) still shows: then the scroll height counts.
    const sh = document.documentElement.scrollHeight;
    post("height", Math.ceil(sh > innerHeight + 1 ? Math.max(h + scrollY, sh) : h + scrollY));
  };
  addEventListener("error", (e) => post("error", String(e.message || e)));`
  }
  const ro = new ResizeObserver(size);
  ro.observe(document.documentElement);
  addEventListener("DOMContentLoaded", () => { const r = document.getElementById("root"); if (r) ro.observe(r); if (document.body) ro.observe(document.body); size(); });
  addEventListener("load", size);
  addEventListener("message", (e) => { if (e.source === parent && e.data && e.data.__irisTheme) { const s = document.getElementById("iris-theme"); if (s) s.textContent = e.data.__irisTheme; } });
  document.addEventListener("click", (e) => {
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (a) { e.preventDefault(); const h = a.getAttribute("href"); if (/^https:/.test(h)) post("action", { kind: "openUrl", args: [h] }); }
  });
})();
</script>`;

/** Our head always comes first, so the no-network policy applies before anything the agent wrote. */
export function head(theme: string, storage: Record<string, string>, kind: AppKind, css: string): string {
  return `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style id="iris-theme">${theme}</style><style>${css}</style>${BRIDGE(storage, kind)}`;
}

export function buildHtmlDoc(source: string, theme: string, storage: Record<string, string>): string {
  const css = "html,body{margin:0;background:transparent;color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);font-size:14px}";
  // The parser folds the page's later <html> and <head> tags into this document.
  return `<!doctype html><html><head>${head(theme, storage, "html", css)}</head>${source.replace(/^\s*<!doctype[^>]*>/i, "")}`;
}

/** The runtime is checked at build time to hold no </script or <!--; the app travels as a JSON string. */
export function buildReactDoc(runtime: string, code: string, theme: string, storage: Record<string, string>, css: string): string {
  return `<!doctype html><html><head>${head(theme, storage, "react", css)}</head><body><div id="root"></div><script>${runtime}</script><script>__irisRun(${scriptJson(code)})</script></body></html>`;
}

