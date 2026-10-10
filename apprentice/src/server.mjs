import http from "node:http";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Collector } from "./collector.mjs";
import { appendEvent, ensureStore, eventsVersion, loadMap, loadRuntime, paths, readEvents, readEventsSince, saveMap, saveRuntime, useMemoryStore } from "./store.mjs";
import { buildRecap, writeVault, writeWiki } from "./wiki.mjs";
import { elevenLabsCredits, speak, stopSpeaking, voiceStatus } from "./voice.mjs";
import { handleMcp } from "./mcp-handler.mjs";
import { loadLocalEnv } from "./config.mjs";
import { aggregateActivity, classifyActivity, dayStart } from "./activity.mjs";
import { buildFlow } from "./flow.mjs";
import { embedStatus, stopEmbedder } from "./embed.mjs";
import { ICON_FILE, ICON_TYPES, iconFolder, iconsFor, siteIconsFor } from "./icons.mjs";
import { dayKey, daysPayload, loadDays, refreshDays } from "./days.mjs";
import { measureDay, readsAnswers, sentenceOf, usualWait } from "./coach.mjs";
import { answerCard, askedBefore, builtOf, nextDue } from "./built.mjs";
import { pageOf, piecesOf, replayOf, saveReplay, shownReplay, textOf } from "./replay.mjs";
import { saveShare } from "./share.mjs";
import { nudgesPayload, offerNudge, openNudge, settleNudges } from "./nudge.mjs";
import { beforeSaid, findSaid, forgetSaid, refreshSaid, repeatedSaid, saidStatus, unreadSaid } from "./said.mjs";
import { dismissSuggestion, refreshSuggestions, suggestionsPayload, wordSuggestion } from "./suggest.mjs";
import { buildGaps, buildTeachBack, confirmation, debriefProgress } from "./debrief.mjs";
import { logSources, projectIndex, summarizeProjects } from "./projects.mjs";
import { callContext, ensureAgent, recallContext, signedUrl, tutorContext } from "./agent.mjs";
import { MEMORY_VERSION, mergeInferred, projectMemory, savedMemory } from "./memory.mjs";
import { makeEpisode, playEpisode, podcastBusy, podcastState } from "./podcast.mjs";
import { hasElevenLabsKey, loadSettings, ownerName, saveSettings, settings } from "./settings.mjs";
import { modelStatus, onUse } from "./llm.mjs";
import { fromHere, holdsKey, makeKey, needsKey, usableKey } from "./guard.mjs";
import { collectable } from "./collection.mjs";
import { lookForUpdate, newer, ownVersion, updatePayload } from "./updates.mjs";
import { endTrial, trialPayload } from "./trial.mjs";
import { endWelcome, welcomePayload } from "./welcome.mjs";
import { recordUse, usagePayload } from "./usage.mjs";
import { fileOf, handover, heldBy, readWorkflow, saveWorkflow, workflowPayload, WORKFLOW_DAYS } from "./workflow.mjs";

useMemoryStore();
await loadLocalEnv();
await ensureStore();
await loadSettings();
// Every answer from the model is counted: what it was for and what it took.
onUse(recordUse);
let clients = new Set();
// Changes the island should show at once, rather than at its next poll.
const NUDGES = new Set(["question", "answer", "control", "session", "intervention", "call", "window", "prompt", "presence", "podcast", "memory"]);
const broadcast = (kind = "update") => {
  for (const response of clients) response.write(`event: update\ndata: ${JSON.stringify({ kind, at: new Date().toISOString() })}\n\n`);
  // The desktop app ignores USR1 only once it has started; before that the signal would end it.
  if (!NUDGES.has(kind)) return;
  if (desktop && Date.now() - desktopStartedAt > 4000) desktop.kill("SIGUSR1");
  // Started by the desktop app instead of starting it: nudge it by the id it gave.
  else if (desktopPid) { try { process.kill(desktopPid, "SIGUSR1"); } catch {} }
};
const collector = new Collector(broadcast);
// At the very first start macOS is not asked for anything until its owner
// presses the button in the welcome, which says what Mason needs and why. A
// system dialog at the first second, with no reason given, is where a new
// owner stops.
const firstStart = (await welcomePayload({ permission: (await loadRuntime()).permission })).show;
if (firstStart) collector.first = false;
if (process.env.APPRENTICE_COLLECT !== "0") collector.start();
let desktop = null;
let desktopStartedAt = 0;
const desktopPid = Number(process.env.APPRENTICE_DESKTOP_PID) || null;
// The key of this start. The desktop app makes it when it starts the server,
// since it must put it in its windows before the server can say anything;
// started from a terminal, the server makes its own and prints where to go.
// Nothing started from here inherits it.
const key = desktopPid && usableKey(process.env.APPRENTICE_KEY) ? process.env.APPRENTICE_KEY : makeKey();
delete process.env.APPRENTICE_KEY;
let stopping = false;

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const short = (text, max = 64) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

async function body(request, largest = 1_000_000) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (data.length > largest) throw new Error("Request too large");
  }
  return data ? JSON.parse(data) : {};
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

// Today's split is asked for every few seconds by the island, so it is only
// recomputed when an event was actually written.
let activityMemo = { version: -1, day: 0, at: 0, value: null, projects: null, flow: null };
// Work, social or other, decided the same way for the flow as for the split:
// inside a project it is work, and "other" is looked at again.
const groupFor = (index) => (sample) => index.of(sample) ? "work" : sample.group && sample.group !== "other" ? sample.group : classifyActivity(sample)?.group || "other";
async function today() {
  const day = dayStart();
  // A new prompt in a project log changes the picture without any new event,
  // so the memo also ages out after a few seconds.
  if (activityMemo.value && activityMemo.version === eventsVersion() && activityMemo.day === day && Date.now() - activityMemo.at < 15_000) return activityMemo;
  const [events, index] = await Promise.all([readEventsSince(day), projectIndex(day)]);
  activityMemo = { version: eventsVersion(), day, at: Date.now(), value: aggregateActivity(events, Date.now(), (sample) => index.of(sample)), projects: summarizeProjects(events, index), flow: buildFlow(events, { groupOf: groupFor(index) }) };
  return activityMemo;
}

// How many of a day's sites are asked for their own icon, when that is switched on.
const SITES_ASKED = 24;

// How a day moved between tools: today, or the day asked for. Each tool comes
// with its icon when the app is on this Mac.
async function flowPayload(asked, span = "day") {
  const current = dayKey(Date.now());
  const day = /^\d{4}-\d{2}-\d{2}$/.test(asked || "") ? asked : current;
  let flow;
  let fromDay = day;
  if (span === "week") {
    // The last seven days as one: for the picture that is shared.
    const from = dayStart() - 6 * 86_400_000;
    flow = buildFlow(await readEventsSince(from));
    fromDay = dayKey(from);
  } else if (day === current) flow = (await today()).flow;
  else {
    const [year, month, date] = day.split("-").map(Number);
    const from = new Date(year, month - 1, date, 4).getTime();
    const to = new Date(year, month - 1, date + 1, 4).getTime();
    const [events, index] = await Promise.all([readEventsSince(from), projectIndex(from)]);
    flow = buildFlow(events.filter((event) => Date.parse(event.startedAt || event.at) < to), { groupOf: groupFor(index) });
  }
  // Every tool that was gone to is named in the window, so each is looked up.
  const shown = flow.tools.filter((tool) => tool.visits);
  const icons = await iconsFor(shown.map((tool) => tool.name));
  // A site with no app of its name may show the icon the site itself gave.
  // Only the sites with the most time are asked: the rest keep their letter.
  const fromSites = await siteIconsFor(shown.slice(0, SITES_ASKED).filter((tool) => !icons[tool.name]), { arrived: () => broadcast("icons") });
  Object.assign(icons, fromSites);
  const known = await loadDays();
  return { ...flow, span: span === "week" ? "week" : "day", day: span === "week" ? current : day, fromDay, today: current, owner: ownerName(), days: [...new Set([...Object.keys(known.moves), current])].sort(), tools: flow.tools.map((tool) => ({ ...tool, icon: icons[tool.name] || null })) };
}

