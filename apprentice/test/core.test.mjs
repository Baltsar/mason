import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "../src/redact.mjs";
import { rankQuestion, rankSwitch } from "../src/question-engine.mjs";
import { catchGuardrail, mastery, reviewDecision } from "../src/teach-engine.mjs";
import { aggregateActivity, classifyActivity, dayStart } from "../src/activity.mjs";
import { buildGaps, buildTeachBack, confirmation, debriefProgress } from "../src/debrief.mjs";
import { summarizeProjects } from "../src/projects.mjs";
import { callContext } from "../src/agent.mjs";
import { plainScript } from "../src/podcast.mjs";
import { hearing } from "../public/voice.js";

test("redacts local secrets before persistence", () => {
  const value = redact("Mail gustaf@example.com password=hunter2 api_key=abcdefghijklmnop");
  assert.equal(value.includes("gustaf@example.com"), false);
  assert.equal(value.includes("hunter2"), false);
  assert.equal(value.includes("abcdefghijklmnop"), false);
});

test("asks a guardrail question only after a pause", () => {
  const input = { prompt: "Do not build on the invoice screen. It is the wrong object.", recentApps: ["Codex"], runtime: { questionsToday: 0 } };
  assert.equal(rankQuestion({ ...input, pauseMs: 1000 }), null);
  const question = rankQuestion({ ...input, pauseMs: 9000 });
  assert.equal(question.kind, "guardrail");
  assert.match(question.text, /never/i);
});

test("does not ask while off the record", () => {
  const question = rankQuestion({ prompt: "Do not build on this direction.", pauseMs: 9000, recentApps: [], runtime: { offTheRecord: true } });
  assert.equal(question, null);
});

test("Teach stops a new attempt to iterate the rejected surface", () => {
  const intervention = catchGuardrail("Polish demo/index.html and continue the invoice UI", {
    decisions: [{ id: "d1", kind: "discarded", title: "The invoice UI is the wrong object", quote: "Do not build on it.", source: { label: "Handover" } }],
  });
  assert.match(intervention.text, /Stop/);
  assert.match(intervention.text, /Do not build/);
  assert.equal(catchGuardrail("Build a local harness for real prompts", { decisions: [] }), null);
});

test("classifies Facebook as social and private surfaces as absent", () => {
  assert.equal(classifyActivity({ app: "Comet", window: "Facebook" }).group, "social");
  assert.equal(classifyActivity({ app: "Safari", window: "My bank account" }), null);
  assert.equal(classifyActivity({ app: "Codex", window: "Build the apprentice" }).group, "work");
  assert.equal(classifyActivity({ app: "Spotify", window: "Discover Weekly" }).group, "other");
});

test("aggregates a work/social split from measured active time", () => {
  const report = aggregateActivity([
    { type: "activity", app: "Codex", group: "work", category: "Creating", color: "#d7ff42", durationSec: 80 },
    { type: "activity", app: "Comet", group: "social", category: "Social", color: "#ff8b68", durationSec: 20 },
  ]);
  assert.equal(report.workPercent, 80);
  assert.equal(report.socialPercent, 20);
});

test("the three groups always read as exactly 100 percent", () => {
  const report = aggregateActivity([
    { type: "activity", app: "Codex", window: "Build", group: "work", category: "Creating", durationSec: 100 },
    { type: "activity", app: "Comet", window: "Facebook", group: "social", category: "Social", durationSec: 100 },
    { type: "activity", app: "Spotify", window: "Discover Weekly", group: "other", category: "Leisure", durationSec: 100 },
  ]);
  assert.equal(report.workPercent + report.socialPercent + report.otherPercent, 100);
  assert.equal(report.groups.work.apps[0].app, "Codex");
  assert.equal(report.groups.social.windows[0].window, "Facebook");
});

test("reading in a browser is research, a post on X is social, the lock screen is nothing", () => {
  assert.equal(classifyActivity({ app: "Comet", window: "ElevenAgents quickstart" }).category, "Research");
  assert.equal(classifyActivity({ app: "Comet", window: "(2) Home / X" }).group, "social");
  assert.equal(classifyActivity({ app: "loginwindow", window: "" }), null);
});

test("the apprentice's day turns over at four in the morning", () => {
  const late = new Date(2026, 9, 4, 1, 30).getTime();
  assert.equal(new Date(dayStart(late)).getDate(), 3);
  assert.equal(new Date(dayStart(late)).getHours(), 4);
});

