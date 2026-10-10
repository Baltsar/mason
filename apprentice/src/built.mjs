import path from "node:path";
import { fingerprint } from "./redact.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// What Mason can teach its owner about their own work. Someone who builds by
// talking to agents often can no longer say what the thing does, what it is
// made of, or why it was done that way. The aim is one thing: that they can
// explain their own project to someone else a month from now.
//
// A list of files does not do that. Three things are what stays: what it does,
// said as to a friend; its two or three parts, each with a likeness from
// everyday life; and why it was built that way, in the owner's own reasons.
// And it stays by being asked, not by being read: the question first, the
// answer a press away, and then "knew it" or "did not". What was not known
// comes back the next day; what was known comes back after longer and longer.

const file = () => path.join(paths.data, "built.json");
// How long until a card comes back, by how many times in a row it was known.
const BACK_AFTER_DAYS = [3, 7, 21, 60];
const NOT_KNOWN_DAYS = 1;
const DAY_MS = 86_400_000;

// The questions one project gives, each with the answer that is remembered,
// and, behind a press of its own, where in the code it lives.
// A project nothing was summarised for gives none.
export function cardsOf(project, memory) {
  if (!memory || memory.source !== "model") return [];
  const cards = [];
  const add = (question, lines, where = []) => {
    const answer = lines.filter(Boolean);
    if (answer.length) cards.push({ id: fingerprint(`${project}\n${question}`), question, answer, where: where.filter(Boolean) });
  };
  const parts = (memory.parts || []).filter((part) => part?.name && part?.does);
  add(`What does ${project} do? Say it as to a friend.`, [memory.plainly || memory.one_line]);
  // A memory written before parts had a likeness still has its parts by file.
  if (parts.length) add(`What is ${project} made of?`, parts.map((part) => `${part.name}${part.like ? `, ${part.like}` : ""}: ${part.does}`), parts.map((part) => part.where && `${part.name}: ${part.where}`));
  else add(`What is ${project} made of?`, memory.how || []);
  add(`Why is ${project} built the way it is?`, memory.decided || []);
  add(`Where did you leave ${project}?`, [memory.left_off, ...(memory.open || []).map((line) => `Open: ${line}`)]);
  return cards;
}

// Every project of the last three weeks with something to ask about that is
// due, the one not touched for the longest first: that is the one being
// forgotten. `days` is the ledger of the long view; `memories` what is
// remembered of each project; `asked` when each card is due again.
export function builtOf({ days = {}, memories = {}, today, asked = {}, now = Date.now() } = {}) {
  const last = new Map();
  for (const day of Object.keys(days).filter((key) => key <= today).sort().slice(-21)) {
    for (const name of Object.keys(days[day])) last.set(name, day);
  }
  return [...last]
    .map(([project, lastDay]) => ({ project, lastDay, about: memories[project]?.one_line || "", cards: cardsOf(project, memories[project]).filter((card) => !(asked[card.id]?.due > now)) }))
    .filter((item) => item.cards.length)
    .sort((a, b) => a.lastDay.localeCompare(b.lastDay) || a.project.localeCompare(b.project));
}

// When each card is due again.
export const askedBefore = async () => (await readJson(file(), {})).asked || {};

// "Knew it" or "did not", for one card. Known, it comes back after longer each
// time; not known, tomorrow, and the count starts again.
export async function answerCard(id, knew, now = Date.now()) {
  if (!/^[a-f0-9]{16}$/.test(String(id))) return false;
  const kept = { asked: {}, ...(await readJson(file(), {})) };
  const step = knew ? Math.min((kept.asked[id]?.step ?? -1) + 1, BACK_AFTER_DAYS.length - 1) : -1;
  kept.asked[id] = { step, due: now + (knew ? BACK_AFTER_DAYS[step] : NOT_KNOWN_DAYS) * DAY_MS, at: new Date(now).toISOString() };
  await atomicJson(file(), kept);
  return true;
}

// When the next card comes back, for the day there is nothing to ask.
export const nextDue = (asked, now = Date.now()) => Math.min(...Object.values(asked).map((card) => card.due).filter((due) => due > now), Infinity);
