import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store decides where the data lives when it is first loaded, so the
// folder is set before anything imports it. This file runs in its own process.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-settings-"));
delete process.env.APPRENTICE_MUTE;
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
