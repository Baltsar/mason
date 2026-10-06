import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The agents' logs are read from a folder of this test's own, set before the
// reader is loaded. This file runs in its own process.
const logs = await mkdtemp(path.join(os.tmpdir(), "mason-logs-"));
process.env.APPRENTICE_CLAUDE_DIR = logs;
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-turns-"));
const { projectIndex } = await import("../src/projects.mjs");

const at = (minute) => new Date(Date.UTC(2026, 9, 6, 8, minute)).toISOString();
const row = (minute, more) => JSON.stringify({ timestamp: at(minute), cwd: "/Users/someone/work/KIOSK", ...more });
const said = (minute, text) => row(minute, { type: "user", message: { role: "user", content: text } });
const step = (minute, stop, type = "text") => row(minute, { type: "assistant", message: { role: "assistant", stop_reason: stop, content: [type === "text" ? { type: "text", text: "Working on it." } : { type: "tool_use", name: "Bash", input: {} }] } });
const result = (minute) => row(minute, { type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });

test("a turn lasts until the model ends it, and knows when the next thing was said", async () => {
  await mkdir(path.join(logs, "-Users-someone-work-KIOSK"));
  await writeFile(path.join(logs, "-Users-someone-work-KIOSK", "session.jsonl"), [
    said(0, "Measure what the modem really draws"),
    step(1, "tool_use", "tool"),
    result(2),
    step(6, "end_turn"),
    // A single word is a turn too, though too short to be kept as something said.
    said(20, "go"),
    step(21, "tool_use", "tool"),
    result(22),
    // What the harness wraps in a tag is not the person speaking.
    row(23, { type: "user", message: { role: "user", content: "<task-notification>done</task-notification>" } }),
    step(24, "tool_use", "tool"),
  ].join("\n") + "\n");
  const index = await projectIndex(0, { maxAgeMs: 0 });
  const stamp = (time) => new Date(time).toISOString();
  assert.deepEqual(index.turns().map((turn) => [turn.project, stamp(turn.prompt), stamp(turn.done), turn.ended, turn.next && stamp(turn.next)]), [
    ["KIOSK", at(0), at(6), true, at(20)],
    ["KIOSK", at(20), at(24), false, null],
  ]);
  assert.deepEqual(index.prompts().map((prompt) => prompt.text), ["Measure what the modem really draws"]);
});
