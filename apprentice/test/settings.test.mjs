import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store decides where the data lives when it is first loaded, so the
// folder is set before anything imports it. This file runs in its own process.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-settings-"));
delete process.env.APPRENTICE_MUTE;
process.env.ELEVENLABS_API_KEY = "a-key-for-the-test";
const { loadSettings, ownerName, saveSettings } = await import("../src/settings.mjs");
const { paths } = await import("../src/store.mjs");

test("a setting is kept, and switching the sound off silences Mason", async () => {
  assert.ok(paths.data.startsWith(os.tmpdir()) || paths.data.includes("mason-settings-"));
  await loadSettings();
  assert.ok(ownerName().length > 0);
  const saved = await saveSettings({ name: "  Ada   Lovelace  ", speech: false });
  assert.equal(saved.name, "Ada Lovelace");
  assert.equal(ownerName(), "Ada Lovelace");
  assert.equal(process.env.APPRENTICE_MUTE, "1");
  assert.equal((await saveSettings({ speech: true })).speech, true);
  assert.equal(process.env.APPRENTICE_MUTE, undefined);
  assert.equal((await loadSettings()).name, "Ada Lovelace");
});

test("switching ElevenLabs off takes the key away from everything that would call it, and on gives it back", async () => {
  const { hasElevenLabsKey } = await import("../src/settings.mjs");
  const { voiceStatus } = await import("../src/voice.mjs");
  await loadSettings();
  assert.equal(voiceStatus().elevenLabs, true);
  await saveSettings({ elevenlabs: false });
  assert.equal(process.env.ELEVENLABS_API_KEY, undefined);
  assert.equal(voiceStatus().elevenLabs, false);
  assert.equal(voiceStatus().engine, "Mac voice");
  assert.equal(hasElevenLabsKey(), true);
  assert.equal((await loadSettings()).elevenlabs, false);
  await saveSettings({ elevenlabs: true });
  assert.equal(process.env.ELEVENLABS_API_KEY, "a-key-for-the-test");
  assert.equal(voiceStatus().elevenLabs, true);
});

test("with the agents' logs switched off, none of them is read", async () => {
  const { projectIndex, projectHistory } = await import("../src/projects.mjs");
  await saveSettings({ logs: false });
  const index = await projectIndex(0, { maxAgeMs: 0 });
  assert.deepEqual(index.list, []);
  assert.deepEqual(await projectHistory("/any/folder", 0), []);
  await saveSettings({ logs: true });
  assert.equal((await loadSettings()).logs, true);
});
