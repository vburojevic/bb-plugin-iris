// Media players (VideoPlayer, AudioPlayer) and files and assets (FileTree,
// AssetGallery, PdfViewer, FontPreview). Every file streams from the thread's
// workspace or storage through a bb preview URL with byte ranges. Without a
// thread (the gallery) each one shows a bundled sample, marked as such.
import { component, p } from "./spec";

const SRC = "A workspace or thread storage path";

export const PLAYERS = [
  component({
    name: "VideoPlayer",
    group: "Media",
    summary:
      "A video that streams and seeks: chapters on the scrubber and in a list, notes that jump to their time, frame stepping (, and . keys), speed 0.25-2x. Space plays, arrows skip 5 s. Comment puts the current time in the composer.",
    props: {
      src: p.str(`${SRC} (mp4, webm, mov)`, { required: true }),
      chapters: p.list("at in seconds or \"1:23\"", "{at, title}[]"),
      notes: p.list("Timestamped review notes; a click jumps there", "{at, text, tone?}[]"),
      fps: p.num("Frame rate for frame stepping", { def: 30 }),
      speed: p.num("Starting speed", { def: 1 }),
      start: p.any("Starting time, seconds or \"1:23\""),
      loop: p.bool("Play again at the end", { def: false }),
      muted: p.bool("Start muted", { def: false }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<VideoPlayer src="$BB_THREAD_STORAGE/onboarding.mp4" fps={24} chapters={[
  { at: 0, title: "Welcome" }, { at: 4, title: "Sign in" }, { at: 8, title: "First run" },
]} notes={[
  { at: 2.5, text: "Logo fades in late" },
  { at: "0:06", text: "Keyboard covers the button", tone: "bad" },
]} />`,
    aliases: ["Video", "VideoPlayback", "Movie", "ScreenRecording"],
    heavy: true,
  }),
  component({
    name: "VideoCompare",
    group: "Media",
    summary:
      "Two videos on one timeline, reference first: one play and scrub control, side by side or wipe, frame steps (, and .), speed, and an offset that aligns them ([ and ] shift a frame). Notes mark the timeline.",
    props: {
      videos: p.list(`${SRC} or https URL`, "(string | {src, label?})[]", { required: true }),
      offset: p.num("Seconds: the second video shows t + offset when the first shows t", { def: 0 }),
      mode: p.oneOf(["side", "wipe"], "First layout", { def: "side" }),
      notes: p.list("at is the first video's time", "{at, text, tone?}[]"),
      fps: p.num("Frame rate for frame steps", { def: 30 }),
      speed: p.num("Starting speed", { def: 1 }),
      loop: p.bool("Play again at the end", { def: false }),
      muted: p.bool("Start muted; sound comes from the first video", { def: false }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<VideoCompare offset={0.4} videos={[
  { src: "$BB_THREAD_STORAGE/before.mp4", label: "main" },
  { src: "$BB_THREAD_STORAGE/after.mp4", label: "This branch" },
]} notes={[{ at: 1.5, text: "Sheet opens late", tone: "warn" }]} />`,
    aliases: ["VideoDiff", "SyncedVideos", "SideBySideVideo"],
    heavy: true,
  }),
  component({
    name: "AudioPlayer",
    group: "Media",
    summary:
      "Audio with a waveform drawn from the decoded file (click or drag to seek) and a transcript whose current line highlights and follows; a click on a line seeks there. Speed 0.5-2x; Space plays, arrows skip 5 s.",
    props: {
      src: p.str(`${SRC} (mp3, m4a, wav, ogg, flac)`, { required: true }),
      transcript: p.any("Lines {at, end?, text, speaker?}[], or WebVTT or SRT text, e.g. load(\"talk.vtt\", {raw: true})"),
      speed: p.num("Starting speed", { def: 1 }),
      start: p.any("Starting time, seconds or \"1:23\""),
      follow: p.bool("Scroll the transcript with playback", { def: true }),
      height: p.num("Transcript height in px", { def: 220 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<AudioPlayer src="$BB_THREAD_STORAGE/standup.m4a" title="Standup" transcript={[
  { at: 0, speaker: "Ana", text: "Sync shipped to TestFlight last night." },
  { at: 3.2, speaker: "Ben", text: "Two crash reports, both in the importer." },
  { at: 6.5, speaker: "Ana", text: "I'll take the importer today." },
]} />`,
    aliases: ["Audio", "Podcast", "VoiceMemo", "Waveform"],
    heavy: true,
  }),
];

export const FILES = [
  component({
    name: "FileTree",
    group: "Files",
    summary:
      "A real folder from the workspace or thread storage as a tree: file and folder sizes, git markers (A M D R U) from this checkout's changes, a filter and a Changed only toggle. Dependency and build folders are skipped; a click opens the file.",
    props: {
      path: p.str("Folder", { def: "." }),
      open: p.num("Levels open at first", { def: 1 }),
      changes: p.oneOf(["branch", "uncommitted", "none"], "Which git changes mark files", { def: "branch" }),
      changedOnly: p.bool("Start with only changed files", { def: false }),
      sort: p.oneOf(["name", "size"], "Order inside folders", { def: "name" }),
      filter: p.str("Starting filter text"),
      limit: p.num("Most files read, up to 2000", { def: 400 }),
      title: p.str("Caption"),
      onClick: p.on("(path) => ... instead of opening the file"),
    },
    children: "none",
    example: `<FileTree path="core" open={1} sort="size" />`,
    aliases: ["FolderTree", "Directory", "Files", "FolderView"],
    heavy: true,
  }),
  component({
    name: "AssetGallery",
    group: "Files",
    summary:
      "Every image, SVG and app icon under a folder, grouped by kind, each with its pixel size and file size on a checkerboard. App icon sets read their Contents.json labels. A click opens details; Open shows the file.",
    props: {
      path: p.str("Folder", { def: "." }),
      kinds: p.list("Which kinds to show", "(\"icon\" | \"image\" | \"svg\")[]"),
      size: p.num("Tile size in px", { def: 112 }),
      sort: p.oneOf(["name", "size"], "Order inside each kind", { def: "name" }),
      limit: p.num("Most assets shown", { def: 120 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<AssetGallery path="assets" />`,
    aliases: ["Assets", "AssetCatalog", "Icons", "ImageAssets"],
    heavy: true,
  }),
  component({
    name: "PdfViewer",
    group: "Files",
    summary: "A PDF rendered page by page with pdf.js (pages draw as they scroll in): page count and jump, zoom, fit width. Arrow keys or PageUp and PageDown move a page.",
    props: {
      src: p.str(`${SRC} (.pdf)`, { required: true }),
      page: p.num("Page shown first", { def: 1 }),
      pages: p.any("Only these pages: \"1-3, 5\" or [2, 4]"),
      zoom: p.num("Share of the width, 0.5-3", { def: 1 }),
      height: p.num("Viewer height in px", { def: 560 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<PdfViewer src="docs/spec.pdf" pages="1-3" height={480} />`,
    aliases: ["Pdf", "PDF", "PdfPreview", "Document"],
    heavy: true,
  }),
  component({
    name: "FontPreview",
    group: "Files",
    summary:
      "A font file (ttf, otf, woff, woff2) loaded as is: its names, format and metrics, editable sample text at any size, sliders for variable axes, and a grid of every glyph it maps; a click shows one large with its code point.",
    props: {
      src: p.str(`${SRC} (.ttf, .otf, .woff, .woff2)`, { required: true }),
      sample: p.str("Sample text", { def: "The quick brown fox jumps over the lazy dog" }),
      size: p.num("Sample size in px", { def: 44 }),
      glyphs: p.num("Glyphs shown before Show all; 0 hides the grid", { def: 240 }),
      title: p.str("Caption"),
    },
    children: "none",
    example: `<FontPreview src="assets/fonts/Inter.woff2" sample="Sphinx of black quartz, judge my vow" />`,
    aliases: ["Font", "FontFile", "GlyphGrid", "Glyphs"],
    heavy: true,
  }),
];
