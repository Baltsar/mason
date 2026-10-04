// The voice of one film: node film/edit/narrate.mjs film/edit/films/<name>.json
//
// Every line goes to ElevenLabs Text to Dialogue in one request, the same
// engine the app uses for its weekly episode, so the voices answer each other
// in a single take. The take is then listened to, to find where each line is.

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.dirname(here);
const plan = JSON.parse(await readFile(path.resolve(process.argv[2]), "utf8"));
const name = path.basename(process.argv[2], ".json");

// The key stays in the app's own local file and is never printed.
const env = await readFile(path.join(film, "..", "apprentice", ".env.local"), "utf8");
const key = env.match(/^ELEVENLABS_API_KEY=(.+)$/m)?.[1]?.trim();
if (!key) throw new Error("No ELEVENLABS_API_KEY in apprentice/.env.local");

const inputs = plan.lines.map((line) => ({ text: line.say || line.text, voice_id: plan.voices[line.voice] }));
const hash = createHash("sha256").update(JSON.stringify(inputs)).digest("hex").slice(0, 10);
const dir = path.join(film, "raw", "voice");
await mkdir(dir, { recursive: true });
const audio = path.join(dir, `${name}-${hash}.mp3`);

if (!existsSync(audio)) {
  const response = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_128", {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ inputs, model_id: "eleven_v3" }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  await writeFile(audio, Buffer.from(await response.arrayBuffer()));
}

// `tempo` in the plan tightens a take that runs a little long. Five per cent is not heard as speed.
// `fit` (seconds) sets the tempo from the take itself, since no two takes run the same length.
let take = audio;
const raw = Number((await run("/opt/homebrew/bin/ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio])).stdout);
const tempo = plan.fit ? Math.max(1, Number((raw / plan.fit).toFixed(3))) : (plan.tempo || 1);
if (tempo > 1.12) console.log(`The take is ${raw.toFixed(1)} s. Fitting ${plan.fit} s needs tempo ${tempo}, which will sound rushed: cut words instead.`);
if (tempo !== 1) {
  take = path.join(dir, `${name}-${hash}-x${tempo}.mp3`);
  if (!existsSync(take)) await run("/opt/homebrew/bin/ffmpeg", ["-y", "-v", "error", "-i", audio, "-filter:a", `atempo=${tempo}`, "-b:a", "160k", take]);
}

const script = path.join(dir, `${name}-script.json`);
await writeFile(script, JSON.stringify(Object.fromEntries(plan.lines.map((line) => [line.id, line.text])), null, 2));
const linesFile = path.join(dir, `${name}-lines.json`);
const { stdout } = await run(process.execPath, [path.join(here, "lines.mjs"), take, script, linesFile], { env: { ...process.env, LINES_ORDERED: "1" }, maxBuffer: 16_000_000, timeout: 10 * 60_000 });
// `pause` in the plan opens a beat after a line: { "a1": 0.45 }. The take is
// cut where that line ends and silence is laid in, then it is listened to again.
let report = stdout;
if (plan.pause && Object.keys(plan.pause).length) {
  const found = JSON.parse(await readFile(linesFile, "utf8"));
  // A cut is made in the middle of the real silence after the line, never at a
  // guessed word end: cutting there clipped the tail of the last word.
  const heardSilence = (await run("/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-i", take, "-af", "silencedetect=noise=-38dB:d=0.07", "-f", "null", "-"]).catch((error) => error)).stderr || "";
  const starts = [...heardSilence.matchAll(/silence_start: ([\d.]+)/g)].map((match) => Number(match[1]));
  const ends = [...heardSilence.matchAll(/silence_end: ([\d.]+)/g)].map((match) => Number(match[1]));
  const quiet = starts.map((start, index) => ({ start, end: ends[index] ?? start + 0.2 }));
  const cutAfter = (id) => {
    const spokenEnd = found[id].out - 0.22;
    // The silence has to lie before the next line's first word, or the cut would fall after it.
    const ids = plan.lines.map((line) => line.id);
    const nextIn = found[ids[ids.indexOf(id) + 1]]?.in ?? Infinity;
    const gap = quiet.filter((item) => item.end > spokenEnd - 0.15 && item.start < Math.min(spokenEnd + 0.9, nextIn + 0.08)).sort((x, y) => Math.abs(x.start - spokenEnd) - Math.abs(y.start - spokenEnd))[0];
    return gap ? (gap.start + gap.end) / 2 : spokenEnd + 0.12;
  };
  const cuts = Object.entries(plan.pause).filter(([id]) => found[id]).map(([id, seconds]) => ({ id, at: cutAfter(id), seconds })).sort((x, y) => x.at - y.at);
  const parts = [];
  let from = 0;
  for (const [index, cut] of cuts.entries()) {
    parts.push(`[0:a]atrim=start=${from.toFixed(3)}:end=${cut.at.toFixed(3)},asetpts=PTS-STARTPTS,apad=pad_dur=${cut.seconds}[p${index}]`);
    from = cut.at;
  }
  parts.push(`[0:a]atrim=start=${from.toFixed(3)},asetpts=PTS-STARTPTS[p${cuts.length}]`);
  const paused = take.replace(/\.mp3$/, `-p${createHash("sha256").update(JSON.stringify(plan.pause)).digest("hex").slice(0, 6)}.mp3`);
  await run("/opt/homebrew/bin/ffmpeg", ["-y", "-v", "error", "-i", take, "-filter_complex", `${parts.join(";")};${cuts.map((_, index) => `[p${index}]`).join("")}[p${cuts.length}]concat=n=${cuts.length + 1}:v=0:a=1[out]`, "-map", "[out]", "-b:a", "160k", paused]);
  take = paused;
  // The lines are not listened for again: a recogniser stretches the first word
  // after a silence back across it. Every line after a pause simply moves by it.
  const order = plan.lines.map((line) => line.id).filter((id) => found[id]);
  let shift = 0;
  report = "";
  for (const id of order) {
    found[id].in = Math.max(found[id].in, (cuts.filter((item) => order.indexOf(item.id) < order.indexOf(id)).at(-1)?.at ?? 0)) + shift;
    found[id].out += shift;
    report += `${id.padEnd(4)} ${found[id].in.toFixed(1).padStart(6)}–${found[id].out.toFixed(1).padEnd(6)} ${found[id].heard.slice(0, 60)}\n`;
    const cut = cuts.find((item) => item.id === id);
    if (cut) shift += cut.seconds;
  }
  await writeFile(linesFile, JSON.stringify(found, null, 2));
}
await writeFile(path.join(dir, `${name}.json`), JSON.stringify({ audio: path.relative(film, take), lines: path.relative(film, linesFile) }, null, 2));
const chars = inputs.reduce((sum, item) => sum + item.text.length, 0);
console.log(`${path.relative(film, take)}  ${chars} characters\n${report.trim()}`);
