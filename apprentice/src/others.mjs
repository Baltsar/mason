import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { dayStart } from "./activity.mjs";
import { redact } from "./redact.mjs";
import { settings } from "./settings.mjs";

// The agents beside Claude Code that keep their own logs on this Mac: Codex,
// Grok and Cursor. What was said to them belongs to the same projects, and a
// picture of how someone works with agents that knows only one of them is a
// picture of that one.
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
const CURSOR_DIR = process.env.APPRENTICE_CURSOR_DIR || (elsewhere ? "" : path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "workspaceStorage"));
// A session in a temporary folder is a tool running, not a project of its owner.
const TEMPORARY = /^(\/private)?\/(tmp|var\/folders)\//;
// Even a word starts a turn; only a real sentence is kept as said.
const A_SENTENCE = 12;
// A log can be very large: one Codex session is 128 MB, most of it pictures
// and what tools gave back. So a log is never held as a whole. It is read a
// piece at a time, from where the last reading stopped, and of a line longer
// than this only the beginning is looked at, for the moment it was written.
const PIECE = 1024 * 1024;
const LONGEST_LINE = 256 * 1024;
const BEGINNING = 16 * 1024;
// In a line that is too long to read whole, what was typed stands near the
// beginning, before the picture that made it long.
const TYPED = /"role":"user"[\s\S]*?"type":"input_text","text":"((?:[^"\\]|\\.)*)"/;
const NEWLINE = 10;
const WHEN = /"(?:timestamp|ts)":"([^"]+)"/;

const minuteOf = (at) => Math.floor(at / 60_000);
const freshLog = () => ({ cwd: null, byHand: true, prompts: [], turns: [], minutes: new Set(), spent: new Map() });

// What an agent took, as its own log counts it, by the day it was taken:
// tokens read for the first time, tokens read again from a cache, and tokens
// written. The three are kept apart because they are not worth the same: most
// of what a long session takes is the same conversation read again.
export function spend(spent, at, fresh, cached, written) {
  const count = (value) => Math.max(0, Math.round(Number(value) || 0));
  if (!count(fresh) && !count(cached) && !count(written)) return;
  const day = dayStart(at);
  const taken = spent.get(day) || { fresh: 0, cached: 0, written: 0 };
  taken.fresh += count(fresh);
  taken.cached += count(cached);
  taken.written += count(written);
  spent.set(day, taken);
}
// One count of what was taken, added into another, from a moment on.
export function addSpent(into, from, since = 0) {
  for (const [day, taken] of from || []) if (day >= dayStart(since)) spend(into, day, taken.fresh, taken.cached, taken.written);
  return into;
}
// What the person said, without what the program wrapped around it.
const typed = (text) => {
  const said = String(text ?? "").trim();
  const asked = said.lastIndexOf("## My request for Codex:");
  return asked >= 0 ? said.slice(asked + 24).trim() : said;
};

