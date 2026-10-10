import test from "node:test";
import assert from "node:assert/strict";
import { lookBack, measureDay, readsAnswers, sentenceOf } from "../src/coach.mjs";

const at = (minute, second = 0, day = 6) => Date.UTC(2026, 9, day, 8, minute, second);
const iso = (time) => new Date(time).toISOString();
const spent = (app, project, start, seconds, more = {}) => ({ type: "activity", app, window: "", project, group: "work", durationSec: seconds, startedAt: iso(start), at: iso(start), ...more });
const chat = (app, start, seconds) => ({ type: "private", app, durationSec: seconds, startedAt: iso(start), at: iso(start) });

test("a finished answer waits while its owner is somewhere else, and is ready until it is looked at", () => {
  const events = [
    spent("Claude", "KIOSK", at(0), 120),
    chat("Discord", at(2), 600),
    spent("Comet", null, at(12), 180, { window: "A video - YouTube", group: "social" }),
    spent("Claude", "KIOSK", at(15), 300),
    spent("Comet", null, at(20), 240, { window: "Home / X", group: "social" }),
  ];
  const turns = [
    // Asked at 08:01, finished at 08:05 while Discord was in front; Claude was back at 08:15.
    { project: "KIOSK", prompt: at(1), done: at(5), ended: true, next: at(16) },
    // Still working: nothing is waiting.
    { project: "MASON", prompt: at(3), done: at(14), ended: false, next: null },
    // Finished at 08:22 and not looked at since.
    { project: "KIOSK", prompt: at(16), done: at(22), ended: true, next: null },
  ];
  const day = measureDay(events, { turns, now: at(24) });
  assert.equal(day.totalSeconds, 1440);
  // 08:05–08:15 and 08:22–08:24, in active time somewhere else.
  assert.equal(day.waited.answers, 2);
  assert.equal(day.waited.seconds, 420 + 180 + 120);
  assert.deepEqual(day.waited.where.map((item) => item.tool), ["Discord", "YouTube", "X"]);
  assert.deepEqual(day.ready, [{ project: "KIOSK", since: iso(at(22)) }]);
  // Back in Claude, nothing is ready any more.
  assert.deepEqual(measureDay([...events, spent("Claude", "KIOSK", at(24), 30)], { turns, now: at(25) }).ready, []);
  assert.equal(readsAnswers("Claude"), true);
  assert.equal(readsAnswers("Discord"), false);
});

test("today gets a sentence only when there is something to say", () => {
  const quiet = { totalSeconds: 4 * 3600, waited: { seconds: 300, answers: 2, where: [] }, ready: [] };
  assert.equal(sentenceOf(quiet), null);
  assert.equal(sentenceOf({ ...quiet, totalSeconds: 600, waited: { seconds: 3000, answers: 9, where: [] } }), null);
  assert.deepEqual(sentenceOf({ ...quiet, waited: { seconds: 46 * 60, answers: 9, where: [{ tool: "Discord", seconds: 1800 }] } }), { tone: "off", text: "Finished answers waited 46 minutes for you, mostly while you were in Discord." });
});

test("after a few days Mason says how the work was done, from what it saw and nothing it was told", () => {
  // Two days of the same shape: a prompt, off to Discord within the minute, back after the answer has waited.
  const dayOf = (day) => {
    const events = [];
    const turns = [];
    for (let round = 0; round < 6; round += 1) {
      const start = at(round * 20, 0, day);
      const project = round % 2 ? "MASON" : "KIOSK";
      events.push(spent("Claude", project, start, 120), chat("Discord", start + 130_000, 780), spent("Comet", null, start + 920_000, 200, { window: "Home / X", group: "social" }));
      turns.push({ project, prompt: start + 100_000, done: start + 300_000, ended: true, next: start + 1_200_000 });
    }
    return { events, turns };
  };
  const [first, second] = [dayOf(4), dayOf(5)];
  const back = lookBack([{ day: "2026-10-04", events: first.events }, { day: "2026-10-05", events: second.events }], { turns: [...first.turns, ...second.turns] });
  assert.deepEqual([back.from, back.to, back.days], ["2026-10-04", "2026-10-05", 2]);
  assert.equal(back.activeSeconds, 2 * 6 * 1100);
  assert.deepEqual(back.split, { work: 11, social: 18, chat: 71, other: 0 });
  assert.deepEqual(back.projects, [{ name: "KIOSK", seconds: 720, share: 5 }, { name: "MASON", seconds: 720, share: 5 }]);
  assert.equal(back.prompts, 12);
  // Every prompt was followed by Discord within a minute, and every project differed from the one before.
  assert.deepEqual(back.left, { count: 12, share: 100, to: [{ tool: "Discord", count: 12 }] });
  assert.equal(back.changes, 11);
  assert.equal(back.waited.answers, 12);
  assert.equal(back.waited.perDay, 6 * (610 + 200));
  assert.equal(back.longest.tool, "Discord");
  assert.deepEqual(back.lines, [
    "After 100% of your prompts you were somewhere else within a minute, most often in Discord.",
    "Finished answers waited 81 minutes a day, mostly while you were in Discord.",
    "2 projects in 2 days. KIOSK got the most: 5% of the time.",
  ]);
  assert.equal(lookBack([{ day: "2026-10-04", events: [] }], {}), null);
});
