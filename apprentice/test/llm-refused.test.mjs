import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// A stand-in for the Claude Code CLI: it prints what the file beside it holds.
// Which program is asked is fixed when the module is loaded, so it is named first.
const root = await mkdtemp(path.join(os.tmpdir(), "mason-llm-"));
const cli = path.join(root, "claude");
const reply = path.join(root, "reply.json");
await writeFile(cli, `#!/bin/sh\ncat > /dev/null\ncat "${reply}"\n`);
await chmod(cli, 0o755);
process.env.APPRENTICE_LLM_BIN = cli;
const { askModel, modelStatus } = await import("../src/llm.mjs");
const says = (value) => writeFile(reply, typeof value === "string" ? value : JSON.stringify(value));

test("a login that ran out is said, in Mason's own words, until the model answers again", async () => {
  assert.deepEqual(modelStatus(), { name: "Claude", where: "your own login", ready: true, onThisMac: false });
  await says({ is_error: true, result: "Failed to authenticate: OAuth session expired and could not be refreshed, token sk-ant-secret", terminal_reason: "api_error" });
  assert.equal(await askModel("Reply with JSON.", "What was built?"), null);
  assert.deepEqual(modelStatus(), { name: "Claude", where: "your own login", ready: false, onThisMac: false, problem: "login expired" });
  // Nothing of what the provider said is kept or shown.
  assert.equal(JSON.stringify(modelStatus()).includes("sk-ant"), false);

  // A reply that cannot be read says nothing about the login, either way.
  await says("cut short");
  assert.equal(await askModel("Reply with JSON.", "What was built?"), null);
  assert.equal(modelStatus().problem, "login expired");

  await says({ is_error: false, result: "{\"headline\": \"Back again\"}" });
  assert.deepEqual(await askModel("Reply with JSON.", "What was built?"), { headline: "Back again" });
  assert.deepEqual(modelStatus(), { name: "Claude", where: "your own login", ready: true, onThisMac: false });
});

test("no usage left is told apart from a login that ran out", async () => {
  await says({ is_error: true, result: "Claude usage limit reached. Your limit will reset at 3pm." });
  assert.equal(await askModel("Reply with JSON.", "What was built?"), null);
  assert.equal(modelStatus().problem, "no usage left");
  await says({ is_error: false, result: "{}" });
  await askModel("Reply with JSON.", "What was built?");
  assert.equal(modelStatus().problem, undefined);
});

test("a key another provider does not take is said of that provider, and not of Claude", async () => {
  await says({ is_error: false, result: "{}" });
  const server = http.createServer((request, response) => { request.resume(); request.on("end", () => { response.writeHead(401); response.end("{}"); }); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  Object.assign(process.env, { APPRENTICE_LLM_URL: `http://127.0.0.1:${server.address().port}/v1`, APPRENTICE_LLM_MODEL: "any", APPRENTICE_LLM_KEY: "a-key" });
  try {
    assert.equal(await askModel("Reply with JSON.", "What was built?"), null);
    assert.equal(modelStatus().problem, "login expired");
    assert.equal(modelStatus().ready, false);
  } finally {
    for (const key of ["APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL", "APPRENTICE_LLM_KEY"]) delete process.env[key];
    server.close();
  }
  assert.equal(modelStatus().problem, undefined);
});
