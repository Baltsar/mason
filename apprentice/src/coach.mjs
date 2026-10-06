import { percentages } from "./activity.mjs";
import { NOT_A_TOOL, toolOf } from "./flow.mjs";

// Knowing where a day went does not change it. For that the day has to be held
// up against what it was meant to be for. So there is one aim a day, a project,
// picked with one press from what was left open, and the day is measured
// against it: how much went to it, how often it was left and for what, and how
// long finished answers from the agents were left waiting.

// Under five seconds somewhere else is a glance, not leaving.
const GLANCE_SECONDS = 5;
// A longer gap than this is a break: what comes after it was not left for.
const BREAK_MS = 15 * 60_000;
// Where an agent's answer is read. With one of these in front, nothing waits.
const AGENT_SURFACE = /^(claude|cursor|terminal|iterm2?|warp|ghostty|visual studio code|code|windsurf|zed)$/i;
// An answer has to be left for this long before it counts as waiting.
const WAITING_MS = 30_000;
// An answer older than this is no longer something to hurry back to.
const STALE_MS = 3 * 3_600_000;
// Less of a day than this says nothing worth a sentence.
const WORTH_A_SENTENCE_SECONDS = 30 * 60;

export const readsAnswers = (tool) => AGENT_SURFACE.test(String(tool || "").trim());

// What was in front, in order, with the project each moment belonged to.
function spansOf(events, projectOf) {
  const spans = [];
  for (const event of events) {
    if (event.type !== "activity" && event.type !== "private") continue;
    const seconds = Math.min(Number(event.durationSec) || 0, 3600);
    const start = Date.parse(event.startedAt || event.at);
    const tool = toolOf(event);
    if (!(seconds > 0) || !Number.isFinite(start) || !tool || NOT_A_TOOL.test(tool)) continue;
    const named = event.type === "private";
    spans.push({ start, end: start + seconds * 1000, seconds, tool, project: named ? null : projectOf(event) || null, group: named ? "chat" : event.group || "other" });
  }
  return spans.sort((a, b) => a.start - b.start);
}

const ranked = (seconds) => Object.entries(seconds).sort((a, b) => b[1] - a[1]).map(([tool, value]) => ({ tool, seconds: Math.round(value) }));

// Active time somewhere else while a finished answer was waiting. Two answers
// waiting at once count once. `turns` come from the agents' logs.
function waitedOf(spans, turns, from, now) {
  const stretches = [];
  let answers = 0;
  for (const turn of turns.filter((item) => item.ended && item.done >= from).sort((a, b) => a.done - b.done)) {
    const back = spans.find((span) => readsAnswers(span.tool) && span.end > turn.done);
    const until = Math.min(back ? Math.max(back.start, turn.done) : now, turn.next ?? now, now);
    if (until - turn.done <= WAITING_MS) continue;
    answers += 1;
    const last = stretches.at(-1);
    if (last && turn.done <= last[1]) last[1] = Math.max(last[1], until);
    else stretches.push([turn.done, until]);
  }
  const where = {};
  for (const [start, end] of stretches) {
    for (const span of spans) {
      if (span.end <= start || span.start >= end || readsAnswers(span.tool)) continue;
      where[span.tool] = (where[span.tool] || 0) + (Math.min(span.end, end) - Math.max(span.start, start)) / 1000;
    }
  }
  const list = ranked(where);
  return { seconds: list.reduce((sum, item) => sum + item.seconds, 0), answers, where: list.slice(0, 6) };
}

// The answers that are finished right now and have not been looked at since.
function readyOf(spans, turns, now) {
  return turns
    .filter((turn) => turn.ended && turn.next === null && now - turn.done < STALE_MS)
    .filter((turn) => !spans.some((span) => readsAnswers(span.tool) && span.end > turn.done))
    .sort((a, b) => a.done - b.done)
    .map((turn) => ({ project: turn.project, since: new Date(turn.done).toISOString() }));
}

