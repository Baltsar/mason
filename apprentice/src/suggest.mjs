import { constants } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { askModel } from "./llm.mjs";
import { fingerprint } from "./redact.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// What is said to the agents again and again, in one project after another, is
// a rule that was never written down where the agents read it. Mason finds it
// in what it remembers of the projects and, once it has been said often enough,
// proposes to write it there: one line, shown with the words it rests on, and
// only when its owner presses. A line can be taken out again. Nothing here is
// praise and nothing is done by itself.

// The file every Claude Code agent on this Mac reads. A test or a rehearsal
// points this somewhere else.
export const rulesFile = () => process.env.APPRENTICE_RULES_FILE || path.join(os.homedir(), ".claude", "CLAUDE.md");
const file = () => path.join(paths.data, "suggestions.json");
const HEADING = "## Learned by Mason";
// The rules are habits, not laws: what is asked for in a prompt comes first.
const NOTE = "Things I told my agents again and again, in several projects. Mason added each one when I said so. They are defaults: when a prompt asks for something else, the prompt wins.";
// Said in at least this many projects, and this many times in all, before it is proposed.
const ENOUGH_PROJECTS = 2;
const ENOUGH_TIMES = 4;
// The rules are looked over again at most this often.
const LOOK_AGAIN_MS = 6 * 3_600_000;

const SYSTEM = `You are given rules one person repeated to coding agents. Each line is one rule from one project, numbered, with the project in brackets and a quote of how it was said. Some lines say the same thing in different words.

Group the lines that make the same demand. Return only groups that hold lines from at least two different projects. For each group write the rule once, as an instruction to an agent, in plain English, at most 22 words.

Write it as a default, not a law. If the quotes carry a condition ("when it is complicated", "for the first version"), keep the condition. Never make the rule stricter or wider than what was said. No praise, no emphasis, no capitals for effect.

Reply with JSON only, no code fence: {"groups": [{"rule": "...", "members": [1, 4, 7]}]}
If nothing repeats across projects, reply {"groups": []}.`;

// A rule that takes away the question before something is published, sent,
// deleted or paid for is never proposed for every project. Said in one place
// it was about that place, and the day after it can be "do not push".
export const ACTS_OUTWARD = /\b(publish|deploy|push|merge|release|ship|send|upload|github|delete|remove|pay|publicera|pusha|deploya|depkoya|skicka|ladda\s+upp|radera|betala|mergea)\w*/i;

const DEMANDS = `You are given things one person said to coding agents again and again, in several projects. Each numbered group holds a few of the ways one thing was said, in the person's own words, often in Swedish.

Say for every group which kind it is:
- "habit": a way of working the person wants from an agent whatever the job is. It would make sense to follow it during every job in every project. ("Show me the diff before you change files." "Answer in a few lines.")
- "job": a piece of work with an end, asked for now and then: an analysis, a review, a summary, a post, a new page. It is a job however often it was asked for, because nobody wants it done during every other job. ("Go through the page for search engines." "Write a post about what we built.")
- "answer": a reply to something the agent asked or offered. ("Yes, do that." "Go with what you recommend.")
- "other": a question, a complaint, or a subject that keeps coming up.

Only for a "habit", write the rule: what the agent should do without being asked, as an instruction to an agent, in plain English, at most 22 words. Say when it applies if what was said tells you. Never write "when asked". Write it as a default, not a law. Never make it stricter or wider than what was said. No praise, no emphasis, no capitals for effect.

Reply with JSON only, no code fence, one entry for every group: {"groups": [{"group": 1, "kind": "habit", "rule": "..."}, {"group": 2, "kind": "job"}]}`;

const clean = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// Every rule that is remembered, with the project it was said in.
export function rulesOf(memories) {
  const rules = [];
  for (const [project, memory] of Object.entries(memories)) {
    for (const item of memory?.keeps_saying || []) {
      if (item?.rule && item?.example) rules.push({ project, rule: clean(item.rule, 120), example: clean(item.example, 160), times: Math.max(2, Math.round(Number(item.times) || 2)) });
    }
  }
  return rules;
}

