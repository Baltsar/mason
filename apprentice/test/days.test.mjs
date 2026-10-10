import test from "node:test";
import assert from "node:assert/strict";
import { dayKey, daysOf, dueDays, movesOf } from "../src/days.mjs";

// Local times, as the day is the owner's day and not the UTC one.
const at = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const minutesFrom = (start, count) => new Set(Array.from({ length: count }, (_, index) => Math.floor(start / 60_000) + index));

test("a day turns over at four in the morning, so a late night is one day", () => {
  assert.equal(dayKey(at(4, 23, 30)), "2026-10-04");
  assert.equal(dayKey(at(5, 2, 15)), "2026-10-04");
  assert.equal(dayKey(at(5, 4, 0)), "2026-10-05");
});

test("each day keeps its projects, with the minutes worked and the things said", () => {
  const days = daysOf([
    { name: "MASON", minutes: new Set([...minutesFrom(at(3, 21), 90), ...minutesFrom(at(4, 10), 30)]), prompts: [{ at: at(3, 21, 5) }, { at: at(4, 1, 10) }, { at: at(4, 10, 2) }] },
    { name: "KIOSK", minutes: minutesFrom(at(4, 14), 45), prompts: [{ at: at(4, 14, 1) }] },
    // An agent that ran on its own for a few minutes is not a day's work.
    { name: "cron", minutes: minutesFrom(at(4, 6), 4), prompts: [] },
  ]);
  assert.deepEqual(days, {
    "2026-10-03": { MASON: { minutes: 90, prompts: 2 } },
    "2026-10-04": { MASON: { minutes: 30, prompts: 1 }, KIOSK: { minutes: 45, prompts: 1 } },
  });
  // Asked for since a moment, earlier days are left alone.
  assert.deepEqual(Object.keys(daysOf([{ name: "MASON", minutes: minutesFrom(at(3, 21), 90), prompts: [] }], at(4, 4))), []);
});

test("how a day moved is kept with it: the time in front and the jumps", () => {
  const spent = (app, start, seconds) => ({ type: "activity", app, window: "", group: "work", durationSec: seconds, startedAt: new Date(start).toISOString(), at: new Date(start).toISOString() });
  const moves = movesOf([spent("Claude", at(4, 9), 300), spent("Cursor", at(4, 9, 6), 200), spent("Claude", at(4, 9, 10), 100), spent("Claude", at(5, 9), 20)]);
  assert.deepEqual(moves, { "2026-10-04": { seconds: 600, jumps: 2, tools: 2 } });
});

test("a look back is due after three finished days of real work, and never covers today", () => {
  const worked = { seconds: 4 * 3600, jumps: 90, tools: 6 };
  const moves = { "2026-10-01": worked, "2026-10-02": { seconds: 900, jumps: 4, tools: 2 }, "2026-10-03": worked, "2026-10-04": worked, "2026-10-05": worked, "2026-10-06": worked };
  // Two real days are not enough; the short one does not count.
  assert.deepEqual(dueDays(moves, [], "2026-10-04"), []);
  assert.deepEqual(dueDays(moves, [], "2026-10-06"), ["2026-10-01", "2026-10-03", "2026-10-04", "2026-10-05"]);
  // Once written, the same days are not looked back on again.
  assert.deepEqual(dueDays(moves, [{ from: "2026-10-01", to: "2026-10-05" }], "2026-10-07"), []);
});

test("what the agents took is kept with the day and the project it was taken in", () => {
  const start = (day) => new Date(2026, 9, day, 4).getTime();
  const days = daysOf([{ name: "MASON", minutes: minutesFrom(at(4, 10), 30), prompts: [{ at: at(4, 10, 2) }], spent: new Map([[start(4), { fresh: 100, cached: 9000, written: 400 }], [start(2), { fresh: 5, cached: 5, written: 5 }]]) }]);
  // A day with tokens and no work in it is not a day of work.
  assert.deepEqual(days, { "2026-10-04": { MASON: { minutes: 30, prompts: 1, tokens: 9500, written: 400 } } });
});

