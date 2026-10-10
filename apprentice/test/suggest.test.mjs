import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Its own data folder, its own rules file and its own stand-in for a model,
// all set before anything is loaded. This file runs in its own process.
const folder = await mkdtemp(path.join(os.tmpdir(), "mason-suggest-"));
process.env.APPRENTICE_DATA = folder;
process.env.APPRENTICE_RULES_FILE = path.join(folder, "CLAUDE.md");
let reply = { groups: [] };
const model = http.createServer((request, response) => {
  request.resume();
  request.on("end", () => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })); });
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));
Object.assign(process.env, { APPRENTICE_LLM_URL: `http://127.0.0.1:${model.address().port}/v1`, APPRENTICE_LLM_MODEL: "stand-in" });
const { adoptRule, applySuggestion, dismissSuggestion, groupRules, refreshSuggestions, removeRule, rulesFile, rulesOf, suggestionsPayload, wordDemands } = await import("../src/suggest.mjs");
test.after(() => model.close());

const memories = {
  KIOSK: { keeps_saying: [{ rule: "Show me visually, not text", times: 2, example: "visa visuellt inte text" }, { rule: "Push and deploy at once", times: 2, example: "pusha och deploya direkt" }] },
  MASON: { keeps_saying: [{ rule: "Make text minimal", times: 3, example: "de är för mycket text" }] },
  SITE: { keeps_saying: [{ rule: "Keep it scannable", times: 2, example: "håll det scanbart" }] },
  EMPTY: { keeps_saying: [] },
};
const before = "# My rules\n\n- Swedish in conversation\n\n## Hard constraints\n- No emojis in code\n";

test("a rule counts only when it was said in several projects, and rests on the words that were said", async () => {
  const rules = rulesOf(memories);
  assert.equal(rules.length, 4);
  // The model says which lines belong together; a line it invents, a group from one project and one said too seldom are left out.
  reply = { groups: [{ rule: "Show it visually and keep the text short, unless I ask for the detail.", members: [1, 3, 4, 99] }, { rule: "Deploy at once.", members: [2] }, { rule: "x", members: [1, 3] }] };
  const proposals = await groupRules(rules);
  assert.equal(proposals.length, 1);
  assert.deepEqual([proposals[0].rule, proposals[0].projects, proposals[0].times], ["Show it visually and keep the text short, unless I ask for the detail.", 3, 7]);
  assert.deepEqual(proposals[0].evidence.map((item) => [item.project, item.example]), [["KIOSK", "visa visuellt inte text"], ["MASON", "de är för mycket text"], ["SITE", "håll det scanbart"]]);
  // No answer at all is not "nothing to propose".
  reply = "not what was asked for";
  assert.equal(await groupRules(rules), null);
});

