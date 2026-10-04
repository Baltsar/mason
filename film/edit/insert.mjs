// Lays one of Gustaf's own clips into a finished film:
//   node film/edit/insert.mjs <film.mp4> <clip> <at seconds> [length] [--audio] [--mute] [--from s]
//
// The clip's picture covers the frame for its length (a portrait clip is
// shown at full height in the middle, with the film still moving around it)
// and its sound is mixed in at that second. --audio lays in only the sound.
// --mute silences the film's own sound under the clip. The film is replaced;
// the version before is kept beside it as <name>.before.mp4.

import { execFile } from "node:child_process";
import { copyFile, rename } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "/opt/homebrew/bin/ffprobe";

const args = process.argv.slice(2);
const flags = new Set(args.filter((item) => item.startsWith("--") && !item.startsWith("--from")));
const fromIndex = args.indexOf("--from");
const from = fromIndex >= 0 ? Number(args[fromIndex + 1]) : 0;
const [film, clip, atText, lengthText] = args.filter((item, index) => !item.startsWith("--") && !(fromIndex >= 0 && index === fromIndex + 1));
const at = Number(atText);

const probe = async (file, entries, stream) => (await run(FFPROBE, ["-v", "error", ...(stream ? ["-select_streams", stream] : []), "-show_entries", entries, "-of", "csv=p=0", file])).stdout.trim();
const clipLength = Number(await probe(clip, "format=duration")) - from;
const length = Math.min(lengthText ? Number(lengthText) : clipLength, clipLength);
const hasVideo = !flags.has("--audio") && (await probe(clip, "stream=index", "v")).length > 0;
const end = at + length;

const graph = [];
let video = "0:v";
if (hasVideo) {
  const [width, height] = (await probe(clip, "stream=width,height", "v:0")).split(",").map(Number);
  // Phones store a portrait clip as a landscape frame plus a rotation flag, and
  // ffmpeg turns the picture when it decodes. So the flag decides the shape.
  const turned = Math.abs(Number((await probe(clip, "stream_side_data=rotation", "v:0")).split(",").filter(Boolean).at(-1) || 0)) === 90;
  const portrait = turned ? width > height : height > width;
  const shape = portrait
    ? "scale=-2:1080,setsar=1"
    : "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1";
  graph.push(`[1:v]trim=start=${from}:duration=${length},setpts=PTS-STARTPTS+${at}/TB,fps=30,${shape}[clip]`);
  graph.push(`[0:v][clip]overlay=${portrait ? "(W-w)/2:0" : "0:0"}:enable='between(t,${at},${end})':eof_action=pass[v]`);
  video = "[v]";
}
const under = flags.has("--mute") ? `volume=enable='between(t,${at},${end})':volume=0` : "anull";
graph.push(`[0:a]${under}[film]`);
graph.push(`[1:a]atrim=start=${from}:duration=${length},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:d=0.04,afade=t=out:st=${Math.max(0, length - 0.08)}:d=0.08,adelay=${Math.round(at * 1000)}:all=1[voice]`);
graph.push("[film][voice]amix=inputs=2:normalize=0:duration=first[a]");

const out = film.replace(/\.mp4$/, ".new.mp4");
await run(FFMPEG, [
  "-y", "-v", "error", "-i", film, "-i", clip, "-filter_complex", graph.join(";"),
  "-map", video, "-map", "[a]",
  ...(hasVideo ? ["-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", "30"] : ["-c:v", "copy"]),
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out,
], { maxBuffer: 64_000_000, timeout: 20 * 60_000 });
await copyFile(film, film.replace(/\.mp4$/, ".before.mp4"));
await rename(out, film);
console.log(`${path.basename(clip)} ${hasVideo ? "picture and sound" : "sound"} at ${at.toFixed(1)}–${end.toFixed(1)} s in ${path.basename(film)}`);
