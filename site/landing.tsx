// The playground's front page: what Iris is, the real renderer to try, the moments
// it is made for, and how to install it. Every card on it is live.
import { useState } from "react";
import { BB_SOURCES } from "../core/bb-data";
import { CATALOG, GROUPS } from "../core/catalog";
import { IrisBlock } from "../ui/block";
import { IrisMark } from "../ui/brand";
import { Glyph } from "../ui/views/kit";
import { CodeView } from "./editor";
import { INSTALL, REPO, copyInstall, playLink } from "./share";
import { THEMES, type ThemeName } from "./themes";

export const ESTIMATE = `<state seats={10} plan="Pro" />
<let price={(plan == "Pro" ? 29 : 12) * seats} />
<Card title="Estimate" icon="calculator">
  <Row>
    <Segmented bind="plan" options={["Basic", "Pro"]} />
    <Slider bind="seats" min={1} max={50} label="Seats" />
  </Row>
  <Row>
    <Metric label="Per month" value={price} format="usd" />
    <Metric label="Per year" value={price * 12 * 0.85}
            format="usd" note="15% off yearly" />
  </Row>
</Card>`;

const LIVE = `<let u={load("bb:usage")} />
<let m={load("bb:machines")} />
<let p={load("bb:plugins")} />
<Card title="Your bb, live" icon="activity" state="live" status="Live">
  <Row>
    <Metric label="Machines online" value={m.filter((x) => x.status == "connected").length} unit={"of " + m.length} />
    <Metric label="Plugins healthy" value={p.filter((x) => x.status == "running").length} unit={"of " + p.length} />
  </Row>
  {u.map((w) => <Progress label={w.label} value={w.usedPercent} />)}
</Card>`;

const THEMED = `<Card title="Release 2.4" icon="rocket" status="On track" tone="good">
  <Row>
    <Metric label="Crash-free" value={99.6} unit="%" delta={0.4} />
    <Metric label="p95 launch" value={812} unit="ms" delta={-64} better="down" />
    <Metric label="Open bugs" value={7} delta={3} better="down" />
  </Row>
  <Chart type="bar" height={150} x="day" y={["passed", "failed"]} stacked data={[
    {day: "Mon", passed: 41, failed: 2}, {day: "Tue", passed: 44, failed: 1},
    {day: "Wed", passed: 39, failed: 4}, {day: "Thu", passed: 47, failed: 0},
    {day: "Fri", passed: 45, failed: 1}]} />
  <Row justify="start" gap="sm">
    <Badge tone="good">Tests pass</Badge>
    <Badge tone="warn">2 flaky</Badge>
    <Badge tone="bad">1 blocker</Badge>
    <Badge tone="info">Beta</Badge>
  </Row>
</Card>`;

const MOMENTS: { label: string; icon: string; name: string; line: string }[] = [
  { label: "Proof it's done", icon: "badge-check", name: "Acceptance", line: "Each criterion with its status and the evidence behind it. Only all passed reads as done." },
  { label: "A decision", icon: "scale", name: "Decision", line: "Options scored against criteria. Drag a weight and the ranking moves." },
  { label: "Data to read", icon: "chart-line", name: "Chart", line: "Hover for readouts, flip to a table, with annotations where things changed." },
  { label: "A test run", icon: "flask-conical", name: "Tests", line: "Failures first, with their messages and a link to the line." },
  { label: "When it lands", icon: "calendar-clock", name: "Forecast", line: "An ETA with a band from recent pace, scope changes and a deadline judged." },
  { label: "A plan", icon: "list-checks", name: "Plan", line: "Steps with files, risk and estimates, approved or changed in one click." },
  { label: "Spend and limits", icon: "gauge", name: "Budget", line: "Every line against its cap, with the burn rate and when it runs out." },
];

const BB_SOURCE_NAMES = BB_SOURCES.map((s) => `bb:${s.name}`);

const byName = (n: string) => CATALOG.find((c) => c.name === n);

function InstallLine() {
  return (
    <button type="button" className="site-install" onClick={() => void copyInstall()} aria-label="Copy the install command">
      <span className="site-install-prompt" aria-hidden>
        $
      </span>
      <code>{INSTALL}</code>
      <span className="site-install-copy">
        <Glyph name="copy" size={14} />
        Copy
      </span>
    </button>
  );
}

function Live({ source }: { source: string }) {
  return <IrisBlock source={source} streaming={false} threadId={null} mode="gallery" stateKey={null} />;
}

function Moments() {
  const [at, setAt] = useState(0);
  const m = MOMENTS[at];
  const spec = byName(m.name);
  return (
    <div className="site-moments">
      <div className="site-moments-tabs" role="tablist" aria-label="Moments">
        {MOMENTS.map((x, k) => (
          <button key={x.name} type="button" role="tab" aria-selected={k === at} className="site-moment" onClick={() => setAt(k)}>
            <Glyph name={x.icon} size={16} />
            <span>{x.label}</span>
          </button>
        ))}
      </div>
      <div className="site-moments-stage" role="tabpanel">
        <div className="site-moments-caption">
          <p>
            <b>{m.name}</b> {m.line}
          </p>
          <div className="site-moments-links">
            <a href={`#/${m.name}`}>Props and code</a>
            {spec ? <a href={playLink(spec.example)}>Edit in the playground</a> : null}
          </div>
        </div>
        <div className="site-stage" data-iris-stage="" key={m.name}>
          {spec ? <Live source={spec.example} /> : null}
        </div>
      </div>
    </div>
  );
}

