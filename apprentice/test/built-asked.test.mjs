import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder the first time it is loaded, and this file writes.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-built-"));
const { answerCard, askedBefore, nextDue } = await import("../src/built.mjs");

const DAY = 86_400_000;
const id = "0123456789abcdef";

test("what was known comes back after longer each time, and what was not, tomorrow", async () => {
  const now = Date.UTC(2026, 9, 10);
  const due = async () => Math.round(((await askedBefore())[id].due - now) / DAY);
  assert.equal(await answerCard(id, true, now), true);
  assert.equal(await due(), 3);
  await answerCard(id, true, now);
  assert.equal(await due(), 7);
  await answerCard(id, true, now);
  await answerCard(id, true, now);
  await answerCard(id, true, now);
  assert.equal(await due(), 60);
  // Not known: tomorrow, and the count starts again.
  await answerCard(id, false, now);
  assert.equal(await due(), 1);
  await answerCard(id, true, now);
  assert.equal(await due(), 3);
  assert.equal(nextDue(await askedBefore(), now), now + 3 * DAY);
  assert.equal(nextDue({}, now), Infinity);
  // Something that is not a card is not kept.
  assert.equal(await answerCard("../not-a-card", true, now), false);
});
