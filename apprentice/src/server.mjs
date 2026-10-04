import http from "node:http";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Collector } from "./collector.mjs";
import { appendEvent, ensureStore, eventsVersion, loadMap, loadRuntime, paths, readEvents, readEventsSince, saveMap, saveRuntime, useMemoryStore } from "./store.mjs";
import { buildRecap, writeWiki } from "./wiki.mjs";
import { speak, stopSpeaking, voiceStatus } from "./voice.mjs";
import { handleMcp } from "./mcp-handler.mjs";
import { loadLocalEnv } from "./config.mjs";
import { aggregateActivity, dayStart } from "./activity.mjs";
import { mastery, reviewDecision } from "./teach-engine.mjs";
import { buildGaps, buildTeachBack, confirmation, debriefProgress } from "./debrief.mjs";
import { projectIndex, summarizeProjects } from "./projects.mjs";
import { callContext, ensureAgent, recallContext, signedUrl, tutorContext } from "./agent.mjs";
import { mergeInferred, projectMemory } from "./memory.mjs";
import { makeEpisode, playEpisode, podcastBusy, podcastState } from "./podcast.mjs";

useMemoryStore();
await loadLocalEnv();
await ensureStore();
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
if (process.env.APPRENTICE_COLLECT !== "0") collector.start();
let desktop = null;
let desktopStartedAt = 0;
const desktopPid = Number(process.env.APPRENTICE_DESKTOP_PID) || null;
let stopping = false;

const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8" };
const short = (text, max = 64) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

async function body(request) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 1_000_000) throw new Error("Request too large");
  }
  return data ? JSON.parse(data) : {};
}

function json(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

// Today's split is asked for every few seconds by the island, so it is only
// recomputed when an event was actually written.
let activityMemo = { version: -1, day: 0, at: 0, value: null, projects: null };
async function today() {
  const day = dayStart();
  // A new prompt in a project log changes the picture without any new event,
  // so the memo also ages out after a few seconds.
  if (activityMemo.value && activityMemo.version === eventsVersion() && activityMemo.day === day && Date.now() - activityMemo.at < 15_000) return activityMemo;
  const [events, index] = await Promise.all([readEventsSince(day), projectIndex(day)]);
  activityMemo = { version: eventsVersion(), day, at: Date.now(), value: aggregateActivity(events, Date.now(), (sample) => index.of(sample)), projects: summarizeProjects(events, index) };
  return activityMemo;
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
  } catch {} finally { refreshing = false; summarising = false; }
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
  const [map, runtime, events, activity, projects, sinceMorning, index, podcast] = await Promise.all([loadMap(), loadRuntime(), readEvents(60), todayActivity(), todayProjects(), readEventsSince(dayStart()), projectIndex(dayStart()), podcastState()]);
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
    now: { project: inFront, recent },
    presence: presence(runtime),
    voice: voiceStatus(),
    debrief: debriefProgress(map.debrief),
    teach: mastery(map, sinceMorning),
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
  const [map, runtime, activity, index] = await Promise.all([loadMap(), loadRuntime(), todayActivity(), projectIndex(dayStart())]);
  const question = map.questions.find((item) => item.status === "open");
  const project = runtime.currentApp ? index.resolve({ app: runtime.currentApp, window: runtime.currentWindow || "", at: new Date().toISOString() }) : null;
  return {
    status: presence(runtime),
    app: runtime.currentApp,
    project,
    returning: returningTo(runtime, project),
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

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    const post = request.method === "POST";
    if (url.pathname === "/api/island" && request.method === "GET") return json(response, 200, await islandPayload());
    if (url.pathname === "/api/state" && request.method === "GET") return json(response, 200, await statePayload());
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
      // Recall: Apprentice asks the expert how their own project is put together.
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
        return json(response, 200, { signedUrl: await signedUrl(agentId), variables: recallContext({ memory }) });
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
        const { ids, variables } = tutorContext({ map });
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
          return json(response, 200, { result: "Recorded. Ask what they would do instead.", shown: { kind: "stopped", title: `Stopped · ${rule.title}` } });
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
        return json(response, 200, { signedUrl: await signedUrl(agentId), variables: callContext({ map, projects, said, gaps, inferred }) });
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
      // A spoken sentence goes to whatever the apprentice asked last: a live
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
        makeEpisode({ changed });
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
    if (url.pathname === "/api/teach" && post) {
      const input = await body(request);
      const prompt = String(input.prompt || "").trim().slice(0, 3000);
      if (!prompt) return json(response, 400, { error: "Enter a decision to review" });
      const map = await loadMap();
      const { intervention, checked } = reviewDecision(prompt, map);
      await appendEvent(intervention
        ? { type: "teach-stop", ...intervention, source: "Teach · unseen case" }
        : { type: "teach-pass", excerpt: prompt, afterStop: input.afterStop || null, source: "Teach · unseen case" });
      await speak(intervention ? intervention.text : "That holds. Nothing the expert said stops this decision.", `teach-${Date.now()}`);
      broadcast("teach");
      return json(response, 200, intervention
        ? { stopped: true, intervention, checked }
        : { stopped: false, checked, message: `Checked against ${checked} guardrails in the expert’s words. Nothing stops this decision.` });
    }
    if (url.pathname === "/api/speak" && post) {
      const input = await body(request);
      if (input.stop) { stopSpeaking(); broadcast("spoken"); return json(response, 200, { ok: true }); }
      const map = await loadMap();
      const text = input.what === "recap" ? map.recap?.script : String(input.text || "");
      const { engine, done } = await speak(text);
      done.then(() => broadcast("spoken"));
      return json(response, 200, { engine });
    }
    if (url.pathname === "/mcp" && post) {
      const result = await handleMcp(await body(request));
      return result ? json(response, 200, result) : json(response, 202, {});
    }
    if (url.pathname === "/source/handover" && request.method === "GET") {
      const source = await readFile(path.join(paths.root, "..", "HANDOVER.md"));
      response.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
      response.end(source);
      return;
    }

    const requested = url.pathname === "/" ? "index.html" : url.pathname === "/overview" ? "overview.html" : url.pathname.replace(/^\//, "");
    const file = path.normalize(path.join(paths.public, requested));
    if (!file.startsWith(paths.public)) return json(response, 403, { error: "Not allowed" });
    const content = await readFile(file);
    response.writeHead(200, { "content-type": mime[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
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
    desktop = spawn(paths.status, [], { stdio: "ignore", env: { ...process.env, APPRENTICE_URL: `http://127.0.0.1:${port}` } });
    desktopStartedAt = Date.now();
    desktop.once("error", () => { desktop = null; });
    // Quitting the desktop app is how Apprentice is stopped. A crash is not a quit.
    desktop.once("exit", (code) => { desktop = null; if (code === 0) shutdown(); });
  }
  // The first read of the project logs takes a couple of seconds; do it before anyone asks.
  projectIndex(dayStart()).then(refreshMemories).catch(() => {});
  // Cheap when nothing was said since: a project is only summarised again
  // after new prompts, and at most every ten minutes.
  setInterval(refreshMemories, 60_000).unref();
  console.log(`Apprentice is running locally: http://127.0.0.1:${port}`);
  console.log("Stop with Ctrl+C or by quitting Apprentice. No data leaves this Mac unless an ElevenLabs key is configured.");
});

for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, shutdown);
// Started by the desktop app: when the app is gone, however it went, so is this.
if (desktopPid) {
  setInterval(() => {
    try { process.kill(desktopPid, 0); } catch { shutdown(); }
  }, 4000).unref();
}
