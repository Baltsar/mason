// The debrief call: a live voice conversation with the ElevenLabs agent.
//
// The page is only the telephone. The server decides what the agent is told
// about the day, and the agent writes into the Work Map through two tools.

const RATE = 16000;

const post = async (body) => {
  const response = await fetch("/api/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "The call could not be placed");
  return value;
};

function toBase64(samples) {
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

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const samples = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index += 1) samples[index] = pcm[index] / 32768;
  return samples;
}

function resample(input, fromRate) {
  if (fromRate === RATE) return input;
  const ratio = fromRate / RATE;
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

// The line is open both ways: start talking and the agent stops, like a person
// would. The microphone's echo cancellation keeps the agent from hearing itself
// through the speakers. If it still does (it keeps cutting itself off while
// nobody has said a word), the call falls back to taking turns, and a press on
// "cut in" still interrupts it.
export async function startCall({ kind = "debrief", project = "", onAgent = () => {}, onUser = () => {}, onSaved = () => {}, onLevels = () => {}, onState = () => {}, onInterrupt = () => {}, onDuplex = () => {}, onMic = () => {}, stream = null, duplex = "full" } = {}) {
  onState("calling");
  const { signedUrl, variables } = await post({ action: "start", kind, project });
  let media;
  try {
    media = stream || await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch (error) {
    await post({ action: "end", kind, turns: [] }).catch(() => {});
    throw error;
  }
  const track = media.getAudioTracks()[0] || null;
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  await context.resume().catch(() => {});
  // Sound that has not been allowed to start yet is said, not hidden: nothing
  // would be heard or sent, and the call would look like it was simply quiet.
  if (context.state !== "running") onState("tap");
  context.onstatechange = () => {
    if (context.state !== "running" || ended) return;
    onState("awake");
    onState(socket.readyState === WebSocket.OPEN ? "live" : "calling");
  };
  const source = context.createMediaStreamSource(media);
  const micMeter = context.createAnalyser();
  const voiceMeter = context.createAnalyser();
  micMeter.fftSize = 256;
  voiceMeter.fftSize = 256;
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(micMeter);
  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);
  voiceMeter.connect(context.destination);

  const socket = new WebSocket(signedUrl);
  const turns = [];
  const playing = new Set();
  let playUntil = 0;
  let droppedBefore = -1;
  let lastAudioEvent = -1;
  let selfInterruptions = 0;
  let openUntil = 0;
  let conversationId = null;
  let ended = false;
  let closing = false;
  let frame = 0;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const agentSpeaking = () => context.currentTime < playUntil + 0.12;

  function play(samples) {
    const buffer = context.createBuffer(1, samples.length, RATE);
    buffer.copyToChannel(samples, 0);
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(voiceMeter);
    const at = Math.max(context.currentTime + 0.04, playUntil);
    node.start(at);
    playUntil = at + buffer.duration;
    playing.add(node);
    node.onended = () => playing.delete(node);
  }
  function hush() {
    for (const node of playing) { try { node.stop(); } catch {} }
    playing.clear();
    playUntil = 0;
  }

  // The agent's tools are run by the server; the page only passes them on and
  // shows what was kept.
  async function runTool({ tool_name: name, tool_call_id: id, parameters = {} }) {
    let result = "Done.";
    let failed = false;
    try {
      const reply = await post({ action: "tool", kind, tool: name, parameters });
      result = reply.result || "Done.";
      if (reply.shown) onSaved(reply.shown);
      if (reply.closing) closing = true;
    } catch (error) {
      failed = true;
      result = error.message;
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "client_tool_result", tool_call_id: id, result, is_error: failed }));
  }

  async function end(reason = "ended") {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(frame);
    clearInterval(goodbye);
    processor.onaudioprocess = null;
    hush();
    for (const node of [processor, source, micMeter, mute, voiceMeter]) { try { node.disconnect(); } catch {} }
    if (!stream) media.getTracks().forEach((track) => track.stop());
    context.close().catch(() => {});
    try { socket.close(); } catch {}
    const summary = await post({ action: "end", kind, conversationId, turns }).catch(() => ({ saved: 0 }));
    onState("ended");
    resolveDone({ reason, saved: summary.saved, summary: summary.summary, turns });
  }

  socket.onopen = () => {
    socket.send(JSON.stringify({ type: "conversation_initiation_client_data", dynamic_variables: variables }));
    onState("live");
  };
  processor.onaudioprocess = (event) => {
    if (ended || socket.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const quiet = duplex === "half" && agentSpeaking() && performance.now() > openUntil;
    const samples = quiet ? new Float32Array(Math.floor(input.length * RATE / context.sampleRate)) : resample(input, context.sampleRate);
    socket.send(JSON.stringify({ user_audio_chunk: toBase64(samples) }));
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    switch (message.type) {
      case "conversation_initiation_metadata":
        conversationId = message.conversation_initiation_metadata_event?.conversation_id || null;
        break;
      case "audio": {
        const audio = message.audio_event;
        // Sound that was already cut off by an interruption is not played late.
        lastAudioEvent = Math.max(lastAudioEvent, audio?.event_id ?? -1);
        if (audio?.audio_base_64 && audio.event_id > droppedBefore) play(fromBase64(audio.audio_base_64));
        break;
      }
      case "interruption":
        droppedBefore = message.interruption_event?.event_id ?? droppedBefore;
        hush();
        onInterrupt("voice");
        // Cut off three times with nothing said: it is hearing its own voice.
        selfInterruptions += 1;
        if (duplex === "full" && selfInterruptions >= 3) { duplex = "half"; onDuplex("half"); }
        break;
      case "agent_response": {
        const text = message.agent_response_event?.agent_response?.trim();
        if (text) { turns.push({ who: "agent", text }); onAgent(text); }
        break;
      }
      case "agent_response_correction": {
        const text = message.agent_response_correction_event?.corrected_agent_response?.trim();
        const last = turns.findLast((turn) => turn.who === "agent");
        if (text && last) { last.text = text; onAgent(text); }
        break;
      }
      case "user_transcript": {
        const text = message.user_transcription_event?.user_transcript?.trim();
        if (text && text !== "...") { selfInterruptions = 0; turns.push({ who: "expert", text }); onUser(text); }
        break;
      }
      case "client_tool_call":
        runTool(message.client_tool_call);
        break;
      case "ping":
        setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "pong", event_id: message.ping_event.event_id })); }, message.ping_event?.ping_ms || 0);
        break;
      default:
        break;
    }
  };
  socket.onerror = () => end("connection lost");
  socket.onclose = () => end("hung up");

  // After the teach-back is confirmed the agent says goodbye; the line closes
  // once it has finished speaking.
  let closingSince = 0;
  const goodbye = setInterval(() => {
    if (!closing) return;
    closingSince = closingSince || Date.now();
    if ((!agentSpeaking() && Date.now() - closingSince > 2500) || Date.now() - closingSince > 20_000) end("finished");
  }, 400);

  const micWave = new Uint8Array(micMeter.fftSize);
  const voiceWave = new Uint8Array(voiceMeter.fftSize);
  const history = new Array(34).fill(0);
  let lastBar = 0;
  const loudness = (meter, wave) => {
    meter.getByteTimeDomainData(wave);
    let sum = 0;
    for (const value of wave) sum += ((value - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / wave.length) * 4.5);
  };
  const draw = (now) => {
    if (now - lastBar > 55) {
      lastBar = now;
      const speaking = agentSpeaking();
      const mic = loudness(micMeter, micWave);
      history.push(speaking ? loudness(voiceMeter, voiceWave) : mic);
      history.shift();
      onLevels(history, speaking ? "agent" : "expert");
      // The microphone is measured the whole time, also while the agent talks.
      onMic(mic, { muted: track?.muted === true, agent: speaking, duplex });
    }
    frame = requestAnimationFrame(draw);
  };
  frame = requestAnimationFrame(draw);

  return {
    done,
    device: track?.label || "",
    wake: () => context.resume().catch(() => {}),
    end: () => end("hung up by the expert"),
    // A press that interrupts: what the agent is saying stops at once, the rest
    // of that sentence is dropped, and the microphone is open for the reply.
    cutIn() {
      if (ended) return;
      droppedBefore = lastAudioEvent;
      hush();
      openUntil = performance.now() + 15_000;
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "user_activity" }));
      onInterrupt("press");
    },
  };
}