// The same demand said in several projects, as one proposal each. The model
// only says which lines belong together and how to word them; what a proposal
// rests on is taken from the lines themselves, never from the reply.
export async function groupRules(rules) {
  if (new Set(rules.map((rule) => rule.project)).size < ENOUGH_PROJECTS) return [];
  const lines = rules.map((rule, index) => `${index + 1}. [${rule.project}] ${rule.rule} — "${rule.example}" (said ${rule.times} times)`);
  const reply = await askModel(SYSTEM, lines.join("\n"), { purpose: "proposals" });
  // No answer from a model is not the same as nothing to propose.
  if (!Array.isArray(reply?.groups)) return null;
  const proposals = [];
  for (const group of reply.groups) {
    const members = [...new Set((Array.isArray(group?.members) ? group.members : []).map((number) => Math.round(Number(number)) - 1))].filter((index) => rules[index]);
    const evidence = members.map((index) => rules[index]);
    const rule = clean(group?.rule, 220);
    const projects = new Set(evidence.map((item) => item.project)).size;
    const times = evidence.reduce((sum, item) => sum + item.times, 0);
    if (rule.length < 8 || projects < ENOUGH_PROJECTS || times < ENOUGH_TIMES) continue;
    if (ACTS_OUTWARD.test(rule) || evidence.some((item) => ACTS_OUTWARD.test(item.rule) || ACTS_OUTWARD.test(item.example))) continue;
    proposals.push({ id: fingerprint(evidence.map((item) => item.example).sort().join("\n")).slice(0, 16), rule, projects, times, evidence });
  }
  return proposals.sort((a, b) => b.projects - a.projects || b.times - a.times);
}

// The same demand, found in the prompts themselves: `repeated` are the groups
// of prompts that mean the same, said on several days in several projects
// (see said.mjs, where no model that writes is involved). Here a model says
// only which groups are a way of working, and words each of those as a rule.
// A job asked for now and then is not one: "go through the page for search
// engines" in every agent's rules would be done during every other job.
// Without a model there is no telling a habit from a "yes, do that", so
// nothing is proposed and the groups stay where they are shown as they were said.
export async function wordDemands(repeated) {
  const demands = repeated.filter((demand) => !demand.ways.some((way) => ACTS_OUTWARD.test(way.text)));
  if (!demands.length) return [];
  const lines = demands.map((demand, index) => `${index + 1}. Said ${demand.times} times in ${demand.projects.length} projects:\n${demand.ways.slice(0, 5).map((way) => `   "${clean(way.text, 200)}"`).join("\n")}`);
  const reply = await askModel(DEMANDS, lines.join("\n"), { purpose: "proposals" });
  if (!Array.isArray(reply?.groups)) return null;
  const proposals = new Map();
  for (const item of reply.groups) {
    const demand = demands[Math.round(Number(item?.group)) - 1];
    const rule = clean(item?.rule, 220);
    if (!demand || item?.kind !== "habit" || proposals.has(demand.id) || rule.length < 8 || ACTS_OUTWARD.test(rule)) continue;
    // What it rests on is the words that were said, never the reply.
    const evidence = demand.ways.map((way) => ({ project: way.project, rule: clean(way.text, 120), example: clean(way.text, 160), times: way.times }));
    proposals.set(demand.id, { id: demand.id, rule, projects: demand.projects.length, times: demand.times, evidence });
  }
  return [...proposals.values()];
}

let kept = null;
async function load() {
  kept ||= { checkedAt: 0, basis: "", open: [], applied: [], settled: [], ...(await readJson(file(), {})) };
  return kept;
}

// A proposal that was answered once, with yes or with no, is not made again:
// not when most of what it rests on has been seen before.
const settledBefore = (proposal, store) => {
  const seen = new Set(store.settled);
  return proposal.evidence.filter((item) => seen.has(fingerprint(item.example))).length * 2 >= proposal.evidence.length;
};

// Looks over the rules again when they have changed, at most a few times a day.
// `memories` is what is remembered of each project, by its name. `repeated`
// are the demands found in the prompts themselves, when those are read by
// their meaning; `soon` looks now and does not wait for the next time.
export async function refreshSuggestions(memories, now = Date.now(), { repeated = [], soon = false } = {}) {
  const store = await load();
  const rules = rulesOf(memories);
  const remembered = fingerprint(JSON.stringify(rules.map((rule) => [rule.project, rule.example])));
  const basis = repeated.length ? fingerprint(`${remembered}\n${repeated.map((demand) => demand.id).join("\n")}`) : remembered;
  if (basis === store.basis || (!soon && now - store.checkedAt < LOOK_AGAIN_MS)) return false;
  const [grouped, worded] = await Promise.all([groupRules(rules), wordDemands(repeated)]);
  store.checkedAt = now;
  // Without an answer the same rules are looked over again later.
  const proposals = grouped && worded ? [...grouped, ...worded].sort((a, b) => b.projects - a.projects || b.times - a.times) : null;
  if (proposals) {
    store.basis = basis;
    store.open = proposals.filter((proposal) => !settledBefore(proposal, store));
  }
  await atomicJson(file(), store);
  return Boolean(proposals);
}

