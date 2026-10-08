// Renders a page that can draw itself at any second into a film:
//   node film/edit/render-page.mjs film/motion/usp.html film/out/04-usp-motion.mp4
//
// The page gives window.film = { duration, fps, ready, stage(), seek(t) }. Each frame is asked
// for by its time and photographed, so the result does not depend on how fast this machine is.
//   STILLS=1.2,4.6   writes only those seconds, as film/edit/.frames/<name>-stills/<second>.jpg
//   AUDIO=path.wav   lays a sound track under the picture
// Needs Node 22 for its WebSocket: ~/.nvm/versions/node/v22.22.2/bin/node

import { execFile, spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const PORT = Number(process.env.RENDER_PORT || 9351);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const page = path.resolve(process.argv[2]);
const out = process.argv[3] ? path.resolve(process.argv[3]) : null;
const name = path.basename(page, ".html");
const stills = process.env.STILLS ? process.env.STILLS.split(",").map(Number) : null;
if (!stills && !out) throw new Error("Give the film to write: render-page.mjs <page.html> <out.mp4>");

const frames = path.join(here, ".frames", stills ? `${name}-stills` : `${name}-page`);
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });

// The page is written as it is published, without a document around it. It gets one here.
const source = await readFile(page, "utf8");
const whole = path.join(here, ".frames", `${name}-page.html`);
await writeFile(whole, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${source}</body></html>`);

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
const shoot = async (second, file) => {
  await evaluate(`film.seek(${second.toFixed(4)}); new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))`);
  const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 95, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
  await writeFile(file, Buffer.from(shot.result.data, "base64"));
};

let duration = 0;
let fps = 60;
try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const ready = new Promise((resolve) => { loaded = resolve; });
  await send("Page.navigate", { url: pathToFileURL(whole).href });
  await Promise.race([ready, sleep(8000)]);
  await evaluate("film.ready");
  console.log(await evaluate("film.stage()"));
  console.log(`Inter loaded: ${await evaluate("document.fonts.check('720 100px Inter')")}`);
  duration = await evaluate("film.duration");
  fps = await evaluate("film.fps");
  if (stills) {
    for (const second of stills) await shoot(second, path.join(frames, `${second.toFixed(2).padStart(5, "0")}.jpg`));
  } else {
    const total = Math.round(duration * fps);
    for (let index = 0; index < total; index += 1) await shoot(index / fps, path.join(frames, `${String(index).padStart(5, "0")}.jpg`));
  }
} finally {
  socket.close();
  chrome.kill();
}

if (stills) {
  console.log(`${stills.length} stills in ${path.relative(process.cwd(), frames)}`);
} else {
  const audio = process.env.AUDIO ? path.resolve(process.env.AUDIO) : null;
  await mkdir(path.dirname(out), { recursive: true });
  await run(FFMPEG, [
    "-y", "-v", "error", "-framerate", String(fps), "-i", path.join(frames, "%05d.jpg"),
    ...(audio ? ["-i", audio] : []),
    "-map", "0:v", ...(audio ? ["-map", "1:a", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"] : []),
    "-t", String(duration), "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(fps), "-movflags", "+faststart", out,
  ], { maxBuffer: 64_000_000, timeout: 20 * 60_000 });
  console.log(`${path.relative(process.cwd(), out)}  ${duration} s`);
}