// A day against its aim. `aim` is { project, text } or nothing; `projectOf`
// says which project a moment on screen belonged to.
export function measureDay(events, { aim = null, projectOf = (event) => event.project || null, turns = [], now = Date.now() } = {}) {
  const spans = spansOf(events, projectOf);
  const on = (span) => Boolean(aim) && span.project === aim.project;
  const totalSeconds = spans.reduce((sum, span) => sum + span.seconds, 0);
  const elsewhere = {};
  const projects = new Set();
  let onSeconds = 0;
  let socialSeconds = 0;
  for (const span of spans) {
    if (span.project) projects.add(span.project);
    if (on(span)) onSeconds += span.seconds;
    else {
      if (span.group === "social") socialSeconds += span.seconds;
      elsewhere[span.tool] = (elsewhere[span.tool] || 0) + span.seconds;
    }
  }
  const [onPercent, socialPercent, elsewherePercent] = percentages([onSeconds, socialSeconds, totalSeconds - onSeconds - socialSeconds]);

  // Stretches on the aim and away from it. A glance away does not end one.
  const runs = [];
  for (const span of spans) {
    const last = runs.at(-1);
    const state = on(span);
    if (!state && span.seconds < GLANCE_SECONDS && last?.on) continue;
    if (last && last.on === state && span.start - last.end < BREAK_MS) {
      last.end = Math.max(last.end, span.end);
      last.seconds += span.seconds;
    } else {
      // What a stretch away began with is what the aim was left for: another
      // project by its name, anything else by its tool.
      runs.push({ on: state, start: span.start, end: span.end, seconds: span.seconds, first: span.project || span.tool, left: Boolean(last?.on) && !state && span.start - last.end < BREAK_MS });
    }
  }
  const leaves = runs.filter((run) => run.left);
  const to = {};
  for (const run of leaves) to[run.first] = (to[run.first] || 0) + 1;
  const longest = runs.filter((run) => run.on).sort((a, b) => b.seconds - a.seconds)[0] || null;
  const first = spans.find(on) || null;
  const lastOn = spans.findLast(on) || null;
  // How long it has been, in active time, since the aim was last in front.
  const since = lastOn ? spans.filter((span) => span.start >= lastOn.end) : spans;

  const from = spans[0]?.start ?? now;
  return {
    totalSeconds: Math.round(totalSeconds),
    aim: aim ? { project: aim.project, text: aim.text || "" } : null,
    onSeconds: Math.round(onSeconds),
    socialSeconds: Math.round(socialSeconds),
    onPercent,
    socialPercent,
    elsewherePercent,
    projects: projects.size,
    away: { count: leaves.length, to: Object.entries(to).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })).slice(0, 6) },
    elsewhere: ranked(elsewhere).slice(0, 6),
    longestOn: longest ? { seconds: Math.round(longest.seconds), startedAt: new Date(longest.start).toISOString() } : null,
    startedOnAt: first ? new Date(first.start).toISOString() : null,
    awayNowSeconds: aim ? Math.round(since.reduce((sum, span) => sum + span.seconds, 0)) : 0,
    waited: waitedOf(spans, turns, from, now),
    ready: readyOf(spans, turns, now),
  };
}

// What today could be about: the projects worked on most over the last three
// days that had any work, each with the first thing that was left open in it.
// `days` is the ledger of the long view; `memories` what is remembered of each
// project. Nothing has to be typed: one of them is pressed.
export function proposeAims({ days = {}, memories = {}, today, limit = 3 } = {}) {
  const minutes = new Map();
  for (const day of Object.keys(days).filter((key) => key <= today).sort().slice(-3)) {
    for (const [name, work] of Object.entries(days[day])) minutes.set(name, (minutes.get(name) || 0) + work.minutes);
  }
  // What is already being worked on today comes before what was worked on most.
  const begun = (name) => days[today]?.[name]?.minutes || 0;
  return [...minutes].sort((a, b) => begun(b[0]) - begun(a[0]) || b[1] - a[1]).slice(0, limit).map(([project]) => {
    const memory = memories[project];
    return { project, text: memory?.open?.[0] || memory?.left_off || "", headline: memory?.headline || "" };
  });
}

const minutesOf = (seconds) => Math.max(1, Math.round(seconds / 60));

// The one thing worth saying about a day: the first of these that is true, and
// nothing at all when none is. A sentence that only repeats the figure above
// it, or praises an ordinary day, is not said.
// `tone` is "off" for something to change, "on" for something that went well.
export function sentenceOf(measure) {
  if (!measure || measure.totalSeconds < WORTH_A_SENTENCE_SECONDS) return null;
  const { aim, waited, away } = measure;
  if (aim && measure.onSeconds === 0) return { tone: "off", text: `${aim.project} was today's aim. It never came up.` };
  if (aim && measure.onPercent < 25 && measure.totalSeconds >= 2 * 3600) return { tone: "off", text: `${aim.project} was today's aim. It got ${measure.onPercent}% of the day.` };
  if (waited.seconds >= 20 * 60) return { tone: "off", text: `Finished answers waited ${minutesOf(waited.seconds)} minutes for you${waited.where[0] ? `, mostly while you were in ${waited.where[0].tool}` : ""}.` };
  if (aim && away.count >= 15) return { tone: "off", text: `You left ${aim.project} ${away.count} times${away.to[0] ? `, most often for ${away.to[0].name}` : ""}.` };
  if (aim && measure.longestOn && measure.longestOn.seconds >= 25 * 60) return { tone: "on", text: `${minutesOf(measure.longestOn.seconds)} minutes unbroken on ${aim.project}.` };
  return null;
}
