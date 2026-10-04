// Push-to-talk dictation with ElevenLabs Scribe v2 Realtime.
//
// The microphone and the socket exist only between a press and the end of the
// sentence, so nothing is streamed (or paid for) while Mason is waiting.

const TARGET_RATE = 16000;
const MAX_SECONDS = 45;
const SILENCE_SECONDS = 1.4;
const BARS = 34;

function pcm16Base64(samples) {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x4000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x4000));
  return btoa(binary);
}

// The audio context runs at the device rate (usually 48 kHz); Scribe is sent 16 kHz.
function resample(input, fromRate) {
  if (fromRate === TARGET_RATE) return input;
  const ratio = fromRate / TARGET_RATE;
  const output = new Float32Array(Math.floor(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor];
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

export const canDictate = () => Boolean(navigator.mediaDevices?.getUserMedia && window.WebSocket && (window.AudioContext || window.webkitAudioContext));

// Starts listening. `done` resolves with the sentence once Scribe commits it
// after a pause, or when stop() is called. `stream` lets a test feed audio in.
export async function dictate({ onPartial = () => {}, onLevels = () => {}, stream = null, language = "" } = {}) {
  if (!canDictate()) throw new Error("The microphone is not available here. Type the answer instead.");
  const tokenReply = await fetch("/api/scribe-token", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const { token, error } = await tokenReply.json();
  if (!tokenReply.ok) throw new Error(error || "ElevenLabs is not connected");

  const media = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  await context.resume().catch(() => {});
  const source = context.createMediaStreamSource(media);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(analyser);
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  const query = new URLSearchParams({ token, model_id: "scribe_v2_realtime", audio_format: "pcm_16000", commit_strategy: "vad", vad_silence_threshold_secs: String(SILENCE_SECONDS) });
  // Without a language Scribe detects it, which lets a Swedish answer follow an English question.
  if (language) query.set("language_code", language);
  const socket = new WebSocket(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${query}`);

  let committed = "";
  let partial = "";
  let stopping = false;
  let finished = false;
  let frame = 0;
  let resolveDone;
  let rejectDone;
  const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });

  function cleanup() {
    if (finished) return;
    finished = true;
    cancelAnimationFrame(frame);
    clearTimeout(limit);
    processor.onaudioprocess = null;
    for (const node of [processor, source, analyser, mute]) { try { node.disconnect(); } catch {} }
    if (!stream) media.getTracks().forEach((track) => track.stop());
    context.close().catch(() => {});
    try { socket.close(); } catch {}
  }
  function finish(text) { cleanup(); resolveDone(String(text || "").trim()); }
  function fail(message) { cleanup(); rejectDone(new Error(message)); }

  // People start talking the moment they press. What is said before the socket
  // is open is kept and sent first, so the first word is never lost.
  const waiting = [];
  const send = (samples) => socket.send(JSON.stringify({ message_type: "input_audio_chunk", audio_base_64: pcm16Base64(samples), commit: false, sample_rate: TARGET_RATE }));
  socket.onopen = () => { while (waiting.length) send(waiting.shift()); };
  processor.onaudioprocess = (event) => {
    if (finished || socket.readyState > WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    // After stop() silence is sent, so the pause detector hears the sentence end.
    const samples = stopping ? new Float32Array(Math.floor(input.length * TARGET_RATE / context.sampleRate)) : resample(input, context.sampleRate);
    if (socket.readyState === WebSocket.OPEN) send(samples);
    else waiting.push(samples);
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const type = message.message_type || "";
    if (type === "partial_transcript") { partial = message.text || ""; onPartial(`${committed} ${partial}`.trim()); return; }
    if (type === "committed_transcript" || type === "committed_transcript_with_timestamps") {
      if (!message.text?.trim()) return;
      committed = `${committed} ${message.text.trim()}`.trim();
      partial = "";
      onPartial(committed);
      finish(committed);
      return;
    }
    if (/error|exceeded|limited|overflow|exhausted|unaccepted|invalid/.test(type)) fail(`Scribe: ${message.error || message.message || type}`);
  };
  socket.onerror = () => fail("Scribe lost its connection.");
  socket.onclose = () => { if (!finished) finish(`${committed} ${partial}`); };

  // Loudness over the last second and a half, newest on the right.
  const wave = new Uint8Array(analyser.fftSize);
  const history = new Array(BARS).fill(0);
  let lastBar = 0;
  const draw = (now) => {
    if (now - lastBar > 55) {
      lastBar = now;
      analyser.getByteTimeDomainData(wave);
      let sum = 0;
      for (const value of wave) sum += ((value - 128) / 128) ** 2;
      history.push(Math.min(1, Math.sqrt(sum / wave.length) * 4.5));
      history.shift();
      onLevels(history);
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  const limit = setTimeout(() => controller.stop(), MAX_SECONDS * 1000);
  const controller = {
    done,
    // The speaker says they are finished: wait briefly for Scribe to commit,
    // otherwise keep what it has heard so far.
    stop() {
      if (stopping || finished) return;
      stopping = true;
      setTimeout(() => finish(`${committed} ${partial}`), (SILENCE_SECONDS + 1.2) * 1000);
    },
    cancel() { cleanup(); resolveDone(""); },
  };
  return controller;
}

// Whether sound is really coming in, in one word: "hearing" a voice, "open"
// and quiet, or "silent". A microphone can be open and deliver nothing (muted,
// the wrong input, access not given), so a few seconds of exact silence from
// the start is said plainly instead of being waited out.
export function hearing(clock = () => performance.now()) {
  // The clock starts at the first sound measured, not while access is still
  // being asked for.
  let openedAt = null;
  let voiceAt = -Infinity;
  let any = false;
  return (level, { muted = false, floor = 0.09 } = {}) => {
    const now = clock();
    openedAt ??= now;
    if (level > 0.0015) any = true;
    if (level > floor) voiceAt = now;
    if (muted || (!any && now - openedAt > 2500)) return "silent";
    return now - voiceAt < 500 ? "hearing" : "open";
  };
}

// Bars for a canvas, shared by every place an answer can be spoken.
export function drawLevels(canvas, bars, color) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width * ratio) { canvas.width = width * ratio; canvas.height = height * ratio; }
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = color;
  const gap = 3;
  const bar = Math.max(2, (width - gap * (bars.length - 1)) / bars.length);
  bars.forEach((level, index) => {
    const size = Math.max(3, level * height);
    context.beginPath();
    context.roundRect(index * (bar + gap), (height - size) / 2, bar, size, bar / 2);
    context.fill();
  });
}