// One line of a Codex log. `cut` says that only its beginning is there.
function absorbCodex(log, line, cut = false) {
  if (cut || line.length > LONGEST_LINE) {
    const beginning = line.subarray(0, BEGINNING).toString("utf8");
    const at = Date.parse(WHEN.exec(beginning)?.[1]);
    if (!Number.isFinite(at)) return;
    log.minutes.add(minuteOf(at));
    let said = "";
    try { said = typed(JSON.parse(`"${TYPED.exec(beginning)?.[1] ?? ""}"`)); } catch {}
    // Something said with a picture attached: the words are kept, the picture is not read.
    if (said && !said.startsWith("<") && !said.startsWith("[")) {
      log.turns.push({ prompt: at, done: at, ended: false });
      if (said.length >= A_SENTENCE) log.prompts.push({ at, text: redact(said, 600), agent: "Codex" });
    } else if (log.turns.length) log.turns.at(-1).done = at;
    return;
  }
  let row;
  try { row = JSON.parse(line.toString("utf8")); } catch { return; }
  const at = Date.parse(row.timestamp);
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  if (!Number.isFinite(at)) return;
  if (row.type === "session_meta") {
    log.cwd = payload.cwd || log.cwd;
    // Started by a script or by another agent, or a helper of its own.
    log.byHand = payload.source !== "exec" && typeof payload.source !== "object" && payload.thread_source !== "subagent" && !/exec|sdk/i.test(String(payload.originator || ""));
    return;
  }
  log.minutes.add(minuteOf(at));
  // Codex says after each step what the step took; what it read includes what came from the cache.
  if (row.type === "event_msg" && payload.type === "token_count") {
    const took = payload.info?.last_token_usage;
    if (took) spend(log.spent, at, (took.input_tokens || 0) - (took.cached_input_tokens || 0), took.cached_input_tokens, took.output_tokens);
    return;
  }
  const turn = log.turns.at(-1);
  if (row.type === "response_item" && payload.type === "message" && payload.role === "user") {
    const said = typed((Array.isArray(payload.content) ? payload.content : []).find((part) => part?.type === "input_text")?.text);
    // What the program itself puts in as the user: context, not something said.
    if (!said || said.startsWith("<") || said.startsWith("[")) return;
    log.turns.push({ prompt: at, done: at, ended: false });
    if (said.length >= A_SENTENCE) log.prompts.push({ at, text: redact(said, 600), agent: "Codex" });
  } else if (turn && row.type === "event_msg" && (payload.type === "task_complete" || payload.type === "turn_aborted")) {
    turn.done = at;
    turn.ended = payload.type === "task_complete";
  } else if (turn && row.type === "response_item") turn.done = at;
}

// One line of what happened in a Grok session.
function absorbGrok(log, line, cut = false) {
  if (cut || line.length > LONGEST_LINE) return;
  let row;
  try { row = JSON.parse(line.toString("utf8")); } catch { return; }
  const at = Date.parse(row.ts);
  if (!Number.isFinite(at)) return;
  log.minutes.add(minuteOf(at));
  const turn = log.turns.at(-1);
  if (row.type === "turn_started") log.turns.push({ prompt: at, done: at, ended: false });
  else if (turn) { turn.done = at; if (row.type === "turn_ended") turn.ended = row.outcome === "completed"; }
}

// What a Grok session was: where, whether it was typed in, and what was typed.
function describeGrok(log, summary, history, usage = "") {
  let known = {};
  try { known = JSON.parse(summary); } catch {}
  // Grok keeps what each turn took in a file of its own.
  const spent = new Map();
  try { for (const turn of JSON.parse(usage).turns || []) spend(spent, Date.parse(turn.endedAt), (turn.inputTokens || 0) - (turn.cachedReadTokens || 0), turn.cachedReadTokens, turn.outputTokens); } catch {}
  const prompts = [];
  for (const line of String(history ?? "").split("\n")) {
    if (!line) continue;
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    const at = Date.parse(row.timestamp);
    const said = String(row.prompt ?? "").trim();
    // A command for the shell is not something said to the agent.
    if (!Number.isFinite(at) || row.session_id !== known.info?.id || row.is_bash || said.length < A_SENTENCE) continue;
    prompts.push({ at, text: redact(said, 600), agent: "Grok" });
  }
  return { ...log, cwd: known.info?.cwd || null, byHand: known.session_kind !== "headless", prompts, spent };
}

const lineByLine = (text, absorb) => {
  const log = freshLog();
  for (const line of String(text ?? "").split("\n")) if (line) absorb(log, Buffer.from(line));
  return log;
};

// One Codex session, from the text of its log.
export const codexLog = (text) => lineByLine(text, absorbCodex);

// One Grok session, from the three files that say what it was: its summary,
// its events, and what was typed in its folder.
export const grokSession = ({ summary, events, history, usage }) => describeGrok(lineByLine(events, absorbGrok), summary, history, usage);

