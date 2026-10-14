import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The store fixes its folder at the first import, and so does the reader of the agents' logs.
const data = await mkdtemp(path.join(os.tmpdir(), "mason-review-"));
const logs = await mkdtemp(path.join(os.tmpdir(), "mason-review-logs-"));
process.env.APPRENTICE_DATA = data;
process.env.APPRENTICE_CLAUDE_DIR = logs;
const { ensureStore } = await import("../src/store.mjs");
const { loadDays, refreshDays } = await import("../src/days.mjs");
const { projectIndex } = await import("../src/projects.mjs");
const { masonSaid } = await import("../src/mason-said.mjs");
const { briefOf, shortOf } = await import("../src/continue.mjs");
const { promptFor } = await import("../src/handover.mjs");
const { fetchFile } = await import("../src/own-model.mjs");
const { isTerminal } = await import("../src/collector.mjs");

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const local = (day, hour, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();
const claudeLog = async (folder, rows) => {
  await mkdir(path.join(logs, folder), { recursive: true });
  await writeFile(path.join(logs, folder, "session.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
};
const said = (at, text, cwd = "/Users/someone/work/KIOSK") => ({ type: "user", timestamp: at, cwd, message: { role: "user", content: text } });
const done = (at, cwd = "/Users/someone/work/KIOSK") => ({ type: "assistant", timestamp: at, cwd, message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done." }] } });

test("what Mason keeps is in folders only its owner can enter", async () => {
  await chmod(data, 0o755);
  await ensureStore();
  assert.equal((await stat(data)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(data, "wiki"))).mode & 0o777, 0o700);
});

test("a brief or a rule prompt that Mason handed over is not read back as its owner's words", async () => {
  const memory = { source: "model", plainly: "A phone booth that answers out loud.", left_off: "Modem power is a guess.", open: ["Measure the modem"] };
  const given = { project: "KIOSK", folder: "/Users/someone/work/KIOSK", memory, recent: [{ at: 1, text: "Try the modem on battery" }] };
  // Everything Mason hands over is recognised: the short brief, with and without the folder, the whole notes, and the rule prompt.
  for (const text of [shortOf(given), shortOf(given, false), briefOf(given).text, promptFor("Show me, do not claim", "mine"), promptFor("Ask before deleting", "theirs")]) assert.equal(masonSaid(text), true, text.slice(0, 60));
  // Its owner's own words, even ones that start the same way, are not.
  for (const text of ["Picking up the kids again, back in an hour", "I am picking up work on KIOSK again, where were we?", "I want to add a login page"]) assert.equal(masonSaid(text), false, text);
  // In a log: the brief is a turn (the agent works on it), but it is not something said.
  await claudeLog("-Users-someone-work-KIOSK", [
    said(local(6, 10), "Make the modem report its power draw every minute"), done(local(6, 10, 4)),
    said(local(6, 11), shortOf(given, false)), done(local(6, 11, 3)),
  ]);
  const index = await projectIndex(0, { maxAgeMs: 0 });
  assert.deepEqual(index.prompts().map((prompt) => prompt.text), ["Make the modem report its power draw every minute"]);
  assert.equal(index.turns().length, 2);
});

test("when the way days are counted changes, a day the logs no longer hold is kept as it was", async () => {
  // A ledger from before, with a day long gone from the logs and a day the logs still give.
  await writeFile(path.join(data, "days.json"), JSON.stringify({
    version: 1,
    through: Date.parse(local(7, 12)),
    days: { "2026-03-02": { OLDSHOP: { minutes: 95, prompts: 14 } }, "2026-10-06": { KIOSK: { minutes: 999, prompts: 99 } } },
    moves: {},
    lookbacks: [{ days: ["2026-03-02"], lines: ["Kept"] }],
  }));
  const known = await refreshDays(Date.parse(local(8, 12)));
  assert.deepEqual(known.days["2026-03-02"], { OLDSHOP: { minutes: 95, prompts: 14 } });
  // The day the logs still give is counted again, the new way.
  assert.notEqual(known.days["2026-10-06"].KIOSK.minutes, 999);
  assert.equal(known.days["2026-10-06"].KIOSK.prompts, 1);
  assert.equal(known.lookbacks.length, 1);
  assert.deepEqual((await loadDays()).days["2026-03-02"], { OLDSHOP: { minutes: 95, prompts: 14 } });
});

test("a model that cannot be written to disk is an error of the fetch, not the end of the server", async () => {
  const shut = await mkdtemp(path.join(os.tmpdir(), "mason-shut-"));
  await chmod(shut, 0o500);
  const body = Buffer.alloc(30_000, 1);
  const fetcher = async () => ({ ok: true, status: 200, body: (async function* () { yield body; })() });
  await assert.rejects(fetchFile({ url: "https://example.test/m.gguf", bytes: body.length, sha256: "0".repeat(64), file: path.join(shut, "m.gguf") }, { fetcher }), /EACCES|permission/i);
  await chmod(shut, 0o700);
});

test("a terminal's screen is not taken for a prompt", () => {
  for (const [app, bundle] of [["iTerm2", "com.googlecode.iterm2"], ["Terminal", ""], ["Ghostty", ""], ["", "dev.warp.Warp-Stable"]]) assert.equal(isTerminal(app, bundle), true, app || bundle);
  for (const [app, bundle] of [["Claude", "com.anthropic.claudefordesktop"], ["Cursor", "com.todesktop.230313mzl4w4u92"], ["Codex", "com.openai.codex"]]) assert.equal(isTerminal(app, bundle), false, app);
});

test("an agent that starts Mason over stdio is held to the switches, and starts no model", async () => {
  // A Mason of its own, with the agents' logs and the summaries switched off, and a "model" that leaves a mark if it is ever started.
  const own = await mkdtemp(path.join(os.tmpdir(), "mason-stdio-"));
  const mark = path.join(own, "model-was-started");
  const model = path.join(own, "claude");
  await writeFile(model, `#!/bin/sh\ntouch "${mark}"\necho '{"is_error":false,"result":"{}"}'\n`);
  await chmod(model, 0o700);
  const ask = (settings) => new Promise(async (resolve, reject) => {
    await writeFile(path.join(own, "settings.json"), JSON.stringify(settings));
    const child = spawn(process.execPath, [path.join(root, "src", "mcp.mjs")], { env: { ...process.env, APPRENTICE_DATA: own, APPRENTICE_CLAUDE_DIR: logs, APPRENTICE_LLM_BIN: model, APPRENTICE_LLM: "" }, stdio: ["pipe", "pipe", "ignore"] });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      const line = out.split("\n").find((text) => text.includes('"id":2'));
      if (line) { child.kill(); resolve(JSON.parse(line).result.content[0].text); }
    });
    child.once("error", reject);
    setTimeout(() => { child.kill(); reject(new Error(`no answer: ${out}`)); }, 20_000).unref();
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "how_was_it_built", arguments: {} } })}\n`);
  });
  // The agents' logs off: none is read.
  assert.match(await ask({ logs: false, summaries: false }), /No project has been worked on yet/);
  // On, with the summaries on too: the project is there, and still no model was started for it.
  assert.match(await ask({ logs: true, summaries: true }), /# KIOSK/);
  await assert.rejects(readFile(mark));
});
