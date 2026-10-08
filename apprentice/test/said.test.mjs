import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Its own data folder, set before anything is loaded. This file runs in its own process.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-said-"));
const { DIMENSIONS, embed } = await import("../src/embed.mjs");
const { beforeSaid, findSaid, forgetSaid, refreshSaid, repeatedSaid, saidStatus, unreadSaid } = await import("../src/said.mjs");

// A stand-in for the model: a text points the way of the things it is about,
// whatever language or words it says them in.
const ABOUT = [
  /stripe|webhook|payment|betalning|checkout|invoice/i,
  /font|colou?r|layout|typograf|spacing/i,
  /short|brief|kort|few words|not so long/i,
  /diff|plan before|show me first|visa först/i,
  /deploy|vercel|hosting/i,
];
const rowOf = (text) => {
  const row = new Float32Array(DIMENSIONS);
  ABOUT.forEach((topic, place) => { if (topic.test(text)) row[place] = 1; });
  // A text about none of it points its own way.
  if (!row.some(Boolean)) row[10 + ([...text].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 200)] = 1;
  const length = Math.hypot(...row);
  return row.map((value) => value / length);
};
const model = async (texts) => texts.map(rowOf);
const day = (date, hour = 10) => Date.UTC(2026, 9, date, hour);

const prompts = [
  { project: "shop", at: day(1), text: "The Stripe webhook must verify the signature before anything else" },
  { project: "shop", at: day(2), text: "Checkout fails when the invoice has no address, look at that" },
  { project: "site", at: day(2), text: "Make the font larger and the layout calmer on the first page" },
  { project: "site", at: day(3), text: "Put it on Vercel when the page is ready to be seen" },
  // The same demand, in four ways, on three days, in three projects.
  { project: "shop", at: day(1, 12), text: "Keep the answer short, I do not read long ones" },
  { project: "site", at: day(2, 12), text: "Svara kort, jag orkar inte läsa så mycket text" },
  { project: "tool", at: day(3, 12), text: "A brief answer please, only what changed" },
  { project: "tool", at: day(3, 14), text: "Again: few words, not so long an answer" },
  // Said often, but in one project only.
  { project: "site", at: day(1, 9), text: "Show me the diff before you change files" },
  { project: "site", at: day(2, 9), text: "A plan before you start, then the diff" },
  { project: "site", at: day(3, 9), text: "Show me first what the diff will be" },
  { project: "site", at: day(4, 9), text: "Visa först, sedan ändrar du i filerna" },
];

test("each prompt is read once, and what was read is kept", async () => {
  assert.deepEqual(await refreshSaid(prompts, { embedder: model, model: "stand-in" }), { added: 12, waiting: 0 });
  assert.deepEqual(await refreshSaid(prompts, { embedder: model, model: "stand-in" }), { added: 0, waiting: 0 });
  assert.deepEqual(await saidStatus(), { count: 12, model: "stand-in", from: "2026-10-01" });
  const rows = await readFile(path.join(process.env.APPRENTICE_DATA, "said", "said.bin"));
  assert.equal(rows.length, 12 * DIMENSIONS * 4);
});

test("what is asked for is found by what it means, by project", async () => {
  const found = await findSaid("where did I deal with payments", { embedder: async () => [rowOf("payment")] });
  assert.equal(found.read, 12);
  assert.deepEqual(found.projects.map((entry) => entry.project), ["shop"]);
  assert.equal(found.projects[0].count, 2);
  assert.match(found.projects[0].said[0].text, /Stripe webhook|Checkout fails/);
  // Nothing that was said is close to this.
  assert.deepEqual((await findSaid("the weather in Lund", { embedder: model })).projects, []);
  // No model, no answer: that is not the same as nothing found.
  assert.equal(await findSaid("payments", { embedder: async () => null }), null);
});

test("a demand made in several projects on several days is one thing said several times", async () => {
  const repeated = await repeatedSaid();
  assert.equal(repeated.length, 1);
  const [demand] = repeated;
  assert.equal(demand.times, 4);
  assert.equal(demand.days, 3);
  assert.deepEqual([...demand.projects].sort(), ["shop", "site", "tool"]);
  assert.equal(demand.ways.length, 4);
  // It comes back in words that were actually said, never in new ones.
  assert.ok(prompts.some((prompt) => prompt.text === demand.text));
});

