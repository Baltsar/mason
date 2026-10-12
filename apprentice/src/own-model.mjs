import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, stat, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runner, startModel } from "./runner.mjs";
import { paths } from "./store.mjs";

// A model that Mason fetches, keeps and runs itself, so that "on this Mac"
// does not mean "after you have set up another program". It is fetched only
// when its owner presses for it, from the one place named here, and it is
// kept only if it is, to the byte, the file that is named here.
//
// The models are a short list in this file and nothing else can be asked
// for: the window sends a name from the list, never an address or a path.
// Each is pinned to one commit at Hugging Face and to the sha256 of the file,
// so what is run is what was looked at when this was written. Both are
// Gemma 4, published as GGUF by the llama.cpp project, Apache 2.0.

const GB = 1e9;
export const CATALOG = {
  "gemma-4-e2b": {
    name: "Gemma 4 E2B",
    note: "Small and quick",
    file: "gemma-4-E2B-it-Q4_0.gguf",
    bytes: 2_841_481_184,
    sha256: "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52",
    url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/b4243c156154b6dca9324415f8c7ccc098b4aed1/gemma-4-E2B-it-Q4_0.gguf",
    memory: 8 * GB,
  },
  "gemma-4-e4b": {
    name: "Gemma 4 E4B",
    note: "Better words, more room",
    file: "gemma-4-E4B-it-Q4_0.gguf",
    bytes: 4_590_807_392,
    sha256: "a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2",
    url: "https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/b8093469224f83f5c38f691eb906c380e9e63114/gemma-4-E4B-it-Q4_0.gguf",
    memory: 16 * GB,
  },
};
// What must be left on the disk after a model has been fetched. A Mac with
// less than this free is a Mac that is in trouble for other reasons.
export const ROOM_TO_SPARE = 2 * GB;

// Kept apart from the model that places texts by meaning, which takes the first file it finds in its own folder.
export const ownFolder = () => path.join(paths.data, "models", "writer");
export const ownFile = (key) => CATALOG[key] ? path.join(ownFolder(), CATALOG[key].file) : null;
// A model is there when its file is, whole. It was checked against its sha256 before it was given that name.
export const ownReady = (key) => { try { return statSync(ownFile(key)).size === CATALOG[key].bytes; } catch { return false; } };

// How much room this Mac has: free on the disk the memory is kept on, and
// memory in all. The disk's figure leaves out what macOS could clear if
// asked, so it is a little lower than the one Finder shows.
export async function room() {
  const where = existsSync(paths.data) ? paths.data : path.dirname(paths.data);
  const disk = await statfs(where).catch(() => null);
  return { free: disk ? Number(disk.bavail) * Number(disk.bsize) : 0, memory: os.totalmem() };
}
// Whether a model fits, and by what it does not.
export const fits = (model, { free, memory }, has = 0) => ({ disk: free >= model.bytes - has + ROOM_TO_SPARE, memory: memory >= model.memory });
// The one to offer first: the larger one where it fits with room to spare twice over, otherwise the small one.
export const suggested = (space) => fits(CATALOG["gemma-4-e4b"], { ...space, free: space.free - ROOM_TO_SPARE }).disk && fits(CATALOG["gemma-4-e4b"], space).memory ? "gemma-4-e4b" : "gemma-4-e2b";

/* Fetching */

