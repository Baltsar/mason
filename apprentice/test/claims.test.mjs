import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { limits } from "../src/question-engine.mjs";
import { mergeInferred } from "../src/memory.mjs";

// What the films say about Mason, checked against the code. See docs/CLAIMS.md.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => readFile(path.join(root, ...parts), "utf8");
const sources = async (folder, ending) => Promise.all((await readdir(path.join(root, folder))).filter((name) => name.endsWith(ending)).map(async (name) => [name, await read(folder, name)]));

test("events, not pixels: nothing in the product can take a screenshot or watch the keyboard", async () => {
  const forbidden = /CGWindowListCreateImage|CGDisplayCreateImage|SCStream|SCScreenshotManager|AVCaptureScreenInput|screencapture|CGEvent\.tapCreate|CGEventTap|addGlobalMonitorForEvents\(matching:[^)]*key/i;
  for (const [name, text] of [...await sources("native", ".swift"), ...await sources("src", ".mjs")]) assert.equal(forbidden.test(text), false, name);
});

test("refused before it is written: a private app is turned away before its window is looked at", async () => {
  const reader = await read("native", "ApprenticeReader.swift");
  const refusal = reader.indexOf("excluded.contains(bundle)");
  const title = reader.indexOf("rawTitle");
  assert.ok(refusal > 0 && title > 0);
  assert.ok(refusal < title);
  const collector = await read("src", "collector.mjs");
  assert.match(collector, /privateRefusals = \(runtime\.privateRefusals \|\| 0\) \+ 1/);
});

test("it waits for the pause: six seconds still, then ninety seconds quiet, five questions at most", () => {
  const limit = limits({ session: { active: true, questions: 0 } });
  assert.equal(limit.pause, 6000);
  assert.equal(limit.cooldown, 90_000);
  assert.equal(limit.max, 5);
});

test("the rules come out of the agent logs: a correction said twice becomes a rule, with the owner's words as evidence", () => {
  const map = { decisions: [] };
  const changed = mergeInferred(map, { project: "KUBB", lastAt: "2026-10-04T10:00:00.000Z", keeps_saying: [{ rule: "Publish without asking", times: 2, example: "Ja sluta fråga publicera" }] });
  assert.equal(changed, true);
  assert.equal(map.decisions.length, 1);
  assert.equal(map.decisions[0].kind, "guardrail");
  assert.equal(map.decisions[0].quote, "Ja sluta fråga publicera");
  assert.equal(map.decisions[0].source.type, "inferred");
});

test("three ElevenLabs agents, one for each kind of call", async () => {
  const agents = await read("src", "agent.mjs");
  for (const role of ["debrief", "tutor", "recall"]) assert.ok(agents.includes(`${role}: { name: "Mason · ${role}"`), role);
});

test("the memory is served to this Mac only", async () => {
  assert.ok((await read("src", "server.mjs")).includes('server.listen(port, "127.0.0.1"'));
});
