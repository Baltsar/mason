import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder the first time it is loaded, and this file writes.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-trial-"));
const { endTrial, trialPayload, TRIAL_DAYS } = await import("../src/trial.mjs");

const watched = (count, seconds = 3600) => Object.fromEntries(Array.from({ length: count }, (_, index) => [`2026-09-${String(index + 1).padStart(2, "0")}-${index}`, { seconds, jumps: 5, tools: 3 }]));
const days = { "2026-10-01": { MASON: { minutes: 90, prompts: 12 }, KIOSK: { minutes: 30, prompts: 3 } }, "2026-10-02": { MASON: { minutes: 20, prompts: 5 } } };

test("the trial ends on the fortieth day Mason watched real work, and not before", async () => {
  assert.equal(TRIAL_DAYS, 40);
  const early = await trialPayload({ moves: watched(39), days, rules: 2 });
  assert.deepEqual([early.day, early.of, early.due], [39, 40, false]);
  // A day with a few minutes at the screen is not a day of work.
  assert.equal((await trialPayload({ moves: { ...watched(39), short: { seconds: 120 } }, days })).due, false);
  const due = await trialPayload({ moves: watched(40), days, rules: 2 });
  assert.deepEqual([due.day, due.due, due.prompts, due.projects, due.rules], [40, true, 20, 2, 2]);
  // A way to hire the man who built it is always there; a coffee only once there is a place to buy one.
  assert.match(due.hire, /^https:\/\//);
  assert.equal(typeof due.coffee, "string");
});

test("use evaluation copy puts the card away for good", async () => {
  await endTrial();
  const later = await trialPayload({ moves: watched(55), days });
  assert.deepEqual([later.day, later.due], [55, false]);
});
