import { readFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "./store.mjs";

export async function loadLocalEnv() {
  let text;
  try { text = await readFile(path.join(paths.root, ".env.local"), "utf8"); }
  catch { return; }
  const allowed = new Set([
    "ELEVENLABS_API_KEY", "ELEVENLABS_VOICE_ID", "ELEVENLABS_MODEL_ID", "ELEVENLABS_LANGUAGE", "ELEVENLABS_AGENT_LLM",
    "APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL", "APPRENTICE_LLM_KEY", "APPRENTICE_SYSTEM_VOICE", "PORT",
    "APPRENTICE_EMBED_URL", "APPRENTICE_EMBED_MODEL", "APPRENTICE_EMBED_KEY", "APPRENTICE_LLAMA",
  ]);
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match || !allowed.has(match[1]) || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}
