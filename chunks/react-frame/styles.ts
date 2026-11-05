// The kit's stylesheet inside the frame. It mirrors the house look of the
// native cards (ui/views/layout.tsx and app.css) with plain CSS, because the
// host's Tailwind build doesn't reach into the frame. Colors come only from
// the theme variables the parent passes in.
export const KIT_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;background:transparent;color:var(--foreground);font-family:var(--font-sans,system-ui,sans-serif);font-size:13.5px;line-height:1.5;-webkit-font-smoothing:antialiased}
#root{display:flow-root;padding:2px 2px 6px}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid color-mix(in oklab,var(--iris-accent) 55%,transparent);outline-offset:1px}
.ir-card{position:relative;margin:4px 0;min-width:0;border-radius:14px;background:var(--card);color:var(--foreground);padding:14px 16px 12px;box-shadow:0 0 0 1px var(--border),0 10px 28px -22px rgb(0 0 0/.45)}
.ir-edge{position:absolute;left:18px;right:18px;top:-1px;height:1.5px;border-radius:2px;background:var(--iris-accent);opacity:0;transition:opacity .4s ease;pointer-events:none}
.ir-card[data-live] > .ir-edge{opacity:1;animation:ir-breathe 2.8s ease-in-out infinite}
@keyframes ir-breathe{0%,100%{opacity:1}50%{opacity:.45}}
.ir-head{display:flex;min-width:0;align-items:center;gap:10px}
.ir-glyph{display:grid;place-items:center;width:30px;height:30px;flex-shrink:0;border-radius:999px;padding:1.5px;background:var(--border)}
.ir-card[data-live] .ir-glyph{background:var(--iris-accent)}
.ir-glyph > span{display:grid;place-items:center;width:100%;height:100%;border-radius:999px;background:var(--card)}
.ir-titles{min-width:0;flex:1}
.ir-title{margin:0;font-size:14px;font-weight:600;line-height:1.375;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ir-subtitle{margin:0;font-size:12.5px;line-height:1.375;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ir-status{display:inline-flex;flex-shrink:0;align-items:center;gap:6px;white-space:nowrap;font-size:12px;color:var(--muted-foreground)}
.ir-status i{width:6px;height:6px;border-radius:999px;background:var(--iris-neutral)}
.ir-card[data-live] .ir-status i{background:var(--iris-good);animation:ir-pulse 1.8s ease-in-out infinite}
.ir-body{display:flex;min-width:0;flex-direction:column;gap:12px}
.ir-head + .ir-body{padding-top:12px}
.ir-foot{margin-top:12px;display:flex;min-width:0;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;font-size:12px;color:var(--muted-foreground)}
.ir-row{display:flex;min-width:0;flex-wrap:wrap}
.ir-stack{display:flex;min-width:0;flex-direction:column}
.ir-grid{display:grid;min-width:0}
.ir-text{margin:0;min-width:0}
.ir-text[data-size=sm]{font-size:12px}
.ir-text[data-size=lg]{font-size:16px;line-height:1.4}
.ir-text[data-size=xl]{font-size:22px;line-height:1.25;letter-spacing:-.02em}
.ir-text[data-muted]{color:var(--muted-foreground)}
.ir-text[data-bold]{font-weight:600}
.ir-text[data-mono]{font-family:var(--font-mono,ui-monospace,monospace);font-size:.92em}
.ir-badge{display:inline-flex;align-self:flex-start;height:20px;max-width:100%;align-items:center;gap:4px;border-radius:999px;padding:0 8px;font-size:11.5px;font-weight:500;line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:var(--muted);color:var(--muted-foreground)}
.ir-badge[data-variant=outline]{background:transparent;box-shadow:inset 0 0 0 1px var(--border)}
.ir-icon{display:inline-block;flex-shrink:0;vertical-align:-3px}
.ir-metric{min-width:0}
.ir-metric-label,.ir-metric-note{font-size:12px;color:var(--muted-foreground);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ir-metric-line{margin-top:2px;display:flex;min-width:0;align-items:baseline;gap:8px}
.ir-metric-value{font-size:26px;font-weight:600;line-height:1.25;letter-spacing:-.025em;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ir-metric-unit{margin-left:4px;font-size:13px;font-weight:400;letter-spacing:0;color:var(--muted-foreground)}
.ir-delta{display:inline-flex;flex-shrink:0;align-items:center;gap:2px;font-size:12.5px;font-weight:500;font-variant-numeric:tabular-nums}
.ir-callout{display:flex;min-width:0;gap:10px;border-radius:8px;padding:10px 12px;font-size:13.5px;line-height:1.6}
.ir-callout-title{font-weight:600}
.ir-progress-top{margin-bottom:4px;display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted-foreground);font-variant-numeric:tabular-nums}
.ir-track{height:8px;overflow:hidden;border-radius:999px;background:var(--muted)}
.ir-fill{height:100%;border-radius:999px;transition:width .26s cubic-bezier(.2,.8,.2,1)}
.ir-scroll-x{overflow-x:auto;scrollbar-width:none}
.ir-scroll-x::-webkit-scrollbar{display:none}
.ir-table{width:100%;border-collapse:collapse;font-size:13px;font-variant-numeric:tabular-nums}
.ir-table th{white-space:nowrap;border-bottom:1px solid var(--border);padding:0 8px 6px;font-size:12px;font-weight:500;color:var(--muted-foreground);text-align:left}
.ir-table td{border-bottom:1px solid color-mix(in oklab,var(--border) 60%,transparent);padding:6px 8px;vertical-align:middle}
.ir-table[data-dense] td{padding-top:4px;padding-bottom:4px}
.ir-table th:first-child,.ir-table td:first-child{padding-left:0}
.ir-table th:last-child,.ir-table td:last-child{padding-right:0}
.ir-table tr:last-child td{border-bottom:0}
.ir-table th button{display:inline-flex;align-items:center;gap:4px;border:0;padding:0;background:none;color:inherit;font:inherit;cursor:pointer}
.ir-table th button:hover,.ir-table th button[data-on]{color:var(--foreground)}
.ir-table tr[data-click]{cursor:pointer}
.ir-table tr[data-click]:hover td{background:color-mix(in oklab,var(--foreground) 4%,transparent)}
.ir-pager{margin-top:8px;display:flex;align-items:center;justify-content:flex-end;gap:4px;font-size:12px;color:var(--muted-foreground)}
.ir-empty{padding:16px 0;text-align:center;font-size:12px;color:var(--muted-foreground)}
.ir-chart{position:relative;min-width:0}
.ir-chart svg{display:block;width:100%;overflow:visible}
.ir-chart text{fill:var(--muted-foreground);font-size:11px;font-family:var(--font-sans,system-ui,sans-serif);font-variant-numeric:tabular-nums}
.ir-legend{margin-top:8px;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted-foreground)}
.ir-legend span{display:inline-flex;align-items:center;gap:6px}
.ir-legend i,.ir-tip i{width:8px;height:8px;border-radius:999px;display:inline-block}
.ir-tip{position:absolute;top:0;pointer-events:none;z-index:2;min-width:96px;border-radius:8px;background:var(--popover,var(--card));box-shadow:0 0 0 1px var(--border),0 8px 24px -12px rgb(0 0 0/.5);padding:6px 8px;font-size:12px;font-variant-numeric:tabular-nums}
.ir-tip div{display:flex;align-items:center;gap:6px;white-space:nowrap}
.ir-tip b{margin-left:auto;padding-left:12px;font-weight:600}
.ir-btn{display:inline-flex;width:fit-content;flex-shrink:0;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:0;border-radius:999px;font-size:13px;font-weight:500;cursor:pointer;background:transparent;box-shadow:inset 0 0 0 1px var(--border);transition:opacity .15s,background-color .15s}
.ir-btn:hover{background:color-mix(in oklab,var(--foreground) 7%,transparent)}
.ir-btn[data-size=sm]{height:28px;padding:0 12px;font-size:12.5px}
.ir-btn[data-variant=primary]{background:var(--foreground);color:var(--background);box-shadow:none}
.ir-btn[data-variant=destructive]{background:var(--destructive);color:var(--destructive-foreground,#fff);box-shadow:none}
.ir-btn[data-variant=primary]:hover,.ir-btn[data-variant=destructive]:hover{opacity:.9}
.ir-btn[data-variant=ghost]{box-shadow:none;color:var(--muted-foreground)}
.ir-btn[data-variant=ghost]:hover{color:var(--foreground)}
.ir-btn:disabled{pointer-events:none;opacity:.5}
.ir-field{display:flex;min-width:0;flex-direction:column;gap:6px}
.ir-row > .ir-field{flex:1 1 180px}
.ir-label{display:flex;align-items:baseline;justify-content:space-between;gap:12px;font-size:12.5px;color:var(--muted-foreground)}
.ir-label output{font-size:13px;font-weight:500;color:var(--foreground);font-variant-numeric:tabular-nums}
.ir-range{-webkit-appearance:none;appearance:none;width:100%;height:20px;margin:0;background:transparent;cursor:pointer}
.ir-range::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:linear-gradient(90deg,var(--iris-accent) var(--fill,50%),var(--muted) var(--fill,50%))}
.ir-range::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;margin-top:-6px;border-radius:50%;background:var(--card);box-shadow:0 0 0 1.5px var(--iris-accent),0 1px 3px rgb(0 0 0/.25)}
.ir-range::-moz-range-track{height:4px;border-radius:999px;background:var(--muted)}
.ir-range::-moz-range-progress{height:4px;border-radius:999px;background:var(--iris-accent)}
.ir-range::-moz-range-thumb{width:16px;height:16px;border:0;border-radius:50%;background:var(--card);box-shadow:0 0 0 1.5px var(--iris-accent),0 1px 3px rgb(0 0 0/.25)}
.ir-range:focus-visible{outline:none}
.ir-range:focus-visible::-webkit-slider-thumb{box-shadow:0 0 0 3px color-mix(in oklab,var(--iris-accent) 40%,transparent)}
.ir-toggle{display:flex;min-width:0;cursor:pointer;align-items:center;gap:12px}
.ir-toggle > span{min-width:0;flex:1}
.ir-toggle small{display:block;font-size:12px;color:var(--muted-foreground)}
.ir-switch{position:relative;width:36px;height:20px;flex-shrink:0;border:0;padding:0;border-radius:999px;background:var(--muted);box-shadow:inset 0 0 0 1px var(--border);cursor:pointer;transition:background-color .15s}
.ir-switch[aria-checked=true]{background:var(--foreground);box-shadow:none}
.ir-switch i{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:999px;background:var(--background);box-shadow:0 1px 2px rgb(0 0 0/.3);transition:left .15s}
.ir-switch[aria-checked=true] i{left:18px}
.ir-input,.ir-select{height:32px;width:100%;border:0;border-radius:8px;background:var(--card);padding:0 12px;font-size:13.5px;box-shadow:inset 0 0 0 1px var(--border);outline:none}
.ir-input:focus-visible,.ir-select:focus-visible{box-shadow:inset 0 0 0 1px color-mix(in oklab,var(--foreground) 40%,transparent)}
.ir-input::placeholder{color:var(--muted-foreground)}
.ir-select-wrap{position:relative}
.ir-select{appearance:none;-webkit-appearance:none;padding-right:32px}
.ir-select-wrap .ir-icon{position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--muted-foreground)}
.ir-seg{display:inline-flex;align-self:flex-start;max-width:100%;gap:2px;border-radius:999px;background:color-mix(in oklab,var(--muted) 70%,transparent);padding:2px}
.ir-seg button{display:inline-flex;height:28px;flex-shrink:0;align-items:center;gap:6px;border:0;border-radius:999px;background:transparent;padding:0 12px;font-size:13px;color:var(--muted-foreground);cursor:pointer;transition:color .15s}
.ir-seg button:hover{color:var(--foreground)}
.ir-seg button[aria-checked=true]{background:var(--card);color:var(--foreground);font-weight:500;box-shadow:0 0 0 1px var(--border)}
.ir-tablist{margin-bottom:12px;display:flex;gap:4px;border-bottom:1px solid var(--border)}
.ir-tablist button{margin-bottom:-1px;display:inline-flex;flex-shrink:0;align-items:center;gap:6px;border:0;border-bottom:2px solid transparent;background:none;padding:4px 10px 8px;font-size:13px;font-weight:500;color:var(--muted-foreground);cursor:pointer}
.ir-tablist button:hover{color:var(--foreground)}
.ir-tablist button[aria-selected=true]{border-bottom-color:var(--foreground);color:var(--foreground)}
.ir-tablist em{font-style:normal;border-radius:999px;background:var(--muted);padding:0 6px;font-size:11px;color:var(--muted-foreground)}
.ir-panel{display:flex;min-width:0;flex-direction:column;gap:12px}
.ir-stopped{display:flex;align-items:center;gap:8px;border-radius:12px;padding:12px 14px;font-size:12.5px;color:var(--muted-foreground);box-shadow:0 0 0 1px var(--border)}
@keyframes ir-flow{to{background-position:200% 0}}
@keyframes ir-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;
