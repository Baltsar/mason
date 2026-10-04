// Records the app's own window by driving it: node film/edit/capture.mjs film/edit/shots/<name>.mjs
//
// The app window is a page served by the local Apprentice server, so a
// headless Chrome can open it, move a pointer, click and type, while the
// DevTools screencast hands over every painted frame. Nothing on the desktop
// is touched and nothing is recorded but that page.

import { execFile, spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.dirname(here);
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const PORT = 9348;
const W = 1280;
const H = 720;
const SCALE = Number(process.env.CAPTURE_SCALE || 1.3);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A pointer and a click ring drawn into the page: a headless browser has no
// cursor, and a demo without one reads as a slideshow.
const POINTER = `(() => {
  if (window.__point) return;
  const arrow = document.createElement("div");
  arrow.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:30px;height:30px;transform:translate(${W / 2}px,${H / 2}px);transition:transform .6s cubic-bezier(.2,.8,.2,1)";
  arrow.innerHTML = '<svg viewBox="0 0 30 30" width="30" height="30"><path d="M5 3l17 10-7.4 1.7-3.8 6.8z" fill="#fff" stroke="#0b0b0c" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const ring = document.createElement("div");
  ring.style.cssText = "position:fixed;left:0;top:0;z-index:2147483646;pointer-events:none;width:48px;height:48px;margin:-24px 0 0 -24px;border-radius:50%;border:2px solid #d7ff42;opacity:0";
  document.body.append(arrow, ring);
  window.__point = (x, y) => { arrow.style.transform = "translate(" + x + "px," + y + "px)"; };
  window.__ring = (x, y) => {
    ring.style.transition = "none"; ring.style.opacity = "1"; ring.style.transform = "translate(" + x + "px," + y + "px) scale(.35)";
    requestAnimationFrame(() => { ring.style.transition = "transform .45s ease-out, opacity .45s ease-out"; ring.style.transform = "translate(" + x + "px," + y + "px) scale(1.2)"; ring.style.opacity = "0"; });
  };
})()`;

const script = path.resolve(process.argv[2]);
const name = path.basename(script, ".mjs");
const frames = path.join(here, ".frames", name);
await rm(frames, { recursive: true, force: true });
await mkdir(frames, { recursive: true });
await mkdir(path.join(film, "raw"), { recursive: true });

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-background-networking",
  `--user-data-dir=${path.join(here, ".stills", "chrome-capture")}`, `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, "about:blank",
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
const once = new Map();
const stamps = [];
let next = 0;
const send = (method, params = {}) => new Promise((resolve, reject) => {
  next += 1;
  waiting.set(next, { resolve, reject, method });
  socket.send(JSON.stringify({ id: next, method, params }));
});
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && waiting.has(message.id)) {
    const entry = waiting.get(message.id);
    waiting.delete(message.id);
    if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
    else entry.resolve(message.result ?? {});
  }
  if (message.method === "Page.screencastFrame") {
    const { data, metadata, sessionId } = message.params;
    const file = path.join(frames, `${String(stamps.length).padStart(6, "0")}.jpg`);
    stamps.push({ file, at: metadata.timestamp });
    writeFile(file, Buffer.from(data, "base64"));
    send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  }
  if (message.method && once.has(message.method)) { once.get(message.method)(); once.delete(message.method); }
};
const event = (method) => new Promise((resolve) => once.set(method, resolve));
const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);
  return reply.result.value;
};

await send("Page.enable");
// The window is laid out at 1280 wide and painted at 1.3x, so its type stays readable in a 1080p film.
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: SCALE, mobile: false });

async function centre(selector) {
  const box = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    const first = node.getBoundingClientRect();
    if (first.top < 80 || first.bottom > innerHeight - 40) node.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  })()`);
  if (!box) throw new Error(`Nothing on the page matches ${selector}`);
  await sleep(450);
  return evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
}

