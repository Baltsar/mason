import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder when it is first loaded, so this file runs in its
// own process with its own folder, like the settings test.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-chats-"));
// No agent logs are read here: the folder they are looked for in is empty.
process.env.APPRENTICE_CLAUDE_DIR = await mkdtemp(path.join(os.tmpdir(), "mason-chats-logs-"));
const { Collector, namedSurface, safeHost } = await import("../src/collector.mjs");
const { loadSettings, saveSettings } = await import("../src/settings.mjs");
const { readEvents } = await import("../src/store.mjs");

test("chat and mail are named only when that is switched on, and a password manager never", async () => {
  const discordTab = { status: "excluded", app: "Comet", bundle: "ai.perplexity.comet", service: "Discord" };
  const slackApp = { status: "excluded", app: "Slack", bundle: "com.tinyspeck.slackmacgap" };
  const passwords = { status: "excluded", app: "1Password", bundle: "com.1password.1password" };
  const bankTab = { status: "excluded", app: "Comet", bundle: "ai.perplexity.comet" };

  assert.equal((await loadSettings()).chats, false);
  for (const surface of [discordTab, slackApp, passwords, bankTab]) assert.equal(namedSurface(surface), null);

  await saveSettings({ chats: true });
  assert.equal(namedSurface(discordTab), "Discord");
  assert.equal(namedSurface(slackApp), "Slack");
  assert.equal(namedSurface(passwords), null);
  assert.equal(namedSurface(bankTab), null);
  assert.equal(namedSurface({ status: "reading", app: "Cursor", bundle: "x" }), null);
});

test("a named visit is kept as a name and a time, never a window title", async () => {
  const collector = new Collector();
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    for (let tick = 0; tick < 4; tick += 1) {
      await collector.observeActivity({ idleSeconds: 0 }, "Discord", "", true);
      now += 2000;
    }
    await collector.flushActivity();
  } finally {
    Date.now = clock;
  }
  const kept = (await readEvents(Infinity)).at(-1);
  assert.equal(kept.type, "private");
  assert.equal(kept.app, "Discord");
  assert.equal(kept.durationSec, 6);
  assert.equal(kept.stored, "name-and-time-only");
  assert.equal("window" in kept, false);
  assert.equal("project" in kept, false);
});

test("a browser tab is kept with the host of its site and nothing more of its address", async () => {
  assert.equal(safeHost("figma.com"), "figma.com");
  assert.equal(safeHost("localhost:8787"), "localhost:8787");
  // Anything that is more than a host, or not one, is dropped.
  for (const more of ["figma.com/file/secret", "https://figma.com", "figma.com?q=1", "a b.com", "", undefined]) assert.equal(safeHost(more), "");

  const collector = new Collector();
  const clock = Date.now;
  let now = clock();
  Date.now = () => now;
  try {
    for (let tick = 0; tick < 4; tick += 1) {
      await collector.observeActivity({ idleSeconds: 0 }, "Comet", "Untitled", false, "figma.com");
      now += 2000;
    }
    await collector.flushActivity();
  } finally {
    Date.now = clock;
  }
  const kept = (await readEvents(Infinity)).at(-1);
  assert.deepEqual([kept.type, kept.app, kept.window, kept.host, kept.durationSec], ["activity", "Comet", "Untitled", "figma.com", 6]);
});
