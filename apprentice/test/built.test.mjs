import test from "node:test";
import assert from "node:assert/strict";
import { builtOf, cardsOf } from "../src/built.mjs";

const kiosk = {
  source: "model",
  one_line: "A phone booth that answers with a voice",
  how: ["voice.ts picks the voice and streams it", "The test panels live in app/test"],
  decided: ["Use the turbo voice for the first word, because the plain one waits too long"],
  built: ["Tested four voices on the test panels"],
  left_off: "Modem power is a guess, not a measurement.",
  open: ["Measure what the modem really draws"],
  keeps_saying: [{ rule: "Show me, do not claim", times: 2, example: "ge mig länk" }],
};

test("a project is asked about as one would explain it: what it does, its parts with a likeness, why, and where it was left", () => {
  const cards = cardsOf("KIOSK", { ...kiosk, plainly: "A phone booth you can ask anything, and it answers out loud.", parts: [{ name: "The voice", like: "like a switchboard operator", does: "picks who speaks and passes the words on", where: "voice.ts" }, { name: "The test bench", like: "", does: "lets four voices be tried side by side", where: "app/test" }, { name: "", does: "left out" }] });
  assert.deepEqual(cards.map((card) => [card.question, card.answer]), [
    ["What does KIOSK do? Say it as to a friend.", ["A phone booth you can ask anything, and it answers out loud."]],
    ["What is KIOSK made of?", ["The voice, like a switchboard operator: picks who speaks and passes the words on", "The test bench: lets four voices be tried side by side"]],
    ["Why is KIOSK built the way it is?", ["Use the turbo voice for the first word, because the plain one waits too long"]],
    ["Where did you leave KIOSK?", ["Modem power is a guess, not a measurement.", "Open: Measure what the modem really draws"]],
  ]);
  // Where it lives in the code is kept apart, for the day it is needed.
  assert.deepEqual(cards[1].where, ["The voice: voice.ts", "The test bench: app/test"]);
  assert.equal(cards.every((card) => /^[a-f0-9]{16}$/.test(card.id)), true);
  // A memory from before parts had a likeness still says what it is and how it is put together.
  assert.deepEqual(cardsOf("KIOSK", kiosk).slice(0, 2).map((card) => card.answer), [["A phone booth that answers with a voice"], kiosk.how]);
  assert.deepEqual(cardsOf("NEW", { source: "own-words", built: ["fix the thing"] }), []);
  assert.deepEqual(cardsOf("NONE", null), []);
});

test("the project not touched for the longest is asked about first, and a card that is not due is not asked", () => {
  const given = {
    today: "2026-10-06",
    days: {
      "2026-10-02": { OLD: { minutes: 90, prompts: 9 }, KIOSK: { minutes: 20, prompts: 2 } },
      "2026-10-05": { KIOSK: { minutes: 60, prompts: 4 }, BLANK: { minutes: 30, prompts: 3 } },
      "2026-10-07": { LATER: { minutes: 10, prompts: 1 } },
    },
    memories: { OLD: { source: "model", one_line: "A map of the town" }, KIOSK: kiosk, LATER: kiosk },
  };
  const projects = builtOf(given);
  assert.deepEqual(projects.map((item) => [item.project, item.lastDay, item.cards.length]), [["OLD", "2026-10-02", 1], ["KIOSK", "2026-10-05", 4]]);
  assert.equal(projects[1].about, "A phone booth that answers with a voice");
  const now = Date.now();
  const [first, second] = projects[1].cards;
  const later = builtOf({ ...given, now, asked: { [first.id]: { due: now + 1000 }, [second.id]: { due: now - 1000 }, [projects[0].cards[0].id]: { due: now + 1000 } } });
  assert.deepEqual(later.map((item) => [item.project, item.cards.length]), [["KIOSK", 3]]);
});
