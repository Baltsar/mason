import path from "node:path";
import { fingerprint } from "./redact.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// A nudge is a word on the island at the moment it can be acted on: an answer
// that has waited longer than its owner usually lets one wait, or a piece of
// work that was done before in another project. It comes from what is
// happening, never from a clock, and it rests on the owner's own history.
//
// What makes it more than a reminder is that each one is followed up. A nudge
// that was acted on counts as followed; one that was not counts as ignored;
// and a kind of nudge that is ignored again and again goes quiet by itself.
// Nothing is set up, and nothing has to be switched off by hand.

const file = () => path.join(paths.data, "nudges.json");
// Not more often than this, and not more than this many in a day.
const APART_MS = 10 * 60_000;
const IN_A_DAY = 6;
// How long there is to act on each kind before it counts as ignored.
const TIME_TO_FOLLOW = { waited: 90_000, before: 10 * 60_000 };
// Ignored this many times in a row, a kind is quiet for this long. After
// that it is tried again, in case the days have changed.
const IGNORED_IN_A_ROW = 3;
const QUIET_MS = 14 * 86_400_000;
const KEPT = 300;
// Until when a kind is quiet, as a time; zero when it never was.
const quietUntil = (quiet, kind) => quiet[kind] ? Date.parse(quiet[kind]) : 0;

// Which of the nudges that could be said now is said, if any. `candidates`
// are [{ kind, key, text, ... }] in the order they matter; `shown` is what
// was said before, `quiet` says until when each kind is silent.
export function choose(candidates, shown, quiet, now) {
  const last = shown.at(-1);
  if (last && now - Date.parse(last.at) < APART_MS) return null;
  if (shown.filter((nudge) => now - Date.parse(nudge.at) < 86_400_000).length >= IN_A_DAY) return null;
  const said = new Set(shown.map((nudge) => `${nudge.kind}|${nudge.key}`));
  return candidates.find((nudge) => !said.has(`${nudge.kind}|${nudge.key}`) && quietUntil(quiet, nudge.kind) <= now) || null;
}

// Whether a nudge was followed, was ignored, or cannot be said yet (null).
// `acted` is true when what the nudge pointed at was done after it was said.
export function outcomeOf(nudge, acted, now) {
  if (acted) return "followed";
  return now - Date.parse(nudge.at) > (TIME_TO_FOLLOW[nudge.kind] || APART_MS) ? "ignored" : null;
}

// The kinds that have just been ignored often enough to go quiet.
export function gonePast(shown, quiet, now) {
  const next = { ...quiet };
  for (const kind of new Set(shown.map((nudge) => nudge.kind))) {
    const settled = shown.filter((nudge) => nudge.kind === kind && nudge.outcome);
    const recent = settled.slice(-IGNORED_IN_A_ROW);
    // Only what was said since the last quiet spell counts towards the next.
    const since = quietUntil(quiet, kind);
    if (recent.length === IGNORED_IN_A_ROW && recent.every((nudge) => nudge.outcome === "ignored" && Date.parse(nudge.at) > since)) next[kind] = new Date(now + QUIET_MS).toISOString();
  }
  return next;
}

let kept = null;
async function load() {
  kept ||= { shown: [], quiet: {}, ...(await readJson(file(), {})) };
  return kept;
}

// Says one of the candidates, if now is a moment for it, and remembers that
// it was said. Returns the nudge, or null.
export async function offerNudge(candidates, now = Date.now()) {
  if (!candidates.length) return null;
  const store = await load();
  const chosen = choose(candidates, store.shown, store.quiet, now);
  if (!chosen) return null;
  const nudge = { ...chosen, id: fingerprint(`${chosen.kind}|${chosen.key}|${now}`), at: new Date(now).toISOString(), outcome: null };
  store.shown = [...store.shown, nudge].slice(-KEPT);
  await atomicJson(file(), store);
  return nudge;
}

// The nudges that are still waiting to be followed or ignored.
export async function openNudges() {
  return (await load()).shown.filter((nudge) => !nudge.outcome);
}

// Settles what can be settled. `acted` says for one nudge whether what it
// pointed at has been done. Returns true when something changed.
export async function settleNudges(acted, now = Date.now()) {
  const store = await load();
  let changed = false;
  for (const nudge of store.shown) {
    if (nudge.outcome) continue;
    const outcome = outcomeOf(nudge, nudge.opened || acted(nudge), now);
    if (!outcome) continue;
    nudge.outcome = outcome;
    changed = true;
  }
  if (!changed) return false;
  store.quiet = gonePast(store.shown, store.quiet, now);
  await atomicJson(file(), store);
  return true;
}

// Pressing a nudge is acting on it.
export async function openNudge(id) {
  const store = await load();
  const nudge = store.shown.find((item) => item.id === id);
  if (!nudge) return null;
  nudge.opened = true;
  await atomicJson(file(), store);
  return nudge;
}

// What the window shows: the nudge that was just said, how the last week of
// them went, and the kinds that have gone quiet.
export async function nudgesPayload(now = Date.now()) {
  const store = await load();
  const week = store.shown.filter((nudge) => now - Date.parse(nudge.at) < 7 * 86_400_000);
  const latest = store.shown.at(-1);
  return {
    latest: latest && now - Date.parse(latest.at) < APART_MS ? latest : null,
    said: week.length,
    followed: week.filter((nudge) => nudge.outcome === "followed").length,
    quiet: Object.keys(store.quiet).filter((kind) => quietUntil(store.quiet, kind) > now),
  };
}
