// Records the Iris demo frame by frame from the isolated dev bb (never the person's own bb).
// Every frame is shot at a fixed real-time step while CSS animations run slowed to match, so each
// lossless frame is exactly one 60 fps step, however slow capture is.
//   PW=<playwright> BB_URL=<dev bb url> node scripts/record-demo.mjs <threadId> <framesDir>
// The thread holds three answers: a latency chart, a what-if slider and a weighted decision.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const pw = createRequire(import.meta.url)(process.env.PW ?? "playwright");
// A separate dev bb (its own --data-dir and port), never your everyday one.
const BASE = process.env.BB_URL ?? "http://127.0.0.1:48886";
const [thread, out] = process.argv.slice(2);
const W = 1200, H = 1000, DPR = 2, FPS = 60, STEP = 1000 / FPS;
// Each frame takes this much real time; CSS animations run at STEP/REAL speed, so every frame is
// exactly one 60 fps step of animation time however long the capture itself takes.
const REAL = 280;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await pw.chromium.launch({ args: ["--disable-smooth-scrolling", "--force-color-profile=srgb", "--hide-scrollbars"] });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, colorScheme: "dark" });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
const S = (m, p) => cdp.send(m, p);
await S("Animation.enable");

let recording = false;
let n = 0;
let clip = null;
const frames = [];
let next = 0;
async function frame() {
  if (!recording) {
    await sleep(STEP);
    return;
  }
  const now = Date.now();
  if (next > now) await sleep(next - now);
  next = Math.max(Date.now(), next) + REAL;
  const r = await S("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: DPR }, fromSurface: true, captureBeyondViewport: false });
  const file = `f${String(n++).padStart(5, "0")}.png`;
  writeFileSync(join(out, file), Buffer.from(r.data, "base64"));
  frames.push({ file, ms: STEP });
}
const idle = async (count) => {
  for (let i = 0; i < count; i++) await frame();
};
const evaluate = (expr) => page.evaluate(expr);

// Load the thread, giving real time for network and timers.
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await sleep(4000);
const skip = page.getByText("Skip setup");
if (await skip.count()) {
  await skip.first().click();
  await sleep(1500);
}
await page.goto(`${BASE}/threads/${thread}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".iris-card", { timeout: 120_000 });
await sleep(4000);
// A visible cursor: headless captures have none, so the page draws one that follows the mouse.
await evaluate(`(() => {
  const c = document.createElement("div");
  c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M5 2.5 L5 19.5 L9.3 15.4 L12.2 21.8 L15 20.6 L12.1 14.3 L18.2 14.3 Z" fill="#fff" stroke="#0b0d12" stroke-width="1.4" stroke-linejoin="round"/></svg>';
  c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(-200px,-200px);filter:drop-shadow(0 2px 3px rgb(0 0 0 / .45))";
  document.documentElement.appendChild(c);
  const style = document.createElement("style");
  style.textContent = 'button[aria-label="Scroll to latest event"]{display:none!important}';
  document.head.appendChild(style);
  let x = -200, y = -200, s = 1;
  const put = () => (c.style.transform = "translate(" + (x - 5) + "px," + (y - 3) + "px) scale(" + s + ")");
  addEventListener("mousemove", (e) => { x = e.clientX; y = e.clientY; put(); }, true);
  addEventListener("mousedown", () => { s = 0.86; put(); }, true);
  addEventListener("mouseup", () => { s = 1; put(); }, true);
  return true;
})()`);

let mx = W - 60, my = H / 2, buttons = 0;
const mouse = (_type, x, y) => page.mouse.move(x, y, { steps: 1 });
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
async function moveTo(x, y, seconds) {
  const steps = Math.max(1, Math.round(seconds * FPS));
  const [x0, y0] = [mx, my];
  for (let i = 1; i <= steps; i++) {
    const t = ease(i / steps);
    mx = x0 + (x - x0) * t;
    my = y0 + (y - y0) * t;
    await mouse("mouseMoved", mx, my);
    await frame();
  }
}
async function press() { buttons = 1; await page.mouse.down(); await frame(); }
async function release() { buttons = 0; await page.mouse.up(); await frame(); }
async function scrollBy(dy, seconds) {
  const steps = Math.max(1, Math.round(seconds * FPS));
  let done = 0;
  for (let i = 1; i <= steps; i++) {
    const target = Math.round(dy * ease(i / steps));
    const d = target - done;
    done = target;
    if (d) await page.mouse.wheel(0, d);
    await frame();
  }
}
const layout = () => evaluate(`(() => {
  const cards = [...document.querySelectorAll(".iris-card")].map((c) => {
    const r = c.getBoundingClientRect();
    const svg = [...c.querySelectorAll("svg")].sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)[0];
    const s = svg ? svg.getBoundingClientRect() : null;
    const ranges = [...c.querySelectorAll('input[type="range"]')].map((i) => { const q = i.getBoundingClientRect(); return { x: q.left, y: q.top + q.height / 2, w: q.width, min: +i.min, max: +i.max, v: +i.value, label: i.getAttribute("aria-label") || "" }; });
    return { title: (c.querySelector("header")?.innerText || "").split("\\n")[0], top: r.top, bottom: r.bottom, left: r.left, right: r.right, svg: s && { x: s.left, y: s.top, w: s.width, h: s.height }, ranges };
  });
  const comp = [...document.querySelectorAll("[contenteditable=true], textarea")].map((e) => e.getBoundingClientRect().top).filter((t) => t > 300).sort((a, b) => a - b)[0] ?? ${H - 160};
  return { cards, composerTop: comp };
})()`);
const thumbX = (r, v) => r.x + 8 + ((v - r.min) / (r.max - r.min)) * (r.w - 16);

// Start at the top of the thread.
await mouse("mouseMoved", 700, 500);
for (let i = 0; i < 30; i++) {
  await page.mouse.wheel(0, -4000);
  await sleep(40);
}
await sleep(1500);
let L = await layout();
const col = { left: Math.floor(L.cards[0].left - 28), right: Math.ceil(L.cards[0].right + 28), top: 64, bottom: Math.floor(L.composerTop - 10) };
writeFileSync(join(out, "crop.json"), JSON.stringify({ ...col, dpr: DPR }));
clip = { x: col.left, y: col.top, width: col.right - col.left, height: col.bottom - col.top };
// From here on, CSS animations and transitions run at STEP/REAL of real speed.
await S("Animation.setPlaybackRate", { playbackRate: STEP / REAL });
console.log("cards:", L.cards.map((c) => c.title).join(" | "), "crop", col);

recording = true;
mx = col.right - 30; my = 420;
await mouse("mouseMoved", mx, my);
await idle(50);
// 1. Hover the chart: a readout follows the cursor across the releases.
const chart = L.cards[0].svg;
await moveTo(chart.x + chart.w * 0.08, chart.y + chart.h * 0.55, 0.8);
await moveTo(chart.x + chart.w * 0.93, chart.y + chart.h * 0.5, 2.6);
await idle(30);
// 2. Scroll to the what-if card and drag its slider.
L = await layout();
const whatIf = L.cards.find((c) => c.ranges.length === 1) ?? L.cards[1];
await moveTo(col.right - 60, my, 0.3);
await scrollBy(whatIf.top - 110, 1.3);
await idle(20);
L = await layout();
const w2 = L.cards.find((c) => c.title === whatIf.title) ?? L.cards[1];
const r = w2.ranges[0];
await moveTo(thumbX(r, r.v), r.y, 0.7);
await press();
await moveTo(thumbX(r, r.max), r.y, 1.3);
await idle(18);
await moveTo(thumbX(r, r.min + (r.max - r.min) * 0.3), r.y, 1.0);
await release();
await idle(36);
// 3. Scroll to the decision and tune its weights: the ranking moves.
L = await layout();
const decision = L.cards.find((c) => c.ranges.length >= 3);
if (decision) {
  await moveTo(col.right - 60, my, 0.3);
  const last = decision.ranges[decision.ranges.length - 1];
  await scrollBy(last.y + 70 - (col.bottom - 20), 1.4);
  await idle(24);
  L = await layout();
  const d2 = L.cards.find((c) => c.ranges.length >= 3);
  // Raise reliability and throughput, then drop simple ops: the managed queue overtakes Postgres.
  const [first, second, , fourth] = d2.ranges;
  // Weights the card remembers from an earlier run may already be at the target: skip those drags.
  const drag = async (r, to, seconds) => {
    if (r.v === to) return;
    await moveTo(thumbX(r, r.v), r.y, 0.6);
    await press();
    await moveTo(thumbX(r, to), r.y, seconds);
    await release();
    r.v = to;
  };
  await drag(second, second.max, 0.7);
  await idle(10);
  if (fourth) {
    await drag(fourth, fourth.max, 1.0);
    await idle(14);
  }
  await drag(first, first.min, 1.1);
  await idle(100);
}
await moveTo(col.right + 40, my, 0.6);
await idle(70);

writeFileSync(join(out, "frames.json"), JSON.stringify(frames));
console.log(`${frames.length} unique frames, ${(frames.reduce((a, f) => a + f.ms, 0) / 1000).toFixed(1)} s`);
await browser.close();
