import path from "node:path";
import { dayStart } from "./activity.mjs";
import { buildFlow } from "./flow.mjs";
import { projectIndex } from "./projects.mjs";
import { settings } from "./settings.mjs";
import { atomicJson, paths, readEvents, readJson } from "./store.mjs";

// The long view: for every day, the projects that were worked on and for how
// long. It is built from the agents' logs, which reach back to the first day
// of a project, and kept in a file of its own: those logs are cleared after a
// while, and the days should not go with them.

const VERSION = 1;
const file = () => path.join(paths.data, "days.json");
// An agent that ran by itself for a few minutes is not a day's work.
const WORTH_MINUTES = 10;

// The day a moment belongs to. Mason's day turns over at 04:00.
export function dayKey(at) {
  const day = new Date(dayStart(at));
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}

// Day → project → minutes an agent session was alive, and things said to it.
export function daysOf(projects, since = 0) {
  const days = {};
  const entry = (at, name) => ((days[dayKey(at)] ||= {})[name] ||= { minutes: 0, prompts: 0 });
  for (const project of projects) {
    for (const minute of project.minutes) if (minute * 60_000 >= since) entry(minute * 60_000, project.name).minutes += 1;
    for (const prompt of project.prompts) if (prompt.at >= since) entry(prompt.at, project.name).prompts += 1;
  }
  for (const [day, worked] of Object.entries(days)) {
    for (const [name, work] of Object.entries(worked)) if (!work.prompts && work.minutes < WORTH_MINUTES) delete worked[name];
    if (!Object.keys(worked).length) delete days[day];
  }
  return days;
}

// How each day moved, for the days Mason was watching: time in front and jumps.
export function movesOf(events, since = 0) {
  const byDay = new Map();
  for (const event of events) {
    if (event.type !== "activity" && event.type !== "private") continue;
    const at = Date.parse(event.startedAt || event.at);
    if (!(at >= since)) continue;
    const day = dayKey(at);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(event);
  }
  const moves = {};
  for (const [day, ofDay] of byDay) {
    const flow = buildFlow(ofDay);
    if (flow.totalSeconds >= 60) moves[day] = { seconds: flow.totalSeconds, jumps: flow.jumps, tools: flow.tools.filter((tool) => tool.visits).length };
  }
  return moves;
}

let ledger = null;
let refreshing = null;

export async function loadDays() {
  if (ledger) return ledger;
  const stored = await readJson(file(), {});
  ledger = stored.version === VERSION ? { days: {}, moves: {}, ...stored } : { version: VERSION, through: 0, days: {}, moves: {} };
  return ledger;
}

// Brings the days up to now. The first time every log is read, which takes a
// few seconds; after that only what was written since the day before.
export function refreshDays(now = Date.now()) {
  refreshing ||= (async () => {
    const known = await loadDays();
    // With the agents' logs switched off, the days already kept stay as they are.
    if (!settings().logs) return known;
    const since = known.through ? dayStart(dayStart(known.through) - 1) : 0;
    const index = await projectIndex(since, { maxAgeMs: 60_000 });
    const from = since ? dayKey(since) : "";
    for (const part of [known.days, known.moves]) for (const day of Object.keys(part)) if (since && day >= from) delete part[day];
    Object.assign(known.days, daysOf(index.list, since));
    Object.assign(known.moves, movesOf(await readEvents(Infinity), since));
    known.through = now;
    await atomicJson(file(), known);
    return known;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

// What the calendar is drawn from.
export async function daysPayload(now = Date.now()) {
  const known = await loadDays();
  return { today: dayKey(now), through: known.through, days: known.days, moves: known.moves };
}
