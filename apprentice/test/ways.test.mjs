import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder at the first import, and .env.local of a test names no endpoint.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-ways-"));
for (const name of ["APPRENTICE_LLM", "APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL", "APPRENTICE_LLM_KEY"]) delete process.env[name];
const { loadSettings, saveSettings } = await import("../src/settings.mjs");
const { checkModel, localModels, waysPayload } = await import("../src/ways.mjs");
await loadSettings();

// A Mac on which Ollama runs with two models, and LM Studio does not.
const ollama = async (url) => {
  if (url === "http://127.0.0.1:11434/v1/models") return { ok: true, json: async () => ({ data: [{ id: "llama3.2:3b" }, { id: "qwen2.5-coder" }, { id: "bad name; rm -rf" }] }) };
  throw new Error("connection refused");
};
const nothing = async () => { throw new Error("connection refused"); };

test("a model on this Mac is found where it listens, and only names that are names are offered", async () => {
  assert.deepEqual(await localModels(ollama), [{ app: "Ollama", url: "http://127.0.0.1:11434/v1", models: ["llama3.2:3b", "qwen2.5-coder"] }]);
  assert.deepEqual(await localModels(nothing), []);
});

test("the way in use is no model, Claude, or a model on this Mac, and each sets where the summaries go", async () => {
  // Out of the box: Claude, the login already on this Mac.
  assert.equal((await waysPayload({ fetcher: nothing })).chosen, "claude");
  assert.equal(process.env.APPRENTICE_LLM_URL, undefined);
  await saveSettings({ summaries: false });
  assert.equal((await waysPayload({ fetcher: nothing })).chosen, "none");
  assert.equal(process.env.APPRENTICE_LLM, "0");
  // A model on this Mac: the summaries go to it and to no other place.
  await saveSettings({ summaries: true, writer: "local", localUrl: "http://127.0.0.1:11434/v1", localModel: "llama3.2:3b" });
  const local = await waysPayload({ fetcher: ollama });
  assert.equal(local.chosen, "local");
  assert.deepEqual(local.localChosen, { url: "http://127.0.0.1:11434/v1", model: "llama3.2:3b" });
  assert.equal(process.env.APPRENTICE_LLM_URL, "http://127.0.0.1:11434/v1");
  assert.equal(process.env.APPRENTICE_LLM_MODEL, "llama3.2:3b");
  assert.equal(process.env.APPRENTICE_LLM, undefined);
  // Back to Claude: nothing is left pointing at the other model.
  await saveSettings({ writer: "claude" });
  assert.equal((await waysPayload({ fetcher: ollama })).chosen, "claude");
  assert.equal(process.env.APPRENTICE_LLM_URL, undefined);
  assert.equal(process.env.APPRENTICE_LLM_MODEL, undefined);
});

test("a press in a window cannot point the summaries at a place on the internet", async () => {
  for (const localUrl of ["https://evil.example/v1", "http://127.0.0.1:11434.evil.example/v1", "http://localhost:9999/v1", "http://127.0.0.1:11434/v1/../../x"]) {
    const kept = await saveSettings({ summaries: true, writer: "local", localUrl, localModel: "llama3.2" });
    assert.deepEqual([kept.writer, kept.localUrl, kept.localModel], ["", "", ""]);
    assert.equal(process.env.APPRENTICE_LLM_URL, undefined);
  }
  // Nor is a name that is not a name taken for a model.
  assert.equal((await saveSettings({ writer: "local", localUrl: "http://127.0.0.1:1234/v1", localModel: "x y; curl" })).writer, "");
});

test("one question shows whether the model answers, and says in a word why not", async () => {
  await saveSettings({ summaries: true, writer: "claude" });
  const answered = await checkModel(async () => ({ ok: true }));
  assert.equal(answered.ok, true);
  assert.equal(answered.name, "Claude");
  assert.ok(answered.ms >= 0);
  assert.deepEqual(await checkModel(async () => null), { ok: false, why: "not answering", name: "Claude" });
  // With no model chosen nothing is asked at all.
  await saveSettings({ summaries: false });
  let asked = 0;
  assert.deepEqual(await checkModel(async () => { asked += 1; return { ok: true }; }), { ok: false, why: "off" });
  assert.equal(asked, 0);
});
