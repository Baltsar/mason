import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redact } from "./redact.mjs";
import { settings } from "./settings.mjs";

// The agents beside Claude Code that keep their own logs on this Mac: Codex
// and Grok. What was said to them belongs to the same projects, and a picture
// of how someone works with agents that knows only one of them is a picture
// of that one.
//
// One thing has to be told apart. A session someone typed in is theirs: its
// prompts are their words and its answers wait for them. A session another
// agent started, with a brief it wrote itself, is work on the project and
// nothing more: its minutes count, its words are not the owner's, and its
// answer waits for the agent that asked.

// A test or a rehearsal that points Claude's logs at a folder of its own does
// not read the real logs of the others either, unless it points those too.
const elsewhere = Boolean(process.env.APPRENTICE_CLAUDE_DIR);
const CODEX_DIR = process.env.APPRENTICE_CODEX_DIR || (elsewhere ? "" : path.join(os.homedir(), ".codex", "sessions"));
const GROK_DIR = process.env.APPRENTICE_GROK_DIR || (elsewhere ? "" : path.join(os.homedir(), ".grok", "sessions"));
// A session in a temporary folder is a tool running, not a project of its owner.
const TEMPORARY = /^(\/private)?\/(tmp|var\/folders)\//;
// Even a word starts a turn; only a real sentence is kept as said.
const A_SENTENCE = 12;

const minuteOf = (at) => Math.floor(at / 60_000);
// What the person said, without what the program wrapped around it.
const typed = (text) => {
  const said = String(text ?? "").trim();
  const asked = said.lastIndexOf("## My request for Codex:");
  return asked >= 0 ? said.slice(asked + 24).trim() : said;
};

// One Codex session, from the lines of its log.
export function codexLog(text) {
  const log = { cwd: null, byHand: true, prompts: [], turns: [], minutes: new Set() };
  for (const line of String(text).split("\n")) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row.timestamp);
    const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
    if (!Number.isFinite(at)) continue;
    if (row.type === "session_meta") {
      log.cwd = payload.cwd || log.cwd;
      // Started by a script or by another agent, or a helper of its own.
      log.byHand = payload.source !== "exec" && typeof payload.source !== "object" && payload.thread_source !== "subagent" && !/exec|sdk/i.test(String(payload.originator || ""));
      continue;
    }
    log.minutes.add(minuteOf(at));
    const turn = log.turns.at(-1);
    if (row.type === "response_item" && payload.type === "message" && payload.role === "user") {
      const said = typed((Array.isArray(payload.content) ? payload.content : []).find((part) => part?.type === "input_text")?.text);
      // What the program itself puts in as the user: context, not something said.
      if (!said || said.startsWith("<") || said.startsWith("[")) continue;
      log.turns.push({ prompt: at, done: at, ended: false });
      if (said.length >= A_SENTENCE) log.prompts.push({ at, text: redact(said, 600), agent: "Codex" });
    } else if (turn && row.type === "event_msg" && (payload.type === "task_complete" || payload.type === "turn_aborted")) {
      turn.done = at;
      turn.ended = payload.type === "task_complete";
    } else if (turn && row.type === "response_item") turn.done = at;
  }
  return log;
}

// One Grok session, from the three files that say what it was: its summary,
// its events, and what was typed in its folder.
export function grokSession({ summary, events, history }) {
  const log = { cwd: null, byHand: true, prompts: [], turns: [], minutes: new Set() };
  let known = {};
  try { known = JSON.parse(summary); } catch {}
  log.cwd = known.info?.cwd || null;
  log.byHand = known.session_kind !== "headless";
  for (const line of String(events ?? "").split("\n")) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row.ts);
    if (!Number.isFinite(at)) continue;
    log.minutes.add(minuteOf(at));
    const turn = log.turns.at(-1);
    if (row.type === "turn_started") log.turns.push({ prompt: at, done: at, ended: false });
    else if (turn) { turn.done = at; if (row.type === "turn_ended") turn.ended = row.outcome === "completed"; }
  }
  for (const line of String(history ?? "").split("\n")) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row.timestamp);
    const said = String(row.prompt ?? "").trim();
    // A command for the shell is not something said to the agent.
    if (!Number.isFinite(at) || row.session_id !== known.info?.id || row.is_bash || said.length < A_SENTENCE) continue;
    log.prompts.push({ at, text: redact(said, 600), agent: "Grok" });
  }
  return log;
}