test("a capture session asks about any real step and reaches a guardrail by the third question", () => {
  const prompt = "Move the island to the top of the screen and keep the panel under it.";
  const session = { active: true, questions: 0, guardrailAsked: false };
  assert.equal(rankQuestion({ prompt, app: "Codex", pauseMs: 9000, runtime: {} }), null);
  const first = rankQuestion({ prompt, app: "Codex", pauseMs: 9000, runtime: { session } });
  assert.equal(first.kind, "reason");
  assert.ok(first.text.split(" ").length <= 7, "a live question is read in a second");
  const third = rankQuestion({ prompt, app: "Codex", pauseMs: 9000, runtime: { session: { ...session, questions: 2 } } });
  assert.equal(third.kind, "guardrail");
  const tooSoon = rankQuestion({ prompt, pauseMs: 9000, runtime: { session, lastQuestionAt: new Date().toISOString() } });
  assert.equal(tooSoon, null);
  assert.equal(rankQuestion({ prompt, pauseMs: 9000, runtime: { session: { ...session, questions: 5 } } }), null);
});

test("a move between apps is asked about only in a session and only once the hands are still", () => {
  const move = { from: "Codex", to: "Comet", window: "ElevenLabs docs" };
  const session = { active: true, questions: 0, guardrailAsked: false };
  assert.equal(rankSwitch({ ...move, idleMs: 9000, runtime: {} }), null);
  assert.equal(rankSwitch({ ...move, idleMs: 1000, runtime: { session } }), null);
  assert.match(rankSwitch({ ...move, idleMs: 9000, runtime: { session } }).text, /Comet/);
});

test("the debrief asks three things the task left open, an unanswered live question first", () => {
  const map = {
    decisions: [],
    questions: [{ id: "q1", status: "parked", kind: "guardrail", text: "What must never continue here?", evidence: "Skit i tailscale", askedAt: "2026-10-04T10:00:00.000Z", source: { app: "Codex" } }],
  };
  const events = [
    { type: "window", app: "Codex", window: "Apprentice", at: "2026-10-04T10:00:00.000Z" },
    { type: "prompt", app: "Codex", window: "Apprentice", excerpt: "We must never store a screen recording.", fingerprint: "abc", at: "2026-10-04T10:01:00.000Z" },
  ];
  const gaps = buildGaps(map, events);
  assert.equal(gaps.length, 3);
  assert.match(gaps[0].text, /Earlier I asked/);
  assert.match(gaps[1].text, /you set a limit/);
  assert.ok(gaps.every((gap) => gap.title && gap.status === "open"));
  assert.equal(debriefProgress({ gaps }).understood, false);
});

test("the teach-back is built from the expert's words and waits for a yes", () => {
  const teachBack = buildTeachBack({
    decisions: [
      { id: "a", kind: "decision", title: "Sit behind the work", body: "…", quote: "It belongs behind my own work." },
      { id: "b", kind: "guardrail", title: "Events, not film", body: "…", quote: "Never save a film of the day." },
    ],
  });
  assert.equal(teachBack.status, "pending");
  assert.match(teachBack.text, /It belongs behind my own work/);
  assert.match(teachBack.text, /Never save a film of the day/);
  assert.match("Yes, that is how it works.", confirmation);
  assert.doesNotMatch("No, the recap is daily.", confirmation);
});

test("the tutor stops an unseen case with a guardrail learned live, in the expert's words", () => {
  const map = {
    decisions: [{
      id: "learned-1", kind: "guardrail", title: "Guardrail: ship the release",
      body: "What must the next agent never continue here?",
      quote: "Never ship without running the tests first.",
      moment: { at: "2026-10-04T10:00:00.000Z", app: "Codex", evidence: "ship the release tonight" },
      source: { label: "Live question · Codex" },
    }],
  };
  const stopped = reviewDecision("We are late. Deploy the fix now and skip the tests.", map);
  assert.equal(stopped.intervention.guardrailId, "learned-1");
  assert.match(stopped.intervention.text, /Never ship without running the tests first/);
  assert.equal(stopped.intervention.moment.app, "Codex");
  assert.equal(reviewDecision("Rename the settings page.", map).intervention, null);
  const events = [{ type: "teach-stop", guardrailId: "learned-1" }, { type: "teach-pass", afterStop: "learned-1" }];
  assert.equal(mastery(map, events).items[0].state, "mastered");
});