// How the last thirty days were worked, for the window and for the file that
// is shared. A month of logs takes a few seconds to read the first time, so
// it is worked out once and kept for a minute.
let workflowMemo = { at: 0, value: null };
function workflow() {
  if (workflowMemo.value && Date.now() - workflowMemo.at < 60_000) return workflowMemo.value;
  const from = dayStart() - (WORKFLOW_DAYS - 1) * 86_400_000;
  const value = (async () => {
    const [index, events, suggestions] = await Promise.all([projectIndex(from, { maxAgeMs: 60_000 }), readEventsSince(from), suggestionsPayload()]);
    const memories = Object.fromEntries(await Promise.all(index.list.map(async (project) => [project.name, await savedMemory(project.name)])));
    return workflowPayload({ index, events, memories, suggestions, owner: ownerName(), from });
  })();
  workflowMemo = { at: Date.now(), value };
  value.catch(() => { if (workflowMemo.value === value) workflowMemo = { at: 0, value: null }; });
  return value;
}

// Today's answers from the agents: how long finished ones were left waiting,
// and which are waiting now. Asked for every few seconds by the island, so it
// is worked out again only when something was written or a moment has passed.
let waitingMemo = { key: "", at: 0, value: null };
async function waitingPayload() {
  const key = `${dayStart()}|${eventsVersion()}`;
  if (waitingMemo.value && waitingMemo.key === key && Date.now() - waitingMemo.at < 10_000) return waitingMemo.value;
  const index = await projectIndex(dayStart());
  const measure = measureDay(await readEventsSince(dayStart()), { projectOf: (sample) => index.of(sample), turns: index.turns(), now: Date.now() });
  const value = { ...measure, sentence: sentenceOf(measure) };
  waitingMemo = { key, at: Date.now(), value };
  return value;
}

// A word on the island, there for a moment and gone: an answer that has just
// come while its owner is somewhere else. Never a panel, never a sound.
const JUST_NOW_MS = 2 * 60_000;
const cued = new Set();
function cueFor(measure, runtime) {
  if (!settings().cues || runtime.session?.active) return null;
  const state = presence(runtime);
  // Only someone who is at the Mac, and not already where answers are read.
  if (!(state === "private-surface" || state === "watching" && !readsAnswers(runtime.currentApp))) return null;
  // An old answer is on the panel, not announced.
  const ready = measure.ready.find((answer) => !cued.has(`${answer.project}|${answer.since}`) && Date.now() - Date.parse(answer.since) < JUST_NOW_MS);
  if (!ready) return null;
  cued.add(`${ready.project}|${ready.since}`);
  return `Answer ready · ${short(ready.project, 20)}`;
}

// How long a finished answer is usually left, over the last week. It changes
// slowly, so it is worked out once an hour.
let usualMemo = { at: 0, value: null };
async function usualWaitMs() {
  if (Date.now() - usualMemo.at < 3_600_000) return usualMemo.value;
  const from = dayStart() - 6 * 86_400_000;
  const [events, index] = await Promise.all([readEventsSince(from), projectIndex(from, { maxAgeMs: 3_600_000 })]);
  usualMemo = { at: Date.now(), value: usualWait(events, { projectOf: (event) => index.of(event), turns: index.turns() }) };
  return usualMemo.value;
}

// A nudge: a word on the island at the moment it can be acted on, resting on
// what its owner usually does. Two kinds so far. An answer that has waited
// twice as long as answers are usually left, within these bounds. And a
// prompt, just sent, for a piece of work that was done before in another
// project. Each is followed up, and a kind that is ignored goes quiet (nudge.mjs).
const WAITED_FROM_MS = 4 * 60_000;
const WAITED_AT_MOST_MS = 15 * 60_000;
// An answer left this long is not being waited for any more.
const WAITED_TOO_LONG_MS = 45 * 60_000;
const JUST_SAID_MS = 3 * 60_000;
let nudgeAt = 0;
async function nudgeFor(waiting, runtime, index) {
  if (!settings().cues || runtime.session?.active || Date.now() - nudgeAt < 5000) return null;
  const now = (nudgeAt = Date.now());
  const state = presence(runtime);
  const reading = state === "watching" && readsAnswers(runtime.currentApp);
  const todays = index.prompts();
  // What was said before is settled first: back where answers are read, or
  // the other project named in the next prompt, is acting on it.
  const [version, update] = await Promise.all([ownVersion(), updatePayload()]);
  // A new version is acted on by being this version or a later one.
  const changed = await settleNudges((nudge) => nudge.kind === "waited" ? reading
    : nudge.kind === "version" ? !newer(nudge.key, version)
    : nudge.kind === "before" ? todays.some((prompt) => prompt.project === nudge.project && prompt.at > Date.parse(nudge.at) && prompt.text.toLowerCase().includes(String(nudge.other).toLowerCase()))
    : false, now);
  if (changed) broadcast("nudge");
  // Only someone who is at the Mac is nudged.
  if (state !== "watching" && state !== "private-surface") return null;
  const candidates = [];
  // Said once for each version, at a moment its owner is at the Mac.
  if (update.latest) candidates.push({ kind: "version", key: update.latest.version, text: `Mason ${update.latest.version} is out` });
  if (!reading) {
    const patience = Math.min(WAITED_AT_MOST_MS, Math.max(WAITED_FROM_MS, ((await usualWaitMs()) || 0) * 2));
    const late = waiting.ready.find((answer) => { const left = now - Date.parse(answer.since); return left >= patience && left < WAITED_TOO_LONG_MS; });
    if (late) candidates.push({ kind: "waited", key: `${late.project}|${late.since}`, project: late.project, text: `Waited ${Math.round((now - Date.parse(late.since)) / 60_000)} min · ${short(late.project, 18)}` });
  }
  if (settings().meaning && embedStatus().ready) {
    const fresh = todays.filter((prompt) => now - prompt.at < JUST_SAID_MS);
    // A prompt has to be read before it can be compared: it is read now, and
    // the nudge comes at the next look, a few seconds on.
    if ((await unreadSaid(fresh)).length) refreshSaid(todays, { steps: 1 }).catch(() => {});
    else for (const prompt of fresh.slice(-2)) {
      const earlier = await beforeSaid(prompt);
      if (earlier) candidates.push({ kind: "before", key: `${prompt.project}|${earlier.project}|${dayKey(now)}`, project: prompt.project, other: earlier.project, when: earlier.at, query: short(prompt.text, 200), text: `Done before · ${short(earlier.project, 20)}` });
    }
  }
  const nudge = await offerNudge(candidates, now);
  if (nudge) broadcast("nudge");
  return nudge?.text || null;
}

// What Mason can ask its owner about their own projects: read from what is
// remembered of each, as it is on disk. No model is asked.
let builtMemo = { at: 0, value: [] };
async function builtProjects() {
  if (Date.now() - builtMemo.at < 60_000) return builtMemo.value;
  const known = await loadDays();
  const names = [...new Set(Object.keys(known.days).sort().slice(-21).flatMap((day) => Object.keys(known.days[day])))];
  const remembered = Object.fromEntries(await Promise.all(names.map(async (name) => [name, memories.get(name) || await savedMemory(name)])));
  builtMemo = { at: Date.now(), value: builtOf({ days: known.days, memories: remembered, today: dayKey(Date.now()), asked: await askedBefore() }) };
  return builtMemo.value;
}

