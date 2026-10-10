import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Its own data folder, set before anything is loaded. This file runs in its own process.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-nudge-"));
const { choose, gonePast, nudgesPayload, offerNudge, openNudge, openNudges, outcomeOf, settleNudges } = await import("../src/nudge.mjs");

const start = Date.UTC(2026, 9, 8, 9);
const minutes = (count) => start + count * 60_000;
const iso = (time) => new Date(time).toISOString();
const waited = (key) => ({ kind: "waited", key, project: "shop", text: `Waited 9 min · ${key}` });
const before = (key) => ({ kind: "before", key, project: "shop", other: "site", text: "Done before · site" });

test("one nudge at a time: not twice for the same thing, not close together, not many in a day", () => {
  const said = [{ kind: "waited", key: "a", at: iso(minutes(0)) }];
  assert.equal(choose([waited("a")], said, {}, minutes(30)), null);
  assert.equal(choose([waited("b")], said, {}, minutes(5)), null);
  assert.equal(choose([waited("a"), before("x")], said, {}, minutes(30)).kind, "before");
  const full = Array.from({ length: 6 }, (_, index) => ({ kind: "waited", key: `k${index}`, at: iso(minutes(index * 20)) }));
  assert.equal(choose([waited("new")], full, {}, minutes(200)), null);
  assert.equal(choose([waited("new")], full, {}, minutes(26 * 60)).key, "new");
  // A kind that has gone quiet says nothing until its quiet is over.
  assert.equal(choose([waited("b"), before("x")], [], { waited: iso(minutes(60)) }, minutes(30)).kind, "before");
  assert.equal(choose([waited("b")], [], { waited: iso(minutes(60)) }, minutes(61)).kind, "waited");
});

test("a nudge is followed when it was acted on in time, and ignored when the time has gone", () => {
  const nudge = { kind: "waited", at: iso(minutes(0)) };
  assert.equal(outcomeOf(nudge, true, minutes(1)), "followed");
  assert.equal(outcomeOf(nudge, false, minutes(1)), null);
  assert.equal(outcomeOf(nudge, false, minutes(2)), "ignored");
  // There is longer to look up a piece of work that was done before.
  assert.equal(outcomeOf({ kind: "before", at: iso(minutes(0)) }, false, minutes(9)), null);
  assert.equal(outcomeOf({ kind: "before", at: iso(minutes(0)) }, false, minutes(11)), "ignored");
});

test("a kind that is ignored three times in a row goes quiet by itself, and comes back later", () => {
  const ignored = (at) => ({ kind: "waited", at: iso(at), outcome: "ignored" });
  const mixed = [ignored(minutes(0)), { kind: "waited", at: iso(minutes(20)), outcome: "followed" }, ignored(minutes(40)), ignored(minutes(60))];
  assert.deepEqual(gonePast(mixed, {}, minutes(61)), {});
  const three = [...mixed, ignored(minutes(80))];
  const quiet = gonePast(three, {}, minutes(81));
  assert.equal(quiet.waited, iso(minutes(81) + 14 * 86_400_000));
  assert.equal(quiet.before, undefined);
  // What was ignored before the quiet spell does not start a new one.
  const later = Date.parse(quiet.waited) + 60_000;
  assert.deepEqual(gonePast([...three, ignored(later)], quiet, later + 1000), quiet);
});

test("what was said is remembered, settled, and counted for the week", async () => {
  assert.equal(await offerNudge([], minutes(0)), null);
  const first = await offerNudge([waited("a")], minutes(0));
  assert.equal(first.text, "Waited 9 min · a");
  assert.equal(await offerNudge([waited("a"), waited("b")], minutes(3)), null);
  assert.deepEqual((await openNudges()).map((nudge) => nudge.key), ["a"]);
  // Back where answers are read within the time: followed.
  assert.equal(await settleNudges(() => true, minutes(1)), true);
  assert.equal(await settleNudges(() => true, minutes(1)), false);

  const second = await offerNudge([before("shop|site")], minutes(15));
  assert.equal((await nudgesPayload(minutes(16))).latest.id, second.id);
  // Pressed in the window: that is acting on it, whatever else happened.
  assert.equal((await openNudge(second.id)).opened, true);
  assert.equal(await openNudge("no such nudge"), null);
  assert.equal(await settleNudges(() => false, minutes(16)), true);

  for (const [index, key] of ["c", "d", "e"].entries()) {
    await offerNudge([waited(key)], minutes(40 + index * 20));
    await settleNudges(() => false, minutes(45 + index * 20));
  }
  const payload = await nudgesPayload(minutes(120));
  assert.deepEqual([payload.said, payload.followed, payload.quiet, payload.latest], [5, 2, ["waited"], null]);
  assert.equal(await offerNudge([waited("f")], minutes(130)), null);
});
