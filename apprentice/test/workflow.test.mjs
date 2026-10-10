import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder the first time it is loaded. This file writes,
// so the folder and the switched-off model are set before anything under src is.
const root = await mkdtemp(path.join(os.tmpdir(), "mason-workflow-"));
process.env.APPRENTICE_DATA = root;
process.env.APPRENTICE_LLM = "0";
const { aboutOf, cardOf, fileOf, placeProjects, roleOf, saveWorkflow, screenOf, workflowPayload } = await import("../src/workflow.mjs");

// Local times, as the day is the owner's day and not the UTC one.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const minutesFrom = (start, count) => new Set(Array.from({ length: count }, (_, index) => Math.floor(start / 60_000) + index));
const words = (count) => Array.from({ length: count }, () => "word").join(" ");
const project = (name, fields = {}) => ({ name, minutes: new Set(), prompts: [], turns: [], ...fields });
const spent = (app, start, seconds, more = {}) => ({ type: "activity", app, window: "", startedAt: new Date(start).toISOString(), durationSec: seconds, group: "work", ...more });

test("a known tool gets its role, a mark in front of its name is ignored, and an unknown name is left unnamed", () => {
  assert.equal(roleOf("Claude"), "coding agent");
  assert.equal(roleOf("Figma"), "design");
  assert.equal(roleOf("iTerm2"), "terminal");
  // The mark some apps put in front of their name, for the direction of writing.
  assert.equal(roleOf("\u200eWhatsApp"), "chat with people");
  assert.equal(roleOf("acme-customer.com"), null);
});

test("a minute two projects shared counts once, and what falls outside the window is left out", () => {
  const from = at(8, 9);
  const to = at(8, 18);
  const card = cardOf([
    project("shop", {
      // Forty minutes from ten, and half an hour that morning, before the window.
      minutes: new Set([...minutesFrom(at(8, 10), 40), ...minutesFrom(at(8, 6), 30)]),
      prompts: [
        { at: at(8, 10), text: "make the door remember" },
        { at: at(8, 10, 4), text: "and show the list" },
        { at: at(8, 8), text: "before the window", agent: "Grok" },
      ],
      turns: [
        { prompt: at(8, 10), done: at(8, 10, 1), ended: true },
        { prompt: at(8, 11), done: at(8, 11, 5), ended: false },
        { prompt: at(8, 8), done: at(8, 8, 5), ended: true },
      ],
      handed: { Codex: 2, Cursor: 1 },
    }),
    project("site", {
      // The first twenty of those minutes, and a stretch after the window closed.
      minutes: new Set([...minutesFrom(at(8, 10), 20), ...minutesFrom(at(8, 19), 15)]),
      prompts: [
        { at: at(8, 10, 2), text: "keep the type large", agent: "Codex" },
        { at: at(8, 10, 6), text: "and the price under it", agent: "Codex" },
        { at: at(8, 19), text: "after the window", agent: "Grok" },
      ],
      handed: { Codex: 3 },
    }),
    project("old-yard", {
      minutes: minutesFrom(at(7, 12), 80),
      prompts: [{ at: at(7, 12), text: "last month", agent: "Grok" }],
      turns: [{ prompt: at(7, 12), done: at(7, 13), ended: true }],
    }),
  ], { from, to });

  // Twenty minutes belong to both, twenty to shop alone: forty minutes, half of them shared.
  assert.equal(card.minutes, 40);
  assert.equal(card.projects, 2);
  assert.equal(card.prompts, 4);
  assert.equal(card.days, 1);
  assert.deepEqual(card.parallel, { usual: 2, share: 50 });
  // No agent on a prompt means it was said to Claude Code. The two shares add up.
  assert.deepEqual(card.agents, [
    { name: "Claude Code", prompts: 2, share: 50 },
    { name: "Codex", prompts: 2, share: 50 },
  ]);
  assert.equal(card.agents.reduce((sum, agent) => sum + agent.share, 0), 100);
  assert.deepEqual(card.handed, [{ name: "Codex", sessions: 5 }, { name: "Cursor", sessions: 1 }]);
  // Under an hour, and under eight finished turns, neither pace is said.
  assert.equal(card.perHour, null);
  assert.equal(card.turn, null);
  assert.equal(card.piece, null);
});

test("how often something is asked is said once an hour of work is in the window", () => {
  const pace = (count, prompts) => cardOf([
    project("shop", { minutes: minutesFrom(at(9, 9), count), prompts: Array.from({ length: prompts }, (_, index) => ({ at: at(9, 9) + index * 60_000, text: "again" })) }),
  ], { from: at(9, 8), to: at(9, 20) }).perHour;
  assert.equal(pace(59, 5), null);
  assert.equal(pace(60, 5), 5);
  assert.equal(pace(70, 7), 6);
});