// The days are brought up to date in the background, at most every few minutes.
let daysAt = 0;
function catchUpDays() {
  if (Date.now() - daysAt < 5 * 60_000) return;
  daysAt = Date.now();
  refreshDays().then(() => broadcast("days")).catch(() => {});
}
// What was said to the agents is placed by the embedding model in the
// background while that is switched on, a step at a time. The first reading
// goes through every log there is; after that only what is new.
let saidAt = 0;
let saidWaiting = null;
// After a start, and when more was read, what is proposed is looked over at
// the next pass and not hours later. Nothing is asked when nothing changed.
let lookSoon = true;
function catchUpSaid() {
  if (!settings().meaning || !settings().logs || !embedStatus().ready) return;
  if (Date.now() - saidAt < 5 * 60_000) return;
  saidAt = Date.now();
  const moved = ({ waiting }) => { saidWaiting = waiting; repeatedMemo.at = 0; broadcast("said"); };
  projectIndex(0, { maxAgeMs: 5 * 60_000 })
    .then((index) => refreshSaid(index.prompts(), { moved }))
    .then((progress) => {
      if (!progress) return;
      saidWaiting = progress.waiting;
      // More is waiting: go on at once, and let others in between.
      if (progress.waiting && progress.added) { saidAt = 0; setTimeout(catchUpSaid, 200).unref(); }
      else if (progress.added) lookSoon = true;
    })
    .catch(() => {});
}

// What is said again and again is worked out from everything that was read,
// which takes a moment, so it is kept until more has been read.
let repeatedMemo = { at: 0, value: [] };
async function repeatedDemands() {
  if (Date.now() - repeatedMemo.at < 30 * 60_000) return repeatedMemo.value;
  repeatedMemo = { at: Date.now(), value: await repeatedSaid() };
  return repeatedMemo.value;
}

// What each of today's projects is about and where it was left. Built in the
// background from the prompts already given to the agents; nothing is asked.
const memories = new Map();
// The project the next recall call is about, when it was picked in the app window.
let recallAim = "";
let refreshing = false;
// True only while a model is writing a project's summary.
let summarising = false;
async function refreshMemories() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [index, summary, map] = await Promise.all([projectIndex(dayStart()), todayProjects(), loadMap()]);
    let learned = false;
    for (const item of summary.projects.slice(0, 6)) {
      const project = index.list.find((candidate) => candidate.name === item.name);
      if (!project) continue;
      const quick = await projectMemory(project);
      if (quick.building) { summarising = true; broadcast("memory"); }
      const memory = quick.building ? await projectMemory(project, { wait: true }) : quick;
      summarising = false;
      const before = memories.get(item.name)?.generatedAt;
      memories.set(item.name, memory);
      if (memory.source === "model") learned = mergeInferred(map, memory) || learned;
      if (memory.generatedAt !== before) broadcast("memory");
    }
    if (learned) { await saveMap(map); await writeWiki(map); broadcast("memory"); }
    // The notes for Obsidian follow the memory.
    await writeVault(map, [...memories.values()]).catch(() => {});
    // What is said in project after project is looked over now and then, across
    // every project of the last three weeks.
    const known = await loadDays();
    const names = [...new Set(Object.keys(known.days).sort().slice(-21).flatMap((day) => Object.keys(known.days[day])))];
    const remembered = Object.fromEntries(await Promise.all(names.map(async (name) => [name, memories.get(name) || await savedMemory(name)])));
    const repeated = settings().meaning ? await repeatedDemands() : [];
    if (await refreshSuggestions(remembered, Date.now(), { repeated, soon: lookSoon })) broadcast("suggestions");
    lookSoon = false;
    await rememberOlder();
  } catch {} finally { refreshing = false; summarising = false; }
}

// The projects of the last three weeks that were not worked on today are
// remembered too, one a round: the ones not touched for a while are the ones
// their owner has forgotten most about. A memory written before something new
// was kept in it is written again the same way.
let olderDone = false;
async function rememberOlder() {
  if (olderDone || !settings().summaries) return;
  const wide = await projectIndex(dayStart() - 21 * 86_400_000, { maxAgeMs: 10 * 60_000 });
  const recent = wide.list.filter((project) => project.prompts.length && !memories.has(project.name)).sort((a, b) => b.prompts.at(-1).at - a.prompts.at(-1).at);
  for (const project of recent) {
    const saved = await savedMemory(project.name);
    if (saved?.version === MEMORY_VERSION) continue;
    summarising = true;
    broadcast("memory");
    await projectMemory(project, { wait: true });
    summarising = false;
    builtMemo.at = 0;
    // Without an answer from a model there is nothing to go on with, until Mason is started again.
    if ((await savedMemory(project.name))?.version !== MEMORY_VERSION) olderDone = true;
    broadcast("memory");
    return;
  }
  olderDone = true;
}

// Coming back to a project after hours or days is the moment its memory is
// worth something. It is offered once, as a line under the island.
function returningTo(runtime, name) {
  const memory = name && memories.get(name);
  if (!memory?.lastAt) return null;
  const dayKey = new Date(dayStart()).toISOString().slice(0, 10);
  runtime.returned ||= {};
  if (runtime.returned[name] === dayKey) return null;
  // lastAt is the last thing said before this visit when they have just arrived.
  const hours = (Date.now() - Date.parse(memory.lastAt)) / 3_600_000;
  if (hours < 6) return null;
  runtime.returned = { ...Object.fromEntries(Object.entries(runtime.returned).filter(([, value]) => value === dayKey)), [name]: dayKey };
  const days = Math.floor(hours / 24);
  return `${name} · ${days >= 1 ? `${days} ${days === 1 ? "day" : "days"} ago` : "earlier today"}`;
}

const todayActivity = async () => (await today()).value;
const todayProjects = async () => (await today()).projects;

function presence(runtime) {
  if (runtime.offTheRecord) return "private";
  if (!runtime.recording) return "paused";
  if (runtime.permission === "needed") return "permission";
  if (runtime.currentPrivate) return "private-surface";
  if ((runtime.currentIdleSeconds ?? 0) >= 60) return "idle";
  return runtime.currentApp ? "watching" : "starting";
}

function learnFromAnswer(map, question) {
  if (!question?.answer || map.decisions.some((item) => item.source?.questionId === question.id)) return;
  const app = question.source?.app || "live work";
  map.decisions.unshift({
    id: `learned-${question.id}`,
    kind: question.kind === "guardrail" ? "guardrail" : "decision",
    title: `${question.kind === "guardrail" ? "Guardrail" : "Step"}: ${short(question.evidence, 58)}`,
    body: question.text,
    quote: question.answer,
    moment: {
      at: question.source?.at || question.askedAt,
      app: question.source?.app || null,
      window: question.source?.window || null,
      evidence: question.evidence,
    },
    source: {
      label: `Live question · ${app}`,
      type: "question",
      questionId: question.id,
      at: question.askedAt,
      answeredBy: question.answerSource || "typed",
    },
  });
}

async function answerQuestion(map, question, text, source) {
  question.answer = text;
  question.status = "answered";
  question.answeredAt = new Date().toISOString();
  question.answerSource = source;
  learnFromAnswer(map, question);
  await saveMap(map);
  await writeWiki(map);
  await appendEvent({ type: "answer", questionId: question.id, answer: question.answer, source });
}

async function answerGap(map, gap, text, source) {
  gap.answer = text;
  gap.status = "answered";
  gap.answeredAt = new Date().toISOString();
  map.decisions.unshift({
    id: `debrief-${gap.id}`,
    kind: gap.kind === "guardrail" ? "guardrail" : "decision",
    title: gap.title,
    body: gap.text,
    quote: text,
    moment: gap.moment || null,
    source: { label: "Debrief · follow-up question", type: "debrief", at: gap.answeredAt, answeredBy: source },
  });
  await appendEvent({ type: "debrief-answer", gapId: gap.id, answer: text, source });
  await advanceDebrief(map);
}

// After each answer: the next gap, or the teach-back once nothing is unclear.
async function advanceDebrief(map) {
  const progress = debriefProgress(map.debrief);
  if (progress.current) {
    await saveMap(map);
    await speak(progress.current.text, `debrief-${progress.current.id}`);
  } else {
    map.debrief.teachBack = buildTeachBack(map);
    await saveMap(map);
    await appendEvent({ type: "teach-back", status: "pending" });
    await speak(map.debrief.teachBack.text, `teach-back-${Date.now()}`);
  }
  await writeWiki(map);
}

async function confirmTeachBack(map, source) {
  map.debrief.teachBack.status = "confirmed";
  map.debrief.teachBack.confirmedAt = new Date().toISOString();
  map.debrief.teachBack.confirmedBy = source;
  await saveMap(map);
  await writeWiki(map);
  await appendEvent({ type: "teach-back", status: "confirmed", source });
  await speak("Understood. The Work Map is ready to teach.", `confirmed-${Date.now()}`);
}