function SectionHead({ id, kicker, title, children }: { id: string; kicker: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="site-section-head">
      <p className="site-kicker">{kicker}</p>
      <h2 id={id}>{title}</h2>
      {children ? <p className="site-lead">{children}</p> : null}
    </header>
  );
}

/** The recorded demo: plays muted on a loop, or waits for a click when the visitor prefers less motion. */
function DemoVideo() {
  const calm = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  return (
    <video
      src="media/demo.mp4"
      poster="media/demo-poster.webp"
      width={768}
      height={744}
      autoPlay={!calm}
      controls={calm}
      muted
      loop
      playsInline
      preload="auto"
      aria-label="A bb thread where an agent answers with Iris cards: the person hovers a latency chart, drags a what-if slider, and tunes the weights of a decision until the ranking changes"
    />
  );
}

export function Landing({ theme, setTheme }: { theme: ThemeName; setTheme: (t: ThemeName) => void }) {
  const families = GROUPS.map((g) => ({ group: g, items: CATALOG.filter((c) => c.group === g) })).filter((f) => f.items.length);
  return (
    <div className="site-landing">
      <section className="site-hero" aria-labelledby="hero-title">
        <div className="site-wrap">
          <p className="site-pill">
            <IrisMark size={16} />A plugin for <a href="https://getbb.app">bb</a>
          </p>
          <h1 id="hero-title">
            Live, interactive UI
            <br />
            in your bb chat.
          </h1>
          <p className="site-hero-lead">Agents answer with charts, plans, test runs, decisions and small apps instead of walls of text. {CATALOG.length} components, drawn in your theme, live as you read.</p>
          <div className="site-cta">
            <a className="site-button site-button-primary" href="#/play">
              <Glyph name="play" size={15} />
              Open the playground
            </a>
            <a className="site-button" href="#/components">
              <Glyph name="layout-grid" size={15} />
              Browse {CATALOG.length} components
            </a>
          </div>
          <InstallLine />
        </div>
        <div className="site-wrap site-demo-wrap">
          <figure className="site-demo">
            <DemoVideo />
            <figcaption>A real bb thread: an agent answers with Iris cards, and the person explores them.</figcaption>
          </figure>
        </div>
      </section>

      <section className="site-section" aria-labelledby="try-title">
        <div className="site-wrap">
          <SectionHead id="try-title" kicker="How it works" title="A few lines of markup. A real card.">
            The agent writes JSX-style markup with live values in an <code>```iris</code> block, and bb draws it as the reply streams in. This is the real renderer: move the slider.
          </SectionHead>
          <div className="site-split">
            <div className="site-split-code">
              <div className="site-panel-bar">
                <span>```iris</span>
                <a href={playLink(ESTIMATE)}>
                  Edit
                  <Glyph name="arrow-right" size={13} />
                </a>
              </div>
              <CodeView source={ESTIMATE} />
            </div>
            <div className="site-split-card" data-iris-stage="">
              <Live source={ESTIMATE} />
            </div>
          </div>
          <ol className="site-steps">
            <li>
              <span className="site-step-n">1</span>
              <div>
                <b>The agent writes a block.</b> Short markup, with state, derived values and data loaded by reference from files.
              </div>
            </li>
            <li>
              <span className="site-step-n">2</span>
              <div>
                <b>iris_check proves it.</b> It reads the block's files, moves every input to its extremes and returns an outline of what you'll see.
              </div>
            </li>
            <li>
              <span className="site-step-n">3</span>
              <div>
                <b>bb draws it, live.</b> Tags render as they stream in, inputs recompute in place and live cards re-read their files every 2 seconds.
              </div>
            </li>
          </ol>
        </div>
      </section>

      <section className="site-section" aria-labelledby="moments-title">
        <div className="site-wrap">
          <SectionHead id="moments-title" kicker="Made for agent work" title="The right card for the moment.">
            Status reports, proof that work is done, decisions and plans come back as cards, with the answer in a sentence above them.
          </SectionHead>
          <Moments />
        </div>
      </section>

      <section className="site-section" aria-labelledby="theme-title">
        <div className="site-wrap site-two">
          <div>
            <SectionHead id="theme-title" kicker="Your theme" title="Every card wears your theme.">
              Colors come only from your bb theme: the accent is its primary, tones use its success, warning and danger colors, and nothing carries a palette of its own. Pick one and the whole page follows.
            </SectionHead>
            <div className="site-themes" role="radiogroup" aria-label="Theme">
              {(Object.keys(THEMES) as ThemeName[]).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={t === theme} className="site-theme" onClick={() => setTheme(t)}>
                  <span className="site-swatch" style={{ background: THEMES[t].swatch[0] }}>
                    <span style={{ background: THEMES[t].swatch[1] }} />
                  </span>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div data-iris-stage="">
            <Live source={THEMED} />
          </div>
        </div>
      </section>

      <section className="site-section" aria-labelledby="live-title">
        <div className="site-wrap site-two site-two-flip">
          <div data-iris-stage="">
            <Live source={LIVE} />
          </div>
          <div>
            <SectionHead id="live-title" kicker="Live data" title="Cards that read bb itself.">
              <code>load("bb:...")</code> reads bb's own live data, scoped to the card's thread. Inside a live card it re-reads every 2 seconds. The live project cards, Changes, Commits, PullRequest, Threads and Environments, update the moment bb reports a change. Any plugin can feed cards too, through a public data contract.
            </SectionHead>
            <ul className="site-chips" aria-label="bb data sources">
              {BB_SOURCE_NAMES.map((s) => (
                <li key={s}>
                  <code>{s}</code>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="site-section" aria-labelledby="keep-title">
        <div className="site-wrap">
          <SectionHead id="keep-title" kicker="Beyond the reply" title="Keep a card, ask for one, take it anywhere." />
          <ul className="site-facts site-facts-3">
            <li>
              <Glyph name="pin" size={18} />
              <b>Pin it beside the chat.</b> A pinned card stays live next to the conversation while the thread scrolls on: a build, a pull request, context use.
            </li>
            <li>
              <Glyph name="message-square-plus" size={18} />
              <b>Ask for a card.</b> One click on any message asks the agent to show that answer as a card.
            </li>
            <li>
              <Glyph name="list-checks" size={18} />
              <b>Answer in a picker.</b> When an agent needs your call, it opens a picker that waits for you: a ranked checklist, design variants in a live preview, a color with its contrast, marks on a screenshot, comments on a spec, or a list to put in order.
            </li>
            <li>
              <Glyph name="external-link" size={18} />
              <b>Open it in the browser.</b> Any card opens in this playground. Its source travels in the link and never reaches a server.
            </li>
            <li>
              <Glyph name="smartphone" size={18} />
              <b>At home on your phone.</b> Cards stack to fit a narrow screen, and a drag on a divider, map or board stays in the card instead of swiping the thread away.
            </li>
            <li>
              <Glyph name="feather" size={18} />
              <b>Light on context.</b> About 3,500 tokens per session: the rules and an index of every component. Details load only when an agent needs them.
            </li>
          </ul>
        </div>
      </section>

      <section className="site-section" aria-labelledby="trust-title">
        <div className="site-wrap">
          <SectionHead id="trust-title" kicker="Built to be trusted" title="Safe, checked and measured." />
          <ul className="site-facts">
            <li>
              <Glyph name="shield-check" size={18} />
              <b>No eval.</b> A sandboxed interpreter runs every expression under a step budget.
            </li>
            <li>
              <Glyph name="wifi-off" size={18} />
              <b>No network of their own.</b> Cards can't make requests, and apps run in a sandbox with a no-network policy. Maps and photos go through Iris's server, and you can turn that off.
            </li>
            <li>
              <Glyph name="send" size={18} />
              <b>You confirm every send.</b> When an app wants to send a message for you, Iris shows the exact text in a bar the app can't reach, and waits for your click. A picker page answers only right after your own click inside it.
            </li>
            <li>
              <Glyph name="scan-search" size={18} />
              <b>Checked and measured.</b> Agents verify each block with iris_check before you see it, and every release passes an eval suite of real chat moments.
            </li>
          </ul>
        </div>
      </section>

      <section className="site-section" aria-labelledby="families-title">
        <div className="site-wrap">
          <SectionHead id="families-title" kicker="The catalog" title={`${CATALOG.length} components in ${families.length} families.`}>
            Every one has a live example, its code and every prop.
          </SectionHead>
          <div className="site-families">
            {families.map((f) => (
              <section key={f.group} className="site-family">
                <h3>
                  {f.group}
                  <span>{f.items.length}</span>
                </h3>
                <p>
                  {f.items.map((c, k) => (
                    <span key={c.name}>
                      <a href={`#/${c.name}`}>{c.name}</a>
                      {k < f.items.length - 1 ? ", " : ""}
                    </span>
                  ))}
                </p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="site-section site-final" aria-labelledby="install-title">
        <div className="site-wrap">
          <IrisMark size={44} />
          <h2 id="install-title">Install Iris</h2>
          <p className="site-lead">On a Mac running bb. New agent sessions learn Iris on their own.</p>
          <InstallLine />
          <div className="site-cta">
            <a className="site-button site-button-primary" href="#/play">
              <Glyph name="play" size={15} />
              Try it first
            </a>
            <a className="site-button" href={REPO}>
              Read the docs on GitHub
            </a>
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="site-wrap">
          <span>
            Iris is open source under Apache-2.0. <a href={`${REPO}/releases/tag/v${__IRIS_VERSION__}`}>Version {__IRIS_VERSION__}</a>
          </span>
          <span>
            <a href={REPO}>GitHub</a> · <a href="https://getbb.app">bb</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
