// Cuts one film from a cut file: node film/edit/build.mjs film/edit/<name>.json
//
// This ffmpeg has no text filters (no libass, no freetype), so every caption,
// name plate and end card is a still rendered by headless Chrome from
// overlay.html and laid over the picture for its time window.

import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.dirname(here);
const cache = path.join(here, ".stills");
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";
const W = 1920;
const H = 1080;
const FPS = 30;
const LIMIT = 59.5;
// Where a captured app window sits in the frame. Matches overlay.html.
const FRAME = { x: 128, y: 44, w: 1664, h: 936 };

const abs = (file) => (path.isAbsolute(file) ? file : path.join(film, file));

// One browser for every still. `--screenshot` starts a new Chrome per image
// and each one takes a minute to quit, so the page is driven over the
// DevTools socket instead.
const PORT = Number(process.env.BUILD_PORT || 9347);
let browser = null;

async function openBrowser() {
  const child = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-background-networking", "--allow-file-access-from-files",
    `--user-data-dir=${path.join(cache, `chrome-${PORT}`)}`, `--remote-debugging-port=${PORT}`, "about:blank",
  ], { stdio: "ignore" });
  let target = null;
  for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((reply) => reply.json()).catch(() => []);
    target = list.find((item) => item.type === "page") || null;
  }
  if (!target) { child.kill(); throw new Error("Chrome did not open its DevTools port."); }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const waiting = new Map();
  const listeners = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message.result ?? {}); waiting.delete(message.id); }
    if (message.method && listeners.has(message.method)) { listeners.get(message.method)(); listeners.delete(message.method); }
  };
  let next = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    next += 1;
    waiting.set(next, resolve);
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  const once = (method) => new Promise((resolve) => listeners.set(method, resolve));
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  return { send, once, close: () => { socket.close(); child.kill(); } };
}

async function still(params) {
  const query = new URLSearchParams(params).toString();
  const file = path.join(cache, `${createHash("sha1").update(query).digest("hex").slice(0, 16)}.png`);
  if (existsSync(file)) return file;
  browser ??= await openBrowser();
  const loaded = browser.once("Page.loadEventFired");
  await browser.send("Page.navigate", { url: `${pathToFileURL(path.join(here, "overlay.html")).href}?${query}` });
  await loaded;
  const shot = await browser.send("Page.captureScreenshot", { format: "png" });
  if (!shot.data) throw new Error(`Still was not rendered: ${query}`);
  await writeFile(file, Buffer.from(shot.data, "base64"));
  return file;
}

async function hasAudio(file) {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file]);
  return stdout.trim().length > 0;
}

const cut = JSON.parse(await readFile(path.resolve(process.argv[2]), "utf8"));
// `line: 7` on a clip or a voice line means: that scripted line, wherever
// lines.mjs found it in the take to camera.
const LINES = path.join(film, "raw", "lines.json");
const spoken = existsSync(LINES) ? JSON.parse(await readFile(LINES, "utf8")) : {};
for (const item of [...cut.clips, ...(cut.vo || [])]) {
  if (item.line === undefined) continue;
  const line = spoken[String(item.line)];
  if (!line) throw new Error(`Line ${item.line} was not found in the take. Run lines.mjs first.`);
  item.src ??= "raw/lines.mp4";
  item.in = line.in + (item.trimIn || 0);
  item.out = line.out - (item.trimOut || 0);
}
await mkdir(cache, { recursive: true });
await mkdir(path.join(film, "out"), { recursive: true });

const inputs = [];
const add = (args) => { inputs.push(args); return inputs.length - 1; };
const sources = new Map();
const source = (file) => {
  if (!sources.has(file)) sources.set(file, add(["-i", abs(file)]));
  return sources.get(file);
};