test("a turn is the middle one that finished, and only once eight of them did", () => {
  const from = at(8, 9);
  const to = at(8, 18);
  const prompt = at(8, 11);
  const finished = (seconds) => ({ prompt, done: prompt + seconds * 1000, ended: true });
  const turns = [10, 20, 30, 40, 50, 60, 70, 80].map(finished);
  const card = cardOf([project("shop", { turns })], { from, to });
  assert.equal(cardOf([project("shop", { turns: turns.slice(0, 7) })], { from, to }).turn, null);
  // One that did not end, one of no length, and one from before the window.
  const ignored = [
    { prompt, done: prompt + 500_000, ended: false },
    { prompt, done: prompt, ended: true },
    { prompt: prompt + 5_000, done: prompt, ended: true },
    { prompt: at(8, 8), done: at(8, 8) + 500_000, ended: true },
  ];
  assert.deepEqual(cardOf([project("shop", { turns: [...turns, ...ignored] })], { from, to }).turn, { seconds: 50, long: 80, count: 8 });
  assert.deepEqual(card.turn, { seconds: 50, long: 80, count: 8 });
});

test("a piece of work runs until a silence of more than thirty minutes, and its words are counted up to eighty", () => {
  const said = (name, hour, minute, count) => ({ name, at: at(8, hour, minute), text: words(count) });
  const lines = [
    // Exactly thirty minutes apart: still the one piece. A thirty-first minute starts another.
    said("atlas", 8, 0, 90), said("atlas", 8, 30, 90),
    said("atlas", 9, 1, 85), said("atlas", 9, 11, 100),
    // Said in another project during the gap, so the silence is counted per project.
    said("beacon", 9, 20, 100), said("beacon", 9, 30, 81),
    said("atlas", 11, 0, 100), said("atlas", 11, 10, 50),
    said("atlas", 12, 0, 70), said("atlas", 12, 10, 120),
    // One prompt on its own is not a piece of work.
    said("atlas", 14, 0, 4),
  ];
  const byName = new Map();
  for (const line of lines) {
    const current = byName.get(line.name) || project(line.name);
    current.prompts.push({ at: line.at, text: line.text });
    byName.set(line.name, current);
  }
  const piece = cardOf([...byName.values()], { from: at(8, 7), to: at(8, 18) }).piece;
  assert.deepEqual(piece, { count: 5, prompts: 2, minutes: 10, opener: 80, follower: 80, atLeast: true });
});

test("the screen names only known tools, and says nothing until an hour was spent in front of it", () => {
  assert.equal(screenOf([]), null);
  assert.equal(screenOf([spent("Claude", at(8, 10), 3599)]), null);
  const hour = screenOf([spent("Claude", at(8, 10), 3600)]);
  assert.equal(hour.hours, 1);
  assert.deepEqual(hour.tools, [{ name: "Claude", role: "coding agent", share: 100 }]);
  assert.equal(hour.other, 0);

  const events = [
    spent("Claude", at(8, 10), 2000),
    spent("Figma", at(8, 10, 1), 1000),
    spent("iTerm2", at(8, 10, 2), 500),
    spent("\u200eWhatsApp", at(8, 10, 3), 500),
    spent("Comet", at(8, 10, 4), 1000, { host: "acme-customer.com", window: "Account" }),
  ];
  const screen = screenOf(events);
  assert.equal(screen.hours, 1);
  assert.deepEqual(screen.tools, [
    { name: "Claude", role: "coding agent", share: 40 },
    { name: "Figma", role: "design", share: 20 },
    { name: "iTerm2", role: "terminal", share: 10 },
    { name: "WhatsApp", role: "chat with people", share: 10 },
  ]);
  // The customer's site is kept in the rest, and never named.
  assert.equal(screen.other, 20);
  assert.equal(JSON.stringify(screen.tools).includes("acme-customer.com"), false);

  // Only the moments `mine` keeps are on this screen. Without Figma the hour is still there.
  const kept = screenOf(events, { mine: (event) => event.app !== "Figma" });
  assert.deepEqual(kept.tools.map((tool) => [tool.name, tool.share]), [["Claude", 50], ["iTerm2", 13], ["WhatsApp", 13]]);
  assert.equal(kept.other, 25);
  // The days are the days this work was on the screen, not every day that was watched.
  assert.equal(screenOf([...events, spent("Figma", at(9, 10), 600)], { mine: (event) => event.app !== "Figma" }).days, 1);
  assert.equal(screenOf([...events, spent("Figma", at(9, 10), 600)]).days, 2);
  assert.equal(screenOf(events, { mine: () => false }), null);
});

test("what a project is said to be comes from memory, or else from the first things asked", () => {
  assert.equal(
    aboutOf(project("shop", { prompts: [{ text: "this was asked" }] }), { one_line: "A door that remembers", built: ["The list", "The bell", "The third"] }),
    "A door that remembers. The list. The bell",
  );
  assert.equal(
    aboutOf(project("shop", { prompts: [{ text: "  first thing  " }, { text: "second thing" }, { text: "third thing" }, { text: "fourth thing" }] }), {}),
    "first thing / second thing / third thing",
  );
});

test("with no model every project comes back without a purpose", async () => {
  assert.deepEqual(await placeProjects([
    { name: "north-pier", about: "A door that remembers who came through" },
    { name: "glass-harbour", about: "" },
  ]), { "north-pier": null, "glass-harbour": null });
});

