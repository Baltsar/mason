import { buildFlow, NOT_A_TOOL, toolOf } from "./flow.mjs";

// Mason is a mirror. It is never told what a day is for: an aim that has to be
// declared changes by the quarter of an hour and turns into a card to keep up
// to date. What it can do without being told anything is look back. After a few
// days it says how the work was done: how many things it was spread over, how
// often the tool changed, where its owner went after sending a prompt, and how
// long finished answers from the agents were left waiting. Facts, in the order
// they stand out. No praise and no advice.

// Under five seconds somewhere else is a glance, not leaving.
const GLANCE_SECONDS = 5;
// Where an agent's answer is read. With one of these in front, nothing waits.
const AGENT_SURFACE = /^(claude|codex|cursor|terminal|iterm2?|warp|ghostty|visual studio code|code|windsurf|zed)$/i;
// An answer has to be left for this long before it counts as waiting.
const WAITING_MS = 30_000;
// An answer older than this is no longer something to hurry back to.
const STALE_MS = 3 * 3_600_000;
// Less of a day than this says nothing worth a sentence.
const WORTH_A_SENTENCE_SECONDS = 30 * 60;
// Leaving within this long of sending a prompt is leaving because of it.
const AFTER_PROMPT_MS = 60_000;

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
    const project = named ? null : projectOf(event) || null;
    // Time inside a project is work, whatever its window is called.
    spans.push({ start, end: start + seconds * 1000, seconds, tool, project, group: named ? "chat" : project ? "work" : event.group || "other" });
  }
  return spans.sort((a, b) => a.start - b.start);
}

const ranked = (seconds) => Object.entries(seconds).sort((a, b) => b[1] - a[1]).map(([tool, value]) => ({ tool, seconds: Math.round(value) }));
const minutesOf = (seconds) => Math.max(1, Math.round(seconds / 60));

// Each finished answer, and until when it was left: until its owner was back
// where answers are read, or said the next thing. `turns` come from the agents' logs.
function leftOf(spans, turns, from, now) {
  return turns.filter((item) => item.ended && item.done >= from && item.done <= now).sort((a, b) => a.done - b.done).map((turn) => {
    const back = spans.find((span) => readsAnswers(span.tool) && span.end > turn.done);
    return { project: turn.project, done: turn.done, until: Math.min(back ? Math.max(back.start, turn.done) : now, turn.next ?? now, now) };
  });
}

