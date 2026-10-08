import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Its own folders for everything, set before anything is loaded. This file runs in its own process.
const root = await mkdtemp(path.join(os.tmpdir(), "mason-others-"));
Object.assign(process.env, { APPRENTICE_DATA: path.join(root, "data"), APPRENTICE_CLAUDE_DIR: path.join(root, "claude"), APPRENTICE_CODEX_DIR: path.join(root, "codex"), APPRENTICE_GROK_DIR: path.join(root, "grok") });
const { codexLog, grokSession, otherProjects, otherSources } = await import("../src/others.mjs");
const { logSources, projectIndex } = await import("../src/projects.mjs");

const at = (minute, second = 0) => new Date(Date.UTC(2026, 9, 8, 10, minute, second)).toISOString();
const lines = (rows) => rows.map((row) => JSON.stringify(row)).join("\n");
const said = (minute, text) => ({ timestamp: at(minute), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });

const typedInCodex = lines([
  { timestamp: at(0), type: "session_meta", payload: { cwd: "/Users/x/code/shop", originator: "Codex Desktop", source: "vscode", thread_source: "user" } },
  said(0, "<environment_context>the program's own words</environment_context>"),
  said(1, "# Context from my IDE setup:\nopen tabs\n## My request for Codex:\nMake the checkout take invoices too, key sk_live_abcdefghijklmnop"),
  { timestamp: at(2), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Working on it" }] } },
  { timestamp: at(3), type: "event_msg", payload: { type: "task_complete", last_agent_message: "Done" } },
  said(9, "ok go"),
  { timestamp: at(10), type: "event_msg", payload: { type: "turn_aborted" } },
]);
const startedByAnAgent = lines([
  { timestamp: at(20), type: "session_meta", payload: { cwd: "/Users/x/code/shop", originator: "codex_exec", source: "exec" } },
  said(20, "A brief another agent wrote: change these four files and run the tests"),
  { timestamp: at(24), type: "event_msg", payload: { type: "task_complete" } },
]);
const grokFiles = (id, kind, cwd) => ({
  summary: JSON.stringify({ info: { id, cwd }, session_kind: kind }),
  events: lines([{ ts: at(30), type: "turn_started" }, { ts: at(31), type: "tool_started" }, { ts: at(33), type: "turn_ended", outcome: "completed" }]),
  history: lines([{ timestamp: at(30), session_id: id, prompt: "Make the first page calmer, please", is_bash: false }, { timestamp: at(30), session_id: id, prompt: "ls -la the whole folder", is_bash: true }, { timestamp: at(30), session_id: "another", prompt: "Said in another session altogether", is_bash: false }]),
});

test("what was typed to Codex is its owner's words, without what the program wrapped around them", () => {
  const log = codexLog(typedInCodex);
  assert.equal(log.cwd, "/Users/x/code/shop");
  assert.equal(log.byHand, true);
  assert.deepEqual(log.prompts, [{ at: Date.parse(at(1)), text: "Make the checkout take invoices too, key [secret]", agent: "Codex" }]);
  // A word starts a turn without being kept as said; the first turn ended, the second was stopped.
  assert.deepEqual(log.turns, [{ prompt: Date.parse(at(1)), done: Date.parse(at(3)), ended: true }, { prompt: Date.parse(at(9)), done: Date.parse(at(10)), ended: false }]);
  assert.equal(codexLog(startedByAnAgent).byHand, false);
  assert.deepEqual(codexLog("not a log\n{\"timestamp\":\"never\"}").prompts, []);
});

test("a Grok session is its owner's only when they typed in it", () => {
  const typed = grokSession(grokFiles("one", "interactive", "/Users/x/code/site"));
  assert.equal(typed.byHand, true);
  assert.deepEqual(typed.prompts.map((prompt) => prompt.text), ["Make the first page calmer, please"]);
  assert.deepEqual(typed.turns, [{ prompt: Date.parse(at(30)), done: Date.parse(at(33)), ended: true }]);
  assert.equal(typed.minutes.size, 3);
  assert.equal(grokSession(grokFiles("two", "headless", "/Users/x/code/shop")).byHand, false);
});

test("both are read into the same projects: the work always counts, the words only when they were typed", async () => {
  await mkdir(path.join(root, "codex", "2026", "10", "08"), { recursive: true });
  await writeFile(path.join(root, "codex", "2026", "10", "08", "rollout-a.jsonl"), typedInCodex);
  await writeFile(path.join(root, "codex", "2026", "10", "08", "rollout-b.jsonl"), startedByAnAgent);
  for (const [place, id, kind, cwd] of [["shop", "two", "headless", "/Users/x/code/shop"], ["site", "one", "interactive", "/Users/x/code/site"]]) {
    const files = grokFiles(id, kind, cwd);
    await mkdir(path.join(root, "grok", place, id), { recursive: true });
    await writeFile(path.join(root, "grok", place, id, "summary.json"), files.summary);
    await writeFile(path.join(root, "grok", place, id, "events.jsonl"), files.events);
    await writeFile(path.join(root, "grok", place, "prompt_history.jsonl"), files.history);
  }
  const found = await otherProjects(0);
  const shop = found.get("/Users/x/code/shop");
  // Typed in Codex, started by an agent in Codex, started by an agent in Grok: one prompt, two turns, all the minutes.
  assert.deepEqual(shop.prompts.map((prompt) => prompt.agent), ["Codex"]);
  assert.equal(shop.turns.length, 2);
  assert.equal(shop.turns[0].next, Date.parse(at(9)));
  assert.ok(shop.minutes.has(Math.floor(Date.parse(at(24)) / 60_000)) && shop.minutes.has(Math.floor(Date.parse(at(31)) / 60_000)));
  assert.deepEqual(found.get("/Users/x/code/site").prompts.map((prompt) => prompt.agent), ["Grok"]);

  assert.deepEqual(await otherSources(), { codex: 2, grok: 2 });
  assert.deepEqual(await logSources(), { claude: 0, cursor: (await logSources()).cursor, codex: 2, grok: 2 });
  const index = await projectIndex(0);
  assert.deepEqual(index.prompts().map((prompt) => [prompt.project, prompt.agent]), [["shop", "Codex"], ["site", "Grok"]]);
  assert.equal(index.turns().filter((turn) => turn.project === "shop").length, 2);
});