// Follows one log: reads what was added since the last time, a piece at a
// time, and hands each line to `absorb`. Returns what is known of the log.
const followed = new Map();
export async function follow(file, absorb) {
  let info;
  try { info = await stat(file); } catch { return null; }
  let known = followed.get(file);
  // A file that became shorter was written anew.
  if (!known || info.size < known.offset) { known = { offset: 0, rest: Buffer.alloc(0), cut: false, log: freshLog(), mtime: 0 }; followed.set(file, known); }
  known.mtime = info.mtimeMs;
  if (info.size === known.offset) return known;
  let handle;
  try { handle = await open(file, "r"); } catch { return known; }
  try {
    const piece = Buffer.alloc(PIECE);
    while (known.offset < info.size) {
      const { bytesRead } = await handle.read(piece, 0, PIECE, known.offset);
      if (!bytesRead) break;
      known.offset += bytesRead;
      const data = piece.subarray(0, bytesRead);
      let from = 0;
      for (let end = data.indexOf(NEWLINE, from); end !== -1; end = data.indexOf(NEWLINE, from)) {
        // The line ends here. What earlier pieces held of it is its beginning,
        // and of a line that was too long that beginning is all there is.
        const line = known.cut ? known.rest : known.rest.length ? Buffer.concat([known.rest, data.subarray(from, end)]) : data.subarray(from, end);
        if (line.length) absorb(known.log, line, known.cut);
        known.rest = Buffer.alloc(0);
        known.cut = false;
        from = end + 1;
      }
      // What is left goes on in the next piece. Once a line has grown too
      // long only its beginning is kept, and the rest of it is let pass.
      if (!known.cut && from < bytesRead) known.rest = Buffer.concat([known.rest, data.subarray(from)]);
      if (!known.cut && known.rest.length > LONGEST_LINE) { known.rest = Buffer.from(known.rest.subarray(0, BEGINNING)); known.cut = true; }
    }
  } catch {} finally { await handle.close().catch(() => {}); }
  return known;
}

// A file of settings or of a few lines. A large one is not what it should be.
const small = async (file) => { try { return (await stat(file)).size < 4 * 1024 * 1024 ? await readFile(file, "utf8") : ""; } catch { return ""; } };
const listed = async (folder) => { try { return folder ? (await readdir(folder)).filter((name) => !name.startsWith(".")) : []; } catch { return []; } };

async function codexLogs(since) {
  const logs = [];
  for (const year of await listed(CODEX_DIR)) for (const month of await listed(path.join(CODEX_DIR, year))) for (const day of await listed(path.join(CODEX_DIR, year, month))) {
    for (const name of await listed(path.join(CODEX_DIR, year, month, day))) {
      if (!name.endsWith(".jsonl")) continue;
      const entry = await follow(path.join(CODEX_DIR, year, month, day, name), absorbCodex);
      if (entry && entry.mtime >= since) logs.push({ ...entry.log, source: "Codex" });
    }
  }
  return logs;
}

async function grokLogs(since) {
  const logs = [];
  for (const place of await listed(GROK_DIR)) {
    const history = await small(path.join(GROK_DIR, place, "prompt_history.jsonl"));
    for (const session of await listed(path.join(GROK_DIR, place))) {
      const folder = path.join(GROK_DIR, place, session);
      const entry = await follow(path.join(folder, "events.jsonl"), absorbGrok);
      if (entry && entry.mtime >= since) logs.push({ ...describeGrok(entry.log, await small(path.join(folder, "summary.json")), history, await small(path.join(folder, "usage.json"))), source: "Grok" });
    }
  }
  return logs;
}

// Cursor keeps what was asked in each workspace in a small database of its
// own. Mason reads one value from it, the list of what was asked and when,
// with the sqlite3 that is on every Mac, opened for reading only. That list
// holds the latest fifty or so, so the days are kept from when Mason first
// read them. The answers, and what they took, are in a store of several
// gigabytes beside it, which is left alone: of Cursor there are words and
// moments, not how long it worked and not its tokens.
const SQLITE = "/usr/bin/sqlite3";
const ASKED = "select value from ItemTable where key='aiService.generations'";