// Active time somewhere else while a finished answer was waiting. Two answers
// waiting at once count once.
function waitedOf(spans, turns, from, now) {
  const stretches = [];
  let answers = 0;
  for (const left of leftOf(spans, turns, from, now)) {
    if (left.until - left.done <= WAITING_MS) continue;
    answers += 1;
    const last = stretches.at(-1);
    if (last && left.done <= last[1]) last[1] = Math.max(last[1], left.until);
    else stretches.push([left.done, left.until]);
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
// An agent in front for another project is not a look at this one: with
// three agents at work, two of the answers are behind the third.
function readyOf(spans, turns, now) {
  return turns
    .filter((turn) => turn.ended && turn.next === null && now - turn.done < STALE_MS)
    .filter((turn) => !spans.some((span) => readsAnswers(span.tool) && span.end > turn.done && (!span.project || span.project === turn.project)))
    .sort((a, b) => a.done - b.done)
    .map((turn) => ({ project: turn.project, since: new Date(turn.done).toISOString() }));
}

// How long a finished answer is usually left, when it is left at all: the
// middle one of the waits in these events, in milliseconds. Null when there
// are too few to say what is usual.
export function usualWait(events, { projectOf = (event) => event.project || null, turns = [], now = Date.now() } = {}) {
  const spans = spansOf(events, projectOf);
  if (!spans.length) return null;
  const waits = leftOf(spans, turns, spans[0].start, now).map((left) => left.until - left.done).filter((wait) => wait > WAITING_MS).sort((a, b) => a - b);
  return waits.length >= 8 ? waits[waits.length >> 1] : null;
}

// Today so far: how long finished answers were left waiting, and which are
// waiting now. `projectOf` says which project a moment on screen belonged to.
export function measureDay(events, { projectOf = (event) => event.project || null, turns = [], now = Date.now() } = {}) {
  const spans = spansOf(events, projectOf);
  return {
    totalSeconds: Math.round(spans.reduce((sum, span) => sum + span.seconds, 0)),
    waited: waitedOf(spans, turns, spans[0]?.start ?? now, now),
    ready: readyOf(spans, turns, now),
  };
}

// The one thing worth saying about today, and nothing on an ordinary day.
export function sentenceOf(measure) {
  if (!measure || measure.totalSeconds < WORTH_A_SENTENCE_SECONDS || measure.waited.seconds < 20 * 60) return null;
  const { waited } = measure;
  return { tone: "off", text: `Finished answers waited ${minutesOf(waited.seconds)} minutes for you${waited.where[0] ? `, mostly while you were in ${waited.where[0].tool}` : ""}.` };
}

// How the work was done over a few days, said afterwards. `days` are the days
// looked back on, oldest first, each with its events: [{ day, events }].
export function lookBack(days, { projectOf = (event) => event.project || null, turns = [] } = {}) {
  const worked = days.filter((day) => day.events.length);
  if (!worked.length) return null;
  const spans = spansOf(worked.flatMap((day) => day.events), projectOf);
  if (!spans.length) return null;
  const activeSeconds = spans.reduce((sum, span) => sum + span.seconds, 0);
  const from = spans[0].start;
  const to = Math.max(...spans.map((span) => span.end));
  const share = (seconds) => Math.round((seconds / activeSeconds) * 100);

  // What the time went to.
  const perProject = {};
  const perGroup = { work: 0, social: 0, chat: 0, other: 0 };
  for (const span of spans) {
    if (span.project) perProject[span.project] = (perProject[span.project] || 0) + span.seconds;
    perGroup[span.group] = (perGroup[span.group] || 0) + span.seconds;
  }
  const projects = Object.entries(perProject).filter(([, seconds]) => seconds >= 600).sort((a, b) => b[1] - a[1]).map(([name, seconds]) => ({ name, seconds: Math.round(seconds), share: share(seconds) }));

  // How it moved: the changes of tool, and the longest stay in one.
  let jumps = 0;
  let longest = null;
  for (const day of worked) {
    const flow = buildFlow(day.events);
    jumps += flow.jumps;
    if (flow.longest && (!longest || flow.longest.seconds > longest.seconds)) longest = { ...flow.longest, day: day.day };
  }

  // What was said to the agents, and what happened right after.
  const said = turns.filter((turn) => turn.prompt >= from && turn.prompt <= to).sort((a, b) => a.prompt - b.prompt);
  let changes = 0;
  said.forEach((turn, index) => { if (index && said[index - 1].project !== turn.project) changes += 1; });
  const went = {};
  let left = 0;
  for (const turn of said) {
    const next = spans.find((span) => !readsAnswers(span.tool) && span.seconds >= GLANCE_SECONDS && span.start >= turn.prompt && span.start <= turn.prompt + AFTER_PROMPT_MS);
    if (!next) continue;
    left += 1;
    went[next.tool] = (went[next.tool] || 0) + 1;
  }
  const waited = waitedOf(spans, turns, from, to);

  const count = worked.length;
  const perHour = activeSeconds >= 600 ? Math.round(jumps / (activeSeconds / 3600)) : 0;
  const facts = {
    from: worked[0].day,
    to: worked.at(-1).day,
    days: count,
    activeSeconds: Math.round(activeSeconds),
    projects: projects.slice(0, 6),
    split: { work: share(perGroup.work), social: share(perGroup.social), chat: share(perGroup.chat), other: share(perGroup.other) },
    jumps,
    perHour,
    longest,
    prompts: said.length,
    changes,
    left: { count: left, share: said.length ? Math.round((left / said.length) * 100) : 0, to: Object.entries(went).sort((a, b) => b[1] - a[1]).map(([tool, times]) => ({ tool, count: times })).slice(0, 5) },
    waited: { ...waited, perDay: Math.round(waited.seconds / count) },
  };

  // What stands out, as plain sentences, at most three. What can be seen
  // nowhere else comes first: what happens around a prompt. Then the pace,
  // and last what the other views already show a day at a time.
  const lines = [];
  if (said.length >= 10 && facts.left.share >= 30 && facts.left.to[0]) lines.push(`After ${facts.left.share}% of your prompts you were somewhere else within a minute, most often in ${facts.left.to[0].tool}.`);
  if (facts.waited.perDay >= 10 * 60) lines.push(`Finished answers waited ${minutesOf(facts.waited.perDay)} minutes a day${waited.where[0] ? `, mostly while you were in ${waited.where[0].tool}` : ""}.`);
  if (perHour >= 20 && longest) lines.push(`You changed tool ${perHour} times an hour. The longest you stayed in one was ${minutesOf(longest.seconds)} minutes, in ${longest.tool}.`);
  if (said.length >= 10 && changes / count >= 8) lines.push(`You changed project ${Math.round(changes / count)} times a day between your prompts.`);
  if (projects.length) lines.push(`${projects.length} ${projects.length === 1 ? "project" : "projects"} in ${count} ${count === 1 ? "day" : "days"}. ${projects[0].name} got the most: ${projects[0].share}% of the time.`);
  if (facts.split.social + facts.split.chat >= 25) lines.push(`${facts.split.social}% went to social and ${facts.split.chat}% to chat.`);
  return { ...facts, lines: lines.slice(0, 3) };
}
