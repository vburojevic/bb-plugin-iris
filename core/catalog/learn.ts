// Learning, play and 3D: practice (Quiz, Flashcards), guided reading
// (Walkthrough), time (Timer), and graphics (Scene in three.js, Shader in WebGL2).
import { COLOR_NAMES } from "../graphics";
import { component, p } from "./spec";

export const LEARNING = [
  component({
    name: "Quiz",
    group: "Learning",
    summary: "Questions one at a time with options; each answer shows right or wrong and why. Ends with the score, the missed questions and a retry. Keys 1-9 pick, Enter goes on.",
    props: {
      questions: p.list("answer is the 0-based index of the right option; why explains it (markdown)", "{q, options: string[], answer: number, why?}[]", { required: true }),
      title: p.str("Caption above the question"),
      shuffle: p.bool("Ask in a random order", { def: false }),
      reveal: p.oneOf(["each", "end"], "Show right or wrong after each answer, or only in the summary", { def: "each" }),
      onFinish: p.on("Runs when the last question is answered, with (right, total)"),
    },
    children: "none",
    example: `<Card title="Swift concurrency">
<Quiz questions={[
  { q: "Where does a @MainActor function run?", options: ["Any thread", "The main thread", "A background queue"], answer: 1, why: "**@MainActor** isolates it to the main actor." },
  { q: "What does await mark?", options: ["A possible suspension point", "A new thread", "A lock"], answer: 0 },
]} />
</Card>`,
    aliases: ["Quizz", "MultipleChoice", "Questions"],
  }),
  component({
    name: "Flashcards",
    group: "Learning",
    summary: "A deck to practice: click or Space flips a card, then sort it into Know it or Still learning (keys K and L, or the arrows). Shuffle any time; review the learning pile when the deck is done.",
    props: {
      cards: p.list("Front and back are markdown; [front, back] pairs work too", "{front, back, hint?}[]", { required: true }),
      title: p.str("Deck name"),
      shuffle: p.bool("Start shuffled", { def: false }),
    },
    children: "none",
    example: `<Card title="HTTP status codes">
<Flashcards cards={[
  { front: "**401**", back: "Unauthorized: no valid credentials" },
  { front: "**403**", back: "Forbidden: known, but not allowed", hint: "You are signed in" },
  { front: "**429**", back: "Too Many Requests: slow down" },
]} />
</Card>`,
    aliases: ["Flashcard", "Deck", "StudyCards"],
  }),
  component({
    name: "Walkthrough",
    group: "Learning",
    summary: "A guided explanation one step at a time: a title, markdown and optional code with highlighted lines. Arrow keys, the dots or Back and Next move between steps.",
    props: {
      steps: p.list("body is markdown; code shows below it with lang and lines highlighted (\"3-5\" or 4); file captions the code", "{title, body?, code?, lang?, lines?, file?}[]", { required: true }),
      title: p.str("Caption above the steps"),
      start: p.num("First step shown (1-based)", { def: 1 }),
    },
    children: "none",
    example: `<Card title="How a request is retried">
<Walkthrough steps={[
  { title: "Make the call", body: "The client sends the request once.", code: "const res = await fetch(url);", lang: "ts" },
  { title: "Back off", body: "On a **429** it waits, doubling each time.", code: "for (let i = 0; i < 4; i++) {\\n  if (res.status !== 429) break;\\n  await sleep(2 ** i * 250);\\n}", lang: "ts", lines: "3" },
  { title: "Give up", body: "After four tries the error goes to the caller." },
]} />
</Card>`,
    aliases: ["Tour", "StepThrough", "Explainer"],
  }),
  component({
    name: "Timer",
    group: "Learning",
    summary: "A countdown (give seconds) or a stopwatch with laps. Start, pause, lap and reset; it keeps time across scrolling and reloads.",
    props: {
      seconds: p.any("Countdown length: 90, \"5m\", \"1:30\" or \"1h 20m\"; leave out for a stopwatch"),
      mode: p.oneOf(["countdown", "stopwatch"], "Default countdown when seconds is given"),
      label: p.str("What it times"),
      autostart: p.bool("Start as soon as it appears", { def: false }),
    },
    children: "none",
    example: `<Card title="Timers">
<Row>
  <Timer seconds="5m" label="Focus" />
  <Timer mode="stopwatch" label="Laps" />
</Row>
</Card>`,
    aliases: ["Countdown", "Stopwatch", "Clock"],
  }),
];

