import test from "node:test";
import assert from "node:assert/strict";
import { builtOf } from "../src/built.mjs";
import { quizOf } from "../src/quiz.mjs";

const kiosk = {
  source: "model",
  headline: "Modem power still a guess",
  one_line: "A phone booth that answers with a voice",
  plainly: "A phone booth you can ask anything, and it answers out loud.",
  parts: [
    { name: "The voice", like: "like a switchboard operator", does: "picks who speaks and passes the words on", where: "voice.ts" },
    { name: "The test bench", like: "", does: "lets four voices be tried side by side", where: "app/test" },
    { name: "The line", like: "like a telephone exchange", does: "keeps the call open while the answer is made", where: "line.ts" },
  ],
  quiz: [{ ask: "Where does it run?", right: "Vercel", wrong: ["Netlify", "Fly.io", "vercel", "Render"], why: "The reports show it deployed with the Vercel CLI." }],
  left_off: "Modem power is a guess, not a measurement.",
};
const town = { source: "model", headline: "Street names missing", plainly: "A map of the town that shows what is open right now.", parts: [{ name: "The clock", like: "", does: "checks each shop's hours against the time" }], left_off: "The street names are not on the map yet." };
const shop = { source: "model", headline: "Checkout untested", plainly: "A small shop for prints, paid for by card.", left_off: "Nobody has paid in the checkout yet." };
const all = { KIOSK: kiosk, TOWN: town, SHOP: shop, DRAFT: { source: "own-words", plainly: "Never a wrong answer: nothing was summarised for it." } };

test("a project is asked about with answers to choose between: one right, the others true of something else", () => {
  const quiz = quizOf("KIOSK", kiosk, all, "2026-10-11");
  assert.deepEqual(quiz.map((item) => [item.kind, item.question]), [
    ["what", "Which one is KIOSK?"],
    ["fact", "Where does it run?"],
    ["part", "What does “The voice” do?"],
    ["part", "What does “The test bench” do?"],
    ["part", "What does “The line” do?"],
    ["left", "Where did you leave KIOSK?"],
  ]);
  const [what, fact, voice, , , left] = quiz;
  // The right answer is among the options, and the others are the other projects.
  assert.equal(what.options[what.right], kiosk.plainly);
  assert.deepEqual([...what.options].sort(), [kiosk.plainly, town.plainly, shop.plainly].sort());
  // The model's own wrong answers, at most three, and never the right one in other letters.
  assert.equal(fact.options[fact.right], "Vercel");
  assert.equal(fact.options.length, 4);
  assert.equal(fact.options.includes("vercel"), false);
  assert.equal(fact.why, "The reports show it deployed with the Vercel CLI.");
  // A part is told apart from the other parts of the same project first.
  assert.equal(voice.options[voice.right], "picks who speaks and passes the words on");
  assert.ok(voice.options.includes("lets four voices be tried side by side") && voice.options.includes("keeps the call open while the answer is made"));
  assert.equal(voice.why, "The voice is like a switchboard operator.");
  // Where it was left is asked in a few words, and said in full afterwards.
  assert.equal(left.options[left.right], "Modem power still a guess");
  assert.equal(left.why, kiosk.left_off);
  assert.equal(quiz.every((item) => /^[a-f0-9]{16}$/.test(item.id)), true);
});

test("a question with nothing to mistake the answer for is not asked, and the order changes by the day", () => {
  // Alone, a project has only its own parts and the model's questions to choose between.
  assert.deepEqual(quizOf("KIOSK", kiosk, { KIOSK: kiosk }, "d").map((item) => item.kind), ["fact", "part", "part", "part"]);
  assert.deepEqual(quizOf("SHOP", shop, { SHOP: shop, TOWN: town }, "d"), []);
  assert.deepEqual(quizOf("DRAFT", all.DRAFT, all, "d"), []);
  assert.deepEqual(quizOf("NONE", null, all, "d"), []);
  const orders = new Set(["a", "b", "c", "d", "e", "f"].map((day) => quizOf("KIOSK", kiosk, all, day)[1].options.join("|")));
  assert.ok(orders.size > 1);
});

test("the project not touched for the longest is asked about first, and a question that is not due is not asked", () => {
  const given = {
    today: "2026-10-06",
    days: {
      "2026-10-02": { TOWN: { minutes: 90, prompts: 9 }, KIOSK: { minutes: 20, prompts: 2 } },
      "2026-10-05": { KIOSK: { minutes: 60, prompts: 4 }, BLANK: { minutes: 30, prompts: 3 } },
      "2026-10-07": { LATER: { minutes: 10, prompts: 1 } },
    },
    memories: { TOWN: town, KIOSK: kiosk, SHOP: shop, LATER: kiosk },
  };
  const projects = builtOf(given);
  assert.deepEqual(projects.map((item) => [item.project, item.lastDay, item.questions.length]), [["TOWN", "2026-10-02", 3], ["KIOSK", "2026-10-05", 6]]);
  assert.equal(projects[1].about, "A phone booth that answers with a voice");
  const now = Date.now();
  const [first, second] = projects[1].questions;
  const later = builtOf({ ...given, now, asked: { [first.id]: { due: now + 1000 }, [second.id]: { due: now - 1000 }, ...Object.fromEntries(projects[0].questions.map((item) => [item.id, { due: now + 1000 }])) } });
  assert.deepEqual(later.map((item) => [item.project, item.questions.length]), [["KIOSK", 5]]);
});
