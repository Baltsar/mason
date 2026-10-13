import test from "node:test";
import assert from "node:assert/strict";
import { backFor, describe, noticeFor } from "../src/notice.mjs";

const now = Date.UTC(2026, 9, 11, 10, 0, 0);
const ago = (seconds) => new Date(now - seconds * 1000).toISOString();
// An answer that finished `finished` seconds ago, after the agent worked `worked` seconds on it.
const work = (project, finished, worked, agent, text = "Make the first page calmer and show me") => {
  const done = now - finished * 1000;
  return { answer: { project, since: new Date(done).toISOString() }, turn: { project, prompt: done - worked * 1000, done, ended: true }, prompt: { project, at: done - worked * 1000, text, ...(agent ? { agent } : {}) } };
};
const scene = (items, more = {}) => noticeFor({ ready: items.map((item) => item.answer), turns: items.map((item) => item.turn), prompts: items.map((item) => item.prompt), now, ...more });

test("an answer that just finished is told of: which project, which agent, how long, and what was asked", () => {
  const notice = scene([work("MASON", 15, 240, "Codex", "Lay the pricing page out in three columns, and keep the header in place while the rest scrolls underneath it please")]);
  assert.equal(notice.kind, "ready");
  assert.equal(notice.text, "Answer ready · MASON");
  assert.equal(notice.back, false);
  assert.deepEqual(notice.answers.map((answer) => [answer.project, answer.agent, answer.workedSeconds]), [["MASON", "Codex", 240]]);
  assert.ok(notice.answers[0].asked.length <= 90 && notice.answers[0].asked.endsWith("…"));
  assert.equal(notice.until, now + 9000);
  // No agent named in the log means Claude Code.
  assert.equal(describe(work("SITE", 5, 60).answer, [work("SITE", 5, 60).turn], [work("SITE", 5, 60).prompt]).agent, "Claude Code");
});

test("nobody is told who is already reading the answer, away from the Mac, in a call, or about one they were waiting for", () => {
  const one = [work("MASON", 15, 240)];
  assert.equal(scene(one, { reading: true }), null);
  assert.equal(scene(one, { reading: "MASON" }), null);
  assert.equal(scene(one, { here: false }), null);
  assert.equal(scene(one, { busy: true }), null);
  // Ten seconds of work: its owner was sitting there waiting for it.
  assert.equal(scene([work("MASON", 5, 10)]), null);
  // Finished a quarter of an hour ago and never told of: no longer news by itself.
  assert.equal(scene([work("MASON", 900, 240)]), null);
  // Told of once, never again.
  assert.equal(scene(one, { told: new Set([`MASON|${one[0].answer.since}`]) }), null);
});

test("in one project's agent, an answer in another project is told of", () => {
  const notice = scene([work("MASON", 15, 240), work("KIOSK", 20, 90, "Codex")], { reading: "MASON" });
  assert.deepEqual(notice.answers.map((answer) => answer.project), ["KIOSK"]);
  assert.deepEqual(notice.keys, [notice.answers[0].key]);
});

test("answers that finish together come as one card, the latest first", () => {
  const notice = scene([work("KIOSK", 90, 300, "Codex"), work("MASON", 10, 120), work("SITE", 40, 60, "Grok")]);
  assert.equal(notice.text, "3 answers ready");
  assert.deepEqual(notice.answers.map((answer) => answer.project), ["MASON", "SITE", "KIOSK"]);
  assert.equal(notice.more, 0);
  const many = scene(Array.from({ length: 6 }, (_, index) => work(`P${index}`, 10 + index, 60)));
  assert.equal(many.answers.length, 4);
  assert.equal(many.more, 2);
});

test("someone who was away is told once, on coming back, of everything that finished meanwhile", () => {
  const meanwhile = [work("MASON", 1500, 240), work("KIOSK", 600, 15), work("OLD", 4 * 3600, 500)];
  // Still at the Mac: none of these is news any more.
  assert.equal(scene(meanwhile), null);
  // Back after twenty minutes: one card, also for the quick one, and not for what is hours old.
  const back = scene(meanwhile, { awayMs: 20 * 60_000 });
  assert.equal(back.back, true);
  assert.deepEqual(back.answers.map((answer) => answer.project), ["KIOSK", "MASON"]);
  // A minute away from the keyboard is not being away.
  assert.equal(scene(meanwhile, { awayMs: 60_000 }), null);
});

test("back after a long time away, one quiet line says where the work was left", () => {
  const back = { awayMs: 45 * 60_000, project: "KIOSK", headline: "Modem power still a guess", percent: 61.6, now };
  assert.deepEqual(backFor(back), { id: `back-${now}`, kind: "back", project: "KIOSK", headline: "Modem power still a guess", percent: 62, text: "Last in KIOSK", until: now + 7000 });
  // Nothing measured today: no figure is made up.
  assert.equal(backFor({ ...back, percent: null }).percent, null);
  // A cup of coffee is not having been away.
  assert.equal(backFor({ ...back, awayMs: 29 * 60_000 }), null);
  assert.equal(backFor({ ...back, awayMs: 0 }), null);
  // Already in that project's agent, or in one Mason cannot tell the project of: there is nothing to be told.
  assert.equal(backFor({ ...back, reading: "KIOSK" }), null);
  assert.equal(backFor({ ...back, reading: true }), null);
  assert.equal(backFor({ ...back, reading: "MASON" }).project, "KIOSK");
  // Not into a call or a session, not to someone who is not there, and not about nothing.
  assert.equal(backFor({ ...back, busy: true }), null);
  assert.equal(backFor({ ...back, here: false }), null);
  assert.equal(backFor({ ...back, project: "" }), null);
});
