import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { redact } from "./redact.mjs";

// A project is a folder the work happens in. Mason never asks for a list:
// it reads the traces the tools already leave on this Mac.
//   Claude Code keeps one log per project folder, with every prompt and its time,
//   and every file its agent wrote.
//   Cursor keeps the folder of every workspace and when it was last used.
// Nothing is copied out of those files except a redacted excerpt of a prompt.

const CLAUDE_DIR = path.join(os.homedir(), ".claude", "projects");
const CURSOR_DIR = path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "workspaceStorage");
const ACTIVE_WITHIN_MS = 8 * 60_000;
const GENERIC = new Set(`hackathon hackaton project projects demo site sajt website new app apps web test tests main src the cursor documents users
frontend backend server client mcp bot final copy old public assets components scripts docs output outputs node_modules dist build data
images design native wiki video videos notes tmp temp misc code repo engine binary`.split(/\s+/));

const AI_APPS = /^(claude|claude code)$/i;
const CURSOR_APP = /^cursor$/i;

function tokensOf(name) {
  return name.toLowerCase().split(/[^a-z0-9åäö]+/).filter((word) => word.length >= 5 && !GENERIC.has(word));
}

// Each log is read once and then only its new lines, so a scan stays cheap
// even when a session file has grown to many megabytes.
const logs = new Map();

async function readNewLines(file, size) {
  const known = logs.get(file) || { offset: 0, rest: "", cwd: null, root: null, prompts: [], minutes: new Set(), files: new Map(), reports: [] };
  if (size < known.offset) Object.assign(known, { offset: 0, rest: "", prompts: [], minutes: new Set(), files: new Map(), reports: [] });
  if (size > known.offset) {
    const handle = await open(file, "r");
    try {
      const buffer = Buffer.alloc(size - known.offset);
      await handle.read(buffer, 0, buffer.length, known.offset);
      const text = known.rest + buffer.toString("utf8");
      const lines = text.split("\n");
      known.rest = lines.pop();
      known.offset = size;
      for (const line of lines) absorb(known, line);
    } finally {
      await handle.close();
    }
  }
  logs.set(file, known);
  return known;
}

function absorb(log, line) {
  if (!line) return;
  let row;
  try { row = JSON.parse(line); } catch { return; }
  const at = Date.parse(row.timestamp);
  if (!Number.isFinite(at)) return;
  if (row.cwd) {
    log.cwd = row.cwd;
    // The project is where the session began, not the subfolder it later moved into.
    if (!log.root || (log.root.startsWith(`${row.cwd}/`))) log.root = row.cwd;
  }
  if (row.isSidechain) return;
  log.minutes.add(Math.floor(at / 60_000));
  // What the agent built: the files it wrote, and when. Names only, never contents.
  if (row.type === "assistant") {
    for (const part of Array.isArray(row.message?.content) ? row.message.content : []) {
      // What it reported back when it was done: the agent's own account of
      // what it built. Short remarks between two steps are not that.
      if (part?.type === "text" && part.text?.length >= 280) {
        log.reports.push({ at, text: redact(part.text, 700) });
        if (log.reports.length > 60) log.reports.shift();
      }
      if (part?.type !== "tool_use" || !/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(part.name)) continue;
      const written = part.input?.file_path || part.input?.notebook_path;
      if (typeof written !== "string") continue;
      if (!log.files.has(written)) log.files.set(written, []);
      log.files.get(written).push(at);
    }
    return;
  }
  if (row.type !== "user" || row.isMeta) return;
  const content = row.message?.content;
  const raw = typeof content === "string" ? content : Array.isArray(content) ? content.find((part) => part?.type === "text")?.text : null;
  if (!raw) return;
  // What the person said, not what the harness wrapped around it.
  const said = raw.replace(/<pasted_content[^>]*>|<\/pasted_content[^>]*>/g, " ").trim();
  if (!said || said.startsWith("<") || said.startsWith("[") || said.length < 12) return;
  log.prompts.push({ at, text: redact(said, 600) });
}

