import { mkdir } from "node:fs/promises";
import path from "node:path";
import { atomicJson, paths, readJson } from "./store.mjs";
import { fingerprint } from "./redact.mjs";
import { projectHistory, projectReports, projectWork } from "./projects.mjs";
import { askModel } from "./llm.mjs";

// What a project is about, how it is put together, where it was left, and what
// its owner keeps telling the agents. Nothing is asked for: it is read out of
// the prompts already given to the coding agents and the files those agents
// wrote, going back three weeks.

const DAYS = 21;
const MAX_PROMPTS = 70;
// Raised when the shape of a memory changes, so saved ones are written again.
const VERSION = 4;
const words = (text, count) => String(text ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, count).join(" ").replace(/[.,;:]+$/, "");
// A silence this long between two prompts is a new visit to the project.
const VISIT_GAP_MS = 6 * 3_600_000;
const JUST_ARRIVED_MS = 30 * 60_000;
const memoryDir = () => path.join(paths.data, "memory");
const fileFor = (name) => path.join(memoryDir(), `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project"}.json`);
const short = (text, max) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};
const day = (at) => new Date(at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const stamp = (at) => `${new Date(at).toISOString().slice(0, 10)} ${new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

const SYSTEM = `You help one person remember their own work. They build by talking to coding agents, so they often no longer know how the thing is put together. You are given the prompts they wrote or dictated in one project (often Swedish, unpolished), the list of files the agents changed, and what the agents reported back when they were done.

Write a faithful memory of the project. Use only what those three say. If something is not in them, leave it out. Never guess at results the prompts do not mention.

Reply with JSON only, no code fence, in exactly this shape:
{
  "headline": "where they left off, at most 6 words, no full stop",
  "one_line": "what this project is, at most 12 words",
  "how": ["at most 4 statements of how it is put together: a main part and what it does, each naming a real file or folder from the list, at most 16 words each"],
  "built": ["at most 3 short statements of what was built or changed, newest first"],
  "left_off": "where they stopped the last time they worked on it, one sentence",
  "open": ["at most 3 things that were still unfinished or unanswered when they stopped"],
  "keeps_saying": [{"rule": "rule in their voice, at most 6 words", "times": 2, "example": "verbatim quote"}],
  "spoken": "a recap of 45 to 60 words to be read aloud, addressed to them as you, starting with: Last time in <project name>"
}

Rules for keeps_saying: only a demand or correction they gave the agent on at least two separate occasions. Phrase it as a rule of at most 6 words in their own voice. "example" must be copied word for word from one prompt, at most 12 words. If nothing repeats, return an empty list. At most 3 items.

Rules for how: describe the parts someone would need to know to explain how this was built. Take what a part does from the agents' reports; a file name alone is not enough to say what a file does. Name the file or folder. Name a framework or service only when a report, a prompt or a file name shows it. If no files are listed, return an empty list.

Write in English. Keep quotes in their original language.`;

const building = new Map();

// The memory in the person's own words alone, for when no model has answered yet.
function fromOwnWords(name, prompts) {
  const last = prompts.at(-1);
  return {
    headline: last ? words(last.text, 6) : null,
    one_line: null,
    how: [],
    built: prompts.slice(-3).reverse().map((prompt) => short(prompt.text, 110)),
    left_off: last ? `You said: “${short(last.text, 180)}”` : null,
    open: [],
    keeps_saying: [],
    spoken: last ? `Last time in ${name}, on ${day(last.at)}, you said: ${short(last.text, 260)}` : null,
    source: "own-words",
  };
}

async function digest(name, prompts, work, reports) {
  const lines = prompts.slice(-MAX_PROMPTS).map((prompt) => `[${stamp(prompt.at)}] ${short(prompt.text, 420)}`);
  const files = work.slice(0, 40).map((item) => `${item.file} (${item.edits})`);
  const reply = await askModel(SYSTEM, `Project: ${name}\nToday is ${stamp(Date.now())}.\n\nPrompts, oldest first:\n${lines.join("\n")}\n\nFiles the agents changed, most changed first, with the number of changes:\n${files.join("\n") || "(none recorded)"}\n\nWhat the agents reported back, oldest first:\n${reports.map((report) => `[${stamp(report.at)}] ${short(report.text, 600)}`).join("\n") || "(nothing recorded)"}`);
  if (!reply || typeof reply.left_off !== "string") return null;
  const said = prompts.map((prompt) => prompt.text.toLowerCase().replace(/\s+/g, " "));
  const list = (value, max) => (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim()).slice(0, max).map((item) => short(item, 200));
  return {
    headline: words(reply.headline || reply.left_off, 7),
    one_line: short(reply.one_line, 120) || null,
    // A part only counts when it names something the agents really changed.
    how: list(reply.how, 6).filter((line) => work.some((item) => item.file.split("/").some((piece) => piece.length > 3 && line.includes(piece)))).slice(0, 4),
    built: list(reply.built, 3),
    left_off: short(reply.left_off, 260),
    open: list(reply.open, 3),
    // A rule only counts when its example really is something they said.
    keeps_saying: (Array.isArray(reply.keeps_saying) ? reply.keeps_saying : [])
      .filter((item) => item && typeof item.rule === "string" && typeof item.example === "string" && Number(item.times) >= 2)
      .filter((item) => said.some((text) => text.includes(item.example.toLowerCase().replace(/\s+/g, " ").replace(/^["“]|["”.…]+$/g, "").slice(0, 40))))
      .slice(0, 3)
      .map((item) => ({ rule: words(item.rule, 8), times: Math.round(Number(item.times)), example: short(item.example, 120) })),
    spoken: short(reply.spoken, 600) || null,
    source: "model",
  };
}

// The memory of one project. Answers at once with what it has; a newer one is
// written in the background when the project has been spoken to since.
export async function projectMemory(project, { wait = false } = {}) {
  const since = Date.now() - DAYS * 86_400_000;
  const [all, work, reports] = await Promise.all([projectHistory(project.folder, since), projectWork(project.folder, since), projectReports(project.folder, since)]);
  // Where the current visit began: the first prompt after the last long silence.
  let visit = all.length - 1;
  while (visit > 0 && all[visit].at - all[visit - 1].at < VISIT_GAP_MS) visit -= 1;
  const justArrived = visit > 0 && Date.now() - all[visit].at < JUST_ARRIVED_MS;
  // Someone who has just come back wants to hear where they left off last
  // time, not a summary of the sentence they wrote a minute ago.
  const prompts = justArrived ? all.slice(0, visit) : all;
  const last = prompts.at(-1);
  const saved = await readJson(fileFor(project.name), null);
  const facts = {
    project: project.name,
    prompts: all.length,
    days: new Set(all.map((prompt) => new Date(prompt.at).toDateString())).size,
    firstAt: all[0] ? new Date(all[0].at).toISOString() : null,
    // The files behind "how it is built": the evidence, most changed first.
    parts: work.slice(0, 5),
    filesChanged: work.length,
    lastAt: last ? new Date(last.at).toISOString() : null,
    justArrived,
  };
  if (!last) return { ...facts, ...fromOwnWords(project.name, prompts), building: false };
  const fresh = saved?.basedOn === last.at && saved?.version === VERSION;
  // A project in full swing is not summarised after every single prompt.
  const recentlyBuilt = saved?.version === VERSION && saved?.generatedAt && Date.now() - Date.parse(saved.generatedAt) < 10 * 60_000;
  if (!fresh && !recentlyBuilt && !building.has(project.name)) {
    const job = digest(project.name, prompts, work, reports).then(async (result) => {
      if (!result) return null;
      await mkdir(memoryDir(), { recursive: true });
      const value = { ...result, version: VERSION, basedOn: last.at, generatedAt: new Date().toISOString() };
      await atomicJson(fileFor(project.name), value);
      return value;
    }).catch(() => null).finally(() => building.delete(project.name));
    building.set(project.name, job);
  }
  const pending = building.get(project.name);
  const built = wait && pending ? await pending : null;
  const best = built || saved || fromOwnWords(project.name, prompts);
  return { ...facts, ...best, building: Boolean(building.get(project.name)) };
}

// What they keep telling the agents becomes a guardrail without being asked
// for. It is marked as inferred until a debrief confirms it.
export function mergeInferred(map, memory) {
  const wanted = memory.keeps_saying || [];
  const mine = (item) => item.source?.type === "inferred" && item.source.project === memory.project;
  const before = map.decisions.filter(mine).map((item) => item.id).join("|");
  const next = wanted.map((item) => ({
    id: `inferred-${fingerprint(`${memory.project}:${item.example}`)}`,
    kind: "guardrail",
    title: item.rule,
    body: `You told the agents this ${item.times} times in ${memory.project}. Nobody asked; it was read from your prompts.`,
    quote: item.example,
    moment: { at: memory.lastAt, app: "Claude Code", window: memory.project, evidence: item.example },
    source: { label: `Inferred · ${memory.project} · said ${item.times} times`, type: "inferred", project: memory.project, at: new Date().toISOString() },
  }));
  if (next.map((item) => item.id).join("|") === before) return false;
  map.decisions = [...next, ...map.decisions.filter((item) => !mine(item))];
  return true;
}
