// Renders an animated film frame by frame: node film/edit/render.mjs film/edit/films/<name>.json
//
// The film is a page (plan.motion) that can draw itself at any second. Each
// frame is asked for by its time and photographed, so the result does not
// depend on how fast this machine is. The narrated take is laid under it.

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.dirname(here);
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const PORT = Number(process.env.RENDER_PORT || 9350);
const FPS = 30;
const LIMIT = 59.5;
const END_HOLD = 1.3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const file = path.resolve(process.argv[2]);
const name = path.basename(file, ".json");
const plan = JSON.parse(await readFile(file, "utf8"));
const voice = JSON.parse(await readFile(path.join(film, "raw", "voice", `${name}.json`), "utf8"));
const lines = JSON.parse(await readFile(path.join(film, voice.lines), "utf8"));
const rects = JSON.parse(await readFile(path.join(film, "raw", "ui", "rects.json"), "utf8"));
const total = Math.min(LIMIT, lines[plan.lines.at(-1).id].out + END_HOLD);
// Only the tail of the film may be rendered while a scene is being worked on: FROM=30 TO=40.
const from = Number(process.env.FROM || 0);
const to = Math.min(total, Number(process.env.TO || total));

const frames = path.join(here, ".frames", `${name}-motion`);
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
await mkdir(path.join(film, "out"), { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-background-networking", "--allow-file-access-from-files",
  `--user-data-dir=${path.join(here, ".stills", `chrome-render-${PORT}`)}`, `--remote-debugging-port=${PORT}`, "--window-size=1920,1080", "about:blank",
], { stdio: "ignore" });
let target = null;
for (let attempt = 0; attempt < 60 && !target; attempt += 1) {
  await sleep(250);
  const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((reply) => reply.json()).catch(() => []);
  target = list.find((item) => item.type === "page") || null;
}
if (!target) { chrome.kill(); throw new Error("Chrome did not open its DevTools port."); }
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
const waiting = new Map();
let loaded = null;
let next = 0;
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message); waiting.delete(message.id); }
  if (message.method === "Page.loadEventFired" && loaded) loaded();
};
const send = (method, params = {}) => new Promise((resolve) => { next += 1; waiting.set(next, resolve); socket.send(JSON.stringify({ id: next, method, params })); });
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.error || reply.result?.exceptionDetails) throw new Error(reply.error?.message || reply.result.exceptionDetails.exception?.description || "The page threw.");
  return reply.result.result.value;
};

try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ready = new Promise((resolve) => { loaded = resolve; });
  await send("Page.navigate", { url: pathToFileURL(path.join(film, plan.motion)).href });
  await Promise.race([ready, sleep(8000)]);
  await evaluate("Promise.all([...document.images].map((image) => image.decode().catch(() => {})))");
  console.log(await evaluate(`init(${JSON.stringify({ lines, plan: plan.lines, rects, total })})`));

  const first = Math.round(from * FPS);
  const last = Math.round(to * FPS);
  for (let index = first; index < last; index += 1) {
    await evaluate(`seek(${(index / FPS).toFixed(4)}); new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 94 });
    await writeFile(path.join(frames, `${String(index - first).padStart(5, "0")}.jpg`), Buffer.from(shot.result.data, "base64"));
  }
} finally {
  socket.close();
  chrome.kill();
}

const out = path.join(film, "out", from > 0 || to < total ? `${name}-part.mp4` : plan.out);
await run(FFMPEG, [
  "-y", "-v", "error", "-framerate", String(FPS), "-i", path.join(frames, "%05d.jpg"),
  "-ss", String(from), "-i", path.join(film, voice.audio),
  "-filter_complex", "[1:a]aresample=48000,aformat=channel_layouts=stereo,apad,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
  "-map", "0:v", "-map", "[a]", "-t", String((to - from).toFixed(3)),
  "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(FPS),
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out,
], { maxBuffer: 64_000_000, timeout: 20 * 60_000 });
console.log(`${path.relative(film, out)}  ${(to - from).toFixed(1)} s`);
