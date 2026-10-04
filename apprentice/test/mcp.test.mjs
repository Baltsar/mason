import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store decides where the data lives when it is first loaded. This file is
// its own process, so it brings its own small Work Map and never reads the
// one on this Mac.
const data = await mkdtemp(path.join(os.tmpdir(), "mason-mcp-"));
process.env.APPRENTICE_DATA = data;
await writeFile(path.join(data, "work-map.json"), JSON.stringify({
  sessions: [{ title: "Change the object", summary: "The invoice screen was dropped for a local layer that follows real work.", source: { label: "Debrief call", type: "call" } }],
  decisions: [
    { id: "g1", kind: "guardrail", title: "Store events, not a film", body: "Said on the debrief call.", quote: "It does not save a film of the whole day.", source: { label: "Debrief call", type: "call" } },
    { id: "d1", kind: "decision", title: "Ask at the pause", body: "Said on the debrief call.", quote: "Ask when my hands are still.", source: { label: "Debrief call", type: "call" } },
  ],
  questions: [],
  uncertainties: [],
  recap: null,
}));
const { callTool, handleMcp } = await import("../src/mcp-handler.mjs");

test("an agent is told what happened last, and where that came from", async () => {
  const answer = await callTool("what_happened_last");
  assert.match(answer, /Change the object/);
  assert.match(answer, /Source: Debrief call/);
});

test("an agent can load the rules in the owner's words and check a decision before acting", async () => {
  const rules = await callTool("guardrails_for_agents");
  assert.match(rules, /Ask at the pause/);
  assert.match(rules, /It does not save a film of the whole day\./);
  assert.match(await callTool("check_decision", { decision: "Save a film of the whole day so nothing is missed." }), /^STOP\. Store events, not a film/);
  assert.match(await callTool("check_decision", { decision: "Add a keyboard shortcut for the Work Map." }), /^CLEAR\./);
});

test("the handshake names the server and lists every tool", async () => {
  const hello = await handleMcp({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(hello.result.serverInfo.name, "mason");
  const listed = await handleMcp({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = listed.result.tools.map((tool) => tool.name);
  for (const name of ["what_happened_last", "how_was_it_built", "check_decision", "guardrails_for_agents"]) assert.ok(names.includes(name), name);
  const unknown = await handleMcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "no_such_tool" } });
  assert.equal(unknown.result.isError, true);
});
