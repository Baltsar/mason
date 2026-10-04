import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const app = path.join(root, "Apprentice.app");
// APPRENTICE_DATA points a second instance at its own memory, so a rehearsal
// never writes into the real Work Map.
const data = process.env.APPRENTICE_DATA || path.join(root, "data");
export const paths = {
  root,
  data,
  events: path.join(data, "events.jsonl"),
  map: path.join(data, "work-map.json"),
  state: path.join(data, "state.json"),
  wiki: process.env.APPRENTICE_DATA ? path.join(data, "wiki") : path.join(root, "wiki"),
  public: path.join(root, "public"),
  reader: path.join(root, ".runtime", "ApprenticeReader"),
  app,
  status: path.join(app, "Contents", "MacOS", "Apprentice"),
};

const RUNTIME_DEFAULTS = {
  recording: true,
  offTheRecord: false,
  permission: "unknown",
  collector: "starting",
  lastEventAt: null,
  lastQuestionAt: null,
  questionsToday: 0,
  questionsDay: null,
  privateRefusals: 0,
  // Off by default: in the background Apprentice only watches and keeps what
  // it wants to ask for the debrief. It speaks up only inside a capture session.
  ambientQuestions: false,
  debriefReady: false,
  lastDebriefAt: null,
  returned: {},
  session: null,
  currentApp: null,
  currentWindow: null,
  currentCategory: null,
  currentGroup: null,
  currentIdleSeconds: null,
  currentPrivate: false,
};

// These change on every tick. They live in memory only, so the collector does
// not rewrite state.json every two seconds.
const VOLATILE = ["collector", "currentApp", "currentWindow", "currentCategory", "currentGroup", "currentIdleSeconds", "currentPrivate"];

// The server is the only writer, so it keeps events, map and runtime in memory.
// Short-lived readers (MCP over stdio, tests) leave this off and read the files.
let memory = null;
export function useMemoryStore() {
  memory = { events: null, map: null, runtime: null, runtimeSaved: "", version: 0 };
}
export const eventsVersion = () => memory?.version ?? 0;

export async function ensureStore() {
  await Promise.all([mkdir(paths.data, { recursive: true }), mkdir(paths.wiki, { recursive: true })]);
  try { await readFile(paths.events); } catch { await writeFile(paths.events, ""); }
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return structuredClone(fallback); }
}

export async function atomicJson(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

async function allEvents() {
  if (memory?.events) return memory.events;
  const events = [];
  try {
    for (const line of (await readFile(paths.events, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      // A half-written last line must not hide the rest of the day.
      try { events.push(JSON.parse(line)); } catch {}
    }
  } catch {}
  if (memory) memory.events = events;
  return events;
}

export async function appendEvent(event) {
  const row = { id: randomUUID(), at: new Date().toISOString(), ...event };
  if (memory) (await allEvents()).push(row);
  await appendFile(paths.events, `${JSON.stringify(row)}\n`);
  if (memory) memory.version += 1;
  return row;
}

export async function readEvents(limit = 160) {
  const events = await allEvents();
  return Number.isFinite(limit) ? events.slice(-limit) : events;
}

export async function readEventsSince(since) {
  return (await allEvents()).filter((event) => Date.parse(event.at) >= since);
}

export async function loadMap() {
  if (memory?.map) return memory.map;
  const map = await readJson(paths.map, { sessions: [], decisions: [], questions: [], uncertainties: [], recap: null });
  if (memory) memory.map = map;
  return map;
}

export async function saveMap(map) {
  map.updatedAt = new Date().toISOString();
  if (memory) memory.map = map;
  await atomicJson(paths.map, map);
}

export async function loadRuntime() {
  if (memory?.runtime) return memory.runtime;
  const runtime = { ...RUNTIME_DEFAULTS, ...(await readJson(paths.state, {})) };
  if (memory) memory.runtime = runtime;
  return runtime;
}

export async function saveRuntime(state) {
  if (!memory) return atomicJson(paths.state, state);
  memory.runtime = state;
  const durable = JSON.stringify(Object.fromEntries(Object.entries(state).filter(([key]) => !VOLATILE.includes(key))));
  if (durable === memory.runtimeSaved) return;
  memory.runtimeSaved = durable;
  await atomicJson(paths.state, state);
}