const graph = [];
const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0b0c,fps=${FPS},setsar=1,format=yuv420p`;
let at = 0;
const starts = [];

for (const [index, clip] of cut.clips.entries()) {
  starts.push(at);
  if (clip.card) {
    // A full-frame still, such as the end card.
    const png = await still({ kind: "end", ...clip.card });  // any full-frame kind: end, title, stats
    const input = add(["-loop", "1", "-t", String(clip.dur), "-i", png]);
    graph.push(`[${input}:v]${fit}[v${index}]`);
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${clip.dur}[a${index}]`);
    at += clip.dur;
    continue;
  }
  if (clip.image) {
    // A still, such as a walkthrough slide, held for as long as its line is spoken.
    const input = add(["-loop", "1", "-t", String(clip.dur), "-i", abs(clip.image)]);
    graph.push(`[${input}:v]${fit}[v${index}]`);
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${clip.dur}[a${index}]`);
    at += clip.dur;
    continue;
  }
  const input = source(clip.src);
  const speed = clip.speed || 1;
  // With `dur` the clip fills that time from `in`, holding its last frame if the source runs out.
  const hold = clip.dur !== undefined;
  if (hold) clip.out = clip.in + clip.dur * speed;
  const length = (clip.out - clip.in) / speed;
  const take = hold
    ? `trim=start=${clip.in},setpts=(PTS-STARTPTS)/${speed},tpad=stop_mode=clone:stop_duration=60,trim=duration=${length.toFixed(3)},setpts=PTS-STARTPTS`
    : `trim=start=${clip.in}:end=${clip.out},setpts=(PTS-STARTPTS)/${speed}`;
  // zoom is a region of the source in its own pixels: the island and the
  // question panel are small on a full desktop and unreadable at 1080p.
  const crop = clip.zoom ? `crop=${clip.zoom.w}:${clip.zoom.h}:${clip.zoom.x}:${clip.zoom.y},` : "";
  if (clip.frame) {
    // A capture of the app window: rounded and set on the backdrop, the way
    // a window sits on a desktop.
    const looped = ["-loop", "1", "-t", (length + 1).toFixed(3), "-i"];
    const backdrop = add([...looped, await still({ kind: "backdrop" })]);
    const mask = add([...looped, await still({ kind: "mask" })]);
    graph.push(`[${input}:v]${take},${crop}scale=${FRAME.w}:${FRAME.h}:flags=lanczos,fps=${FPS},format=yuv420p[s${index}]`);
    graph.push(`[${mask}:v]crop=${FRAME.w}:${FRAME.h}:0:0,fps=${FPS},trim=duration=${length.toFixed(3)},format=gray[m${index}]`);
    graph.push(`[s${index}][m${index}]alphamerge[sm${index}]`);
    graph.push(`[${backdrop}:v]fps=${FPS},trim=duration=${length.toFixed(3)},format=yuv420p[b${index}]`);
    graph.push(`[b${index}][sm${index}]overlay=${FRAME.x}:${FRAME.y}:shortest=1,setsar=1,format=yuv420p[v${index}]`);
  } else {
    graph.push(`[${input}:v]${take},${crop}${fit}[v${index}]`);
  }
  const gain = clip.gain ?? 1;
  if (!hold && gain > 0 && speed === 1 && await hasAudio(abs(clip.src))) {
    graph.push(`[${input}:a]atrim=start=${clip.in}:end=${clip.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume=${gain}[a${index}]`);
  } else {
    graph.push(`anullsrc=r=48000:cl=stereo,atrim=duration=${length.toFixed(3)}[a${index}]`);
  }
  at += length;
}

const total = at;
graph.push(`${cut.clips.map((_, index) => `[v${index}][a${index}]`).join("")}concat=n=${cut.clips.length}:v=1:a=1[vcat][acat]`);

// Voice lines read separately, each placed at its second in the film.
const voices = ["[acat]"];
for (const [index, line] of (cut.vo || []).entries()) {
  const input = source(line.src);
  graph.push(`[${input}:a]atrim=start=${line.in}:end=${line.out},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(line.at * 1000)}:all=1,volume=${line.gain ?? 1}[vo${index}]`);
  voices.push(`[vo${index}]`);
}
graph.push(`${voices.join("")}amix=inputs=${voices.length}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);

// Stills over the picture. `clip` makes a time relative to that clip's start.
const when = (item) => {
  const base = item.clip === undefined ? 0 : starts[item.clip];
  return [base + item.at, base + item.to];
};
const layers = [];
// The mark sits in the corner until a full-frame card takes over.
const firstCard = cut.clips.findIndex((clip) => clip.card);
if (cut.bug) layers.push({ params: { kind: "bug" }, from: cut.bug.at ?? 0, to: cut.bug.to ?? (firstCard >= 0 ? starts[firstCard] : total) });
for (const item of cut.bugs || []) layers.push({ params: { kind: "bug" }, from: item.at, to: item.to });
for (const item of cut.labels || []) { const [from, to] = when(item); layers.push({ params: { kind: "label", text: item.text }, from, to }); }
for (const item of cut.lower || []) { const [from, to] = when(item); layers.push({ params: { kind: "lower", name: item.name, role: item.role }, from, to }); }
for (const item of cut.captions || []) {
  const [from, to] = when(item);
  layers.push({ params: { kind: "caption", text: item.text, hl: item.hl || "", tone: item.tone || "", pos: item.pos || "" }, from, to });
}

let last = "vcat";
for (const [index, layer] of layers.entries()) {
  const input = add(["-i", await still(layer.params)]);
  graph.push(`[${last}][${input}:v]overlay=0:0:enable='between(t,${layer.from.toFixed(3)},${layer.to.toFixed(3)})'[o${index}]`);
  last = `o${index}`;
}

browser?.close();

const out = path.join(film, "out", cut.out);
await run(FFMPEG, [
  "-y", "-v", "error", ...inputs.flat(),
  "-filter_complex", graph.join(";"),
  "-map", `[${last}]`, "-map", "[aout]",
  "-t", String(Math.min(total, LIMIT)),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out,
], { maxBuffer: 64_000_000, timeout: 20 * 60_000 });

const { stdout } = await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration,size", "-of", "default=nw=1", out]);
console.log(`${cut.out}\n${stdout.trim()}\ncut length ${total.toFixed(2)} s${total > LIMIT ? `, trimmed to ${LIMIT} s` : ""}`);
