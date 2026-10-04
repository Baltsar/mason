// Finds where each scripted line is spoken in the one take to camera:
//   node film/edit/lines.mjs film/raw/lines.mp4
// Writes film/raw/lines.json: { "7": { in, out, heard } }. A line read twice
// keeps its last reading, since a retake is said after the miss.

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.dirname(here);
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const WHISPER = process.env.WHISPER_BIN || "/opt/homebrew/bin/whisper-cli";
const MODEL = process.env.WHISPER_MODEL || path.join(homedir(), ".cache/kallan/ggml-base.bin");

const words = (text) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
// Whisper hears numbers and names its own way; a word counts when it starts alike.
const base = (word) => word.replace(/'.*$/, "");
const alike = (a, b) => base(a) === base(b) || (a.length > 3 && b.length > 3 && (a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4))));

// Optional second and third arguments: the script to look for and where to write.
const script = JSON.parse(await readFile(process.argv[3] ? path.resolve(process.argv[3]) : path.join(here, "script.json"), "utf8"));
const target = process.argv[4] ? path.resolve(process.argv[4]) : path.join(film, "raw", "lines.json");
const input = path.resolve(process.argv[2]);
const dir = await mkdtemp(path.join(tmpdir(), "apprentice-lines-"));
let heard = [];
try {
  const wav = path.join(dir, "audio.wav");
  await run(FFMPEG, ["-y", "-v", "error", "-i", input, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav]);
  // One word per segment, so every word carries its own time.
  await run(WHISPER, ["-m", MODEL, "-f", wav, "-l", "en", "-ml", "1", "-sow", "-oj", "-of", path.join(dir, "heard"), "-np"], { maxBuffer: 64_000_000, timeout: 10 * 60_000 });
  const json = JSON.parse(await readFile(path.join(dir, "heard.json"), "utf8"));
  for (const row of json.transcription || []) {
    for (const word of words(row.text || "")) heard.push({ word, from: row.offsets.from / 1000, to: row.offsets.to / 1000 });
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}

const found = {};
const missing = [];
// LINES_ORDERED=1: a generated narration is said once and in order, so each
// line is looked for after the one before it and there are no retakes.
const ordered = Boolean(process.env.LINES_ORDERED);
let cursor = 0;
for (const [number, text] of Object.entries(script)) {
  const want = words(text);
  let best = null;
  for (let start = ordered ? cursor : 0; start < (ordered ? Math.min(heard.length, cursor + want.length + 40) : heard.length); start += 1) {
    // A reading starts where two of the line's first four words are heard close together.
    const opening = heard.slice(start, start + 5).map((item) => item.word);
    if (want.slice(0, 4).filter((word) => opening.some((said) => alike(said, word))).length < 2) continue;
    // Walk the take and the line together, letting either skip a word.
    let at = start;
    let hits = 0;
    let first = -1;
    let last = start;
    for (const word of want) {
      for (let look = at; look < Math.min(heard.length, at + 3); look += 1) {
        if (alike(heard[look].word, word)) { hits += 1; last = look; at = look + 1; if (first < 0) first = look; break; }
      }
    }
    const score = hits / want.length;
    if (score < 0.6) continue;
    // Inside one reading the fullest match wins. A separate, later reading
    // replaces it when it is about as good: that is the retake.
    const later = !ordered && best && start > best.last;
    if (!best || (later ? score >= best.score - 0.1 : score > best.score)) best = { score, start: first, last };
  }
  if (!best) { missing.push(number); continue; }
  cursor = best.last + 1;
  found[number] = {
    in: Math.max(0, heard[best.start].from - 0.12),
    out: heard[best.last].to + 0.22,
    heard: heard.slice(best.start, best.last + 1).map((item) => item.word).join(" "),
    match: Number(best.score.toFixed(2)),
  };
}

// The lines are read in order, so a line cannot begin inside the one before it.
const order = Object.keys(script).filter((key) => found[key]);
for (const [index, key] of order.entries()) {
  const before = found[order[index - 1]];
  const line = found[key];
  if (before && line.in < before.out && line.out > before.out) line.in = before.out - 0.2;
  // A misheard opening word (a name, a number) makes a line look late. In an
  // ordered narration it starts where the line before it stopped.
  if (ordered && before && line.in - before.out > 0.35 && !alike(words(line.heard)[0] ?? "", words(script[key])[0])) line.in = before.out + 0.05;
}

await writeFile(target, JSON.stringify(found, null, 2));
for (const [number, line] of Object.entries(found)) console.log(`${number.padStart(2)}  ${line.in.toFixed(1).padStart(6)}–${line.out.toFixed(1).padEnd(6)} ${(line.out - line.in).toFixed(1).padStart(5)} s  ${line.match}  ${line.heard.slice(0, 70)}`);
if (missing.length) console.log(`not found: ${missing.join(", ")}`);
