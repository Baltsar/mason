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

test("a project gives one question for each thing that is remembered about it", () => {
  assert.deepEqual(cardsOf("KIOSK", kiosk), [
    { question: "How is KIOSK put together?", answer: ["voice.ts picks the voice and streams it", "The test panels live in app/test"] },
    { question: "What did you decide in KIOSK?", answer: ["Use the turbo voice for the first word, because the plain one waits too long"] },
    { question: "What did you build last in KIOSK?", answer: ["Tested four voices on the test panels"] },
    { question: "Where did you leave KIOSK?", answer: ["Modem power is a guess, not a measurement.", "Open: Measure what the modem really draws"] },
    { question: "What do you keep telling the agents in KIOSK?", answer: ["Show me, do not claim: “ge mig länk”"] },
  ]);
  // What is not remembered is not asked about, and the owner's own last words are not a memory to quiz on.
  assert.deepEqual(cardsOf("SITE", { source: "model", how: [], built: ["A footer"], left_off: null }).map((card) => card.question), ["What did you build last in SITE?"]);
  assert.deepEqual(cardsOf("NEW", { source: "own-words", built: ["fix the thing"] }), []);
  assert.deepEqual(cardsOf("NONE", null), []);
});

test("the project not touched for the longest is asked about first", () => {
  const projects = builtOf({
    today: "2026-10-06",
    days: {
      "2026-10-02": { OLD: { minutes: 90, prompts: 9 }, KIOSK: { minutes: 20, prompts: 2 } },
      "2026-10-05": { KIOSK: { minutes: 60, prompts: 4 }, BLANK: { minutes: 30, prompts: 3 } },
      "2026-10-07": { LATER: { minutes: 10, prompts: 1 } },
    },
    memories: { OLD: { source: "model", built: ["A map"] }, KIOSK: kiosk, LATER: kiosk },
  });
  assert.deepEqual(projects.map((item) => [item.project, item.lastDay, item.cards.length]), [["OLD", "2026-10-02", 1], ["KIOSK", "2026-10-05", 5]]);
  assert.equal(projects[1].about, "A phone booth that answers with a voice");
});
