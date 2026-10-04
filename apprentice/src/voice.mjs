import { access, mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { paths } from "./store.mjs";

// A premade ElevenLabs voice, so an API key alone is enough to hear it.
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
// Flash costs half the credits of the multilingual model and answers fastest.
const DEFAULT_MODEL_ID = "eleven_flash_v2_5";
let playing = null;

export const voiceStatus = () => ({
  elevenLabs: Boolean(process.env.ELEVENLABS_API_KEY),
  scribe: Boolean(process.env.ELEVENLABS_API_KEY),
  engine: process.env.ELEVENLABS_API_KEY ? "ElevenLabs" : "Mac voice",
  language: process.env.ELEVENLABS_LANGUAGE || "",
});

export function stopSpeaking() {
  playing?.kill("SIGTERM");
  playing = null;
}

// One thing is heard at a time. `done` resolves when it has ended, whether it
// ran out or was stopped, so a listener can open after the last word.
function track(child) {
  playing = child;
  return new Promise((resolve) => {
    child.once("error", () => { if (playing === child) playing = null; resolve(); });
    child.once("exit", () => { if (playing === child) playing = null; resolve(); });
  });
}

// All speech is played by this process, never by a page. A question can then
// be heard while every Mason window is closed.
export async function speak(text) {
  stopSpeaking();
  const clean = String(text ?? "").trim().slice(0, 5000);
  if (!clean || process.env.APPRENTICE_MUTE) return { engine: null, done: Promise.resolve() };
  const audio = await elevenLabsSpeech(clean).catch(() => null);
  const child = audio
    ? spawn("afplay", [audio], { stdio: "ignore" })
    : spawn("say", ["-v", process.env.APPRENTICE_SYSTEM_VOICE || "Samantha", clean], { stdio: "ignore" });
  return { engine: audio ? "ElevenLabs" : "Mac voice", done: track(child) };
}

// A finished recording, on the same single channel as speech: Stop ends it and
// so does anything said after it. Muted, it is silent but lasts just as long.
export function playFile(file, seconds = 0) {
  stopSpeaking();
  const child = process.env.APPRENTICE_MUTE
    ? spawn("sleep", [String(Math.ceil(seconds))], { stdio: "ignore" })
    : spawn("afplay", [file], { stdio: "ignore" });
  return { done: track(child) };
}

export async function notifyAndSpeak(text, { title = "Mason · one question" } = {}) {
  if (process.env.APPRENTICE_MUTE) return { engine: null, done: Promise.resolve() };
  const notice = spawn("osascript", ["-e", `display notification ${JSON.stringify(text)} with title ${JSON.stringify(title)}`], { detached: true, stdio: "ignore" });
  notice.once("error", () => {});
  notice.unref();
  return speak(text);
}

// A sentence is paid for once. The same words in the same voice are replayed
// from disk, so "say it again" and a repeated question cost nothing.
export async function elevenLabsSpeech(text) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID;
  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID;
  const hash = createHash("sha256").update(`${voice}|${model}|${text}`).digest("hex").slice(0, 24);
  const target = path.join(paths.data, "audio", `tts-${hash}.mp3`);
  try { await access(target); return target; } catch {}
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_22050_32`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: model }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

// Two voices in one take. Text to Dialogue plays the turn-taking, the pauses
// and the reactions between the speakers, which separate sentences cannot.
export async function elevenLabsDialogue(inputs, target) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const response = await fetch("https://api.elevenlabs.io/v1/text-to-dialogue?output_format=mp3_44100_64", {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ inputs, model_id: process.env.ELEVENLABS_DIALOGUE_MODEL_ID || "eleven_v3" }),
    signal: AbortSignal.timeout(240_000),
  });
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
  return target;
}

export const PCM_RATE = 22_050;

// One sentence in one voice as raw samples, to be joined with others.
export async function elevenLabsPcm(text, voice) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=pcm_${PCM_RATE}`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL_ID }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`ElevenLabs returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
