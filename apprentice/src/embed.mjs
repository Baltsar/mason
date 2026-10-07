import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { paths } from "./store.mjs";

// To find something by what it means, and not only by the words it was said
// in, a text is turned into a row of numbers by an embedding model. Texts that
// mean the same get rows that point the same way. The model writes nothing and
// answers nothing: it only places texts next to each other.
//
// Like the model that writes the summaries, this one sits behind one function
// and can be changed. Out of the box it is a model file on this Mac, run by
// llama.cpp for as long as it is needed and then stopped: nothing is sent
// anywhere. With APPRENTICE_EMBED_URL set it is instead whatever answers there
// in the OpenAI embeddings format.

// The length a row is cut to. EmbeddingGemma keeps nearly all it knows in its
// first 256 numbers, and a third of the size is a third of the file.
export const DIMENSIONS = 256;
const BATCH = 32;
// The model is stopped when nothing has been asked of it for this long.
const IDLE_MS = 3 * 60_000;
const START_MS = 40_000;

// Each family of model wants its texts introduced in its own way.
const INTRODUCTIONS = [
  [/embeddinggemma/i, { query: "task: search result | query: ", document: "title: none | text: " }],
  [/nomic/i, { query: "search_query: ", document: "search_document: " }],
];

const endpoint = () => (process.env.APPRENTICE_EMBED_URL || "").trim().replace(/\/+$/, "");
export const modelFolder = () => path.join(paths.data, "models");

// The model file on this Mac: the one that is named, or the one in the folder.
function modelFile() {
  const named = (process.env.APPRENTICE_EMBED_MODEL || "").trim();
  if (named.endsWith(".gguf")) return existsSync(named) ? named : null;
  try {
    // A file that starts with "mmproj" is the part for pictures and sound.
    const file = readdirSync(modelFolder()).filter((item) => item.endsWith(".gguf") && !item.startsWith("mmproj")).sort()[0];
    return file ? path.join(modelFolder(), file) : null;
  } catch { return null; }
}

// What runs the model: the one that is named, a build kept in Mason's own
// folder (a new model can need a newer llama.cpp than the one installed), or
// the one installed on this Mac. Mason started from its icon does not have
// the folders of a terminal on its path, so the usual ones are looked in too.
function runner() {
  const named = (process.env.APPRENTICE_LLAMA || "").trim();
  if (named) return existsSync(named) ? named : null;
  const folders = [path.join(paths.root, ".runtime", "llama"), ...(process.env.PATH || "").split(":"), "/opt/homebrew/bin", "/usr/local/bin"];
  return folders.filter(Boolean).map((folder) => path.join(folder, "llama-server")).find((file) => existsSync(file)) || null;
}

// The name the rows are kept under. Rows from two models cannot be compared,
// so a change of model starts the index again.
export function embedModel() {
  if (endpoint()) return (process.env.APPRENTICE_EMBED_MODEL || "").trim();
  const file = modelFile();
  return file ? path.basename(file, ".gguf") : "";
}

// Which model places the texts and where it runs, for the settings screen.
export function embedStatus() {
  const url = endpoint();
  if (url) {
    let host = url;
    try { host = new URL(url).host; } catch {}
    return { name: embedModel(), where: host, ready: Boolean(embedModel()), onThisMac: /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host), missing: embedModel() ? null : "model" };
  }
  // A model that was started and stopped by itself is not tried again and again.
  const missing = !modelFile() ? "model" : !runner() ? "runner" : refused ? "start" : null;
  return { name: embedModel(), where: "this Mac", ready: !missing, onThisMac: true, missing };
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

let server = null;
let starting = null;
let idle = null;
// The model would not load: most often a llama.cpp older than the model.
let refused = false;

export function stopEmbedder() {
  clearTimeout(idle);
  server?.child.kill();
  server = null;
  // Switched off and on again, it is given another try.
  refused = false;
}
process.once("exit", stopEmbedder);

// The model on this Mac, started when it is first needed. It listens on this
// Mac only, is told to stay off the network, and loads no part for pictures.
async function local() {
  if (server) return server;
  if (refused) return null;
  starting ||= (async () => {
    const [file, bin] = [modelFile(), runner()];
    if (!file || !bin) return null;
    const port = await freePort();
    // Anything on this Mac can reach a local port, a page in a browser too:
    // only who knows this key, made anew each time, is answered.
    const key = randomUUID();
    const child = spawn(bin, [
      "-m", file, "--embeddings", "--no-mmproj", "--offline", "--host", "127.0.0.1", "--port", String(port),
      // A prompt is kept to 600 characters, which is never more tokens than this.
      "--ctx-size", "8192", "--batch-size", "1024", "--ubatch-size", "1024", "--log-disable",
    ], { stdio: "ignore", env: { ...process.env, LLAMA_API_KEY: key } });
    let gone = false;
    child.once("error", () => { gone = true; });
    child.once("exit", () => { gone = true; if (server?.child === child) server = null; });
    const url = `http://127.0.0.1:${port}`;
    for (const until = Date.now() + START_MS; Date.now() < until && !gone;) {
      try { if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok) return (server = { child, url: `${url}/v1`, key }); } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    refused = gone;
    child.kill();
    return null;
  })().finally(() => { starting = null; });
  return starting;
}

// A row cut to its first numbers has to be brought back to length one, or the
// comparison that follows is quietly wrong.
function shortened(row) {
  const cut = Float32Array.from(row.slice(0, DIMENSIONS));
  let sum = 0;
  for (const value of cut) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  for (let index = 0; index < cut.length; index += 1) cut[index] /= length;
  return cut;
}

// The row of each text, in the order they were given, or null when there is no
// model or it did not answer. `kind` says whether a text is something that is
// looked for ("query") or something that can be found ("document").
export async function embed(texts, kind = "document") {
  if (!texts.length) return [];
  const { url, key } = endpoint() ? { url: endpoint(), key: process.env.APPRENTICE_EMBED_KEY } : await local() || {};
  if (!url) return null;
  const model = embedModel();
  const said = INTRODUCTIONS.find(([family]) => family.test(model))?.[1][kind] || "";
  const rows = [];
  try {
    for (let from = 0; from < texts.length; from += BATCH) {
      const response = await fetch(`${url}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model, input: texts.slice(from, from + BATCH).map((text) => `${said}${text}`) }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) return null;
      const { data } = await response.json();
      if (!Array.isArray(data) || data.length !== Math.min(BATCH, texts.length - from)) return null;
      for (const item of [...data].sort((a, b) => a.index - b.index)) {
        if (!Array.isArray(item.embedding) || item.embedding.length < DIMENSIONS) return null;
        rows.push(shortened(item.embedding));
      }
    }
  } catch { return null; }
  finally {
    if (!endpoint()) { clearTimeout(idle); idle = setTimeout(stopEmbedder, IDLE_MS); idle.unref?.(); }
  }
  return rows;
}
