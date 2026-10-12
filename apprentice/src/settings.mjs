import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { CATALOG, setOwnModel } from "./own-model.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// The few things a person may want to change. Each has a default that works,
// so the settings screen is never needed to get started.
// Naming chat and mail, asking sites for their icons, and placing what was
// said by its meaning are off until asked for.
// Looking for a new version asks GitHub once a day and sends nothing of its owner's.
const DEFAULTS = { name: "", speech: true, summaries: true, elevenlabs: true, chats: false, logs: true, cues: true, logos: false, meaning: false, updates: true, island: true, ready: true, chime: true, skin: "lime", writer: "", localUrl: "", localModel: "", ownModel: "" };
// Where a model on this Mac may be reached from here: the address Ollama and
// LM Studio listen on by default, and nothing else. Any other endpoint is set
// by hand in .env.local, so that a press in a window can never point the
// summaries, and the prompts in them, at a place on the internet.
const LOCAL_URLS = ["http://127.0.0.1:11434/v1", "http://127.0.0.1:1234/v1"];
// What the window is made of (public/skins.css). All but the last are glass.
export const SKINS = ["lime", "slate", "sandstone", "patina", "marble", "granite"];
const file = () => path.join(paths.data, "settings.json");

// What was set from outside (a rehearsal runs muted, for one) is kept and
// never overruled by a switch that is merely at its default. It is read the
// first time the settings are loaded, once .env.local has been read.
let outside = null;
let current = { ...DEFAULTS };
let account = null;

// The first name on this Mac's account: what Mason calls its owner until told otherwise.
function accountName() {
  if (account !== null) return account;
  try { account = execFileSync("id", ["-F"], { encoding: "utf8", timeout: 2000 }).trim().split(/\s+/)[0] || ""; }
  catch { account = ""; }
  return account;
}

// The rest of the server reads these each time it speaks or summarises.
function apply() {
  if (!current.speech) process.env.APPRENTICE_MUTE = "1";
  else if (outside.mute) process.env.APPRENTICE_MUTE = outside.mute;
  else delete process.env.APPRENTICE_MUTE;
  if (!current.summaries) process.env.APPRENTICE_LLM = "0";
  else if (outside.llm) process.env.APPRENTICE_LLM = outside.llm;
  else delete process.env.APPRENTICE_LLM;
  // Switched off, the key is taken out of this process. Every place that
  // would call ElevenLabs then finds no key: Mason speaks with the Mac's own
  // voice, answers are typed, there are no calls, and no credit is spent.
  if (!current.elevenlabs) delete process.env.ELEVENLABS_API_KEY;
  else if (outside.key) process.env.ELEVENLABS_API_KEY = outside.key;
  // Which model writes. A key that belongs to an endpoint named in .env.local
  // goes to that endpoint only, never to another model.
  const put = (name, value) => { if (value) process.env[name] = value; else delete process.env[name]; };
  const model = current.writer === "local" ? [current.localUrl, current.localModel, ""] : current.writer === "claude" || current.writer === "mason" ? ["", "", ""] : [outside.llmUrl, outside.llmModel, outside.llmKey];
  setOwnModel(current.writer === "mason" ? current.ownModel : "");
  put("APPRENTICE_LLM_URL", model[0]);
  put("APPRENTICE_LLM_MODEL", model[1]);
  put("APPRENTICE_LLM_KEY", model[2]);
}

function writerOf(value) {
  const localUrl = LOCAL_URLS.includes(value?.localUrl) ? value.localUrl : "";
  const localModel = /^[\w.:\/-]{1,80}$/.test(value?.localModel || "") ? value.localModel : "";
  const local = value?.writer === "local" && localUrl && localModel;
  // One of Mason's own models is a name from its short list, and nothing else.
  const own = value?.writer === "mason" && Object.hasOwn(CATALOG, value?.ownModel) ? value.ownModel : "";
  return { writer: local ? "local" : own ? "mason" : value?.writer === "claude" ? "claude" : "", localUrl: local ? localUrl : "", localModel: local ? localModel : "", ownModel: own };
}

function clean(value) {
  return {
    name: String(value?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
    speech: value?.speech !== false,
    summaries: value?.summaries !== false,
    elevenlabs: value?.elevenlabs !== false,
    chats: value?.chats === true,
    logs: value?.logs !== false,
    cues: value?.cues !== false,
    logos: value?.logos === true,
    meaning: value?.meaning === true,
    updates: value?.updates !== false,
    island: value?.island !== false,
    ready: value?.ready !== false,
    chime: value?.chime !== false,
    // The window is glass unless the one skin without it is chosen. A switch
    // that was once kept for the glass is not read any more.
    skin: SKINS.includes(value?.skin) ? value.skin : "lime",
    // Which model writes: "" is what .env.local names or else Claude, "claude"
    // is the Claude login whatever .env.local says, "local" a model another
    // program runs on this Mac, "mason" one that Mason keeps and runs itself.
    ...writerOf(value),
  };
}

export async function loadSettings() {
  outside ??= { mute: process.env.APPRENTICE_MUTE, llm: process.env.APPRENTICE_LLM, key: process.env.ELEVENLABS_API_KEY, llmUrl: process.env.APPRENTICE_LLM_URL, llmModel: process.env.APPRENTICE_LLM_MODEL, llmKey: process.env.APPRENTICE_LLM_KEY };
  current = clean({ ...DEFAULTS, ...(await readJson(file(), {})) });
  apply();
  return current;
}

export async function saveSettings(patch) {
  current = clean({ ...current, ...patch });
  await atomicJson(file(), current);
  apply();
  return current;
}

export const settings = () => current;

// The endpoint .env.local names for the summaries, if it names one.
export const outsideEndpoint = () => (outside?.llmUrl || "").trim();

// Whether there is a key at all, also while ElevenLabs is switched off.
export const hasElevenLabsKey = () => Boolean(outside?.key);

// Who the agents are talking to and about.
export const ownerName = () => current.name || accountName() || os.userInfo().username;
