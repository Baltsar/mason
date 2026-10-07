import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DIMENSIONS, embed, embedModel } from "./embed.mjs";
import { fingerprint } from "./redact.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// Everything that was said to the agents, findable by what it means. Each
// prompt is placed once by the embedding model and its row is kept next to its
// words, so that "where did I deal with payments" finds the chat about Stripe
// webhooks, and so that the same demand said in five projects in five ways
// shows up as one thing said five times. The words and the rows stay in the
// data folder on this Mac, also after the agents' own logs have been cleared.

const VERSION = 1;
const folder = () => path.join(paths.data, "said");
// The model is asked for this many prompts at a time, so that a first reading
// of months of logs comes in steps and can be seen to move.
const STEP = 256;
// Everything one person says to agents is alike: the same language, the same
// tone, the same kind of request. Left in, that likeness drowns the rest, and
// "the weather tomorrow" lies as close to every prompt as the right answer
// does. So what all prompts have in common is taken away before any two are
// compared. It takes a few hundred prompts to know what they have in common.
const CENTRED_FROM = 200;
// What is found has to be at least this close to what was asked for, and not
// far behind the best that was found.
const CLOSE_ENOUGH = 0.36;
const NEAR_THE_BEST = 0.09;
// Two prompts this close make the same demand.
const SAME_DEMAND = 0.56;
// A few words ("look again later") lie close to anything and lead nowhere:
// what is found, and what counts as a demand, says at least this much.
const SAYS_SOMETHING = 4;
// A demand is short enough to be one thing.
const DEMAND_LETTERS = 240;
// Said this often, on this many days, in this many projects, before it counts.
const ENOUGH = { times: 4, days: 3, projects: 2 };

// What the agent's own program puts in the person's mouth: the note it sends
// after a pause, and the summary a long conversation is carried on from.
const NOT_THEIR_WORDS = /^(This session is being continued from a previous conversation|Caveat: the messages below)|while you were working[^.]*\. Please continue from where you left off/i;

const pause = () => new Promise((resolve) => setImmediate(resolve));
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);
const idOf = (prompt) => fingerprint(`${prompt.project}\n${prompt.at}\n${prompt.text}`);

let kept = null;

// A row with what all rows have in common taken away, at length one again.
function apart(row, from, common) {
  const own = new Float32Array(DIMENSIONS);
  let sum = 0;
  for (let place = 0; place < DIMENSIONS; place += 1) { own[place] = row[from + place] - common[place]; sum += own[place] * own[place]; }
  const length = Math.sqrt(sum) || 1;
  for (let place = 0; place < DIMENSIONS; place += 1) own[place] /= length;
  return own;
}

// The rows as they are compared: each with the common part taken away, once
// enough has been read to know it. Worked out again whenever more was read.
function compared(index) {
  if (index.compared?.count === index.items.length) return index.compared;
  const count = index.items.length;
  const common = new Float32Array(DIMENSIONS);
  if (count >= CENTRED_FROM) for (let item = 0; item < count; item += 1) for (let place = 0; place < DIMENSIONS; place += 1) common[place] += index.rows[item * DIMENSIONS + place] / count;
  const rows = new Float32Array(index.rows.length);
  for (let item = 0; item < count; item += 1) rows.set(apart(index.rows, item * DIMENSIONS, common), item * DIMENSIONS);
  index.compared = { count, common, rows };
  return index.compared;
}

async function load() {
  if (kept) return kept;
  const empty = { model: "", items: [], rows: new Float32Array(0) };
  const stored = await readJson(path.join(folder(), "said.json"), null);
  if (stored?.version !== VERSION || stored.dimensions !== DIMENSIONS || !Array.isArray(stored.items)) return (kept = empty);
  try {
    const bytes = await readFile(path.join(folder(), "said.bin"));
    // Rows and words that do not match were not written together: start again.
    if (bytes.length !== stored.items.length * DIMENSIONS * 4) return (kept = empty);
    kept = { model: stored.model, items: stored.items, rows: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4).slice() };
  } catch { kept = empty; }
  return kept;
}

async function save(index) {
  await mkdir(folder(), { recursive: true });
  const rows = path.join(folder(), "said.bin");
  await writeFile(`${rows}.tmp`, Buffer.from(index.rows.buffer, index.rows.byteOffset, index.rows.byteLength));
  await rename(`${rows}.tmp`, rows);
  await atomicJson(path.join(folder(), "said.json"), { version: VERSION, model: index.model, dimensions: DIMENSIONS, items: index.items });
}

// How much has been read, for the settings screen.
export async function saidStatus() {
  const index = await load();
  return { count: index.items.length, model: index.model, from: index.items.length ? dayOf(Math.min(...index.items.map((item) => item.at))) : null };
}

// Forgets everything that was read: the words and the rows.
export async function forgetSaid() {
  kept = { model: "", items: [], rows: new Float32Array(0) };
  await save(kept);
}

let reading = null;