test("rows from another model are not mixed with the ones that were kept", async () => {
  const again = await refreshSaid(prompts.slice(0, 3), { embedder: model, model: "another" });
  assert.deepEqual(again, { added: 3, waiting: 0 });
  assert.deepEqual(await saidStatus(), { count: 3, model: "another", from: "2026-10-01" });
});

test("a model that does not answer adds nothing, and everything can be forgotten", async () => {
  assert.equal(await refreshSaid(prompts, { embedder: async () => null, model: "another" }), null);
  assert.equal((await saidStatus()).count, 3);
  await forgetSaid();
  assert.equal((await saidStatus()).count, 0);
});

test("the model is asked in its own way, and its rows are cut and brought back to length", async () => {
  const asked = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      const { input } = JSON.parse(body);
      asked.push(...input);
      // Rows of 768 numbers, given back in the wrong order.
      const data = input.map((text, index) => ({ index, embedding: Array.from({ length: 768 }, (_, place) => (place === index ? 3 : place === 700 ? 9 : 0)) })).reverse();
      response.writeHead(request.url === "/v1/embeddings" ? 200 : 404, { "content-type": "application/json" });
      response.end(JSON.stringify({ data }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.APPRENTICE_EMBED_URL = `http://127.0.0.1:${server.address().port}/v1/`;
  process.env.APPRENTICE_EMBED_MODEL = "embeddinggemma-2";
  try {
    const rows = await embed(["first", "second"], "query");
    assert.deepEqual(asked, ["task: search result | query: first", "task: search result | query: second"]);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].length, DIMENSIONS);
    // What lay beyond the cut is gone, and each row has length one again.
    assert.equal(rows[0][0], 1);
    assert.equal(rows[1][1], 1);
    assert.deepEqual(await embed(["a text to be found"]), [rows[0]]);
    assert.equal(asked.at(-1), "title: none | text: a text to be found");
    process.env.APPRENTICE_EMBED_URL = `http://127.0.0.1:${server.address().port}/nowhere`;
    assert.equal(await embed(["first"]), null);
  } finally {
    delete process.env.APPRENTICE_EMBED_URL;
    delete process.env.APPRENTICE_EMBED_MODEL;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("a piece of work done before in another project is found, and a habit is not taken for one", async () => {
  // Enough has to be read before what all prompts have in common is known.
  const filler = Array.from({ length: 210 }, (_, count) => ({ project: `p${count % 7}`, at: day(1, 1) + count * 60_000, text: `nothing of note was said here, this is line number ${count} of them` }));
  const earlier = { project: "shop", at: day(2), text: "The Stripe webhook must verify the signature before anything else is done" };
  const again = { project: "site", at: day(5), text: "Checkout has to take a payment by invoice as well as by card" };
  const habit = ["shop", "tool", "kiosk"].map((project, count) => ({ project, at: day(2, 12 + count), text: "Keep the answer short please, I do not read the long ones" }));
  const habitAgain = { project: "site", at: day(6), text: "A brief answer is what I want here, not a long one" };
  const sameDay = { project: "tool", at: day(5, 12), text: "The invoice for a payment has to be sent after checkout is done" };
  const little = { project: "site", at: day(6, 12), text: "Stripe webhook again" };
  const all = [...filler, earlier, again, ...habit, habitAgain, sameDay, little];
  assert.deepEqual((await unreadSaid([again, earlier])).length, 2);
  await refreshSaid(all, { embedder: model, model: "stand-in" });
  assert.deepEqual(await unreadSaid([again, earlier]), []);

  const found = await beforeSaid(again);
  assert.equal(found.project, "shop");
  assert.equal(found.text, earlier.text);
  assert.ok(found.score > 0.9);
  // Said the same way in three other projects: a habit, not a piece of work.
  assert.equal(await beforeSaid(habitAgain), null);
  // The first time it was said there was nothing before it.
  assert.equal(await beforeSaid(earlier), null);
  // Too little said to be a piece of work, and a prompt that was never read.
  assert.equal(await beforeSaid(little), null);
  assert.equal(await beforeSaid({ project: "site", at: day(7), text: "Checkout has to take a payment by invoice, said but never read" }), null);
});