// One file, fetched to a name of its own beside where it will live, and given
// its real name only when every byte is there and the sha256 is the one that
// was named. Stopped half-way (the server was restarted, or Cancel was
// pressed), it goes on from where it was the next time. `onProgress` hears
// how many bytes are there.
export async function fetchFile({ url, file, bytes, sha256 }, { fetcher = fetch, signal, onProgress = () => {} } = {}) {
  await mkdir(path.dirname(file), { recursive: true });
  const part = `${file}.part`;
  let got = (await stat(part).catch(() => null))?.size || 0;
  if (got > bytes) { await rm(part, { force: true }); got = 0; }
  const hash = createHash("sha256");
  // What is already there is read once more, so that the sum is of the whole file.
  if (got) for await (const chunk of createReadStream(part)) hash.update(chunk);
  if (got < bytes) {
    const response = await fetcher(url, { headers: got ? { range: `bytes=${got}-` } : {}, signal, redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`The file could not be fetched (${response.status}).`);
    // Asked to go on and answered with the whole file: it is taken from the start.
    if (got && response.status !== 206) return rm(part, { force: true }).then(() => fetchFile({ url, file, bytes, sha256 }, { fetcher, signal, onProgress }));
    const out = createWriteStream(part, { flags: got ? "a" : "w" });
    try {
      for await (const chunk of response.body) {
        got += chunk.length;
        if (got > bytes) throw new Error("The file is larger than the one that was named.");
        hash.update(chunk);
        if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
        onProgress(got);
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }
  }
  if (got !== bytes || hash.digest("hex") !== sha256) {
    await rm(part, { force: true });
    throw new Error("The file was not the one that was named, and was thrown away.");
  }
  await rename(part, file);
  return file;
}

// The one fetch that is going on, if one is. `failed` is why the last one stopped, in a sentence.
let job = null;
let failed = { key: "", why: "" };
export async function download(key, { fetcher = fetch, onProgress = () => {} } = {}) {
  const model = CATALOG[key];
  if (!model) throw new Error("No such model");
  if (ownReady(key)) return ownFile(key);
  if (job) return job.key === key ? job.done : Promise.reject(new Error("Another model is being fetched."));
  const has = (await stat(`${ownFile(key)}.part`).catch(() => null))?.size || 0;
  if (!fits(model, await room(), has).disk) throw new Error("There is not room for it on this disk.");
  failed = { key: "", why: "" };
  const controller = new AbortController();
  let told = 0;
  job = { key, got: has, controller };
  job.done = fetchFile({ ...model, file: ownFile(key) }, {
    fetcher,
    signal: controller.signal,
    // The window is told about once a second, not at every packet.
    onProgress: (got) => { job.got = got; if (Date.now() - told > 900) { told = Date.now(); onProgress(); } },
  }).catch((error) => {
    // Cancelled is not failed: what is there is kept, to go on from.
    if (!controller.signal.aborted) failed = { key, why: error.message };
    return null;
  }).finally(() => { job = null; onProgress(); });
  return job.done;
}
export function cancelDownload() { job?.controller.abort(); }

// Where each model of the list stands: there, being fetched, or not there, and whether it would fit.
export async function ownStatus() {
  const space = await room();
  const models = await Promise.all(Object.entries(CATALOG).map(async ([key, model]) => {
    const ready = ownReady(key);
    const got = job?.key === key ? job.got : ready ? model.bytes : (await stat(`${ownFile(key)}.part`).catch(() => null))?.size || 0;
    const fit = fits(model, space, got);
    return { key, name: model.name, note: model.note, bytes: model.bytes, got, state: ready ? "ready" : job?.key === key ? "fetching" : "absent", fitsDisk: ready || fit.disk, fitsMemory: fit.memory, failed: failed.key === key ? failed.why : "" };
  }));
  return { runner: Boolean(runner()), free: space.free, memory: space.memory, suggested: suggested(space), models };
}

/* Running */

// The model that writes, when it is one of these: set where settings are applied.
let chosen = "";
let server = null;
let starting = null;
let idle = null;
// The model would not load: most often a llama.cpp older than the model.
let refused = false;
const IDLE_MS = 4 * 60_000;
export const ownModel = () => chosen;
export function setOwnModel(key) {
  const next = CATALOG[key] ? key : "";
  if (next !== chosen) stopOwn();
  chosen = next;
}
export function stopOwn() {
  clearTimeout(idle);
  server?.child.kill();
  server = null;
  refused = false;
}
process.once("exit", stopOwn);
// Whether it can be asked at all: the file is there, something can run it, and it did not refuse to load.
export const ownAble = () => Boolean(chosen) && ownReady(chosen) && Boolean(runner()) && !refused;

// The model, started when it is first asked (runner.mjs) and stopped when it
// has been quiet for a few minutes: loaded, it holds as much memory as its
// file is large. A summary is some ten thousand tokens of prompts and
// reports, so it is given room for that, and it is told not to think aloud.
export async function ownServer() {
  if (!ownAble()) return null;
  clearTimeout(idle);
  if (server) return server;
  starting ||= (async () => {
    const started = await startModel({ file: ownFile(chosen), args: ["--ctx-size", "16384", "--parallel", "1", "--reasoning-budget", "0"], startMs: 90_000 });
    refused = started.gone;
    if (!started.server) return null;
    server = started.server;
    server.child.once("exit", () => { if (server?.child === started.server.child) server = null; });
    return server;
  })().finally(() => { starting = null; });
  return starting;
}
// Said after each answer: the count to being stopped starts again.
export function ownRests() {
  clearTimeout(idle);
  idle = setTimeout(stopOwn, IDLE_MS);
  idle.unref?.();
}
