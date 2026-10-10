import { mkdir, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { atomicJson, loadMap, paths, readJson } from "./store.mjs";
import { dayStart } from "./activity.mjs";
import { projectIndex } from "./projects.mjs";
import { projectMemory } from "./memory.mjs";
import { askModel } from "./llm.mjs";
import { PCM_RATE, elevenLabsDialogue, elevenLabsPcm, playFile, speak } from "./voice.mjs";

// The week as a news bulletin, for someone who would rather listen than read.
// The facts are counted from the project logs; the model only writes the
// telling, and two ElevenLabs voices read it. One episode is paid for once.

const DAYS = 7;
const STORIES = 4;
const MAX_CHARS = 2800;
// Two premade ElevenLabs voices, so a key alone is enough.
const VOICES = {
  anchor: process.env.ELEVENLABS_ANCHOR_VOICE_ID || "onwK4e9ZLuTAKqWW03F9",
  reporter: process.env.ELEVENLABS_REPORTER_VOICE_ID || "Xb7hH8MSUJpSbSDYk0k2",
};
const podcastDir = () => path.join(paths.data, "podcast");
const short = (text, max) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};
const weekday = (at) => new Date(at).toLocaleDateString("en-GB", { weekday: "long" });
const dayMonth = (at) => new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const hoursOf = (minutes) => minutes < 90 ? `${minutes} minutes` : `${Math.round(minutes / 60)} hours`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
// A direction to the voice, such as [whispers], is heard and never shown.
const shown = (text) => String(text).replace(/\[[^\]]{1,28}\]\s*/g, "").trim();
const settled = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]).catch(() => null);