// Reads the prompts that have not been read yet, the newest first, one step at
// a time. `prompts` are [{ project, at, text }]. Returns how many were added
// and how many are still waiting, or null when the model did not answer.
export function refreshSaid(prompts, { embedder = embed, model = embedModel(), steps = 4, moved = () => {} } = {}) {
  reading ||= (async () => {
    let index = await load();
    // Rows from another model cannot be compared with new ones.
    if (index.model !== model) index = kept = { model, items: [], rows: new Float32Array(0) };
    const known = new Set(index.items.map((item) => item.id));
    const fresh = [];
    for (const prompt of prompts) {
      if (NOT_THEIR_WORDS.test(prompt.text)) continue;
      const id = idOf(prompt);
      if (known.has(id)) continue;
      known.add(id);
      fresh.push({ id, project: prompt.project, at: prompt.at, text: prompt.text });
    }
    fresh.sort((a, b) => b.at - a.at);
    let added = 0;
    for (let step = 0; step < steps && added < fresh.length; step += 1) {
      const batch = fresh.slice(added, added + STEP);
      const rows = await embedder(batch.map((item) => item.text), "document");
      if (!rows || rows.length !== batch.length) return added ? { added, waiting: fresh.length - added } : null;
      const grown = new Float32Array(index.rows.length + batch.length * DIMENSIONS);
      grown.set(index.rows);
      rows.forEach((row, place) => grown.set(row, index.rows.length + place * DIMENSIONS));
      index.items.push(...batch);
      index.rows = grown;
      added += batch.length;
      await save(index);
      moved({ added, waiting: fresh.length - added });
    }
    return { added, waiting: fresh.length - added };
  })().finally(() => { reading = null; });
  return reading;
}

// How alike two rows are: both have length one, so this is the cosine.
function alike(rows, a, b) {
  let sum = 0;
  for (let index = 0, from = a * DIMENSIONS, to = b * DIMENSIONS; index < DIMENSIONS; index += 1) sum += rows[from + index] * rows[to + index];
  return sum;
}

// What was said that means what is asked for, by project: the project whose
// closest prompt is closest comes first, each with the few prompts that fit.
export async function findSaid(query, { embedder = embed, projects = 6, each = 3 } = {}) {
  const index = await load();
  const asked = String(query ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!asked || !index.items.length) return { query: asked, read: index.items.length, projects: [] };
  const [answer] = (await embedder([asked], "query")) || [];
  if (!answer) return null;
  const { common, rows } = compared(index);
  const row = apart(answer, 0, common);
  const scores = new Float32Array(index.items.length);
  for (let item = 0; item < index.items.length; item += 1) {
    let sum = 0;
    for (let place = 0, from = item * DIMENSIONS; place < DIMENSIONS; place += 1) sum += rows[from + place] * row[place];
    scores[item] = sum;
  }
  const order = [...scores.keys()].filter((item) => index.items[item].text.trim().split(/\s+/).length >= SAYS_SOMETHING).sort((a, b) => scores[b] - scores[a]);
  if (!order.length) return { query: asked, read: index.items.length, projects: [] };
  const floor = Math.max(CLOSE_ENOUGH, scores[order[0]] - NEAR_THE_BEST);
  const found = new Map();
  for (const item of order) {
    if (scores[item] < floor) break;
    const { project, at, text } = index.items[item];
    const entry = found.get(project) || { project, score: scores[item], count: 0, last: 0, said: [] };
    entry.count += 1;
    entry.last = Math.max(entry.last, at);
    // The same words said twice are shown once.
    if (entry.said.length < each && !entry.said.some((hit) => hit.text === text)) entry.said.push({ text, at: new Date(at).toISOString(), score: Math.round(scores[item] * 100) / 100 });
    found.set(project, entry);
  }
  return {
    query: asked,
    read: index.items.length,
    projects: [...found.values()].slice(0, projects).map((entry) => ({ ...entry, score: Math.round(entry.score * 100) / 100, last: new Date(entry.last).toISOString() })),
  };
}

// The demands that were made again and again: prompts that mean the same,
// said on several days in several projects. Nothing is reworded here: each
// comes back in the words it was most typically said in, with the others it
// was said in as what it rests on.
export async function repeatedSaid({ sameDemand = SAME_DEMAND, enough = ENOUGH } = {}) {
  const index = await load();
  const { rows } = compared(index);
  // The same words said again are one thing said several times.
  const byText = new Map();
  index.items.forEach((item, place) => {
    const text = item.text.trim();
    if (text.length > DEMAND_LETTERS || text.split(/\s+/).length < SAYS_SOMETHING) return;
    const key = text.toLowerCase();
    const entry = byText.get(key) || { place, text, said: [] };
    entry.said.push(item);
    byText.set(key, entry);
  });
  const demands = [...byText.values()];
  const near = demands.map(() => []);
  for (let a = 0; a < demands.length; a += 1) {
    for (let b = a + 1; b < demands.length; b += 1) {
      if (alike(rows, demands[a].place, demands[b].place) >= sameDemand) { near[a].push(b); near[b].push(a); }
    }
    // Thousands of prompts are compared with each other: others get a turn.
    if (a % 40 === 39) await pause();
  }
  // The demand with the most others around it speaks for them. Then the next,
  // among the ones that are left.
  const weight = (place) => near[place].reduce((sum, other) => sum + demands[other].said.length, demands[place].said.length);
  const taken = new Set();
  const groups = [];
  for (const leader of [...demands.keys()].sort((a, b) => weight(b) - weight(a))) {
    if (taken.has(leader)) continue;
    const members = [leader, ...near[leader].filter((other) => !taken.has(other))];
    for (const member of members) taken.add(member);
    const said = members.flatMap((member) => demands[member].said);
    const group = {
      id: fingerprint(members.map((member) => demands[member].text.toLowerCase()).sort().join("\n")),
      text: demands[leader].text,
      times: said.length,
      days: new Set(said.map((item) => dayOf(item.at))).size,
      projects: [...new Set(said.map((item) => item.project))],
      last: new Date(Math.max(...said.map((item) => item.at))).toISOString(),
      // The other ways it was said, each with where and when it was last said so.
      ways: members.slice(0, 6).map((member) => ({ text: demands[member].text, times: demands[member].said.length, project: demands[member].said.at(-1).project })),
    };
    if (group.times >= enough.times && group.days >= enough.days && group.projects.length >= enough.projects) groups.push(group);
  }
  return groups.sort((a, b) => b.projects.length - a.projects.length || b.times - a.times);
}