async function claudeProjects(since) {
  const found = new Map();
  let folders = [];
  try { folders = await readdir(CLAUDE_DIR); } catch { return found; }
  for (const folder of folders) {
    let files = [];
    try { files = (await readdir(path.join(CLAUDE_DIR, folder))).filter((name) => name.endsWith(".jsonl")); } catch { continue; }
    for (const name of files) {
      const file = path.join(CLAUDE_DIR, folder, name);
      let info;
      try { info = await stat(file); } catch { continue; }
      if (info.mtimeMs < since) continue;
      const log = await readNewLines(file, info.size).catch(() => null);
      // Work in a temporary folder is a tool running, not a project of its owner.
      if (!log?.root || /^(\/private)?\/(tmp|var\/folders)\//.test(log.root)) continue;
      const project = found.get(log.root) || { name: path.basename(log.root), folder: log.root, prompts: [], minutes: new Set(), source: "Claude Code" };
      for (const prompt of log.prompts) if (prompt.at >= since) project.prompts.push(prompt);
      for (const minute of log.minutes) if (minute * 60_000 >= since - 60_000) project.minutes.add(minute);
      found.set(log.root, project);
    }
  }
  return found;
}

async function cursorWorkspaces(since) {
  const found = [];
  let folders = [];
  try { folders = await readdir(CURSOR_DIR); } catch { return found; }
  for (const folder of folders) {
    try {
      const info = await stat(path.join(CURSOR_DIR, folder, "state.vscdb"));
      if (info.mtimeMs < since) continue;
      const workspace = JSON.parse(await readFile(path.join(CURSOR_DIR, folder, "workspace.json"), "utf8"));
      if (!workspace.folder) continue;
      found.push({ folder: decodeURIComponent(workspace.folder.replace(/^file:\/\//, "")), usedAt: info.mtimeMs });
    } catch {}
  }
  return found.sort((a, b) => b.usedAt - a.usedAt);
}

// The logs of one project folder that were written to since a moment.
// Claude Code names a project's log folder after its path, so the history of a
// project is there from the first day it was worked on, not from the day
// Mason was installed.
async function logsOf(folder, since) {
  const directory = path.join(CLAUDE_DIR, folder.replace(/[^A-Za-z0-9]/g, "-"));
  let files = [];
  try { files = (await readdir(directory)).filter((name) => name.endsWith(".jsonl")); } catch { return []; }
  const found = [];
  for (const name of files) {
    const file = path.join(directory, name);
    let info;
    try { info = await stat(file); } catch { continue; }
    if (info.mtimeMs < since) continue;
    const log = await readNewLines(file, info.size).catch(() => null);
    if (log) found.push(log);
  }
  return found;
}

// Everything said to an agent in one project folder, as far back as asked.
export async function projectHistory(folder, since) {
  const prompts = [];
  for (const log of await logsOf(folder, since)) prompts.push(...log.prompts.filter((prompt) => prompt.at >= since));
  return prompts.sort((a, b) => a.at - b.at);
}

const NOT_THE_PROJECT = /(^|\/)(node_modules|\.git|\.claude|\.next|dist|build|\.runtime)\/|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

// What the agents changed in one project folder: each file with the number of
// times it was written, most changed first. This is how the thing was built,
// as opposed to what was asked for.
export async function projectWork(folder, since) {
  const changed = new Map();
  for (const log of await logsOf(folder, since)) {
    for (const [file, times] of log.files) {
      if (!file.startsWith(`${folder}${path.sep}`)) continue;
      const name = file.slice(folder.length + 1);
      const edits = times.filter((at) => at >= since).length;
      if (!edits || NOT_THE_PROJECT.test(name)) continue;
      changed.set(name, (changed.get(name) || 0) + edits);
    }
  }
  return [...changed].map(([file, edits]) => ({ file, edits })).sort((a, b) => b.edits - a.edits);
}

// What the agents said they had done, newest last.
export async function projectReports(folder, since, count = 10) {
  const reports = [];
  for (const log of await logsOf(folder, since)) reports.push(...log.reports.filter((report) => report.at >= since));
  return reports.sort((a, b) => a.at - b.at).slice(-count);
}

// One index per window asked for: today's is read every few seconds, the
// week's only when an episode is made, and neither should push the other out.
const cached = new Map();

export async function projectIndex(since, { maxAgeMs = 20_000 } = {}) {
  const known = cached.get(since);
  if (known && Date.now() - known.at < maxAgeMs) return known.index;
  const [claude, cursor] = await Promise.all([claudeProjects(since), cursorWorkspaces(since)]);
  const projects = new Map();
  // A log that was only touched today, with nothing said or done in it, is not today's work.
  for (const project of claude.values()) if (project.minutes.size) projects.set(project.folder, project);
  // Cursor touches many workspaces when it starts; the two newest are the ones in use.
  for (const workspace of cursor.slice(0, 2)) {
    if (!projects.has(workspace.folder)) projects.set(workspace.folder, { name: path.basename(workspace.folder), folder: workspace.folder, prompts: [], minutes: new Set(), source: "Cursor" });
    projects.get(workspace.folder).cursorUsedAt = workspace.usedAt;
  }
  for (const project of projects.values()) project.tokens = tokensOf(project.name);
  // Work inside a subfolder belongs to the project around it ("apprentice"
  // inside HACKNATION), and the subfolder's name is one more way to recognise it.
  const outermost = [...projects.values()].sort((a, b) => a.folder.length - b.folder.length);
  for (const child of [...outermost].reverse()) {
    const parent = outermost.find((other) => other !== child && child.folder.startsWith(`${other.folder}${path.sep}`));
    if (!parent) continue;
    parent.prompts.push(...child.prompts);
    for (const minute of child.minutes) parent.minutes.add(minute);
    parent.tokens = [...new Set([...parent.tokens, ...child.tokens])];
    projects.delete(child.folder);
  }
  for (const project of projects.values()) project.prompts.sort((a, b) => a.at - b.at);
  const list = [...projects.values()];

  // Which project the Claude window is about: the one last spoken to. An agent
  // that keeps working for an hour does not make its project the one in front.
  const activeInClaude = (at) => {
    let best = null;
    for (const project of list) {
      const prompt = project.prompts.findLast((item) => item.at <= at + 60_000);
      if (prompt && at - prompt.at < 30 * 60_000 && (!best || prompt.at > best.at)) best = { project, at: prompt.at };
    }
    if (best) return best.project;
    const minute = Math.floor(at / 60_000);
    for (let step = 0; step <= ACTIVE_WITHIN_MS / 60_000; step += 1) {
      const near = list.find((project) => project.minutes.has(minute - step) || project.minutes.has(minute + step));
      if (near) return near;
    }
    return null;
  };

  const index = {
    list,
    // Which project a moment on screen belongs to, or null when it is none of them.
    resolve({ app = "", window = "", at, startedAt } = {}) {
      const when = Date.parse(startedAt || at) || Date.now();
      const title = `${window}`.toLowerCase();
      if (title) {
        const named = list.find((project) => project.tokens.some((token) => title.includes(token)));
        if (named) return named.name;
      }
      if (AI_APPS.test(app.trim())) return activeInClaude(when)?.name || null;
      if (CURSOR_APP.test(app.trim())) {
        const recent = cursor.find((workspace) => Math.abs(workspace.usedAt - when) < 45 * 60_000) || (Date.now() - when < 45 * 60_000 ? cursor[0] : null);
        return recent ? path.basename(recent.folder) : null;
      }
      return null;
    },
    // The project recorded with an event is kept only while it is still a
    // known project; otherwise the moment is worked out again.
    of(event) {
      return event.project && list.some((project) => project.name === event.project) ? event.project : index.resolve(event);
    },
    prompts() {
      return list.flatMap((project) => project.prompts.map((prompt) => ({ ...prompt, project: project.name }))).sort((a, b) => a.at - b.at);
    },
  };
  for (const [key, entry] of cached) if (Date.now() - entry.at > 600_000) cached.delete(key);
  cached.set(since, { at: Date.now(), index });
  return index;
}

// Time per project, the moves between them, and what happened outside all of them.
export function summarizeProjects(events, index, now = Date.now()) {
  const totals = new Map();
  const off = new Map();
  let offSeconds = 0;
  let switches = 0;
  let last = null;
  const blocks = [];
  for (const event of events) {
    if (event.type !== "activity" || !(Number(event.durationSec) > 0)) continue;
    const name = index.of ? index.of(event) : event.project || index.resolve(event);
    const seconds = Math.min(Number(event.durationSec), 3600);
    const startedAt = Date.parse(event.startedAt || event.at);
    if (name) {
      const entry = totals.get(name) || { name, seconds: 0, apps: new Set() };
      entry.seconds += seconds;
      entry.apps.add(event.app);
      totals.set(name, entry);
      if (last && last !== name) switches += 1;
      last = name;
    } else {
      offSeconds += seconds;
      const key = `${event.app}\n${event.window || ""}`;
      const entry = off.get(key) || { app: event.app, window: event.window || "", seconds: 0, group: event.group };
      entry.seconds += seconds;
      off.set(key, entry);
    }
    const tail = blocks.at(-1);
    if (tail && tail.project === (name || null) && startedAt - tail.endedAt < 120_000) { tail.seconds += seconds; tail.endedAt = startedAt + seconds * 1000; }
    else blocks.push({ project: name || null, startedAt, endedAt: startedAt + seconds * 1000, seconds, app: event.app, window: event.window || "" });
  }
  const total = [...totals.values()].reduce((sum, item) => sum + item.seconds, 0) + offSeconds;
  const share = (seconds) => total ? Math.round((seconds / total) * 100) : 0;
  const said = index.prompts();
  const projects = [...totals.values()].sort((a, b) => b.seconds - a.seconds).map((item) => {
    const prompts = said.filter((prompt) => prompt.project === item.name);
    return {
      name: item.name,
      seconds: Math.round(item.seconds),
      percent: share(item.seconds),
      apps: [...item.apps],
      prompts: prompts.length,
      lastSaid: prompts.at(-1) ? { at: new Date(prompts.at(-1).at).toISOString(), text: prompts.at(-1).text } : null,
    };
  });
  // A project that was prompted today but never in the foreground is still a project.
  for (const project of index.list) {
    if (projects.some((item) => item.name === project.name) || !project.prompts.length) continue;
    projects.push({ name: project.name, seconds: 0, percent: 0, apps: [project.source], prompts: project.prompts.length, lastSaid: { at: new Date(project.prompts.at(-1).at).toISOString(), text: project.prompts.at(-1).text } });
  }
  return {
    projects,
    offProject: {
      seconds: Math.round(offSeconds),
      percent: share(offSeconds),
      windows: [...off.values()].sort((a, b) => b.seconds - a.seconds).slice(0, 6).map((item) => ({ ...item, seconds: Math.round(item.seconds) })),
    },
    switches,
    blocks: blocks.slice(-40).map((block) => ({ ...block, startedAt: new Date(block.startedAt).toISOString(), endedAt: new Date(block.endedAt).toISOString(), seconds: Math.round(block.seconds) })),
    current: last,
    asOf: new Date(now).toISOString(),
  };
}