test("yes writes one line where the agents read it and leaves the rest of the file alone; it can be taken out again", async () => {
  await writeFile(rulesFile(), before);
  reply = { groups: [{ rule: "Show it visually and keep the text short, unless I ask for the detail.", members: [1, 3, 4] }] };
  assert.equal(await refreshSuggestions(memories), true);
  const [proposal] = (await suggestionsPayload()).open;
  assert.equal(proposal.times, 7);
  // Nothing is written until it is said yes to.
  assert.equal(await readFile(rulesFile(), "utf8"), before);

  assert.equal(await applySuggestion(proposal.id), true);
  const after = await readFile(rulesFile(), "utf8");
  assert.ok(after.startsWith(before.trimEnd()));
  assert.match(after, /\n\n## Learned by Mason\n\n.*the prompt wins\.\n\n- Show it visually and keep the text short, unless I ask for the detail\.\n$/s);
  assert.equal(await readFile(path.join(folder, "rules-before-mason.md"), "utf8"), before);
  assert.deepEqual((await suggestionsPayload()).open, []);
  assert.equal((await suggestionsPayload()).applied[0].rule, proposal.rule);

  // The same thing, found again later, is not proposed a second time.
  assert.equal(await refreshSuggestions({ ...memories, NEW: { keeps_saying: [{ rule: "Less text", times: 2, example: "mindre text" }] } }, Date.now() + 7 * 3_600_000), true);
  assert.deepEqual((await suggestionsPayload()).open, []);

  assert.equal(await removeRule(proposal.id), true);
  assert.equal(await readFile(rulesFile(), "utf8"), before);
  assert.deepEqual((await suggestionsPayload()).applied, []);
});

test("a rule that takes away the question before something goes out is never proposed for every project", async () => {
  const said = rulesOf({ A: { keeps_saying: [{ rule: "Just publish, stop asking", times: 2, example: "Ja sluta fråga publicera" }] }, B: { keeps_saying: [{ rule: "Go live at once", times: 2, example: "Pusha och deploya" }] } });
  reply = { groups: [{ rule: "Go live at once without seeking approval.", members: [1, 2] }] };
  assert.deepEqual(await groupRules(said), []);
});

test("no means it is not proposed again, and the words can be changed before yes", async () => {
  reply = { groups: [{ rule: "Use a picture when it is complicated.", members: [1, 2] }] };
  const said = { A: { keeps_saying: [{ rule: "Draw it", times: 2, example: "rita det" }] }, B: { keeps_saying: [{ rule: "A picture, please", times: 2, example: "en bild tack" }] } };
  assert.equal(await refreshSuggestions(said, Date.now() + 14 * 3_600_000), true);
  const [proposal] = (await suggestionsPayload()).open;
  assert.equal(proposal.rule, "Use a picture when it is complicated.");
  assert.equal(await dismissSuggestion(proposal.id), true);
  assert.equal(await refreshSuggestions({ ...said, C: { keeps_saying: [] } }, Date.now() + 21 * 3_600_000), false);
  assert.deepEqual((await suggestionsPayload()).open, []);
  assert.equal(await readFile(rulesFile(), "utf8"), before);

  reply = { groups: [{ rule: "Explain it simply.", members: [1, 2] }] };
  const more = { C: { keeps_saying: [{ rule: "Simpler", times: 2, example: "enklare" }] }, D: { keeps_saying: [{ rule: "Plainly", times: 3, example: "rakt på" }] } };
  assert.equal(await refreshSuggestions(more, Date.now() + 28 * 3_600_000), true);
  const [second] = (await suggestionsPayload()).open;
  assert.equal(await applySuggestion(second.id, "  Explain it simply, but not when the problem is complex.  "), true);
  assert.ok((await readFile(rulesFile(), "utf8")).endsWith("\n- Explain it simply, but not when the problem is complex.\n"));
  assert.equal(await removeRule(second.id), true);
  assert.equal(await readFile(rulesFile(), "utf8"), before);
});

// What said.mjs finds in the prompts themselves: the same thing said in several ways.
const demand = (id, times, projects, ...texts) => ({ id, text: texts[0], times, days: 5, projects, ways: texts.map((text, index) => ({ text, times: 1, project: projects[index % projects.length] })) });

test("a demand found in the prompts themselves is worded by the model and rests on what was said", async () => {
  const repeated = [
    demand("d-localhost", 13, ["A", "B", "C"], "kör igång localhost så kan ja se", "Boota upp localhost igen", "Visa mig igen, localhost"),
    demand("d-yes", 4, ["A", "B"], "Kör de du rekommenderar", "Japp kör de du rekommendera"),
    demand("d-push", 6, ["A", "B", "C"], "Okay nu måste vi pusha", "Pusha bara merga"),
  ];
  // The model is shown two groups: the one about pushing never reaches it.
  reply = { groups: [{ group: 1, kind: "habit", rule: "Start the local server and give the address when something is ready to look at." }, { group: 2, kind: "answer", rule: "Go with the recommendation." }, { group: 9, kind: "habit", rule: "No such group." }] };
  const proposals = await wordDemands(repeated);
  assert.equal(proposals.length, 1);
  assert.equal(proposals[0].rule, "Start the local server and give the address when something is ready to look at.");
  assert.deepEqual([proposals[0].times, proposals[0].projects], [13, 3]);
  assert.deepEqual(proposals[0].evidence.map((item) => item.example), ["kör igång localhost så kan ja se", "Boota upp localhost igen", "Visa mig igen, localhost"]);

  // A rule the model words so that it acts outward is held back as well.
  reply = { groups: [{ group: 2, kind: "habit", rule: "Push the recommended change without asking." }] };
  assert.deepEqual(await wordDemands(repeated), []);
  // No model, no telling a demand from a yes: nothing is proposed.
  reply = "not what was asked for";
  assert.equal(await wordDemands(repeated), null);
  assert.deepEqual(await wordDemands([]), []);
});

test("a demand from the prompts becomes a proposal at once when more was read, and no settles it", async () => {
  const repeated = [demand("d-localhost", 13, ["A", "B", "C"], "kör igång localhost så kan ja se", "Boota upp localhost igen", "Visa mig igen, localhost")];
  reply = { groups: [{ group: 1, kind: "habit", rule: "Start the local server when something is ready to look at." }] };
  const now = Date.now() + 40 * 3_600_000;
  assert.equal(await refreshSuggestions({}, now, { repeated }), true);
  const [proposal] = (await suggestionsPayload()).open;
  assert.equal(proposal.rule, "Start the local server when something is ready to look at.");
  assert.equal(await dismissSuggestion(proposal.id), true);
  // Said once more, in one more way: still the demand that was answered with no.
  const grown = [demand("d-localhost-grown", 14, ["A", "B", "C"], "kör igång localhost så kan ja se", "Boota upp localhost igen", "Visa mig igen, localhost", "starta localhost")];
  assert.equal(await refreshSuggestions({}, now + 60_000, { repeated: grown }), false);
  assert.equal(await refreshSuggestions({}, now + 60_000, { repeated: grown, soon: true }), true);
  assert.deepEqual((await suggestionsPayload()).open, []);
});

test("a rule taken over from someone else is written once, kept with whose it was, and can be taken out", async () => {
  const before = await readFile(rulesFile(), "utf8").catch(() => "");
  assert.equal(await adoptRule("  - Run the tests after every change and show the result.  ", "S. Hale"), true);
  assert.equal(await adoptRule("Run the tests after every change and show the result.", "Someone else"), true);
  const text = await readFile(rulesFile(), "utf8");
  assert.equal(text.split("- Run the tests after every change and show the result.").length, 2);
  const taken = (await suggestionsPayload()).applied.filter((rule) => rule.rule === "Run the tests after every change and show the result.");
  assert.equal(taken.length, 1);
  assert.equal(taken[0].from, "S. Hale");
  assert.equal(await adoptRule("   "), false);
  await removeRule(taken[0].id);
  assert.equal((await readFile(rulesFile(), "utf8").catch(() => "")).trim(), before.trim());
});