// Enough work for two purposes, and one purpose that stays under a couple of hours.
const sampleWorkflow = () => workflowPayload({
  index: {
    list: [
      project("north-pier", { minutes: minutesFrom(at(10, 8), 150), prompts: [{ at: at(10, 9), text: "Make the door remember who came through" }] }),
      project("glass-harbour", { minutes: minutesFrom(at(10, 8), 119), prompts: [{ at: at(10, 9), text: "Put the price where it can be seen" }] }),
      project("paper-lantern", { minutes: minutesFrom(at(10, 8), 120), prompts: [{ at: at(10, 9), text: "Cut the film down to the one scene" }] }),
      project("speck-lane", { minutes: minutesFrom(at(10, 14), 10), prompts: [{ at: at(10, 14), text: "Rename the label" }] }),
    ],
    turns: () => [],
    of: (event) => event.project || null,
  },
  events: [],
  suggestions: {
    applied: [{ id: "written-one", rule: "Leave the copy in the owner's words" }],
    open: [
      { id: "quiet-first", rule: "Keep the first screen quiet", projects: 1, times: 5, evidence: [{ project: "north-pier", example: "quieter" }] },
      { id: "both", rule: "Show the thing, do not describe it", projects: 2, times: 4, evidence: [{ project: "glass-harbour", example: "show it" }, { project: "north-pier", example: "no essay" }] },
      { id: "friday-ship", rule: "Ship the work on Friday", projects: 1, times: 3, evidence: [{ project: "glass-harbour", example: "on friday" }] },
    ],
  },
  owner: "S. Hale",
  now: at(10, 16),
  place: async (known) => Object.fromEntries(known.map((item) => [item.name, { "north-pier": "build", "glass-harbour": "design", "paper-lantern": "content" }[item.name] || null])),
});

test("there is always one card for all the work, and a purpose gets its own only after a couple of hours", async () => {
  const payload = await sampleWorkflow();
  assert.deepEqual(payload.cards.map((card) => card.purpose), ["all", "build", "content"]);
  assert.equal(Object.hasOwn(payload.cards[0], "names"), false);
  assert.equal(payload.cards[1].minutes, 150);
  assert.deepEqual(payload.cards[1].names, ["north-pier"]);
  assert.equal(payload.cards[2].minutes, 120);
  assert.deepEqual(payload.cards[2].names, ["paper-lantern"]);
  // A rule is on the purpose's card only when its evidence names one of that card's projects.
  assert.deepEqual(payload.cards[0].rules.map((rule) => rule.id), ["quiet-first", "both", "friday-ship", "written-one"]);
  assert.deepEqual(payload.cards[1].rules.map((rule) => rule.id), ["quiet-first", "both"]);
  assert.deepEqual(payload.cards[2].rules, []);
});

const carriesNames = (value) => {
  if (Array.isArray(value)) return value.some(carriesNames);
  if (value && typeof value === "object") return Object.hasOwn(value, "names") || Object.values(value).some(carriesNames);
  return false;
};

test("a file to hand over says the purpose in words, keeps the chosen rules, and no name of a project", async () => {
  const payload = await sampleWorkflow();
  const names = ["north-pier", "glass-harbour", "paper-lantern", "speck-lane"];
  assert.equal(fileOf(payload, "no-such"), null);
  assert.equal(fileOf(payload, "design"), null);

  const all = fileOf(payload, "all", ["quiet-first", "written-one"]);
  assert.equal(all.format, "mason.workflow");
  assert.equal(all.purpose, "all my work");
  assert.equal(all.by, "S. Hale");
  assert.deepEqual(all.rules, [
    { rule: "Keep the first screen quiet", projects: 1, times: 5 },
    { rule: "Leave the copy in the owner's words" },
  ]);

  const build = fileOf(payload, "build", ["quiet-first", "both", "friday-ship", "written-one"]);
  assert.equal(build.format, "mason.workflow");
  assert.equal(build.purpose, "building software");
  assert.equal(fileOf(payload, "content", []).purpose, "writing and video");
  // The Friday rule names the other project, and a written rule has no evidence, so neither comes along.
  assert.deepEqual(build.rules, [
    { rule: "Keep the first screen quiet", projects: 1, times: 5 },
    { rule: "Show the thing, do not describe it", projects: 2, times: 4 },
  ]);
  assert.equal(carriesNames(all) || carriesNames(build), false);
  const text = JSON.stringify(all) + JSON.stringify(build);
  for (const name of names) assert.equal(text.includes(name), false, name);
});

test("a workflow is written as JSON in the share folder", async () => {
  const workflow = { format: "mason.workflow", purpose: "building software", minutes: 150 };
  const saved = await saveWorkflow(workflow);
  assert.equal(saved, path.join(process.env.APPRENTICE_DATA, "share", "mason-workflow-building-software.json"));
  assert.deepEqual(JSON.parse(await readFile(saved, "utf8")), workflow);
});
