import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder the first time it is loaded, and this file writes.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-updates-"));
const { loadSettings, saveSettings } = await import("../src/settings.mjs");
await loadSettings();
const { lookForUpdate, newer, ownVersion, releaseFrom, updatePayload } = await import("../src/updates.mjs");

const answering = (status, body, asked = []) => async (url, options) => { asked.push({ url, options }); return { ok: status === 200, status, json: async () => body }; };
const release = (tag, more = {}) => ({ tag_name: tag, html_url: `https://github.com/Baltsar/mason/releases/tag/${tag}`, draft: false, prerelease: false, ...more });

test("one version comes after another by its numbers, and what is no version comes after nothing", () => {
  assert.equal(newer("0.10.0", "0.9.9"), true);
  assert.equal(newer("v1.0.0", "0.99.99"), true);
  assert.equal(newer("0.4.0", "0.4.0"), false);
  assert.equal(newer("0.3.9", "0.4.0"), false);
  assert.equal(newer("latest", "0.4.0"), false);
  assert.equal(newer("1.0.0-beta", "0.4.0"), false);
  assert.equal(newer("0.5.0", undefined), false);
});

test("a release is taken only as a version and an address on this repository's releases", () => {
  assert.deepEqual(releaseFrom(release("v0.5.0")), { version: "0.5.0", url: "https://github.com/Baltsar/mason/releases/tag/v0.5.0" });
  assert.equal(releaseFrom(release("v0.5.0", { html_url: "https://example.com/get-mason" })), null);
  assert.equal(releaseFrom(release("v0.5.0", { html_url: "https://github.com/Someone/else/releases/tag/v0.5.0" })), null);
  assert.equal(releaseFrom(release("newest")), null);
  assert.equal(releaseFrom(release("v0.5.0", { draft: true })), null);
  assert.equal(releaseFrom(release("v0.5.0", { prerelease: true })), null);
  assert.equal(releaseFrom(null), null);
});

test("GitHub is asked at most once a day, sent nothing of its owner's, and a newer version is said", async () => {
  const own = await ownVersion();
  const [major, minor] = own.split(".").map(Number);
  const next = `${major}.${minor + 1}.0`;
  const asked = [];
  const now = Date.now();
  assert.deepEqual(await lookForUpdate({ now, fetcher: answering(200, release(`v${next}`), asked) }), { version: next, url: `https://github.com/Baltsar/mason/releases/tag/v${next}` });
  assert.equal(asked.length, 1);
  assert.equal(asked[0].url, "https://api.github.com/repos/Baltsar/mason/releases/latest");
  assert.deepEqual(Object.keys(asked[0].options.headers).sort(), ["accept", "user-agent"]);
  assert.equal(asked[0].options.body, undefined);
  assert.equal((await updatePayload()).latest.version, next);
  assert.equal((await updatePayload()).version, own);

  // An hour later nothing is asked; a day later it is, and the same version is no news.
  await lookForUpdate({ now: now + 3_600_000, fetcher: answering(200, release("v99.0.0"), asked) });
  assert.equal(asked.length, 1);
  await lookForUpdate({ now: now + 25 * 3_600_000, fetcher: answering(200, release(`v${own}`), asked) });
  assert.equal(asked.length, 2);
  assert.equal((await updatePayload()).latest, null);

  // No network is no news, and what was known stays known.
  await lookForUpdate({ now: now + 50 * 3_600_000, fetcher: async () => { throw new Error("offline"); } });
  assert.equal((await updatePayload()).latest, null);
  // No release at all is an answer too.
  await lookForUpdate({ soon: true, fetcher: answering(404, {}) });
  assert.equal((await updatePayload()).latest, null);
});

test("switched off, nothing is asked and nothing is said", async () => {
  const asked = [];
  await lookForUpdate({ soon: true, fetcher: answering(200, release("v99.0.0"), asked) });
  assert.equal((await updatePayload()).latest.version, "99.0.0");
  await saveSettings({ updates: false });
  assert.equal(await lookForUpdate({ soon: true, fetcher: answering(200, release("v100.0.0"), asked) }), null);
  assert.equal(asked.length, 1);
  assert.equal((await updatePayload()).latest, null);
});