const shot = {
  wait: sleep,
  async goto(url) {
    // A change of only the #hash is not a new page and fires no load event, so
    // the window is emptied first and every wait has a ceiling.
    for (const address of ["about:blank", url]) {
      const loaded = event("Page.loadEventFired");
      await send("Page.navigate", { url: address });
      await Promise.race([loaded, sleep(5000)]);
    }
    await evaluate(POINTER);
  },
  async point(selector) {
    const { x, y } = await centre(selector);
    await evaluate(`window.__point(${x}, ${y})`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await sleep(680);
    return { x, y };
  },
  async click(selector) {
    const { x, y } = await shot.point(selector);
    await evaluate(`window.__ring(${x}, ${y})`);
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await sleep(350);
  },
  async type(selector, text, perKey = 34) {
    await shot.click(selector);
    await evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); node.value = ""; node.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    for (const letter of text) {
      await send("Input.insertText", { text: letter });
      await sleep(perKey + Math.random() * 26);
    }
  },
  // Marks the first element under `selector` whose text contains `text`, so it can be clicked like any other.
  async find(selector, text) {
    const found = await evaluate(`(() => {
      document.querySelectorAll("[data-shot]").forEach((node) => node.removeAttribute("data-shot"));
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.includes(${JSON.stringify(text)}));
      if (node) node.setAttribute("data-shot", "");
      return Boolean(node);
    })()`);
    if (!found) throw new Error(`No ${selector} contains "${text}"`);
    return "[data-shot]";
  },
  async glide(pixels, ms = 1400) {
    await evaluate(`window.scrollBy({ top: ${pixels}, behavior: "smooth" })`);
    await sleep(ms);
  },
  async scroll(selector) {
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "start", behavior: "smooth" })`);
    await sleep(900);
  },
  evaluate,
  // A still of the window as it stands, and where named parts of it are, for the animated film.
  async png(file) {
    await evaluate("document.querySelectorAll('body > div[style*=\"z-index:21474836\"]').forEach((node) => { node.style.visibility = 'hidden'; })");
    const reply = await send("Page.captureScreenshot", { format: "png" });
    await mkdir(path.dirname(path.join(film, file)), { recursive: true });
    await writeFile(path.join(film, file), Buffer.from(reply.data, "base64"));
  },
  rects(selectors) {
    return evaluate(`(() => Object.fromEntries(Object.entries(${JSON.stringify(selectors)}).map(([name, selector]) => { const node = document.querySelector(selector); if (!node) return [name, null]; const r = node.getBoundingClientRect(); return [name, { x: r.left, y: r.top, w: r.width, h: r.height }]; })))()`);
  },
  write: (file, value) => writeFile(path.join(film, file), JSON.stringify(value, null, 2)),
};

const play = (await import(pathToFileURL(script).href)).default;
// The first page is loaded before the screencast starts, so the film does not open on a blank frame.
await play({ ...shot, async start() { await send("Page.startScreencast", { format: "jpeg", quality: 93, everyNthFrame: 1, maxWidth: Math.round(W * SCALE), maxHeight: Math.round(H * SCALE) }); await sleep(120); } });
const endedAt = Date.now() / 1000;
await send("Page.stopScreencast");
await sleep(200);
socket.close();
chrome.kill();

if (stamps.length < 2) { console.log("stills only"); process.exit(0); }
// The screencast only sends a frame when the page repaints, so each frame is
// held until the next one arrives.
const list = ["ffconcat version 1.0"];
for (const [index, frame] of stamps.entries()) {
  const until = stamps[index + 1]?.at ?? Math.max(endedAt, frame.at + 0.04);
  list.push(`file '${frame.file}'`, `duration ${Math.max(0.001, until - frame.at).toFixed(4)}`);
}
list.push(`file '${stamps.at(-1).file}'`);
const listFile = path.join(frames, "frames.txt");
await writeFile(listFile, list.join("\n"));
const out = path.join(film, "raw", `${name}.mp4`);
await run(FFMPEG, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `fps=30,scale=${Math.round(W * SCALE)}:${Math.round(H * SCALE)}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "15", out], { timeout: 10 * 60_000 });
console.log(`${out}\n${stamps.length} frames, ${(endedAt - stamps[0].at).toFixed(1)} s`);