async function statePayload() {
  const [map, runtime, events, activity, projects, sinceMorning, index, podcast, days, waiting, suggestions, built] = await Promise.all([loadMap(), loadRuntime(), readEvents(60), todayActivity(), todayProjects(), readEventsSince(dayStart()), projectIndex(dayStart()), podcastState(), loadDays(), waitingPayload(), suggestionsPayload(), builtProjects()]);
  // The project in front right now (often none: a feed, a video), and the last
  // project that has something remembered about it.
  const inFront = runtime.currentApp && !runtime.currentPrivate ? index.resolve({ app: runtime.currentApp, window: runtime.currentWindow || "", at: new Date().toISOString() }) : null;
  const remembered = (name) => Boolean(memories.get(name)?.left_off);
  const recent = remembered(inFront) ? inFront : [...projects.blocks].reverse().find((block) => block.project && remembered(block.project))?.project || null;
  if (!map.recap) map.recap = buildRecap(map, events, activity);
  const questions = sinceMorning.filter((event) => event.type === "question");
  return {
    map,
    runtime,
    events,
    activity,
    projects,
    memories: Object.fromEntries(memories),
    podcast,
    waiting,
    // How the last few days of work were done, as it was written down then.
    lookback: days.lookbacks.at(-1) || null,
    suggestions,
    // What the window is made of: the dark look, or liquid glass.
    look: settings().glass ? "glass" : "",
    // The nudge that was just said, and how the last week of them went.
    nudges: await nudgesPayload(),
    trial: await trialPayload({ moves: days.moves, days: days.days, rules: suggestions.applied.length }),
    welcome: await welcomePayload({ permission: runtime.permission, days: days.days, through: days.through }),
    // The figures the top bar shows for the two views that load by themselves.
    flow: { jumps: (await today()).flow.jumps },
    days: Object.keys(days.days).length,
    built: built.length,
    now: { project: inFront, recent },
    presence: presence(runtime),
    voice: voiceStatus(),
    debrief: debriefProgress(map.debrief),
    stats: {
      steps: map.decisions.length,
      judgementCalls: map.decisions.filter((item) => item.kind !== "guardrail").length,
      guardrails: map.decisions.filter((item) => item.kind === "guardrail").length,
      sourced: map.decisions.filter((item) => item.source).length,
      questionsAsked: questions.length,
      guardrailQuestions: questions.filter((event) => event.kind === "guardrail").length,
      privateRefusals: runtime.privateRefusals || 0,
    },
  };
}

async function islandPayload() {
  const [map, runtime, activity, index, waiting] = await Promise.all([loadMap(), loadRuntime(), todayActivity(), projectIndex(dayStart()), waitingPayload()]);
  const question = map.questions.find((item) => item.status === "open");
  const project = runtime.currentApp ? index.resolve({ app: runtime.currentApp, window: runtime.currentWindow || "", at: new Date().toISOString() }) : null;
  return {
    status: presence(runtime),
    // Where Mason sits in the menu bar: as the island beside the notch, or as an icon among the others.
    bar: settings().island ? "island" : "icon",
    app: runtime.currentApp,
    project,
    returning: returningTo(runtime, project) || cueFor(waiting, runtime) || await nudgeFor(waiting, runtime, index),
    category: runtime.currentCategory,
    group: runtime.currentGroup,
    work: activity.workPercent,
    social: activity.socialPercent,
    other: activity.otherPercent,
    totalSeconds: activity.totalSeconds,
    question: question ? { id: question.id, kind: question.kind, text: question.text, evidence: question.evidence } : null,
    session: runtime.session?.active ? { startedAt: runtime.session.startedAt, questions: runtime.session.questions || 0 } : null,
    debriefReady: Boolean(runtime.debriefReady),
    onCall: map.debrief?.call?.status === "live",
    // For the eye on the island: a count that goes up with everything taken
    // in from the screen, and whether something is being worked out right now.
    seen: eventsVersion(),
    busy: summarising || podcastBusy(),
  };
}

async function startDebrief(map, runtime) {
  const since = runtime.session?.startedAt ? Date.parse(runtime.session.startedAt) : dayStart();
  const [events, index] = await Promise.all([readEventsSince(since), projectIndex(dayStart())]);
  const gaps = buildGaps(map, events, { since, projects: summarizeProjects(events, index), said: index.prompts().filter((prompt) => prompt.at >= since) });
  map.debrief = { id: randomUUID(), startedAt: new Date().toISOString(), since: new Date(since).toISOString(), gaps, teachBack: null };
  await saveMap(map);
  await appendEvent({ type: "debrief", action: "start", gaps: gaps.length });
  await speak(gaps[0].text, `debrief-${gaps[0].id}`);
}