// One workspace of Cursor, from the list of what was asked in it.
export function cursorLog(text) {
  const log = freshLog();
  let rows = [];
  try { rows = JSON.parse(text); } catch {}
  for (const row of Array.isArray(rows) ? rows : []) {
    const at = Number(row?.unixMs);
    const said = typed(row?.textDescription);
    if (!Number.isFinite(at) || at <= 0 || !said) continue;
    log.minutes.add(minuteOf(at));
    // When the answer was finished is not said there, so no answer is ever counted as waiting.
    log.turns.push({ prompt: at, done: at, ended: false });
    if (said.length >= A_SENTENCE) log.prompts.push({ at, text: redact(said, 600), agent: "Cursor" });
  }
  log.prompts.sort((a, b) => a.at - b.at);
  log.turns.sort((a, b) => a.prompt - b.prompt);
  return log;
}

const asked = (database) => new Promise((resolve) => {
  execFile(SQLITE, ["-readonly", database, ASKED], { timeout: 4000, maxBuffer: 8 * 1024 * 1024 }, (error, out) => resolve(error ? "" : out));
});

// A workspace is read again only when Cursor wrote to it.
const cursorRead = new Map();
async function cursorLogs(since) {
  const logs = [];
  for (const name of await listed(CURSOR_DIR)) {
    const database = path.join(CURSOR_DIR, name, "state.vscdb");
    let info;
    try { info = await stat(database); } catch { continue; }
    if (info.mtimeMs < since) continue;
    let known = cursorRead.get(database);
    if (!known || known.written !== info.mtimeMs || known.size !== info.size) {
      let folder = "";
      try {
        const where = String(JSON.parse(await small(path.join(CURSOR_DIR, name, "workspace.json"))).folder || "");
        // A folder on this Mac is a project. An agent of Cursor's that runs somewhere else has none here.
        if (where.startsWith("file://")) folder = decodeURIComponent(where.slice("file://".length));
      } catch {}
      // A window with no folder open belongs to no project.
      known = { written: info.mtimeMs, size: info.size, log: folder ? { ...cursorLog(await asked(database)), cwd: folder } : null };
      cursorRead.set(database, known);
    }
    if (known.log) logs.push({ ...known.log, source: "Cursor" });
  }
  return logs;
}

// What Codex, Grok and Cursor were used for, by project folder, since a moment.
let reading = Promise.resolve();
export function otherProjects(since) {
  // One reading at a time: two would follow the same logs from the same place.
  const next = reading.then(async () => {
    const found = new Map();
    if (!settings().logs) return found;
    for (const log of [...await codexLogs(since), ...await grokLogs(since), ...await cursorLogs(since)]) {
      if (!log.cwd || TEMPORARY.test(log.cwd)) continue;
      const project = found.get(log.cwd) || { name: path.basename(log.cwd), folder: log.cwd, prompts: [], minutes: new Set(), turns: [], spent: new Map(), source: log.source };
      addSpent(project.spent, log.spent, since);
      let worked = false;
      for (const minute of log.minutes) if (minute * 60_000 >= since - 60_000) { project.minutes.add(minute); worked = true; }
      // A session another agent started is work that was handed over to this one.
      if (!log.byHand && worked) (project.handed ||= {})[log.source] = (project.handed[log.source] || 0) + 1;
      // Only what its owner typed is said by them, and only its answers wait for them.
      if (log.byHand) {
        for (const prompt of log.prompts) if (prompt.at >= since) project.prompts.push(prompt);
        log.turns.forEach((turn, index) => { if (turn.done >= since) project.turns.push({ ...turn, next: log.turns[index + 1]?.prompt ?? null }); });
      }
      found.set(log.cwd, project);
    }
    return found;
  });
  reading = next.catch(() => {});
  return next;
}

// How many sessions each of them keeps on this Mac, for the settings screen.
export async function otherSources() {
  let codex = 0;
  for (const year of await listed(CODEX_DIR)) for (const month of await listed(path.join(CODEX_DIR, year))) for (const day of await listed(path.join(CODEX_DIR, year, month))) codex += (await listed(path.join(CODEX_DIR, year, month, day))).filter((name) => name.endsWith(".jsonl")).length;
  let grok = 0;
  for (const place of await listed(GROK_DIR)) for (const session of await listed(path.join(GROK_DIR, place))) if (!session.includes(".")) grok += 1;
  return { codex, grok };
}
