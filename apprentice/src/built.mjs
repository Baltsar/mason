import path from "node:path";
import { quizOf } from "./quiz.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// What Mason can teach its owner about their own work. Someone who builds by
// talking to agents often can no longer say what the thing does, what it is
// made of, or where it runs. The aim is one thing: that they can explain
// their own project to someone else a month from now.
//
// It stays by being asked, not by being read: a question with answers to
// choose between (quiz.mjs), right or wrong said at once, and the reason in a
// line. What was got wrong comes back the next day; what was got right comes
// back after longer and longer.

const file = () => path.join(paths.data, "built.json");
// How long until a question comes back, by how many times in a row it was got right.
const BACK_AFTER_DAYS = [3, 7, 21, 60];
const NOT_KNOWN_DAYS = 1;
const DAY_MS = 86_400_000;

// Every project of the last three weeks with something to ask about that is
// due, the one not touched for the longest first: that is the one being
// forgotten. `days` is the ledger of the long view; `memories` what is
// remembered of each project; `asked` when each question is due again.
export function builtOf({ days = {}, memories = {}, today, asked = {}, now = Date.now() } = {}) {
  const last = new Map();
  for (const day of Object.keys(days).filter((key) => key <= today).sort().slice(-21)) {
    for (const name of Object.keys(days[day])) last.set(name, day);
  }
  return [...last]
    .map(([project, lastDay]) => ({ project, lastDay, about: memories[project]?.one_line || "", questions: quizOf(project, memories[project], memories, today).filter((question) => !(asked[question.id]?.due > now)) }))
    .filter((item) => item.questions.length)
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
