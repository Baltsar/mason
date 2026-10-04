// Turns a film plan and its narrated take into a cut, then builds it:
//   node film/edit/compose.mjs film/edit/films/<name>.json
// Each shot is held for as long as its lines are spoken.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const film = path.dirname(here);
const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";
const LEAD = 0.18;
const TAIL = 1.3;

const file = path.resolve(process.argv[2]);
const name = path.basename(file, ".json");
const plan = JSON.parse(await readFile(file, "utf8"));
const voice = JSON.parse(await readFile(path.join(film, "raw", "voice", `${name}.json`), "utf8"));
const spoken = JSON.parse(await readFile(path.join(film, voice.lines), "utf8"));
const missing = plan.lines.filter((line) => !spoken[line.id]).map((line) => line.id);
if (missing.length) throw new Error(`Not heard in the take: ${missing.join(", ")}`);
const length = Number((await run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(film, voice.audio)])).stdout);

// A shot starts just before its first line and runs until the next shot.
const starts = plan.shots.map((shot, index) => (index === 0 ? 0 : Math.max(0, spoken[shot.lines[0]].in - LEAD)));
// The film runs a beat past the last word, so it does not end on a cut-off syllable.
const total = spoken[plan.lines.at(-1).id].out + TAIL;
const clips = plan.shots.map((shot, index) => {
  const dur = Number(((starts[index + 1] ?? total) - starts[index]).toFixed(3));
  // A slot is footage of Gustaf, used when he has dropped it in; otherwise the card stands.
  const clip = shot.slot && existsSync(path.join(film, shot.slot.src || shot.slot.image)) ? { ...shot.slot } : { ...shot.clip };
  if (clip.src) clip.in ??= 0;
  return { ...clip, dur };
});

// Captions: a few words at a time, each phrase given its share of the line.
function phrases(text) {
  const parts = text.split(/(?<=[,.:;?!])\s+/).flatMap((part) => {
    const out = [];
    let current = "";
    for (const word of part.split(/\s+/)) {
      if (current && `${current} ${word}`.length > 40) { out.push(current); current = word; } else current = current ? `${current} ${word}` : word;
    }
    if (current) out.push(current);
    return out;
  });
  // A very short phrase rides with its neighbour.
  const merged = [];
  for (const part of parts) {
    if (merged.length && (merged.at(-1).length < 12 || part.length < 9) && `${merged.at(-1)} ${part}`.length <= 44) merged[merged.length - 1] += ` ${part}`;
    else merged.push(part);
  }
  return merged;
}
const captions = [];
for (const [index, line] of plan.lines.entries()) {
  if (line.caption === false) continue;
  // A line's text leaves the screen when the next voice starts, so two lines never overlap.
  const next = plan.lines[index + 1];
  const from = Math.max(spoken[line.id].in, captions.at(-1)?.to ?? 0);
  const to = Math.min(spoken[line.id].out, next ? spoken[next.id].in + 0.05 : total);
  const parts = phrases(line.caption || line.text);
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  let at = from;
  for (const part of parts) {
    const share = (to - from) * (part.length / size);
    captions.push({ at: Number(at.toFixed(3)), to: Number(Math.min(total, at + share - 0.04).toFixed(3)), text: part, hl: line.hl || "", tone: line.tone || (line.voice === "apprentice" ? "voice" : "") });
    at += share;
  }
}

// The mark sits in the corner of the full-frame cards; the app window carries its own.
const bugs = plan.shots.flatMap((shot, index) => (shot.bug ? [{ at: starts[index], to: starts[index + 1] ?? total }] : []));
const cut = { out: plan.out, clips, vo: [{ src: voice.audio, in: 0, out: Number(Math.min(total, length).toFixed(3)), at: 0 }], captions, bugs };
const cutFile = path.join(film, "raw", "voice", `${name}-cut.json`);
await writeFile(cutFile, JSON.stringify(cut, null, 2));
const { stdout } = await run(process.execPath, [path.join(here, "build.mjs"), cutFile], { maxBuffer: 64_000_000, timeout: 20 * 60_000 });
console.log(stdout.trim());
for (const [index, shot] of plan.shots.entries()) console.log(`${starts[index].toFixed(1).padStart(5)}  ${String(clips[index].dur.toFixed(1)).padStart(5)} s  ${shot.lines.join(",").padEnd(12)} ${clips[index].src || clips[index].image || clips[index].card?.kind || "end"}`);