let refusals = 0;
const server = http.createServer(async (request, response) => {
  try {
    // A page in a browser that is not Mason's own gets no answer and changes nothing.
    if (!fromHere(request.headers)) {
      // Said in the log a few times, so that a window of Mason's own that is turned away can be told from an attempt.
      if ((refusals += 1) <= 5) console.warn(`Not answered: a request from ${String(request.headers.origin || request.headers["sec-fetch-site"] || request.headers.host || "nowhere").slice(0, 80)}`);
      return json(response, 403, { error: "Only this Mac's own Mason is answered" });
    }
    const url = new URL(request.url, "http://127.0.0.1");
    const post = request.method === "POST";
    // Another program on this Mac names no page and gets this far. Without the
    // key of this start it may read the pages, which anyone may, and no more.
    // A picture and the event stream cannot send a header, so for reading the
    // key may stand in the address.
    if (needsKey(request.method, url.pathname) && !holdsKey(key, request.headers, request.method === "GET" ? url.searchParams.get("key") : null)) {
      if ((refusals += 1) <= 5) console.warn(`Not answered: ${request.method} ${url.pathname.slice(0, 80)} without the key of this start`);
      return json(response, 401, { error: "This window does not have Mason's key. Open Mason from its menu, or from the address it printed when it started." });
    }
    if (url.pathname === "/api/island" && request.method === "GET") return json(response, 200, await islandPayload());
    if (url.pathname === "/api/state" && request.method === "GET") return json(response, 200, await statePayload());
    if (url.pathname === "/api/built") {
      // "Knew it" or "did not": the card comes back later, or tomorrow.
      if (post) {
        const input = await body(request);
        if (!(await answerCard(input.id, input.knew === true))) return json(response, 400, { error: "No such card" });
        builtMemo.at = 0;
        broadcast("built");
      }
      const next = nextDue(await askedBefore());
      return json(response, 200, { today: dayKey(Date.now()), projects: await builtProjects(), next: Number.isFinite(next) ? new Date(next).toISOString() : null });
    }
    if (url.pathname === "/api/suggestions") {
      if (post) {
        const input = await body(request);
        // No, or other words for it. Mason writes a rule nowhere: it is handed
        // to an agent from the window, as a prompt its owner sends.
        if (input.action === "word") {
          const why = await wordSuggestion(String(input.id || ""), String(input.rule || ""));
          if (why) return json(response, 400, { error: `Mason does not hand on those words: ${why}. Say it more plainly, or give it to an agent yourself.` });
        } else if (input.action === "dismiss") await dismissSuggestion(String(input.id || ""));
        else return json(response, 400, { error: "Unknown action" });
        broadcast("suggestions");
      }
      return json(response, 200, await suggestionsPayload());
    }
    if (url.pathname === "/api/nudge" && post) {
      // Pressing a nudge is acting on it.
      const pressed = await openNudge((await body(request)).id);
      if (pressed) broadcast("nudge");
      return json(response, pressed ? 200 : 404, { ok: Boolean(pressed) });
    }
    if (url.pathname === "/api/find" && post) {
      if (!settings().meaning) return json(response, 200, { off: true });
      const found = await findSaid((await body(request)).query);
      if (!found) return json(response, 200, { unavailable: embedStatus().missing || "model" });
      // With nothing asked for, what is said again and again is shown instead.
      return json(response, 200, { ...found, waiting: saidWaiting, repeated: found.query ? [] : (await repeatedDemands()).slice(0, 8) });
    }
    if (url.pathname === "/api/flow" && request.method === "GET") return json(response, 200, await flowPayload(url.searchParams.get("day"), url.searchParams.get("span") || "day"));
    if (url.pathname === "/api/workflow/open" && post) {
      // Someone else's workflow, read with care, beside one's own for the same kind of work.
      const theirs = readWorkflow((await body(request, 400_000)).text);
      if (!theirs) return json(response, 400, { error: "Not a workflow from Mason" });
      const own = await workflow();
      // A rule that is offered comes with the prompt that hands it to an agent,
      // and with the agents whose rules already hold it. Mason writes it nowhere.
      const rules = await Promise.all(theirs.rules.map(async (rule) => ({ ...rule, hand: handover(rule.rule), told: rule.held ? [] : await heldBy(rule.rule) })));
      return json(response, 200, { theirs: { ...theirs, rules }, mine: own.cards.find((card) => card.purpose === theirs.purpose) || own.cards[0] });
    }
    if (url.pathname === "/api/welcome" && post) {
      // "Start" or "Not now": the first start is over, and the window is as on any day.
      await endWelcome();
      broadcast("welcome");
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/trial" && post) {
      // "Use evaluation copy": the card about the trial is put away for good.
      await endTrial();
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/workflow/collect" && post) {
      // One's own workflow in the form the collection keeps: read back with
      // the same care as a stranger's, so that what is copied is what a
      // reader there would be shown. Nothing is sent from here.
      const input = await body(request);
      const made = fileOf(await workflow(), String(input.purpose || "all"), Array.isArray(input.rules) ? input.rules.map(String) : []);
      const ready = made && collectable(made);
      if (!ready) return json(response, 400, { error: "No such workflow" });
      return json(response, 200, { text: ready.text, name: ready.name, dropped: ready.dropped });
    }
    if (url.pathname === "/api/workflow") {
      if (!post) return json(response, 200, await workflow());
      // Kept as a file to hand to someone, with the picture of it beside it.
      // Only the rules that were left in go with it.
      const input = await body(request, 12_000_000);
      const purpose = String(input.purpose || "all");
      const made = fileOf(await workflow(), purpose, Array.isArray(input.rules) ? input.rules.map(String) : []);
      if (!made) return json(response, 400, { error: "No such workflow" });
      const file = await saveWorkflow(made, purpose);
      const picture = await saveShare(input.image, `workflow ${purpose}`);
      if (process.env.APPRENTICE_COLLECT !== "0") spawn("open", ["-R", picture || file], { stdio: "ignore", detached: true }).once("error", () => {}).unref();
      return json(response, 200, { file: file.replace(process.env.HOME || "\u0000", "~"), picture: Boolean(picture) });
    }
    if (url.pathname === "/api/share" && post) {
      // The picture drawn in the window is kept as a file and shown in the Finder.
      const input = await body(request, 12_000_000);
      const file = await saveShare(input.image, input.label);
      if (!file) return json(response, 400, { error: "Not a picture" });
      if (process.env.APPRENTICE_COLLECT !== "0") spawn("open", ["-R", file], { stdio: "ignore", detached: true }).once("error", () => {}).unref();
      return json(response, 200, { file: file.replace(process.env.HOME || "\u0000", "~") });
    }
    if (url.pathname === "/api/replay" && post) {
      // One piece of today's work, cut afterwards from what is kept anyway:
      // the latest, or the one that is asked for, or the whole day.
      const input = await body(request);
      const [events, index] = await Promise.all([readEventsSince(dayStart()), projectIndex(dayStart())]);
      const said = index.prompts();
      const pieces = piecesOf(said);
      const piece = input.piece === "today" ? null : pieces.find((item) => item.id === input.piece) || pieces[0] || null;
      const ends = [...events.map((event) => Date.parse(event.startedAt || event.at) + (Number(event.durationSec) || 0) * 1000), ...said.map((prompt) => prompt.at)].filter(Number.isFinite);
      const last = Math.min(Date.now(), ends.length ? Math.max(...ends) : Date.now());
      // A piece runs a little past its last prompt, to where the answer was read.
      const [from, to] = piece ? [piece.from - 60_000, Math.min(last, piece.to + 10 * 60_000)] : [dayStart(), last];
      const prompts = piece ? said.filter((prompt) => prompt.project === piece.project) : said;
      const replay = replayOf({ events, prompts, turns: index.turns(), from, to });
      const names = input.names === true;
      // First everything is shown to its owner, who picks the piece and takes lines out.
      if (input.action !== "save" && input.action !== "text") return json(response, 200, { ...shownReplay(replay, { names }), piece: piece?.id || "today", pieces: pieces.slice(0, 5).map((item) => ({ id: item.id, project: item.project, prompts: item.prompts })) });
      const shown = shownReplay(replay, { names, hidden: Array.isArray(input.hidden) ? input.hidden.map(String) : [] });
      if (!shown.lines.length) return json(response, 400, { error: "Nothing is left to show" });
      if (input.action === "text") return json(response, 200, { text: textOf(shown, ownerName()) });
      const file = await saveReplay(pageOf(shown, ownerName()));
      if (process.env.APPRENTICE_COLLECT !== "0") spawn("open", ["-R", file], { stdio: "ignore", detached: true }).once("error", () => {}).unref();
      return json(response, 200, { file: file.replace(process.env.HOME || "\u0000", "~") });
    }
    if (url.pathname === "/api/days" && request.method === "GET") {
      // What is known is given at once; anything newer follows as an update.
      catchUpDays();
      return json(response, 200, await daysPayload());
    }
    if (url.pathname.startsWith("/icons/") && request.method === "GET") {
      const name = url.pathname.slice("/icons/".length);
      if (!ICON_FILE.test(name)) return json(response, 404, { error: "Not found" });
      const picture = await readFile(path.join(iconFolder(), name));
      // A picture and nothing else, whatever a site may have sent.
      response.writeHead(200, { "content-type": ICON_TYPES[name.split(".").at(-1)], "cache-control": "max-age=86400", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" });
      response.end(picture);
      return;
    }
    if (url.pathname === "/api/stream" && request.method === "GET") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      response.write(`event: ready\ndata: {}\n\n`);
      clients.add(response);
      request.on("close", () => clients.delete(response));
      return;
    }
    if (url.pathname === "/api/control" && post) {
      const input = await body(request);
      const runtime = await loadRuntime();
      // Asks the question panel to start listening, as if its microphone was pressed.
      if (input.action === "listen") { broadcast("listen"); return json(response, 200, { ok: true }); }
      if (input.action === "debrief-later") { runtime.debriefReady = false; runtime.lastDebriefAt = new Date().toISOString(); await saveRuntime(runtime); broadcast("call"); return json(response, 200, { ok: true }); }
      if (input.action === "pause") runtime.recording = false;
      if (input.action === "resume") { runtime.recording = true; runtime.offTheRecord = false; }
      if (input.action === "off-the-record") runtime.offTheRecord = true;
      if (input.action === "on-the-record") runtime.offTheRecord = false;
      await saveRuntime(runtime);
      await appendEvent({ type: "control", action: input.action });
      broadcast("control");
      return json(response, 200, { ok: true, runtime });
    }
    if (url.pathname === "/api/session" && post) {
      const input = await body(request);
      const [runtime, map] = await Promise.all([loadRuntime(), loadMap()]);
      if (input.action === "start") {
        runtime.session = { id: randomUUID(), active: true, startedAt: new Date().toISOString(), endedAt: null, questions: 0, guardrailAsked: false };
        runtime.lastQuestionAt = null;
        runtime.recording = true;
        runtime.offTheRecord = false;
        await appendEvent({ type: "session", action: "start", sessionId: runtime.session.id });
      }
      if (input.action === "end" && runtime.session?.active) {
        runtime.session.active = false;
        runtime.session.endedAt = new Date().toISOString();
        await appendEvent({ type: "session", action: "end", sessionId: runtime.session.id, questions: runtime.session.questions });
        runtime.debriefReady = true;
        if (!voiceStatus().elevenLabs) await startDebrief(map, runtime);
      }
      await saveRuntime(runtime);
      broadcast("session");
      return json(response, 200, { ok: true, session: runtime.session });
    }
    if (url.pathname === "/api/answer" && post) {
      const input = await body(request);
      const map = await loadMap();
      const question = map.questions.find((item) => item.id === input.id);
      if (!question) return json(response, 404, { error: "Question not found" });
      const text = String(input.answer || "").trim().slice(0, 3000);
      if (input.action === "later" || !text) {
        question.status = "parked";
        await saveMap(map);
      } else {
        await answerQuestion(map, question, text, input.source === "voice" ? "ElevenLabs Scribe v2 Realtime" : "typed");
      }
      broadcast("answer");
      return json(response, 200, { ok: true, status: question.status });
    }
    if (url.pathname === "/api/debrief" && post) {
      const input = await body(request);
      const [map, runtime] = await Promise.all([loadMap(), loadRuntime()]);
      const text = String(input.text || "").trim().slice(0, 3000);
      if (input.action === "start") await startDebrief(map, runtime);
      const debrief = map.debrief;
      if (!debrief) return json(response, 409, { error: "No debrief has started" });
      const gap = debrief.gaps.find((item) => item.id === input.id);
      if (input.action === "answer" && gap && text) await answerGap(map, gap, text, input.source === "voice" ? "ElevenLabs Scribe v2 Realtime" : "typed");
      if (input.action === "skip" && gap) {
        gap.status = "skipped";
        map.uncertainties.unshift({ id: `gap-${gap.id}`, text: gap.text, why: gap.why, status: "open" });
        await advanceDebrief(map);
      }
      if (input.action === "repeat") await speak(debriefProgress(debrief).current?.text || debrief.teachBack?.text || "", `repeat-${Date.now()}`);
      if (input.action === "confirm" && debrief.teachBack) await confirmTeachBack(map, "pressed");
      // A spoken reply to the teach-back is a yes, or it is a correction to check.
      if (input.action === "hear" && debrief.teachBack && text) {
        const yes = confirmation.test(text);
        if (yes) await confirmTeachBack(map, "ElevenLabs Scribe v2 Realtime");
        broadcast("debrief");
        return json(response, 200, { ok: true, heard: yes ? "confirmed" : "correction" });
      }
      if (input.action === "correct" && debrief.teachBack && text) {
        debrief.teachBack.corrections.push({ text, at: new Date().toISOString() });
        map.decisions.unshift({
          id: `correction-${randomUUID()}`,
          kind: "decision",
          title: `Correction: ${short(text, 56)}`,
          body: "The expert corrected the teach-back.",
          quote: text,
          moment: null,
          source: { label: "Debrief · teach-back correction", type: "debrief", at: new Date().toISOString() },
        });
        await appendEvent({ type: "teach-back", status: "corrected", text });
        map.debrief.teachBack = buildTeachBack(map);
        await saveMap(map);
        await writeWiki(map);
        await speak(map.debrief.teachBack.text, `teach-back-${Date.now()}`);
      }
      broadcast("debrief");
      return json(response, 200, { ok: true, debrief: debriefProgress(map.debrief) });
    }
    if (url.pathname === "/api/memory" && post) {
      const input = await body(request);
      const memory = memories.get(String(input.project || ""));
      if (!memory?.spoken) return json(response, 404, { error: "Nothing is remembered about that project yet" });
      const spoken = await speak(memory.spoken);
      spoken.done.then(() => broadcast("spoken"));
      return json(response, 200, { engine: spoken.engine });
    }
    if (url.pathname === "/api/call" && post) {
      const input = await body(request);
      const [map, runtime] = await Promise.all([loadMap(), loadRuntime()]);
      // Recall: Mason asks the expert how their own project is put together.
      // The project is the one named, the one aimed at from the app window, or
      // the first one something is remembered about.
      if (input.kind === "recall" && input.action === "aim") {
        recallAim = String(input.project || "");
        return json(response, 200, { ok: true });
      }
      if (input.kind === "recall" && input.action === "start") {
        const wanted = String(input.project || "") || recallAim;
        recallAim = "";
        const memory = memories.get(wanted)?.left_off ? memories.get(wanted) : [...memories.values()].find((item) => item.left_off);
        if (!memory) return json(response, 409, { error: "Nothing is remembered about a project yet" });
        const agentId = await ensureAgent("recall");
        stopSpeaking();
        map.recall = { status: "live", project: memory.project, startedAt: new Date().toISOString(), results: [], turns: [] };
        await saveMap(map);
        await appendEvent({ type: "recall", action: "call", project: memory.project });
        broadcast("call");
        return json(response, 200, { signedUrl: await signedUrl(agentId), variables: recallContext({ memory, expert: ownerName() }) });
      }
      if (input.kind === "recall") {
        const recall = map.recall;
        if (!recall) return json(response, 409, { error: "No recall call is in progress" });
        const args = input.parameters || {};
        if (input.action === "tool" && input.tool === "mark") {
          const knew = String(args.outcome || "").toLowerCase() === "knew";
          const topic = short(args.topic, 60);
          recall.results.push({ topic, outcome: knew ? "knew" : "reminded" });
          await saveMap(map);
          await appendEvent({ type: "recall", project: recall.project, topic, outcome: knew ? "knew" : "reminded" });
          broadcast("teach");
          return json(response, 200, { result: "Recorded.", shown: { kind: knew ? "cleared" : "reminded", title: `${knew ? "Remembered" : "Reminded"} · ${topic}` } });
        }
        if (input.action === "tool" && input.tool === "finish") {
          recall.summary = short(args.summary, 400);
          await saveMap(map);
          return json(response, 200, { result: "Noted. Say nothing more.", closing: true });
        }
        if (input.action === "end") {
          recall.status = "ended";
          recall.endedAt = new Date().toISOString();
          recall.turns = (Array.isArray(input.turns) ? input.turns : []).slice(0, 80).map((turn) => ({ who: turn.who === "agent" ? "agent" : "expert", text: String(turn.text || "").slice(0, 1200) }));
          await saveMap(map);
          broadcast("call");
          const knew = recall.results.filter((item) => item.outcome === "knew").length;
          return json(response, 200, { ok: true, summary: recall.results.length ? `${knew} of ${recall.results.length} remembered` : "Call ended" });
        }
        return json(response, 400, { error: "Unknown recall action" });
      }
      // The tutor: the same line, the other role. It gets the rules, not the day.
      if (input.action === "start" && input.kind === "tutor") {
        const { ids, variables } = tutorContext({ map, expert: ownerName() });
        const agentId = await ensureAgent("tutor");
        stopSpeaking();
        map.tutor = { status: "live", startedAt: new Date().toISOString(), ids, results: [], turns: [] };
        await saveMap(map);
        await appendEvent({ type: "tutor", action: "call", rules: Object.keys(ids).length });
        broadcast("call");
        return json(response, 200, { signedUrl: await signedUrl(agentId), variables });
      }
      if (input.kind === "tutor") {
        const tutor = map.tutor;
        if (!tutor) return json(response, 409, { error: "No tutor call is in progress" });
        const args = input.parameters || {};
        if (input.action === "tool" && input.tool === "stop_decision") {
          const rule = map.decisions.find((item) => item.id === tutor.ids[String(args.rule_id || "").trim().toUpperCase()]);
          if (!rule) return json(response, 200, { result: "No such rule id. Use an id from the list." });
          tutor.results.push({ outcome: "stopped", rule: rule.id, title: rule.title, decision: short(args.decision, 160) });
          await saveMap(map);
          await appendEvent({ type: "teach-stop", guardrailId: rule.id, guardrailTitle: rule.title, quote: rule.quote, evidence: short(args.decision, 220), source: "Tutor call · unseen case" });
          broadcast("teach");
          // The stop is shown with the moment the owner said it: a rule is not
          // just a rule, it is something they said on a certain day, somewhere.
          const said = rule.moment?.at ? ` · said ${new Date(rule.moment.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${rule.moment.app ? ` in ${rule.moment.app}` : ""}` : "";
          return json(response, 200, { result: "Recorded. Ask what they would do instead.", shown: { kind: "stopped", title: `Stopped · ${rule.title}${said}` } });
        }
        if (input.action === "tool" && input.tool === "clear_decision") {
          const recovered = tutor.ids[String(args.recovered_rule || "").trim().toUpperCase()] || null;
          tutor.results.push({ outcome: recovered ? "recovered" : "cleared", rule: recovered, decision: short(args.decision, 160) });
          await saveMap(map);
          await appendEvent({ type: "teach-pass", excerpt: short(args.decision, 220), afterStop: recovered, source: "Tutor call · unseen case" });
          broadcast("teach");
          return json(response, 200, { result: "Recorded.", shown: { kind: "cleared", title: recovered ? "Got it right the second time" : "Clear" } });
        }
        if (input.action === "tool" && input.tool === "finish") {
          tutor.summary = short(args.summary, 400);
          await saveMap(map);
          return json(response, 200, { result: "Noted. Say nothing more.", closing: true });
        }
        if (input.action === "end") {
          tutor.status = "ended";
          tutor.endedAt = new Date().toISOString();
          tutor.turns = (Array.isArray(input.turns) ? input.turns : []).slice(0, 80).map((turn) => ({ who: turn.who === "agent" ? "agent" : "learner", text: String(turn.text || "").slice(0, 1200) }));
          await saveMap(map);
          broadcast("call");
          const stops = tutor.results.filter((item) => item.outcome === "stopped").length;
          return json(response, 200, { ok: true, summary: stops ? `${stops} stopped` : "Call ended" });
        }
        return json(response, 400, { error: "Unknown tutor action" });
      }
      // The debrief's two tools arrive the same way as the tutor's.
      if (input.action === "tool" && input.tool === "save_step") Object.assign(input, { action: "step", ...(input.parameters || {}) });
      if (input.action === "tool" && input.tool === "confirm_teach_back") Object.assign(input, { action: "confirm", ...(input.parameters || {}) });
      if (input.action === "start") {
        const since = runtime.session?.startedAt ? Date.parse(runtime.session.startedAt) : dayStart();
        const [events, index] = await Promise.all([readEventsSince(since), projectIndex(dayStart())]);
        const projects = summarizeProjects(events, index);
        const said = index.prompts().filter((prompt) => prompt.at >= since);
        const gaps = buildGaps(map, events, { since, projects, said });
        const agentId = await ensureAgent();
        const inferred = [...memories.values()].flatMap((memory) => (memory.keeps_saying || []).map((item) => ({ ...item, project: memory.project })));
        stopSpeaking();
        map.debrief = { id: randomUUID(), startedAt: new Date().toISOString(), since: new Date(since).toISOString(), gaps: [], teachBack: null, call: { status: "live", startedAt: new Date().toISOString(), saved: [], turns: [] } };
        runtime.debriefReady = false;
        runtime.lastDebriefAt = new Date().toISOString();
        await Promise.all([saveMap(map), saveRuntime(runtime)]);
        await appendEvent({ type: "debrief", action: "call", gaps: gaps.length });
        broadcast("call");
        return json(response, 200, { signedUrl: await signedUrl(agentId), variables: callContext({ map, projects, said, gaps, inferred, expert: ownerName() }) });
      }
      const call = map.debrief?.call;
      if (!call) return json(response, 409, { error: "No call is in progress" });
      if (input.action === "step") {
        const words = String(input.expert_words || "").trim().slice(0, 1200);
        if (!words) return json(response, 400, { error: "expert_words is empty" });
        const kind = input.kind === "guardrail" ? "guardrail" : input.kind === "rejected" ? "discarded" : "decision";
        const step = {
          id: `call-${randomUUID()}`,
          kind,
          title: short(input.title || words, 72),
          body: "Said on the debrief call.",
          quote: words,
          moment: { at: new Date().toISOString(), app: "Debrief call", window: String(input.project || "").slice(0, 80) || null, evidence: null },
          source: { label: "Debrief call · ElevenLabs agent", type: "call", at: new Date().toISOString(), answeredBy: "ElevenLabs Agents" },
        };
        map.decisions.unshift(step);
        call.saved.push({ id: step.id, kind, title: step.title });
        await saveMap(map);
        await writeWiki(map);
        await appendEvent({ type: "debrief-answer", via: "call", kind, title: step.title, answer: words });
        broadcast("debrief");
        return json(response, 200, { ok: true, saved: step.title, result: `Saved in the Work Map: ${step.title}`, shown: { kind, title: step.title } });
      }
      if (input.action === "confirm") {
        const confirmed = input.confirmed === true || input.confirmed === "true";
        map.debrief.teachBack = { text: String(input.summary || "").trim().slice(0, 2000), generatedAt: new Date().toISOString(), status: confirmed ? "confirmed" : "pending", confirmedAt: confirmed ? new Date().toISOString() : null, confirmedBy: confirmed ? "voice call" : null, corrections: [] };
        await saveMap(map);
        await writeWiki(map);
        await appendEvent({ type: "teach-back", status: confirmed ? "confirmed" : "declined", source: "call" });
        broadcast("debrief");
        return json(response, 200, { ok: true, confirmed, result: confirmed ? "Confirmed. Say \"Noted.\" and nothing more." : "Kept for later. Say nothing more.", closing: true });
      }
      if (input.action === "end") {
        call.status = "ended";
        call.endedAt = new Date().toISOString();
        call.conversationId = String(input.conversationId || "").slice(0, 80) || null;
        call.turns = (Array.isArray(input.turns) ? input.turns : []).slice(0, 80).map((turn) => ({ who: turn.who === "agent" ? "agent" : "expert", text: String(turn.text || "").slice(0, 1200) }));
        await saveMap(map);
        await appendEvent({ type: "debrief", action: "call-ended", saved: call.saved.length, seconds: Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000) });
        refreshMemories();
        broadcast("call");
        return json(response, 200, { ok: true, saved: call.saved.length, summary: call.saved.length ? `${call.saved.length} saved` : "Call ended" });
      }
      return json(response, 400, { error: "Unknown call action" });
    }
    if (url.pathname === "/api/transcript" && post) {
      const input = await body(request);
      const text = String(input.text || "").trim().slice(0, 3000);
      if (!text) return json(response, 400, { error: "Empty transcript" });
      const map = await loadMap();
      const source = "ElevenLabs Scribe v2 Realtime";
      // A spoken sentence goes to whatever Mason asked last: a live
      // question, a debrief gap, or the teach-back waiting for a yes.
      const question = map.questions.find((item) => item.status === "open" && Date.now() - Date.parse(item.askedAt) > 4000);
      const gap = debriefProgress(map.debrief).current;
      const teachBack = map.debrief?.teachBack?.status === "pending" ? map.debrief.teachBack : null;
      let linked = null;
      if (question) { await answerQuestion(map, question, text, source); linked = "question"; }
      else if (gap) { await answerGap(map, gap, text, source); linked = "debrief"; }
      else if (teachBack && confirmation.test(text)) { await confirmTeachBack(map, source); linked = "teach-back"; }
      await appendEvent({ type: "transcript", text, linked, source });
      broadcast("transcript");
      return json(response, 200, { ok: true, linked });
    }
    if (url.pathname === "/api/scribe-token" && post) {
      const key = process.env.ELEVENLABS_API_KEY;
      if (!key) return json(response, 412, { error: "ElevenLabs is not connected" });
      const upstream = await fetch("https://api.elevenlabs.io/v1/single-use-token/realtime_scribe", {
        method: "POST",
        headers: { "xi-api-key": key },
      });
      const value = await upstream.json();
      if (!upstream.ok) return json(response, upstream.status, { error: value.detail?.message || value.detail || "Could not create Scribe token" });
      return json(response, 200, { token: value.token });
    }
    if (url.pathname === "/api/settings") {
      if (post) {
        const input = await body(request);
        // Showing the folder is the one thing here that is not a setting.
        if (input.action === "reveal" || input.action === "notes") {
          if (process.env.APPRENTICE_COLLECT !== "0") spawn("open", [input.action === "notes" ? paths.wiki : paths.data], { stdio: "ignore", detached: true }).once("error", () => {}).unref();
          return json(response, 200, { ok: true });
        }
        // What was read by its meaning is forgotten only when that is asked for.
        if (input.action === "forget-said") {
          await forgetSaid();
          saidWaiting = null;
          repeatedMemo = { at: 0, value: [] };
          broadcast("said");
          return json(response, 200, { ok: true });
        }
        await saveSettings(input);
        // Switching the agents' logs on or off shows at once, not at the next reading.
        if ("logs" in input) { await projectIndex(dayStart(), { maxAgeMs: 0 }); activityMemo.at = 0; }
        // Switched on, the reading starts now; switched off, the model is stopped.
        if ("meaning" in input) { saidAt = 0; if (settings().meaning) catchUpSaid(); else stopEmbedder(); }
        // Switched on, the look for a new version is made now.
        if (input.updates === true) await lookForUpdate({ soon: true });
        broadcast("settings");
      }
      const runtime = await loadRuntime();
      return json(response, 200, {
        settings: settings(),
        name: ownerName(),
        status: {
          access: runtime.permission === "granted" ? "on" : runtime.permission === "needed" ? "needed" : "unknown",
          elevenLabs: Boolean(process.env.ELEVENLABS_API_KEY),
          elevenLabsKey: hasElevenLabsKey(),
          credits: await elevenLabsCredits(),
          model: modelStatus(),
          usage: await usagePayload(),
          update: await updatePayload(),
          // The model that places what was said, and how much it has read.
          said: { ...embedStatus(), ...(await saidStatus()), waiting: saidWaiting },
          logs: await logSources(),
          data: paths.data.replace(process.env.HOME || "\u0000", "~"),
        },
      });
    }
    if (url.pathname === "/api/access" && post) {
      const input = await body(request);
      const pane = {
        fix: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
        microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        sound: "x-apple.systempreferences:com.apple.Sound-Settings.extension",
      }[input.action];
      if (!pane) return json(response, 400, { error: "Unknown action" });
      // A rehearsal never touches the real app's access.
      if (process.env.APPRENTICE_COLLECT === "0") return json(response, 200, { ok: true, rehearsal: true });
      if (input.action === "fix") {
        // macOS ties the Accessibility switch to the exact build it was given
        // to. After an update the switch still reads "on" but no longer counts.
        // The old grant is forgotten and asked for again, for this build.
        await new Promise((resolve) => spawn("tccutil", ["reset", "Accessibility", "design.headless.apprentice"], { stdio: "ignore" }).once("error", resolve).once("exit", resolve));
        collector.first = true;
      }
      spawn("open", [pane], { stdio: "ignore", detached: true }).once("error", () => {}).unref();
      return json(response, 200, { ok: true });
    }
    if (url.pathname === "/api/podcast" && post) {
      const input = await body(request);
      const changed = () => broadcast("podcast");
      if (input.action === "make") {
        stopSpeaking();
        makeEpisode({ changed, listener: ownerName() });
      } else if (input.action === "play") {
        if (!(await playEpisode({ ended: changed }))) return json(response, 404, { error: "There is no episode yet" });
        changed();
      } else if (input.action === "stop") {
        stopSpeaking();
      } else return json(response, 400, { error: "Unknown action" });
      return json(response, 200, await podcastState());
    }
    if (url.pathname === "/api/recap" && post) {
      const map = await loadMap();
      map.recap = buildRecap(map, await readEvents(160), await todayActivity());
      await saveMap(map);
      await writeWiki(map);
      broadcast("recap");
      return json(response, 200, map.recap);
    }
    if (url.pathname === "/api/speak" && post) {
      const input = await body(request);
      if (input.stop) { stopSpeaking(); broadcast("spoken"); return json(response, 200, { ok: true }); }
      const map = await loadMap();
      // Only what Mason itself holds is spoken: nothing a caller sends is.
      const text = input.what === "recap" ? map.recap?.script : "";
      const { engine, done } = await speak(text);
      done.then(() => broadcast("spoken"));
      return json(response, 200, { engine });
    }
    if (url.pathname === "/mcp" && post) {
      const result = await handleMcp(await body(request));
      return result ? json(response, 200, result) : json(response, 202, {});
    }

    const requested = url.pathname === "/" ? "index.html" : url.pathname === "/overview" ? "overview.html" : url.pathname.replace(/^\//, "");
    const file = path.normalize(path.join(paths.public, requested));
    if (!file.startsWith(paths.public)) return json(response, 403, { error: "Not allowed" });
    const content = await readFile(file);
    // A page opened with the key in its address tells no other site where it came from.
    response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache", "referrer-policy": "no-referrer" });
    response.end(content);
  } catch (error) {
    if (!response.headersSent) json(response, error.code === "ENOENT" ? 404 : 500, { error: error.message });
    else response.end();
  }
});

async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopSpeaking();
  stopEmbedder();
  await collector.stop();
  desktop?.kill("SIGTERM");
  for (const response of clients) response.end();
  clients.clear();
  await unlink(pidFile).catch(() => {});
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 1200).unref();
}

