import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { askModel, modelStatus } from "../src/llm.mjs";

// A stand-in for any provider that speaks the OpenAI chat format, on this Mac.
function standIn(reply) {
  const asked = [];
  const server = http.createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => { text += chunk; });
    request.on("end", () => {
      asked.push({ url: request.url, key: request.headers.authorization, body: JSON.parse(text) });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: reply } }] }));
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ asked, url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })));
}

test("the summaries can be written by any model that speaks the OpenAI chat format", async () => {
  const other = await standIn("<think>{ not this }</think>\n```json\n{\"headline\": \"Kubb & Blood ships\"}\n```");
  Object.assign(process.env, { APPRENTICE_LLM_URL: `${other.url}/`, APPRENTICE_LLM_MODEL: "llama3.2", APPRENTICE_LLM_KEY: "a-key" });
  try {
    assert.deepEqual(await askModel("Reply with JSON.", "What was built?", { model: "sonnet" }), { headline: "Kubb & Blood ships" });
    assert.equal(other.asked.length, 1);
    const [request] = other.asked;
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.key, "Bearer a-key");
    // The endpoint is asked for its own model, not for the Claude one a caller named.
    assert.equal(request.body.model, "llama3.2");
    assert.deepEqual(request.body.messages, [{ role: "system", content: "Reply with JSON." }, { role: "user", content: "What was built?" }]);
    assert.deepEqual(modelStatus(), { name: "llama3.2", where: new URL(other.url).host, ready: true, onThisMac: true });

    // Switched off, nothing is asked at all.
    process.env.APPRENTICE_LLM = "0";
    assert.equal(await askModel("Reply with JSON.", "What was built?"), null);
    assert.equal(other.asked.length, 1);
  } finally {
    for (const key of ["APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL", "APPRENTICE_LLM_KEY", "APPRENTICE_LLM"]) delete process.env[key];
    other.close();
  }
  assert.equal(modelStatus().name, "Claude");
});

test("what a provider wants beside the model and the messages goes with the request", async () => {
  const other = await standIn("{\"ready\": true}");
  Object.assign(process.env, {
    APPRENTICE_LLM_URL: other.url, APPRENTICE_LLM_MODEL: "venice-uncensored-1-2",
    APPRENTICE_LLM_EXTRA: "{\"venice_parameters\":{\"include_venice_system_prompt\":false},\"model\":\"another\"}",
  });
  try {
    assert.deepEqual(await askModel("Reply with JSON.", "Ready?"), { ready: true });
    const [request] = other.asked;
    assert.deepEqual(request.body.venice_parameters, { include_venice_system_prompt: false });
    // The extra fields never replace the model that was named.
    assert.equal(request.body.model, "venice-uncensored-1-2");
    assert.equal(modelStatus().ready, true);

    // Unreadable, nothing is asked rather than something else than was written down.
    process.env.APPRENTICE_LLM_EXTRA = "{venice_parameters";
    assert.equal(await askModel("Reply with JSON.", "Ready?"), null);
    assert.equal(other.asked.length, 1);
    assert.equal(modelStatus().ready, false);
  } finally {
    for (const key of ["APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL", "APPRENTICE_LLM_EXTRA"]) delete process.env[key];
    other.close();
  }
});

test("a reply that is not the JSON asked for is no answer", async () => {
  const other = await standIn("I am sorry, I cannot do that.");
  Object.assign(process.env, { APPRENTICE_LLM_URL: other.url, APPRENTICE_LLM_MODEL: "any" });
  try {
    assert.equal(await askModel("Reply with JSON.", "What was built?"), null);
  } finally {
    for (const key of ["APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL"]) delete process.env[key];
    other.close();
  }
});
