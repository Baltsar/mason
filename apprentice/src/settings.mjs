import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { atomicJson, paths, readJson } from "./store.mjs";

// The few things a person may want to change. Each has a default that works,
// so the settings screen is never needed to get started.
const DEFAULTS = { name: "", speech: true, summaries: true };
const file = () => path.join(paths.data, "settings.json");

// What was set from outside (a rehearsal runs muted, for one) is kept and
// never overruled by a switch that is merely at its default.
const outside = { mute: process.env.APPRENTICE_MUTE, llm: process.env.APPRENTICE_LLM };
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
}

function clean(value) {
  return {
    name: String(value?.name ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
    speech: value?.speech !== false,
    summaries: value?.summaries !== false,
  };
}

export async function loadSettings() {
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

// Who the agents are talking to and about.
export const ownerName = () => current.name || accountName() || os.userInfo().username;