// A log is read again only when its file has grown or changed.
const read = new Map();
async function parsed(file, parse) {
  let info;
  try { info = await stat(file); } catch { return null; }
  const known = read.get(file);
  if (known && known.size === info.size && known.mtime === info.mtimeMs) return known;
  let log;
  try { log = await parse(); } catch { return null; }
  read.set(file, { log, size: info.size, mtime: info.mtimeMs });
  return read.get(file);
}

const text = (file) => readFile(file, "utf8").catch(() => "");
const listed = async (folder) => { try { return folder ? (await readdir(folder)).filter((name) => !name.startsWith(".")) : []; } catch { return []; } };

async function codexLogs(since) {
  const logs = [];
  for (const year of await listed(CODEX_DIR)) for (const month of await listed(path.join(CODEX_DIR, year))) for (const day of await listed(path.join(CODEX_DIR, year, month))) {
    for (const name of await listed(path.join(CODEX_DIR, year, month, day))) {
      if (!name.endsWith(".jsonl")) continue;
      const file = path.join(CODEX_DIR, year, month, day, name);
      const entry = await parsed(file, async () => codexLog(await text(file)));
      if (entry && entry.mtime >= since) logs.push({ ...entry.log, source: "Codex" });
    }
  }
  return logs;
}

async function grokLogs(since) {
  const logs = [];
  for (const place of await listed(GROK_DIR)) for (const session of await listed(path.join(GROK_DIR, place))) {
    const folder = path.join(GROK_DIR, place, session);
    const events = path.join(folder, "events.jsonl");
    const entry = await parsed(events, async () => grokSession({ summary: await text(path.join(folder, "summary.json")), events: await text(events), history: await text(path.join(GROK_DIR, place, "prompt_history.jsonl")) }));
    if (entry && entry.mtime >= since) logs.push({ ...entry.log, source: "Grok" });
  }
  return logs;
}

// What Codex and Grok were used for, by project folder, since a moment.
export async function otherProjects(since) {
  const found = new Map();
  if (!settings().logs) return found;
  for (const log of [...await codexLogs(since), ...await grokLogs(since)]) {
    if (!log.cwd || TEMPORARY.test(log.cwd)) continue;
    const project = found.get(log.cwd) || { name: path.basename(log.cwd), folder: log.cwd, prompts: [], minutes: new Set(), turns: [], source: log.source };
    for (const minute of log.minutes) if (minute * 60_000 >= since - 60_000) project.minutes.add(minute);
    // Only what its owner typed is said by them, and only its answers wait for them.
    if (log.byHand) {
      for (const prompt of log.prompts) if (prompt.at >= since) project.prompts.push(prompt);
      log.turns.forEach((turn, index) => { if (turn.done >= since) project.turns.push({ ...turn, next: log.turns[index + 1]?.prompt ?? null }); });
    }
    found.set(log.cwd, project);
  }
  return found;
}

// How many sessions each of them keeps on this Mac, for the settings screen.
export async function otherSources() {
  let codex = 0;
  for (const year of await listed(CODEX_DIR)) for (const month of await listed(path.join(CODEX_DIR, year))) for (const day of await listed(path.join(CODEX_DIR, year, month))) codex += (await listed(path.join(CODEX_DIR, year, month, day))).filter((name) => name.endsWith(".jsonl")).length;
  let grok = 0;
  for (const place of await listed(GROK_DIR)) for (const session of await listed(path.join(GROK_DIR, place))) if (!session.includes(".")) grok += 1;
  return { codex, grok };
}