export const GRAPHICS = [
  component({
    name: "Scene",
    group: "Graphics",
    summary:
      "A 3D scene in three.js the person can orbit (drag), zoom (scroll or pinch) and click. Objects are declared; animate moves them per frame. Pauses off screen; loads on demand.",
    props: {
      objects: p.list(
        `type: box|sphere|cylinder|torus|plane|text|gltf. at [x,y,z] (y is up), rotation in degrees, scale a number or [x,y,z]. size: box [w,h,d], sphere [r], cylinder [r,h], torus [r,tube], plane [w,d], text [height]. color: ${COLOR_NAMES}. gltf: src is a workspace .glb or .gltf`,
        "{id?, type, at?, rotation?, scale?, size?, color?, opacity?, wireframe?, text?, src?, label?}[]",
        { required: true },
      ),
      animate: p.any("A function of t (seconds) returning changes by object id, e.g. (t) => ({ cube: { rotation: [0, t * 60, 0] } }); at, rotation, scale, color, opacity"),
      camera: p.obj("Where the camera sits and looks; default frames every object", "{at?: [x,y,z], look?: [x,y,z], fov?}"),
      orbit: p.bool("Drag to orbit, scroll to zoom", { def: true }),
      autoRotate: p.bool("Turn slowly around the scene", { def: false }),
      ground: p.bool("A faint grid under the objects", { def: false }),
      height: p.num("Height in px", { def: 320 }),
      title: p.str("Caption"),
      onPick: p.on("Runs with (id, label) when the person clicks an object, e.g. (id) => explain(id)"),
    },
    children: "none",
    example: `<Card title="Orbit">
<Scene ground animate={(t) => ({ moon: { at: [Math.cos(t) * 2, 0.6, Math.sin(t) * 2] }, ring: { rotation: [90, 0, t * 40] } })} objects={[
  { id: "planet", type: "sphere", size: 0.8, at: [0, 0.6, 0], color: "accent" },
  { id: "ring", type: "torus", size: [1.3, 0.04], at: [0, 0.6, 0], color: 3 },
  { id: "moon", type: "sphere", size: 0.18, color: "warn" },
  { type: "box", size: [0.5, 0.5, 0.5], at: [-2.2, 0.25, 1], rotation: [0, 30, 0], color: "good" },
  { type: "text", text: "Earth", at: [0, 1.75, 0] },
]} />
</Card>`,
    aliases: ["ThreeD", "Three", "Model", "Scene3D"],
    heavy: true,
    calls: { animate: [0] },
  }),
  component({
    name: "Shader",
    group: "Graphics",
    summary:
      "A Shadertoy-style fragment shader in WebGL2: write mainImage(out vec4 fragColor, in vec2 fragCoord) with iTime, iResolution, iMouse, iFrame, iTimeDelta, iDate, plus theme colors iPalette[0..3], iBackground, iForeground. Compile errors show inline with line numbers. Pauses off screen.",
    props: {
      height: p.num("Height in px", { def: 240 }),
      title: p.str("Caption"),
      speed: p.num("Time scale for iTime", { def: 1 }),
      paused: p.bool("Start paused on the first frame", { def: false }),
    },
    children: "raw",
    childrenDoc: "GLSL ES 3.00, verbatim: a mainImage function, or a full #version 300 es shader",
    example: `<Card title="Theme waves">
<Shader>
void mainImage(out vec4 fragColor, in vec2 fragCoord) {
  vec2 uv = fragCoord / iResolution.xy;
  float w = sin(uv.x * 9.0 + iTime) * 0.08 + sin(uv.x * 23.0 - iTime * 1.7) * 0.03;
  float band = smoothstep(0.012, 0.0, abs(uv.y - 0.5 - w));
  vec3 col = mix(iBackground, mix(iPalette[0], iPalette[1], uv.x), 0.18 + 0.2 * uv.y);
  fragColor = vec4(mix(col, iPalette[2], band), 1.0);
}
</Shader>
</Card>`,
    aliases: ["Glsl", "FragmentShader", "ShaderToy"],
  }),
];