const port = Number(process.env.PORT || 4317);
// A rehearsal on another port keeps its own pid file, so stopping it never hides the real one.
const pidFile = path.join(paths.root, ".runtime", port === 4317 ? "server.pid" : `server-${port}.pid`);
server.listen(port, "127.0.0.1", () => {
  writeFile(pidFile, `${process.pid}\n`).catch(() => {});
  if (process.platform === "darwin" && process.env.APPRENTICE_OVERLAY !== "0") {
    desktop = spawn(paths.status, [], { stdio: "ignore", env: { ...process.env, APPRENTICE_URL: `http://127.0.0.1:${port}`, APPRENTICE_KEY: key } });
    desktopStartedAt = Date.now();
    desktop.once("error", () => { desktop = null; });
    // Quitting the desktop app is how Mason is stopped. A crash is not a quit.
    desktop.once("exit", (code) => { desktop = null; if (code === 0) shutdown(); });
  }
  // The first read of the project logs takes a couple of seconds; do it before anyone asks.
  projectIndex(dayStart()).then(refreshMemories).catch(() => {});
  // Cheap when nothing was said since: a project is only summarised again
  // after new prompts, and at most every ten minutes.
  setInterval(refreshMemories, 60_000).unref();
  // The long view is caught up once Mason is running, not while it starts.
  setTimeout(catchUpDays, 15_000).unref();
  setInterval(catchUpDays, 10 * 60_000).unref();
  // At the very first start the window opens by itself, with the welcome in it.
  if (firstStart) {
    setTimeout(() => {
      try { if (desktop) desktop.kill("SIGUSR2"); else if (desktopPid) process.kill(desktopPid, "SIGUSR2"); } catch {}
    }, 5000).unref();
  }
  // A new version is looked for a little after the start, and then a few times a day; a look is made at most once a day.
  setTimeout(() => lookForUpdate().catch(() => {}), 30_000).unref();
  setInterval(() => lookForUpdate().catch(() => {}), 6 * 3_600_000).unref();
  setTimeout(catchUpSaid, 30_000).unref();
  setInterval(catchUpSaid, 10 * 60_000).unref();
  // The desktop app has the key already, and what it starts writes to a log
  // file, where the key does not belong.
  console.log(desktopPid ? `Mason is running locally: http://127.0.0.1:${port}` : `Mason is running locally. Open it with the key of this start:\n  http://127.0.0.1:${port}/?key=${key}`);
  console.log("Stop with Ctrl+C or by quitting Mason. What leaves this Mac is listed, each with a switch, under Leaves this Mac in Settings.");
});

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, shutdown);
// Started by the desktop app: when the app is gone, however it went, so is this.
if (desktopPid) {
  setInterval(() => {
    try { process.kill(desktopPid, 0); } catch { shutdown(); }
  }, 4000).unref();
}
