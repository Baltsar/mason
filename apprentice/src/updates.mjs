import { readFile } from "node:fs/promises";
import path from "node:path";
import { settings } from "./settings.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// Whether a newer Mason is out. Mason is not in a store that would say so, so
// it looks itself: once a day it asks GitHub for the latest release of its own
// repository and compares the number with its own. It sends nothing about its
// owner, and it installs nothing: it says that a version is out and where.
// The look has a switch in Settings, with everything else that leaves the Mac.

export const REPOSITORY = "Baltsar/mason";
const LATEST = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const RELEASES = `https://github.com/${REPOSITORY}/releases/`;
const LOOK_EVERY_MS = 24 * 3_600_000;
const VERSION = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const file = () => path.join(paths.data, "updates.json");

const parts = (version) => { const found = VERSION.exec(String(version ?? "").trim()); return found ? found.slice(1).map(Number) : null; };
// Whether one version comes after another. Something that is not a version comes after nothing.
export function newer(one, other) {
  const [a, b] = [parts(one), parts(other)];
  if (!a || !b) return false;
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}

// The version this Mason is, as its package says.
let own = null;
export async function ownVersion() {
  own ||= String(JSON.parse(await readFile(path.join(paths.root, "package.json"), "utf8")).version || "0.0.0");
  return own;
}

// What GitHub said about the latest release, taken only when it is what it
// should be: a version number, and an address on the releases of this repository.
export function releaseFrom(reply) {
  const version = parts(reply?.tag_name)?.join(".");
  const url = typeof reply?.html_url === "string" && reply.html_url.startsWith(RELEASES) ? reply.html_url.slice(0, 200) : null;
  return version && url && !reply.draft && !reply.prerelease ? { version, url } : null;
}

// Looks, when it is switched on and a day has passed since the last look.
// Nothing here throws: no network is no news.
export async function lookForUpdate({ now = Date.now(), fetcher = fetch, soon = false } = {}) {
  if (!settings().updates) return null;
  const kept = await readJson(file(), {});
  if (!soon && now - (kept.checkedAt || 0) < LOOK_EVERY_MS) return kept.latest || null;
  let latest = kept.latest || null;
  try {
    const response = await fetcher(LATEST, { headers: { accept: "application/vnd.github+json", "user-agent": "mason" }, redirect: "error", signal: AbortSignal.timeout(8000) });
    if (response.ok) latest = releaseFrom(await response.json());
    // No release yet is an answer too.
    else if (response.status === 404) latest = null;
  } catch {}
  await atomicJson(file(), { checkedAt: now, latest });
  return latest;
}

// For the window: this version, and the one that is out when it is newer.
export async function updatePayload() {
  const [version, kept] = await Promise.all([ownVersion(), readJson(file(), {})]);
  const latest = settings().updates && kept.latest && newer(kept.latest.version, version) ? kept.latest : null;
  return { version, latest, checkedAt: kept.checkedAt || 0 };
}