test("time inside a project is work whatever the window is called, and moves between projects are counted", () => {
  const index = {
    list: [],
    resolve: ({ window = "" }) => /bitmagic/i.test(window) ? "BITMAGIC" : /apprentice/i.test(window) ? "HACKNATION" : null,
    prompts: () => [{ at: Date.parse("2026-10-04T10:05:00.000Z"), project: "BITMAGIC", text: "Fix the rematch bug." }],
  };
  const events = [
    { type: "activity", app: "Comet", window: "Bitmagic Game", group: "other", category: "Leisure", durationSec: 600, startedAt: "2026-10-04T10:00:00.000Z" },
    { type: "activity", app: "Comet", window: "GTA - YouTube", group: "social", category: "Social", durationSec: 120, startedAt: "2026-10-04T10:10:00.000Z" },
    { type: "activity", app: "Comet", window: "Bitmagic Game", group: "other", category: "Leisure", durationSec: 60, startedAt: "2026-10-04T10:12:00.000Z" },
    { type: "activity", app: "Comet", window: "Apprentice", group: "other", category: "Other", durationSec: 240, startedAt: "2026-10-04T10:13:00.000Z" },
  ];
  const report = aggregateActivity(events, Date.now(), index.resolve);
  assert.equal(report.groups.work.seconds, 900);
  assert.equal(report.groups.social.seconds, 120);
  const summary = summarizeProjects(events, index);
  assert.deepEqual(summary.projects.map((item) => item.name), ["BITMAGIC", "HACKNATION"]);
  assert.equal(summary.projects[0].lastSaid.text, "Fix the rematch bug.");
  assert.equal(summary.switches, 1);
  assert.equal(summary.offProject.seconds, 120);
  const gaps = buildGaps({ decisions: [], questions: [] }, events, { projects: summary, said: index.prompts() });
  assert.match(gaps[0].text, /In the middle of BITMAGIC you spent 2 minutes/);
});

test("the agent is told sites, never the titles of what was watched", () => {
  const context = callContext({
    map: { decisions: [] },
    projects: { projects: [{ name: "BITMAGIC", seconds: 600, prompts: 1, apps: ["Comet"] }], switches: 0, offProject: { seconds: 300, windows: [{ app: "Comet", window: "Some embarrassing video - YouTube", seconds: 300 }] } },
    said: [],
    gaps: [],
  });
  assert.match(context.opening, /I watched you work on BITMAGIC today/);
  assert.match(context.context, /YouTube \(5 min\)/);
  assert.doesNotMatch(context.context, /embarrassing/);
});

test("the week is told from the counts alone when no model answers, with the repeated line word for word", () => {
  const script = plainScript({
    projects: [
      { name: "KUBB", minutes: 600, prompts: 80, days: 4, last: "fix the rematch", leftOff: "The rematch is broken.", open: ["Network lag in multiplayer."] },
      { name: "SITE", minutes: 45, prompts: 6, days: 1, last: "publish it", leftOff: null, open: [] },
    ],
    totals: { projects: 2, prompts: 86, minutes: 645, busiest: { day: "Thursday", prompts: 40 } },
    quote: { times: 3, example: "Ja sluta fråga publicera", project: "KUBB" },
  });
  const spoken = script.lines.map((line) => line.text).join(" ");
  assert.match(spoken, /2 projects, 86 instructions, 11 hours/);
  assert.match(spoken, /The rematch is broken\./);
  assert.match(spoken, /The last thing you said was: publish it/);
  assert.match(spoken, /said 3 times: Ja sluta fråga publicera/);
  assert.match(spoken, /Still open: Network lag in multiplayer\./);
  assert.deepEqual(script.headlines, ["KUBB: 10 hours", "SITE: 45 minutes"]);
  assert.ok(script.lines.every((line) => line.speaker === "anchor" || line.speaker === "reporter"));
});

test("an open microphone is told apart: a voice, quiet, or no sound at all", () => {
  let now = 1000;
  const clock = () => now;
  const live = hearing(clock);
  assert.equal(live(0.01), "open");
  assert.equal(live(0.4), "hearing");
  now += 300;
  assert.equal(live(0.01), "hearing");
  now += 400;
  assert.equal(live(0.01), "open");
  now += 10_000;
  assert.equal(live(0.01), "open");
  // While the agent talks, a trace of its voice in the microphone is not the person.
  assert.equal(live(0.2, { floor: 0.3 }), "open");
  assert.equal(live(0.01, { muted: true }), "silent");

  const dead = hearing(clock);
  assert.equal(dead(0), "open");
  now += 2600;
  assert.equal(dead(0), "silent");
});
