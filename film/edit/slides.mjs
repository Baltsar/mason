// Saves every slide of walkthrough.html as a still: node film/edit/slides.mjs
// The technical film is cut from these, each held for as long as its line is spoken.

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.dirname(here);
const CHROME = process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9349;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--disable-background-networking", "--allow-file-access-from-files",
  `--user-data-dir=${path.join(here, ".stills", "chrome-slides")}`, `--remote-debugging-port=${PORT}`, "about:blank",
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
  if (message.id && waiting.has(message.id)) { waiting.get(message.id)(message.result ?? {}); waiting.delete(message.id); }
  if (message.method === "Page.loadEventFired" && loaded) loaded();
};
const send = (method, params = {}) => new Promise((resolve) => { next += 1; waiting.set(next, resolve); socket.send(JSON.stringify({ id: next, method, params })); });

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
const ready = new Promise((resolve) => { loaded = resolve; });
await send("Page.navigate", { url: pathToFileURL(path.join(film, "walkthrough.html")).href });
await ready;
await sleep(300);

await mkdir(path.join(film, "raw", "slides"), { recursive: true });
const count = (await send("Runtime.evaluate", { expression: "document.querySelectorAll('.slide').length", returnByValue: true })).result.value;
for (let index = 0; index < count; index += 1) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(film, "raw", "slides", `slide-${index + 1}.png`), Buffer.from(shot.data, "base64"));
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await sleep(200);
}
socket.close();
chrome.kill();
console.log(`${count} slides saved to film/raw/slides`);