function settle(store, proposal) {
  store.settled = [...new Set([...store.settled, ...proposal.evidence.map((item) => fingerprint(item.example))])];
  store.open = store.open.filter((item) => item.id !== proposal.id);
}

// The text of the rules file with a line added under Mason's own heading,
// everything else left exactly as it was.
function withLine(text, line) {
  const at = text.indexOf(HEADING);
  if (at < 0) return `${text.replace(/\s*$/, "")}${text.trim() ? "\n\n" : ""}${HEADING}\n\n${NOTE}\n\n${line}\n`;
  const next = text.indexOf("\n## ", at + HEADING.length);
  const end = next < 0 ? text.length : next;
  return `${text.slice(0, end).replace(/\s*$/, "")}\n${line}\n${next < 0 ? "" : `\n${text.slice(next + 1)}`}`;
}

// The same text with one of Mason's lines taken out, and its heading too when
// that was the last one.
function withoutLine(text, line) {
  const at = text.indexOf(HEADING);
  if (at < 0) return text;
  const next = text.indexOf("\n## ", at + HEADING.length);
  const end = next < 0 ? text.length : next + 1;
  const rows = text.slice(at, end).split("\n");
  const index = rows.indexOf(line);
  if (index < 0) return text;
  rows.splice(index, 1);
  const before = text.slice(0, at);
  const after = text.slice(end);
  if (!rows.some((row) => row.startsWith("- "))) return `${before.replace(/\s*$/, "")}${after ? `\n\n${after}` : "\n"}`.replace(/^\n+/, "");
  return `${before}${rows.join("\n")}${after}`;
}

async function writeRules(change) {
  const target = rulesFile();
  let text = "";
  try { text = await readFile(target, "utf8"); } catch {}
  // The file as it was before Mason first touched it is kept beside the memory.
  if (text) await copyFile(target, path.join(paths.data, "rules-before-mason.md"), constants.COPYFILE_EXCL).catch(() => {});
  const next = change(text);
  if (next === text) return;
  await mkdir(path.dirname(target), { recursive: true });
  const draft = `${target}.${process.pid}.tmp`;
  await writeFile(draft, next);
  await rename(draft, target);
}

// Yes: the rule is written where every agent reads it, in the proposed words
// or in the owner's own when they were changed first.
export async function applySuggestion(id, wording = "") {
  const store = await load();
  const proposal = store.open.find((item) => item.id === id);
  if (!proposal) return false;
  const rule = clean(wording, 220).replace(/^-\s*/, "") || proposal.rule;
  const line = `- ${rule}`;
  await writeRules((text) => text.split("\n").includes(line) ? text : withLine(text, line));
  store.applied.push({ id: proposal.id, rule, line, at: new Date().toISOString() });
  settle(store, proposal);
  await atomicJson(file(), store);
  return true;
}

// No: it is not proposed again.
export async function dismissSuggestion(id) {
  const store = await load();
  const proposal = store.open.find((item) => item.id === id);
  if (!proposal) return false;
  settle(store, proposal);
  await atomicJson(file(), store);
  return true;
}

// A rule that was added is taken out of the file again.
export async function removeRule(id) {
  const store = await load();
  const rule = store.applied.find((item) => item.id === id);
  if (!rule) return false;
  await writeRules((text) => withoutLine(text, rule.line));
  store.applied = store.applied.filter((item) => item.id !== id);
  await atomicJson(file(), store);
  return true;
}

// What the window shows: what is proposed, and what was added.
export async function suggestionsPayload() {
  const store = await load();
  const shown = rulesFile().replace(os.homedir(), "~");
  return { open: store.open.map((proposal) => ({ ...proposal, file: shown })), applied: store.applied.map(({ id, rule, at }) => ({ id, rule, at })) };
}
