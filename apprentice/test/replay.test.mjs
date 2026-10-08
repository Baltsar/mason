import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Its own data folder, set before anything is loaded. This file runs in its own process.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-replay-"));
const { figuresOf, pageOf, piecesOf, replayOf, saveReplay, shownReplay, textOf } = await import("../src/replay.mjs");

const at = (minute, second = 0) => Date.UTC(2026, 9, 8, 10, minute, second);
const spent = (app, minute, seconds, more = {}) => ({ type: "activity", app, window: "", group: "work", durationSec: seconds, startedAt: new Date(at(minute)).toISOString(), at: new Date(at(minute)).toISOString(), ...more });
const events = [
  spent("Claude", 0, 60),
  spent("Discord", 1, 180, { type: "private" }),
  spent("Comet", 4, 60, { host: "tally.so" }),
  spent("Claude", 5, 120),
];
const prompts = [
  { project: "shop", at: at(0, 30), text: "Fix the checkout in /Users/gustaf/code/shop and <script>alert(1)</script> it" },
  { project: "site", at: at(6), text: "Make the first page of site calmer" },
  { project: "shop", at: at(40), text: "Said long after the stretch" },
];
const turns = [
  { project: "shop", prompt: at(0, 30), done: at(3), ended: true, next: at(6) },
  { project: "site", prompt: at(6), done: at(6, 20), ended: false, next: null },
];
const replay = replayOf({ events, prompts, turns, from: at(0), to: at(7) });

test("a stretch is laid out prompt by prompt, with what happened around each", () => {
  assert.equal(replay.lines.length, 2);
  const [first, second] = replay.lines;
  assert.equal(first.project, "shop");
  // The agent worked from the prompt until it was done; the answer then lay
  // until Claude was in front again.
  assert.equal(first.workedSeconds, 150);
  assert.equal(first.waitedSeconds, 120);
  assert.deepEqual(first.meanwhile, [{ tool: "Discord", seconds: 180 }, { tool: "tally.so", seconds: 60 }]);
  // An answer that was not finished has no time worked and none waited.
  assert.deepEqual([second.workedSeconds, second.waitedSeconds], [null, null]);
  assert.equal(replay.jumps, 3);
  assert.deepEqual(replay.tools.map((tool) => tool.name), ["Claude", "Discord", "tally.so"]);
});

test("until its owner says otherwise, a replay names no project, no site and no home folder", () => {
  const shown = shownReplay(replay);
  assert.deepEqual(shown.lines.map((line) => line.project), ["Project A", "Project B"]);
  assert.equal(shown.lines[0].text, "Fix the checkout in ~/code/Project A and <script>alert(1)</script> it");
  assert.equal(shown.lines[1].text, "Make the first page of Project B calmer");
  assert.deepEqual(shown.tools.map((tool) => tool.name), ["Claude", "Discord", "a website"]);
  assert.equal(shown.lines[0].around, "Agent worked 3 min · meanwhile in Discord 3 min, a website 60 s · answer waited 2 min");
  // With names, everything is as it was, except the home folder.
  const named = shownReplay(replay, { names: true });
  assert.equal(named.lines[0].project, "shop");
  assert.match(named.lines[0].text, /~\/code\/shop/);
  assert.equal(named.tools[2].name, "tally.so");
  // A line that was taken out is gone, and counted.
  const cut = shownReplay(replay, { hidden: [replay.lines[0].id] });
  assert.deepEqual([cut.lines.length, cut.left, cut.lines[0].project], [1, 1, "Project B"]);
});

test("the page stands by itself, says nothing that was hidden, and carries its figures without its words", async () => {
  const shown = shownReplay(replay, { hidden: [replay.lines[1].id] });
  const page = pageOf(shown, "Gustaf");
  assert.match(page, /How Gustaf worked/);
  assert.match(page, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(page, /<script>alert/);
  assert.doesNotMatch(page, /first page/);
  assert.match(page, /1 prompt was left out/);
  const figures = JSON.parse(/<script type="application\/json" id="mason-replay">(.*?)<\/script>/.exec(page)[1]);
  assert.deepEqual([figures.format, figures.prompts, figures.jumps, figures.waitedSeconds], ["mason-replay", 1, 3, 120]);
  assert.doesNotMatch(JSON.stringify(figures), /checkout/);
  assert.deepEqual(figuresOf(shown), figures);

  const text = textOf(shown, "Gustaf");
  assert.match(text, /\*\*How Gustaf worked · 7 minutes\*\*/);
  assert.match(text, /> Fix the checkout in ~\/code\/Project A/);
  const file = await saveReplay(page, at(7));
  assert.match(path.basename(file), /^mason-replay-2026-10-08-10-07\.html$/);
  assert.equal(await readFile(file, "utf8"), page);
});

test("what is cut is a piece of work: one project, from its first prompt to its last", () => {
  const said = (project, minute) => ({ project, at: at(minute), text: "something to do" });
  // Two projects worked in turn, a long silence in one of them, and a prompt alone.
  const pieces = piecesOf([said("shop", 0), said("site", 2), said("shop", 5), said("site", 20), said("shop", 50), said("shop", 58), said("tool", 30)]);
  assert.deepEqual(pieces.map((piece) => [piece.project, piece.prompts, (piece.to - piece.from) / 60_000]), [["shop", 2, 8], ["site", 2, 18], ["shop", 2, 5]]);
  assert.equal(new Set(pieces.map((piece) => piece.id)).size, 3);
});
