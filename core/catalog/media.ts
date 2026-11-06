// Media and the design review kit: images in a grid, pins on an image, places
// on a map, a credited photo, and the pieces a design review needs beside
// Compare, Acceptance and Provenance (Evidence).
import { component, p } from "./spec";

// Example images are tiny inline SVGs, so the gallery and tests need no files.
const svg = (w: number, h: number, body: string) =>
  `data:image/svg+xml;utf8,${`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>${body}</svg>`.replace(/</g, "%3C").replace(/>/g, "%3E").replace(/#/g, "%23")}`;
const rect = (x: number, y: number, w: number, h: number, r: number, fill: string) => `<rect x='${x}' y='${y}' width='${w}' height='${h}' rx='${r}' fill='${fill}'/>`;
const scene = (sky: string, sun: string, near: string, far: string) =>
  svg(
    480,
    320,
    `<rect width='480' height='320' fill='${sky}'/><circle cx='340' cy='110' r='42' fill='${sun}'/><path d='M0 220 Q120 150 240 210 T480 190 V320 H0Z' fill='${far}'/><path d='M0 260 Q160 200 300 250 T480 240 V320 H0Z' fill='${near}'/>`,
  );
// A phone screen: a title, a search field, three rows and a button.
const phone = svg(
  390,
  844,
  rect(0, 0, 390, 844, 0, "rgb(246,246,249)") +
    rect(24, 96, 180, 26, 8, "rgb(30,30,38)") +
    rect(24, 146, 342, 44, 12, "rgb(228,228,236)") +
    [222, 318, 414].map((y) => rect(24, y, 342, 80, 16, "white") + rect(44, y + 22, 40, 36, 10, "rgb(118,132,240)") + rect(100, y + 26, 150, 12, 6, "rgb(60,60,70)") + rect(100, y + 46, 100, 10, 5, "rgb(170,170,182)")).join("") +
    rect(24, 742, 342, 52, 26, "rgb(72,96,226)"),
);
// A desktop page: a sidebar, a header and a grid of cards.
const desktop = svg(
  1280,
  800,
  rect(0, 0, 1280, 800, 0, "rgb(250,250,252)") +
    rect(0, 0, 240, 800, 0, "rgb(236,237,242)") +
    [60, 100, 140, 180].map((y) => rect(28, y, 150, 14, 7, "rgb(180,182,194)")).join("") +
    rect(280, 48, 320, 30, 10, "rgb(34,34,42)") +
    rect(1080, 44, 160, 40, 20, "rgb(72,96,226)") +
    [0, 1, 2].map((k) => rect(280 + k * 324, 120, 300, 180, 18, "white") + rect(304 + k * 324, 150, 120, 16, 8, "rgb(70,70,80)") + rect(304 + k * 324, 240, 200, 36, 8, "rgb(222,226,246)")).join("") +
    rect(280, 330, 948, 400, 18, "white") +
    [380, 440, 500, 560, 620].map((y) => rect(312, y, 880, 18, 9, "rgb(232,232,238)")).join(""),
);
const plan = svg(
  480,
  300,
  rect(0, 0, 480, 300, 0, "rgb(244,241,234)") +
    `<g fill='none' stroke='rgb(90,84,74)' stroke-width='6'><rect x='20' y='20' width='440' height='260'/><path d='M200 20 V170 M200 220 V280 M200 150 H330 M380 150 H460'/></g>` +
    rect(60, 200, 90, 50, 8, "rgb(196,176,150)") +
    rect(250, 60, 150, 60, 30, "rgb(176,196,206)") +
    rect(330, 190, 100, 70, 6, "rgb(210,200,184)"),
);