// What happened in the seven days up to now, counted and in their own words.
export async function gatherWeek(now = Date.now()) {
  const since = dayStart(now) - (DAYS - 1) * 86_400_000;
  const [index, map] = await Promise.all([projectIndex(since, { maxAgeMs: 120_000 }), loadMap()]);
  const worked = index.list
    .filter((project) => project.prompts.length)
    .map((project) => ({
      project,
      name: project.name,
      minutes: project.minutes.size,
      prompts: project.prompts.length,
      days: [...new Set(project.prompts.map((prompt) => new Date(prompt.at).toDateString()))],
      first: short(project.prompts[0].text, 200),
      last: short(project.prompts.at(-1).text, 200),
      lastAt: project.prompts.at(-1).at,
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const stories = worked.slice(0, STORIES);
  const memories = await Promise.all(stories.map((item) => settled(projectMemory(item.project, { wait: true }), 70_000)));
  const said = worked.flatMap((item) => item.project.prompts);
  const perDay = new Map();
  for (const prompt of said) perDay.set(weekday(prompt.at), (perDay.get(weekday(prompt.at)) || 0) + 1);
  const busiest = [...perDay].sort((a, b) => b[1] - a[1])[0] || null;
  // The latest hour of a night that work was still being handed out.
  const night = said
    .filter((prompt) => new Date(prompt.at).getHours() < 5)
    .sort((a, b) => (new Date(b.at).getHours() * 60 + new Date(b.at).getMinutes()) - (new Date(a.at).getHours() * 60 + new Date(a.at).getMinutes()))[0] || null;
  const repeated = memories
    .flatMap((memory, position) => (memory?.keeps_saying || []).map((item) => ({ ...item, project: stories[position].name })))
    .sort((a, b) => b.times - a.times)[0] || null;
  return {
    since,
    until: now,
    label: `${dayMonth(since)} – ${dayMonth(now)}`,
    projects: stories.map((item, position) => ({
      name: item.name,
      minutes: item.minutes,
      prompts: item.prompts,
      days: item.days.length,
      first: item.first,
      last: item.last,
      lastDay: weekday(item.lastAt),
      about: memories[position]?.one_line || null,
      built: memories[position]?.built || [],
      leftOff: memories[position]?.left_off || null,
      open: memories[position]?.open || [],
      keepsSaying: memories[position]?.keeps_saying || [],
    })),
    others: worked.slice(STORIES).map((item) => ({ name: item.name, prompts: item.prompts })),
    totals: {
      projects: worked.length,
      prompts: said.length,
      minutes: worked.reduce((sum, item) => sum + item.minutes, 0),
      busiest: busiest ? { day: busiest[0], prompts: busiest[1] } : null,
      latestNight: night ? `${weekday(night.at)} at ${new Date(night.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : null,
    },
    quote: repeated,
    learned: {
      rules: map.decisions.filter((item) => item.kind === "guardrail").length,
      unasked: map.decisions.filter((item) => item.source?.type === "inferred").length,
    },
  };
}

function briefing(facts, listener) {
  const { totals } = facts;
  const project = (item) => [
    `## ${item.name}: ${hoursOf(item.minutes)} of work, ${plural(item.prompts, "instruction")} to the agents, on ${plural(item.days, "day")}, last touched ${item.lastDay}`,
    item.about && `what it is: ${item.about}`,
    item.built.length && `built or changed: ${item.built.join("; ")}`,
    item.leftOff && `where it stands: ${item.leftOff}`,
    item.open.length && `still open: ${item.open.join("; ")}`,
    ...item.keepsSaying.map((rule) => `kept saying, ${rule.times} times: ${rule.rule}. In their words: "${rule.example}"`),
    `first thing said this week: "${item.first}"`,
    `last thing said: "${item.last}"`,
  ].filter(Boolean).join("\n");
  return [
    `Listener: ${listener}`,
    `The week: ${weekday(facts.since)} ${dayMonth(facts.since)} to ${weekday(facts.until)} ${dayMonth(facts.until)}`,
    `Totals: ${plural(totals.projects, "project")}, ${plural(totals.prompts, "instruction")} given to coding agents, ${hoursOf(totals.minutes)} of work.`,
    totals.busiest && `Busiest day: ${totals.busiest.day}, ${plural(totals.busiest.prompts, "instruction")}.`,
    totals.latestNight && `Latest in a night that work was still being handed out: ${totals.latestNight}.`,
    facts.quote && `Most repeated line of the week, ${facts.quote.times} times, in ${facts.quote.project}: "${facts.quote.example}"`,
    `Mason now holds ${plural(facts.learned.rules, "rule")} of theirs, ${facts.learned.unasked} picked up without asking.`,
    "",
    "Projects, most worked on first:",
    ...facts.projects.map(project),
    facts.others.length ? `\nAlso touched: ${facts.others.map((item) => `${item.name} (${plural(item.prompts, "instruction")})`).join(", ")}` : "",
  ].filter((line) => line !== null && line !== false && line !== undefined).join("\n");
}

const SYSTEM = `You write a short weekly news bulletin for one listener, about their own working week. Two voices read it aloud: ANCHOR, in the studio, dry and authoritative, and REPORTER, in the field, urgent and a little breathless.

The order:
1. Cold open. ANCHOR teases three headlines, each under ten words.
2. One story per project, most worked on first. ANCHOR hands over, REPORTER reports what happened, what was at stake or went wrong, and where it stands now.
3. Quote of the week, if one is given: the line they kept repeating, word for word in its original language, then in a few words what it means.
4. The numbers: two or three figures.
5. Sign-off with a cliffhanger: what is still open going into next week.

The drama is in the telling, never in the facts. Use only what you are given. No invented events, people, results, numbers or deadlines. If something is not given, leave it out. Speak to the listener as "you". It is news: never mention prompts, logs, instructions-as-data or an AI writing this.

Made for the ear: short sentences, numbers as words. A line may begin with one direction to the voice in square brackets, from this list only: [urgent] [excited] [whispers] [sighs] [deadpan] [laughs] [serious]. Use it on fewer than half of the lines.

Length: 230 to 290 words in all, 14 to 22 lines.

Reply with JSON only, no code fence:
{"title": "episode title, at most 5 words, no full stop", "headlines": ["exactly three, at most 6 words each"], "lines": [{"speaker": "anchor", "text": "..."}, {"speaker": "reporter", "text": "..."}]}`;

async function writeScript(facts, listener) {
  const reply = await askModel(SYSTEM, briefing(facts, listener), { model: process.env.APPRENTICE_PODCAST_MODEL || "sonnet", timeoutMs: 150_000, purpose: "recap" });
  const lines = (Array.isArray(reply?.lines) ? reply.lines : [])
    .filter((line) => line && typeof line.text === "string" && shown(line.text))
    .map((line) => ({ speaker: line.speaker === "reporter" ? "reporter" : "anchor", text: line.text.replace(/\s+/g, " ").trim() }));
  if (lines.length < 6) return null;
  // A recording has a ceiling; the sign-off is kept and the middle gives way.
  while (lines.length > 6 && lines.reduce((sum, line) => sum + line.text.length, 0) > MAX_CHARS) lines.splice(lines.length - 2, 1);
  return {
    title: short(reply.title, 48) || "Your week",
    headlines: (Array.isArray(reply.headlines) ? reply.headlines : []).filter((item) => typeof item === "string" && item.trim()).slice(0, 3).map((item) => short(item, 60)),
    lines,
    writer: "model",
  };
}

// The same bulletin from the counts alone, for when no model answers.
export function plainScript(facts) {
  const { totals } = facts;
  const lines = [
    { speaker: "anchor", text: `This is your week. ${plural(totals.projects, "project")}, ${plural(totals.prompts, "instruction")}, ${hoursOf(totals.minutes)} of work.` },
    ...facts.projects.flatMap((item) => [
      { speaker: "anchor", text: `${item.name}.` },
      { speaker: "reporter", text: `${hoursOf(item.minutes)} on ${plural(item.days, "day")}. ${item.leftOff || `The last thing you said was: ${item.last}`}` },
    ]),
    facts.quote && { speaker: "anchor", text: `Quote of the week, said ${facts.quote.times} times: ${facts.quote.example}` },
    totals.busiest && { speaker: "reporter", text: `Your busiest day was ${totals.busiest.day}.` },
    { speaker: "anchor", text: facts.projects[0]?.open[0] ? `Still open: ${facts.projects[0].open[0]} That was your week.` : "That was your week." },
  ].filter(Boolean);
  return {
    title: "Your week",
    headlines: facts.projects.slice(0, 3).map((item) => `${item.name}: ${hoursOf(item.minutes)}`),
    lines,
    writer: "counts",
  };
}

function wav(samples) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + samples.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(PCM_RATE, 24);
  header.writeUInt32LE(PCM_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(samples.length, 40);
  return Buffer.concat([header, samples]);
}

const duration = (file) => new Promise((resolve) => {
  execFile("afinfo", [file], (error, stdout) => resolve(error ? 0 : Number(/estimated duration: ([\d.]+)/.exec(stdout)?.[1]) || 0));
});

// One take with both voices. If that is refused, the same lines one by one in
// the cheap model, joined with a breath between them.
async function record(lines, base) {
  if (!process.env.ELEVENLABS_API_KEY) return { file: null, engine: "Mac voice", seconds: 0 };
  await mkdir(podcastDir(), { recursive: true });
  try {
    const file = await elevenLabsDialogue(lines.map((line) => ({ text: line.text, voice_id: VOICES[line.speaker] })), `${base}.mp3`);
    return { file, engine: "ElevenLabs Text to Dialogue", seconds: await duration(file) };
  } catch {
    const breath = Buffer.alloc(Math.round(PCM_RATE * 0.32) * 2);
    const parts = [];
    for (const line of lines) parts.push(await elevenLabsPcm(shown(line.text), VOICES[line.speaker]), breath);
    const file = `${base}.wav`;
    await writeFile(file, wav(Buffer.concat(parts)));
    return { file, engine: "ElevenLabs Flash", seconds: await duration(file) };
  }
}

let job = null;
let progress = { status: "idle", error: null };
let latest;
let playingSince = null;

async function newestOnDisk() {
  let files = [];
  try { files = (await readdir(podcastDir())).filter((name) => name.endsWith(".json")).sort(); } catch { return null; }
  return files.length ? readJson(path.join(podcastDir(), files.at(-1)), null) : null;
}

// Writes and records this week's episode. `changed` is called at every step,
// so a page can say what is happening without asking.
export function makeEpisode({ listener = "you", changed = () => {} } = {}) {
  if (job) return job;
  const step = (status, error = null) => { progress = { status, error }; changed(); };
  job = (async () => {
    step("writing");
    const facts = await gatherWeek();
    if (!facts.projects.length) throw new Error("Nothing was built this week yet");
    const script = (await writeScript(facts, listener)) || plainScript(facts);
    step("recording");
    const key = `week-${new Date(dayStart()).toISOString().slice(0, 10)}-${Date.now().toString(36)}`;
    const audio = await record(script.lines, path.join(podcastDir(), key));
    const episode = {
      key,
      week: facts.label,
      title: script.title,
      headlines: script.headlines,
      lines: script.lines,
      writer: script.writer,
      audio: audio.file ? path.basename(audio.file) : null,
      engine: audio.engine,
      // Without a recording the length is the time the words take to say.
      seconds: Math.round(audio.seconds) || Math.round(script.lines.reduce((sum, line) => sum + shown(line.text).split(" ").length, 0) / 2.5),
      totals: facts.totals,
      generatedAt: new Date().toISOString(),
    };
    await mkdir(podcastDir(), { recursive: true });
    await atomicJson(path.join(podcastDir(), `${key}.json`), episode);
    latest = episode;
    step("idle");
    return episode;
  })().catch((error) => { step("failed", error.message); return null; }).finally(() => { job = null; });
  return job;
}

export const podcastBusy = () => Boolean(job);

export async function playEpisode({ ended = () => {} } = {}) {
  if (latest === undefined) latest = await newestOnDisk();
  if (!latest) return false;
  const spoken = latest.audio
    ? playFile(path.join(podcastDir(), latest.audio), latest.seconds)
    : await speak(latest.lines.map((line) => shown(line.text)).join(" "));
  const startedAt = Date.now();
  playingSince = startedAt;
  spoken.done.then(() => {
    if (playingSince === startedAt) playingSince = null;
    ended();
  });
  return true;
}

export async function podcastState() {
  if (latest === undefined) latest = await newestOnDisk();
  return {
    status: progress.status,
    error: progress.error,
    playing: playingSince ? { startedAt: playingSince } : null,
    episode: latest && {
      key: latest.key,
      week: latest.week,
      title: latest.title,
      headlines: latest.headlines,
      lines: latest.lines.map((line) => ({ speaker: line.speaker, text: shown(line.text) })),
      seconds: latest.seconds,
      engine: latest.engine,
      generatedAt: latest.generatedAt,
    },
  };
}
