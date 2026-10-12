import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { paths } from "./store.mjs";

// A model on this Mac is a file, and llama.cpp is what runs it. Mason starts
// it when a model is first needed and stops it when it has been quiet for a
// while. Two models are run this way: the one that places texts by meaning
// (embed.mjs) and the one that writes (own-model.mjs).

// What runs a model: the one that is named, a build kept in Mason's own
// folder (a new model can need a newer llama.cpp than the one installed), or
// the one installed on this Mac. Mason started from its icon does not have
// the folders of a terminal on its path, so the usual ones are looked in too.
export function runner() {
  const named = (process.env.APPRENTICE_LLAMA || "").trim();
  if (named) return existsSync(named) ? named : null;
  const folders = [path.join(paths.root, ".runtime", "llama"), ...(process.env.PATH || "").split(":"), "/opt/homebrew/bin", "/usr/local/bin"];
  return folders.filter(Boolean).map((folder) => path.join(folder, "llama-server")).find((file) => existsSync(file)) || null;
}

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

// One model, started and waited for. It listens on this Mac only, is told to
// stay off the network, and loads no part for pictures. Anything on this Mac
// can reach a local port, a page in a browser too, so only who knows the key,
// made anew each time, is answered. `gone` in what comes back says the model
// would not load: most often a llama.cpp older than the model.
export async function startModel({ file, args = [], startMs = 40_000 }) {
  const bin = runner();
  if (!file || !bin) return { gone: false, server: null };
  const port = await freePort();
  const key = randomUUID();
  const child = spawn(bin, ["-m", file, "--no-mmproj", "--offline", "--host", "127.0.0.1", "--port", String(port), "--log-disable", ...args], { stdio: "ignore", env: { ...process.env, LLAMA_API_KEY: key } });
  let gone = false;
  child.once("error", () => { gone = true; });
  child.once("exit", () => { gone = true; });
  const url = `http://127.0.0.1:${port}`;
  for (const until = Date.now() + startMs; Date.now() < until && !gone;) {
    try { if ((await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) })).ok) return { gone: false, server: { child, url: `${url}/v1`, key } }; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  child.kill();
  return { gone, server: null };
}