export const MEDIA = [
  component({
    name: "Gallery",
    group: "Media",
    summary: "Images in a grid; a click opens a lightbox with arrows, Esc to close and the caption. For screenshots from a run, mood boards, results side by side.",
    props: {
      images: p.list(
        "Each a workspace or thread storage path, an https URL or a data: image; or {src, caption?, alt?}. At most 60",
        "(string | {src, caption?, alt?})[]",
        { required: true },
      ),
      columns: p.num("Fixed column count; default fits as many as the width allows"),
      aspect: p.oneOf(["square", "landscape", "portrait", "natural"], "Thumbnail shape; images are shown whole inside it; natural keeps each image's own", { def: "landscape" }),
      title: p.str("Caption above the grid"),
    },
    children: "none",
    example: `<Gallery images={[
  { src: "${scene("rgb(255,214,170)", "rgb(255,248,220)", "rgb(120,80,90)", "rgb(200,120,110)")}", caption: "Dusk" },
  { src: "${scene("rgb(170,214,255)", "rgb(255,255,240)", "rgb(60,120,90)", "rgb(120,170,140)")}", caption: "Noon" },
  { src: "${scene("rgb(40,44,90)", "rgb(230,230,250)", "rgb(20,24,50)", "rgb(60,64,120)")}", caption: "Night" },
]} />`,
    aliases: ["Images", "Photos", "Lightbox", "Carousel"],
  }),
  component({
    name: "Screens",
    group: "Media",
    summary:
      "Screenshots as a matrix: one row per screen, one column per device, theme or locale, each tile with its label and an optional status; a click opens a lightbox. A screen missing a column shows as Missing. For proving a UI on every platform and theme.",
    props: {
      shots: p.list(
        "Each {screen, column, src, caption?, status?}; src is a workspace or thread storage path, an https URL or a data: image; status passed|failed|changed or any word. At most 120",
        "{screen, column, src, caption?, status?}[]",
        { required: true },
      ),
      columns: p.list("Column order, e.g. [\"iPhone\", \"iPad\", \"Mac\"]; default as first seen", "string[]"),
      title: p.str("Caption above the matrix"),
    },
    children: "none",
    example: `<Screens title="Settings, build 212" columns={["iPhone", "iPad", "Mac"]} shots={[
  { screen: "Settings", column: "iPhone", src: "${phone}", status: "passed" },
  { screen: "Settings", column: "iPad", src: "${desktop}", status: "passed" },
  { screen: "Settings", column: "Mac", src: "${desktop}", status: "changed" },
  { screen: "Account", column: "iPhone", src: "${phone}" },
  { screen: "Account", column: "Mac", src: "${desktop}" },
]} />`,
    aliases: ["ScreenMatrix", "ScreenshotMatrix", "DeviceMatrix"],
  }),
  component({
    name: "Hotspots",
    group: "Media",
    summary: "Numbered pins on an image; each opens its title and text. For a floor plan, a product shot, parts of a diagram. A list of the pins sits below for reading in order.",
    props: {
      src: p.str("The image: a workspace or thread storage path, an https URL or a data: image", { required: true }),
      spots: p.list("x and y in percent of the image from the top left (0-100)", "{x, y, title, text?, tone?}[]", { required: true }),
      alt: p.str("What the image shows"),
      caption: p.str("Line under the image"),
      list: p.bool("Show the numbered list below", { def: true }),
    },
    children: "none",
    example: `<Hotspots src="${plan}" alt="Studio floor plan" spots={[
  { x: 22, y: 75, title: "Desk", text: "Faces the window; power along the wall." },
  { x: 68, y: 30, title: "Meeting table", text: "Seats six. The screen is on the north wall." },
  { x: 79, y: 75, title: "Kitchen", tone: "info" },
]} />`,
    aliases: ["Pins", "ImagePins", "Hotspot"],
  }),
  component({
    name: "Map",
    group: "Media",
    summary:
      "Places on an OpenStreetMap map with a numbered list beside it, fit to show them all; route joins them in order with distances. Names are looked up (Photon); lat and lng skip the lookup. Iris's server fetches tiles and lookups; with web lookups off it shows the list alone.",
    props: {
      places: p.list("A name to look up, [lat, lng], or an object. query overrides what is looked up; lat and lng win over both. At most 25", "(string | [lat, lng] | {name, lat?, lng?, query?, note?, tone?})[]", { required: true }),
      route: p.bool("Join the places in order with a line, and show each leg's distance", { def: false }),
      zoom: p.num("Whole zoom 1-18; default fits every place"),
      height: p.num("Map height in pixels", { def: 320 }),
      list: p.bool("Show the list of places beside the map", { def: true }),
      title: p.str("Caption above the map"),
    },
    children: "none",
    example: `<Map route places={[
  { name: "Ferry Building", lat: 37.7955, lng: -122.3937, note: "Coffee and the farmers market" },
  { name: "Coit Tower", query: "Coit Tower, San Francisco" },
  { name: "Palace of Fine Arts", lat: 37.8029, lng: -122.4484 },
]} />`,
    aliases: ["Places", "Locations", "Route", "Itinerary", "MapView"],
  }),
  component({
    name: "PhotoSearch",
    group: "Media",
    summary:
      "A real photo for a description, from Wikimedia Commons only, with its author and license credited under it. Iris's server searches and caches it; nothing shows when web lookups are off. For what a place, plant, landmark or object looks like.",
    props: {
      query: p.str("What the photo should show, in a few words, e.g. \"Plitvice lakes waterfall\"", { required: true }),
      caption: p.str("Line under the photo; default the file's own title"),
      width: p.num("Max width in pixels", { def: 640 }),
      aspect: p.oneOf(["natural", "landscape", "square"], "Crop", { def: "natural" }),
    },
    children: "none",
    example: `<PhotoSearch query="Golden Gate Bridge from Marin Headlands" />`,
    aliases: ["Photo", "StockPhoto", "CommonsPhoto"],
  }),
];

