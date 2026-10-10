import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder the first time it is loaded, and this file writes.
const root = await mkdtemp(path.join(os.tmpdir(), "mason-usage-"));
process.env.APPRENTICE_DATA = root;
const { recordUse, usagePayload } = await import("../src/usage.mjs");
const { askModel, onUse } = await import("../src/llm.mjs");

const at = (day, hour) => new Date(2026, 9, day, hour).getTime();

test("what the model took is kept by day and by what it was for, and nothing of what was said", async () => {
  await recordUse({ purpose: "summaries", input: 7000, output: 400, at: at(9, 10) });
  await recordUse({ purpose: "summaries", input: 6000, output: 600, at: at(9, 15) });
  await recordUse({ purpose: "proposals", input: 900, output: 100, at: at(9, 16) });
  // A late night belongs to the day before it; a week back is still this week, eight days is not.
  await recordUse({ purpose: "recap", input: 3000, output: 2000, at: at(10, 2) });
  await recordUse({ purpose: "summaries", input: 5000, output: 0, at: at(3, 12) });
  await recordUse({ purpose: "summaries", input: 9999, output: 0, at: at(1, 12) });
  const usage = await usagePayload(at(9, 20));
  assert.deepEqual(usage.today, { calls: 4, tokens: 20_000, by: [{ purpose: "summaries", tokens: 14_000 }, { purpose: "recap", tokens: 5000 }, { purpose: "proposals", tokens: 1000 }] });
  assert.equal(usage.week.tokens, 25_000);
  assert.equal(usage.week.calls, 5);
  assert.deepEqual(Object.keys(JSON.parse(await readFile(path.join(root, "usage.json"), "utf8")).days["2026-10-09"].summaries).sort(), ["calls", "input", "output"]);
});

test("a call is counted with the provider's own figure, or by its length when none is given", async () => {
  const heard = [];
  onUse((use) => heard.push(use));
  let usage = { prompt_tokens: 1234, completion_tokens: 56 };
  const server = http.createServer((request, response) => { request.resume(); request.on("end", () => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ choices: [{ message: { content: "{\"ok\": true}" } }], usage })); }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, { APPRENTICE_LLM_URL: `http://127.0.0.1:${server.address().port}/v1`, APPRENTICE_LLM_MODEL: "any" });
  try {
    await askModel("s".repeat(360), "p".repeat(360), { purpose: "summaries" });
    usage = undefined;
    await askModel("s".repeat(360), "p".repeat(360));
  } finally {
    for (const key of ["APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL"]) delete process.env[key];
    server.close();
    onUse(null);
  }
  assert.deepEqual(heard, [{ purpose: "summaries", input: 1234, output: 56 }, { purpose: "other", input: 200, output: 3 }]);
});
