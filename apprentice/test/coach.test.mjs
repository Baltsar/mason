import test from "node:test";
import assert from "node:assert/strict";
import { measureDay, proposeAims, readsAnswers, sentenceOf } from "../src/coach.mjs";

const at = (minute, second = 0) => Date.UTC(2026, 9, 6, 8, minute, second);
const iso = (time) => new Date(time).toISOString();
const spent = (app, project, minute, seconds, more = {}) => ({ type: "activity", app, window: "", project, group: "work", durationSec: seconds, startedAt: iso(at(minute)), at: iso(at(minute)), ...more });
const aim = { project: "KIOSK", text: "Measure what the modem draws" };

test("a day is measured against its aim: on it, social, elsewhere", () => {
  const day = measureDay([
    spent("Claude", "KIOSK", 0, 600),
    spent("Comet", null, 10, 300, { window: "Home / X", group: "social" }),
    spent("Claude", "KIOSK", 15, 600),
    // Two seconds of Finder is a glance, not leaving.
    { type: "activity", app: "Finder", window: "", project: null, group: "work", durationSec: 2, startedAt: iso(at(25)), at: iso(at(25)) },
    { type: "activity", app: "Claude", window: "", project: "KIOSK", group: "work", durationSec: 298, startedAt: iso(at(25, 2)), at: iso(at(25, 2)) },
    spent("Claude", "MASON", 30, 300),
    { type: "private", app: "Discord", durationSec: 400, startedAt: iso(at(35)), at: iso(at(35)) },
  ], { aim, now: at(60) });
  assert.equal(day.totalSeconds, 2500);
  assert.equal(day.onSeconds, 1498);
  assert.deepEqual([day.onPercent, day.socialPercent, day.elsewherePercent], [60, 12, 28]);
  assert.equal(day.onPercent + day.socialPercent + day.elsewherePercent, 100);
  // Left twice: for X, and then for the other project. Discord came after that, not after the aim.
  assert.equal(day.away.count, 2);
  assert.deepEqual(day.away.to, [{ name: "X", count: 1 }, { name: "MASON", count: 1 }]);
  // The glance at Finder did not break the stretch that began at 08:15.
  assert.deepEqual(day.longestOn, { seconds: 898, startedAt: iso(at(15)) });
  assert.equal(day.startedOnAt, iso(at(0)));
  assert.equal(day.awayNowSeconds, 700);
  assert.equal(day.projects, 2);
  assert.equal(day.elsewhere[0].tool, "Discord");
});

test("a finished answer waits while its owner is somewhere else, and is ready until it is looked at", () => {
  const events = [
    spent("Claude", "KIOSK", 0, 120),
    { type: "private", app: "Discord", durationSec: 600, startedAt: iso(at(2)), at: iso(at(2)) },
    spent("Comet", null, 12, 180, { window: "A video - YouTube", group: "social" }),
    spent("Claude", "KIOSK", 15, 300),
    spent("Comet", null, 20, 240, { window: "Home / X", group: "social" }),
  ];
  const turns = [
    // Asked at 08:01, finished at 08:05 while Discord was in front; Claude was back at 08:15.
    { project: "KIOSK", prompt: at(1), done: at(5), ended: true, next: at(16) },
    // Still working: nothing is waiting.
    { project: "MASON", prompt: at(3), done: at(14), ended: false, next: null },
    // Finished at 08:22 and not looked at since.
    { project: "KIOSK", prompt: at(16), done: at(22), ended: true, next: null },
  ];
  const day = measureDay(events, { aim, turns, now: at(24) });
  // 08:05–08:15 and 08:22–08:24, in active time somewhere else.
  assert.equal(day.waited.answers, 2);
  assert.equal(day.waited.seconds, 420 + 180 + 120);
  assert.deepEqual(day.waited.where.map((item) => item.tool), ["Discord", "YouTube", "X"]);
  assert.deepEqual(day.ready, [{ project: "KIOSK", since: iso(at(22)) }]);
  // Back in Claude, nothing is ready any more.
  const back = measureDay([...events, spent("Claude", "KIOSK", 24, 30)], { aim, turns, now: at(25) });
  assert.deepEqual(back.ready, []);
  assert.equal(readsAnswers("Claude"), true);
  assert.equal(readsAnswers("Discord"), false);
});

test("what today could be about comes from what was worked on last and left open", () => {
  const proposals = proposeAims({
    today: "2026-10-06",
    days: {
      "2026-09-20": { OLD: { minutes: 900, prompts: 9 } },
      "2026-10-03": { KIOSK: { minutes: 60, prompts: 4 } },
      "2026-10-04": { MASON: { minutes: 264, prompts: 54 }, KIOSK: { minutes: 30, prompts: 2 } },
      "2026-10-05": { BITMAGIC: { minutes: 75, prompts: 14 }, SITE: { minutes: 20, prompts: 3 } },
      "2026-10-07": { LATER: { minutes: 999, prompts: 9 } },
    },
    limit: 3,
    memories: { MASON: { headline: "Flow and days are in", open: ["Whether to name chat apps"], left_off: "Pushes are locked." }, KIOSK: { open: [], left_off: "Modem power is a guess." } },
  });
  assert.deepEqual(proposals, [
    { project: "MASON", text: "Whether to name chat apps", headline: "Flow and days are in" },
    { project: "KIOSK", text: "Modem power is a guess.", headline: "" },
    { project: "BITMAGIC", text: "", headline: "" },
  ]);
});

test("what is already being worked on today is proposed first", () => {
  const proposals = proposeAims({ today: "2026-10-06", days: { "2026-10-05": { MASON: { minutes: 300, prompts: 40 } }, "2026-10-06": { KIOSK: { minutes: 12, prompts: 3 } } }, memories: {} });
  assert.deepEqual(proposals.map((item) => item.project), ["KIOSK", "MASON"]);
});

test("one sentence about the day: the first thing worth saying", () => {
  const base = { totalSeconds: 4 * 3600, aim, onSeconds: 7200, onPercent: 50, projects: 3, away: { count: 4, to: [] }, waited: { seconds: 0, answers: 0, where: [] }, longestOn: { seconds: 600 } };
  assert.equal(sentenceOf({ ...base, totalSeconds: 600 }), null);
  assert.deepEqual(sentenceOf({ ...base, onSeconds: 0, onPercent: 0 }), { tone: "off", text: "KIOSK was today's aim. It never came up." });
  assert.equal(sentenceOf({ ...base, onPercent: 18 }).text, "KIOSK was today's aim. It got 18% of the day.");
  assert.equal(sentenceOf({ ...base, waited: { seconds: 46 * 60, answers: 9, where: [{ tool: "Discord", seconds: 1800 }] } }).text, "Finished answers waited 46 minutes for you, mostly while you were in Discord.");
  assert.equal(sentenceOf({ ...base, away: { count: 31, to: [{ name: "X", count: 12 }] } }).text, "You left KIOSK 31 times, most often for X.");
  assert.deepEqual(sentenceOf({ ...base, longestOn: { seconds: 45 * 60 } }), { tone: "on", text: "45 minutes unbroken on KIOSK." });
  // An ordinary day gets no sentence: the figure above says it already.
  assert.equal(sentenceOf(base), null);
  assert.equal(sentenceOf({ ...base, aim: null }), null);
});