export const DESIGN = [
  component({
    name: "DeviceFrame",
    group: "Design",
    summary: "A screenshot inside a phone, tablet, Mac window or browser frame, drawn plainly with no brand artwork. For showing a build the way people will see it.",
    props: {
      src: p.str("The screenshot: a workspace or thread storage path, an https URL or a data: image", { required: true }),
      device: p.oneOf(["iphone", "ipad", "mac", "browser"], "Which frame", { def: "iphone" }),
      landscape: p.bool("Turn a phone or tablet sideways", { def: false }),
      url: p.str("browser: the address shown in the bar"),
      title: p.str("mac: the window title"),
      width: p.num("Frame width in pixels; default suits the device"),
      fit: p.oneOf(["cover", "contain"], "How the screenshot fills the screen; cover crops from the top", { def: "cover" }),
      caption: p.str("Line under the frame"),
      alt: p.str("What the screenshot shows"),
    },
    children: "none",
    example: `<Row>
  <DeviceFrame device="iphone" src="${phone}" caption="Build 212" />
  <DeviceFrame device="browser" url="studio.example.com/dashboard" src="${desktop}" caption="Web" />
</Row>`,
    aliases: ["Mockup", "DeviceMockup", "PhoneFrame", "Frame"],
  }),
  component({
    name: "Swatches",
    group: "Design",
    summary:
      "Colors with names and their WCAG contrast ratio against each background you choose, marked pass or fail for AA and AAA, normal and large text. Hex, rgb() and hsl() are computed exactly; theme tokens (var(--primary)) are read from the theme.",
    props: {
      colors: p.list("Each a color string or {name?, value, note?}", "(string | {name?, value, note?})[]", { required: true }),
      backgrounds: p.list("What the colors are tested on; default white and black", "(string | {name, value})[]"),
      level: p.oneOf(["AA", "AAA"], "Which bar a pass means", { def: "AA" }),
      sample: p.str("Text drawn in each color on each background", { def: "Aa" }),
      title: p.str("Caption above the swatches"),
    },
    children: "none",
    example: `<Swatches backgrounds={[{ name: "Light", value: "#FFFFFF" }, { name: "Dark", value: "#16161D" }]} colors={[
  { name: "Brand", value: "#4860E2", note: "Buttons, links" },
  { name: "Success", value: "#1F9D55" },
  { name: "Warning", value: "#E8A317" },
  { name: "Muted text", value: "#8A8A99" },
]} />`,
    aliases: ["Palette", "Colors", "ColorPalette", "Contrast"],
  }),
  component({
    name: "TypeSpecimen",
    group: "Design",
    summary: "A font rendered at each size and weight with sample text, for checking a type scale. Uses fonts installed where the card is viewed and says when one is missing.",
    props: {
      font: p.str("A CSS font-family list, e.g. \"Inter, system-ui\"", { required: true }),
      sizes: p.list("Sizes in px, or {size, label} for named steps", "(number | {size, label?})[]"),
      weights: p.list("Weights as numbers or words (regular, semibold, bold)", "(number | string)[]"),
      sample: p.str("The text drawn at each size", { def: "The quick brown fox jumps over the lazy dog" }),
      lineHeight: p.num("Line height as a multiple of the size", { def: 1.3 }),
      italic: p.bool("Draw in italic", { def: false }),
      title: p.str("Caption; default the font's name"),
    },
    children: "none",
    example: `<TypeSpecimen font="system-ui" weights={["regular", "semibold", "bold"]} sizes={[{ size: 34, label: "Large Title" }, { size: 22, label: "Title 2" }, { size: 17, label: "Body" }, { size: 13, label: "Footnote" }]} />`,
    aliases: ["Typography", "FontSpecimen", "TypeScale", "Fonts"],
  }),
  component({
    name: "MarkUp",
    group: "Design",
    summary:
      "The person marks up an image: boxes, arrows and pins, each numbered with a note. The state is the list of marks [{n, kind, x, y, w?, h?, x2?, y2?, note}] in the image's own pixels. For \"show me what's wrong\" in an iris_ask picker; Annotate is for your own notes.",
    props: {
      bind: p.bind("State holding the marks list; start it as []"),
      src: p.str("The image: a workspace or thread storage path, an https URL or a data: image", { required: true }),
      label: p.str("What to mark, shown above the image"),
      alt: p.str("Alt text for the image"),
    },
    children: "none",
    example: `<state marks={[]} />
<MarkUp bind="marks" label="Box what looks off" src="${phone}" />
<Submit label="Send marks" />`,
    aliases: ["MarkUpImage", "DrawOnImage", "ImageFeedback"],
  }),
  component({
    name: "Annotate",
    group: "Design",
    summary:
      "A screenshot with numbered callouts: boxes drawn over regions, or pins, given in percent. The numbered notes sit below; hovering one lights its region. For design review feedback on a real build.",
    props: {
      src: p.str("The screenshot: a workspace or thread storage path, an https URL or a data: image", { required: true }),
      notes: p.list("x, y, w and h in percent of the image from the top left (0-100); without w and h it is a pin", "{x, y, w?, h?, label, text?, tone?}[]", { required: true }),
      alt: p.str("What the screenshot shows"),
      caption: p.str("Line under the image"),
      width: p.num("Max width in pixels"),
    },
    children: "none",
    example: `<Annotate src="${phone}" width={300} notes={[
  { x: 5, y: 10.5, w: 50, h: 5, label: "Title is too heavy", text: "Use Semibold, not Black.", tone: "warn" },
  { x: 5, y: 17, w: 90, h: 6, label: "Search field", text: "Add a placeholder.", tone: "info" },
  { x: 5, y: 87, w: 90, h: 7.5, label: "Primary button", text: "Contrast passes AA.", tone: "good" },
]} />`,
    aliases: ["Annotated", "Callouts", "Markup", "AnnotatedScreenshot"],
  }),
];
