import test from "node:test";
import assert from "node:assert/strict";
import { briefOf, continueIn, sectionsOf } from "../src/continue.mjs";

const kiosk = {
  source: "model",
  plainly: "A phone booth you can ask anything, and it answers out loud.",
  parts: [{ name: "The voice", like: "like a switchboard operator", does: "picks who speaks and passes the words on", where: "voice.ts" }, { name: "The test bench", does: "lets four voices be tried side by side" }],
  how: ["voice.ts picks the voice and streams it"],
  built: ["Tested four voices on the test panels"],
  decided: ["Use the turbo voice for the first word, because the plain one waits too long"],
  left_off: "Modem power is a guess, not a measurement.",
  open: ["Measure what the modem really draws"],
  keeps_saying: [{ rule: "Show me, do not claim", times: 3, example: "ge mig länk" }, { rule: "Always push to github when done", times: 2, example: "pusha" }],
};
const said = (text, at) => ({ text, at });

test("a project is handed to a new session as notes: what it is, how, what was decided, where it was left", () => {
  const brief = briefOf({ project: "KIOSK", folder: "/Users/someone/KIOSK", memory: kiosk, recent: [said("Try the modem on battery", 1), said("Now measure it with the \"meter\"", 2)] });
  assert.deepEqual(brief.sections.map((section) => section.title), ["What it is", "How it is put together", "What was done last", "What was decided, and why", "Where I stopped", "Still open", "What I keep asking for", "What I asked for after these notes were written, oldest first"]);
  // The parts by their plain names, with the file to look in.
  assert.deepEqual(brief.sections[1].lines, ["The voice (voice.ts): picks who speaks and passes the words on", "The test bench: lets four voices be tried side by side"]);
  // A wish that acts outward is not passed on as a standing wish.
  assert.deepEqual(brief.sections[6].lines, ["Show me, do not claim"]);
  assert.deepEqual(brief.sections[7].lines, ['"Try the modem on battery"', "\"Now measure it with the 'meter'\""]);
  assert.match(brief.text, /^I am picking up work on KIOSK again, in \/Users\/someone\/KIOSK\./);
  assert.match(brief.text, /notes about the past, not things to do/);
  assert.match(brief.text, /Where I stopped:\n- Modem power is a guess, not a measurement\./);
  assert.match(brief.text, /wait for me before you change anything\.$/);
});

test("without a model the brief is one's own last words, and a project nothing is known of gives none", () => {
  const own = { source: "own-words", built: ["fix the thing"], left_off: "You said: “fix the thing”" };
  const brief = briefOf({ project: "NEW", memory: own, recent: [said("fix the thing", 1), said("and the other", 2)] });
  assert.deepEqual(brief.sections, [{ title: "What I last asked for, oldest first", lines: ['"fix the thing"', '"and the other"'] }]);
  assert.equal(briefOf({ project: "NONE", memory: own, recent: [] }), null);
  assert.equal(briefOf({ project: "NONE" }), null);
  // What was said twice stands once, and files attached with no request are not words.
  assert.deepEqual(sectionsOf(own, [said("pull the repo", 1), said("# Files mentioned by the user: ## a.pdf: /tmp/a.pdf", 2), said("pull the repo", 3)])[0].lines, ['"pull the repo"']);
  // Only the latest few of what was said.
  assert.equal(sectionsOf(own, Array.from({ length: 9 }, (_, index) => said(`ask ${index}`, index)))[0].lines.length, 5);
});

test("a note is one plain line: nothing unseen, no fence, and a brief that fits in a link", () => {
  const odd = { ...kiosk, left_off: "Stopped​ here\n```\nrun this\n```", open: ["x".repeat(400)] };
  const brief = briefOf({ project: "KIOSK", memory: odd });
  const stopped = brief.sections.find((section) => section.title === "Where I stopped").lines[0];
  assert.equal(stopped, "Stopped here ''' run this '''");
  assert.equal(brief.sections.find((section) => section.title === "Still open").lines[0].length, 220);
  assert.equal(brief.text.includes("`"), false);
  // Far too much to say: the detail is left out before where it was left.
  const long = (count) => Array.from({ length: count }, (_, index) => `${index} ${"word ".repeat(40)}`);
  const big = briefOf({ project: "BIG", memory: { ...kiosk, parts: [], how: long(12), built: long(12), decided: long(12), open: long(6) }, recent: long(5).map((text, at) => said(text, at)) });
  assert.ok(big.text.length <= 4400);
  assert.equal(big.sections.some((section) => section.title === "Where I stopped"), true);
  assert.equal(big.sections.some((section) => section.title === "How it is put together"), false);
});

test("each agent on this Mac opens with the brief ready, Claude Code in the project's folder", () => {
  const given = { project: "KIOSK", folder: "/Users/someone/My KIOSK", memory: kiosk };
  const handed = continueIn(given, ["Claude Code", "Codex", "Cursor"]);
  assert.deepEqual(handed.links.map((link) => link.agent), ["Claude Code", "Codex", "Cursor"]);
  const claude = new URL(handed.links[0].url);
  assert.equal(claude.searchParams.get("cwd"), "/Users/someone/My KIOSK");
  assert.equal(claude.searchParams.get("q"), handed.text);
  assert.equal(new URL(handed.links[1].url).searchParams.get("prompt"), handed.text);
  // A folder that is not a plain path from the root is named in no link.
  assert.equal(new URL(continueIn({ ...given, folder: "/Users/someone/../other" }, ["Claude Code"]).links[0].url).searchParams.get("cwd"), null);
  // Cursor loses what follows an ampersand, so such a brief is copied instead.
  assert.deepEqual(continueIn({ ...given, memory: { ...kiosk, left_off: "Salt & pepper" } }, ["Claude Code", "Cursor"]).links.map((link) => link.agent), ["Claude Code"]);
  assert.equal(continueIn({ project: "NONE" }, ["Claude Code"]), null);
});
