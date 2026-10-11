import path from "node:path";
import { atomicJson, paths, readJson } from "./store.mjs";

// The debrief as a voice call. An ElevenLabs agent holds the conversation: it
// is told what Mason saw today, asks about the judgement behind it,
// explains it back and writes the answers into the Work Map through two tools.
// The agent is created once and reused; only the day's context changes.

const API = "https://api.elevenlabs.io/v1/convai";

// What stopped a call, in words its owner can act on. What ElevenLabs
// answered is a line of code for someone else to read.
export const plainly = (status, detail = "") => status === 401 || status === 403
  ? (/permission|convai/i.test(detail) ? "This ElevenLabs key may not place calls. Give the key the permission for agents, or switch Voice off in Settings." : "ElevenLabs did not take the key. Check it in .env.local.")
  : status === 429 ? "ElevenLabs is busy, or the credits have run out. Try again in a while."
  : status >= 500 ? "ElevenLabs is not answering right now. Try again in a while."
  : `ElevenLabs could not start the call (${status}).`;
const AGENT_VERSION = 11;
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const agentFile = () => path.join(paths.data, "agent.json");

// How every agent talks. Written down once, because the first version sounded
// like a script: a greeting, praise after every answer, questions a yes
// answers, a list read out loud, and a farewell nobody wants to sit through.
const VOICE = `How you talk:
- Like a colleague who was there, never like a script. No greeting, no small talk, no praise, no farewell. Never say "great", "spot on", "no worries", "have a great day" or "goodbye".
- Never ask anything that a yes or a no answers. Ask what, how or why.
- One thing each time you speak, at most twenty-five words. Never read out a list.
- Spoken English. They may answer in Swedish; understand it and go on in English. Quote their own words as they said them.`;

const PROMPT = `You are Mason, a calm and curious junior colleague of {{expert_name}}. You have been quietly watching the work on this Mac today. You are now on a short voice call with them: the debrief.

Your goal: understand the judgement behind what you saw, in at most four questions, then explain it back until they say yes.

What you saw today. These are facts. Do not invent anything beyond them:
{{context}}

How to run the call:
1. Ask one short question at a time, about something specific you saw: a move between projects, a detour, something they rejected or limited, something they said to an agent. Never ask what the screen already answers. Never ask generic productivity questions.
2. Listen. When an answer hides a rule (a limit, an exception, a moment to stop and ask someone), ask one short follow-up about it.
3. Every time an answer contains a decision, a rejected direction or a rule, call save_step with their own words before you go on.
4. After three or four questions, explain back what you understood in under thirty seconds: how they decide, what they dropped, where a new person must stop and ask. End it with exactly these words and no others: "What did I get wrong?" Never ask whether it is correct.
5. If they correct you, call save_step with the correction and say the corrected part again. When they say it is right, call confirm_teach_back, say "Noted." and nothing more.

You have already asked the first question. End every turn on a question. Quote at most six of their words back, never a whole sentence. If they say they have no time, say you will keep it for later, call confirm_teach_back with confirmed false, and say nothing more.

${VOICE}`;

const TOOLS = [
  {
    type: "client",
    name: "save_step",
    description: "Save one thing the expert just explained into the Work Map: a decision, a rejected direction or a guardrail. Call it right after the answer, before the next question.",
    expects_response: true,
    response_timeout_secs: 8,
    parameters: {
      type: "object",
      required: ["kind", "title", "expert_words"],
      properties: {
        kind: { type: "string", enum: ["decision", "rejected", "guardrail"], description: "decision: how they choose. rejected: something that must not come back. guardrail: a limit, an exception, or when to stop and ask." },
        title: { type: "string", description: "The step in at most eight words, as a statement." },
        expert_words: { type: "string", description: "The reason in the expert's own words, as close to what they said as possible." },
        project: { type: "string", description: "The project it belongs to, exactly as named in the context, or empty." },
      },
    },
  },
  {
    type: "client",
    name: "confirm_teach_back",
    description: "Call once at the end: after the expert has confirmed the teach-back, or when they have no time for the call.",
    expects_response: true,
    response_timeout_secs: 8,
    parameters: {
      type: "object",
      required: ["confirmed", "summary"],
      properties: {
        confirmed: { type: "boolean", description: "true when the expert said yes to the teach-back." },
        summary: { type: "string", description: "The teach-back as you said it, in three or four sentences." },
      },
    },
  },
];

// The tutor: the same voice, the other role. It teaches a new person with the
// expert's rules, stops a wrong decision before it is acted on and explains it
// in the expert's own words.
const TUTOR_PROMPT = `You are Mason, now a tutor. You teach a new person how {{expert_name}} works, using only the rules {{expert_name}} gave. The new person is about to make decisions in a case {{expert_name}} never showed you.

The rules, each with an id and {{expert_name}}'s own words. These are all you know:
{{rules}}

How to run the session:
1. For every decision they describe, check it against the rules.
2. If it breaks a rule or comes close to one, stop them before they act. Say "{{expert_name}} would stop here. Why do you think?" and let them answer. Then give the reason in {{expert_name}}'s own words, quoting them, and call stop_decision with the rule id.
3. After a stop, ask what they would do instead. If the new plan respects the rule, say so and call clear_decision with that rule id as recovered_rule.
4. If a decision breaks no rule, say it is fine in a few words and call clear_decision.
5. After two or three decisions, or when they say they are done, tell them in one sentence what they have mastered and what to practise next. Call finish. Then say nothing more.

Never invent a rule. If nothing in the rules applies, say you have no rule for that and that they should ask {{expert_name}}. Quote {{expert_name}} exactly; the quotes may be in Swedish.

${VOICE}`;

const TUTOR_TOOLS = [
  {
    type: "client",
    name: "stop_decision",
    description: "Record that you stopped a decision because it breaks a rule. Call it right after you explained the stop.",
    expects_response: true,
    response_timeout_secs: 8,
    parameters: {
      type: "object",
      required: ["rule_id", "decision"],
      properties: {
        rule_id: { type: "string", description: "The id of the rule that was broken, exactly as listed, for example R2." },
        decision: { type: "string", description: "What the new person was about to do, in a few words." },
      },
    },
  },
  {
    type: "client",
    name: "clear_decision",
    description: "Record that a decision is fine. If it is their corrected plan after a stop, pass that rule id as recovered_rule.",
    expects_response: true,
    response_timeout_secs: 8,
    parameters: {
      type: "object",
      required: ["decision"],
      properties: {
        decision: { type: "string", description: "What the new person decided, in a few words." },
        recovered_rule: { type: "string", description: "The rule id they were stopped on and now respect, or empty." },
      },
    },
  },
  {
    type: "client",
    name: "finish",
    description: "Call once at the end, after telling them what they mastered and what to practise next.",
    expects_response: true,
    response_timeout_secs: 8,
    parameters: {
      type: "object",
      required: ["summary"],
      properties: { summary: { type: "string", description: "One sentence: what they mastered and what to practise next." } },
    },
  },
];

// Recall: the roles turned around. The expert built it by talking to agents
// and no longer knows how it is put together; Mason was there, and helps
// them get it back by asking rather than telling.
const RECALL_PROMPT = `You are Mason. You were there while {{expert_name}} built the project {{project}} by talking to coding agents. Some time later they no longer remember how it is put together or what they decided. You help them get it back in a short voice call. It is a colleague who was there helping them remember, not a quiz.

What you know about the project, from their own prompts, the files their agents changed and what those agents reported. This is all you know:
{{notes}}

How the call goes:
1. You have already asked them to tell you what they remember. Let them tell it. Do not correct anything while they are telling it.
2. When they stop, say in a few plain words what they had right. Call mark with outcome "knew" for each part they brought up themselves.
3. Then bring up one thing they left out, the way a colleague would: "You also did this: ..." and ask what they decided there, or why they did it. One thing, then wait.
4. If they know it, say so in two or three words and go on. If they do not, tell them at once in one sentence, in their own words when you have them, and call mark with outcome "reminded". No hints and no guessing games.
5. After two or three such things, or when they have had enough, name in one sentence the one part worth looking at again. Call finish. Then say nothing more.

Never invent a detail. If they ask about something that is not in your notes, say you did not see that.

${VOICE}`;

const RECALL_TOOLS = [
  {
    type: "client",
    name: "mark",
    description: "Record one part of the project: one they remembered by themselves, or one you had to tell them.",
    expects_response: true,
    response_timeout_secs: 8,
    parameters: {
      type: "object",
      required: ["topic", "outcome"],
      properties: {
        topic: { type: "string", description: "The part, in at most five words, for example: how matchmaking works." },
        outcome: { type: "string", enum: ["knew", "reminded"], description: "knew: they remembered it. reminded: you had to tell them." },
      },
    },
  },
  TUTOR_TOOLS.find((tool) => tool.name === "finish"),
];

const ROLES = {
  debrief: { name: "Mason · debrief", prompt: PROMPT, tools: TOOLS },
  tutor: { name: "Mason · tutor", prompt: TUTOR_PROMPT, tools: TUTOR_TOOLS },
  recall: { name: "Mason · recall", prompt: RECALL_PROMPT, tools: RECALL_TOOLS },
};

function agentConfig(kind) {
  const role = ROLES[kind] || ROLES.debrief;
  // English agents must use the v2 flash model; every other language needs v2.5.
  const language = process.env.ELEVENLABS_LANGUAGE || "en";
  return {
    name: role.name,
    conversation_config: {
      agent: {
        first_message: "{{opening}}",
        language,
        prompt: { prompt: role.prompt, llm: process.env.ELEVENLABS_AGENT_LLM || "gemini-2.0-flash", temperature: 0.4, tools: role.tools },
      },
      tts: { model_id: language === "en" ? "eleven_flash_v2" : "eleven_flash_v2_5", voice_id: process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID, agent_output_audio_format: "pcm_16000" },
      asr: { user_input_audio_format: "pcm_16000" },
      // Remembering takes longer than answering: the recall call waits for it.
      turn: { turn_timeout: kind === "recall" ? 20 : 8 },
      // A debrief is two minutes. The ceiling keeps a forgotten call from running on.
      conversation: { max_duration_seconds: 240, client_events: ["audio", "interruption", "user_transcript", "agent_response", "agent_response_correction", "client_tool_call", "ping", "conversation_initiation_metadata"] },
    },
    platform_settings: { auth: { enable_auth: true } },
  };
}

async function api(method, route, body) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); } catch { value = { detail: text.slice(0, 300) }; }
  if (!response.ok) throw new Error(plainly(response.status, JSON.stringify(value.detail ?? value)));
  return value;
}

// One agent per role ("debrief" interviews the expert, "tutor" teaches the new
// person, "recall" helps the expert remember their own project), each created
// once and reused.
export async function ensureAgent(kind = "debrief") {
  if (!process.env.ELEVENLABS_API_KEY) throw new Error("ElevenLabs is not connected");
  const signature = `${AGENT_VERSION}|${process.env.ELEVENLABS_LANGUAGE || "en"}|${process.env.ELEVENLABS_VOICE_ID || ""}|${process.env.ELEVENLABS_AGENT_LLM || ""}`;
  const file = await readJson(agentFile(), {});
  // The first version of this file held the debrief agent alone.
  const all = file.agentId ? { debrief: file } : file;
  const saved = all[kind] || {};
  if (saved.agentId && saved.signature === signature) return saved.agentId;
  // The prompt or the tools changed: the existing agent is updated in place.
  const config = agentConfig(kind);
  const agentId = saved.agentId
    ? (await api("PATCH", `/agents/${saved.agentId}`, config).then(() => saved.agentId).catch(async () => (await api("POST", "/agents/create", config)).agent_id))
    : (await api("POST", "/agents/create", config)).agent_id;
  await atomicJson(agentFile(), { ...all, [kind]: { agentId, signature, createdAt: saved.createdAt || new Date().toISOString() } });
  return agentId;
}

export async function signedUrl(agentId) {
  const value = await api("GET", `/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`);
  return value.signed_url;
}

const minutes = (seconds) => `${Math.max(1, Math.round(seconds / 60))} min`;
const SITES = /(YouTube|LinkedIn|Reddit|Facebook|Instagram|TikTok|Twitch|Netflix|Spotify|Wikipedia|GitHub)/i;
const siteOf = (item) => SITES.exec(item.window || "")?.[1] || (/\/ X$|on X:/.test(item.window || "") ? "X" : item.app);
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const short = (text, max) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

// What the tutor is told: every guardrail and rejected direction, with a short
// id it can refer to and the expert's own words.
export function tutorContext({ map, expert = "the expert" }) {
  const rules = map.decisions.filter((item) => item.kind === "guardrail" || item.kind === "discarded").slice(0, 14);
  const ids = Object.fromEntries(rules.map((item, index) => [`R${index + 1}`, item.id]));
  return {
    ids,
    variables: {
      expert_name: expert,
      rules: rules.map((item, index) => `R${index + 1}. ${item.title}. ${expert} said: "${short(item.quote || item.body, 160)}"`).join("\n") || "No rules yet.",
      opening: `I know how ${expert} works. What are you about to do?`,
    },
  };
}

// What the recall agent is told: everything remembered about one project.
export function recallContext({ memory, expert = "the expert" }) {
  const block = (title, lines) => lines?.length ? `${title}:\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
  const notes = [
    memory.one_line ? `What it is: ${memory.one_line}` : "",
    block("How it is put together (from the files the agents changed)", memory.how),
    block("Files changed most", (memory.parts || []).map((item) => `${item.file}, ${item.edits} changes`)),
    block("Built or changed, newest first", memory.built),
    block("Decisions that were made", memory.decided),
    memory.left_off ? `Where it was left: ${memory.left_off}` : "",
    block("Still open", memory.open),
    block("What they kept telling their agents", (memory.keeps_saying || []).map((item) => `${item.rule} (said ${item.times} times: "${short(item.example, 90)}")`)),
  ].filter(Boolean).join("\n\n");
  return {
    expert_name: expert,
    project: memory.project,
    notes: notes || "Almost nothing is known about this project.",
    opening: `Tell me about ${memory.project}. What do you remember?`,
  };
}

// What the agent is told before the call: the day in a few plain lines.
export function callContext({ map, projects, said, gaps, inferred = [], expert = "the expert" }) {
  const lines = [];
  const worked = projects.projects.filter((item) => item.seconds >= 30 || item.prompts);
  if (worked.length) {
    lines.push("Projects worked on today (a project is a folder on this Mac):");
    for (const item of worked.slice(0, 6)) {
      lines.push(`- ${item.name}: ${item.seconds >= 30 ? `${minutes(item.seconds)} in front` : "prompted, never in front"}${item.prompts ? `, ${item.prompts} prompts to an agent` : ""}${item.apps.length ? `, in ${item.apps.join(" and ")}` : ""}.`);
    }
    if (projects.switches >= 2) lines.push(`They moved between projects ${projects.switches} times.`);
  }
  if (projects.offProject.seconds >= 60) {
    const sites = new Map();
    for (const item of projects.offProject.windows) sites.set(siteOf(item), (sites.get(siteOf(item)) || 0) + item.seconds);
    const longest = [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([site, seconds]) => `${site} (${minutes(seconds)})`).join(", ");
    lines.push(`Outside every project: ${minutes(projects.offProject.seconds)}. Mostly ${longest}. You do not know the titles; refer to them by site only.`);
  }
  const recent = said.slice(-8);
  if (recent.length) {
    lines.push("Things they said to an agent, in their own words (often Swedish):");
    for (const prompt of recent) lines.push(`- ${clock(new Date(prompt.at).toISOString())} in ${prompt.project}: "${short(prompt.text, 220)}"`);
  }
  if (gaps.length) {
    lines.push("Open threads Mason noticed. Ask about the most interesting ones and skip any that sound wrong:");
    for (const gap of gaps) lines.push(`- ${gap.text}`);
  }
  if (inferred.length) {
    lines.push("Rules Mason inferred because they repeated them to their agents. Nobody has confirmed these. Ask about one: is it really a rule, and when does it not apply?");
    for (const item of inferred.slice(0, 5)) lines.push(`- In ${item.project}, said ${item.times} times: ${item.rule} ("${short(item.example, 90)}")`);
  }
  const known = map.decisions.filter((item) => item.kind !== "decision" && item.source?.type !== "inferred").slice(0, 5);
  if (known.length) {
    lines.push("Guardrails already in the Work Map. Do not ask about these again:");
    for (const item of known) lines.push(`- ${item.title}: "${short(item.quote || item.body, 120)}"`);
  }
  if (!lines.length) lines.push("Almost nothing was observed today. Ask what they are working on and what a new person must never do.");
  const names = worked.filter((item) => item.seconds >= 30).slice(0, 2).map((item) => item.name);
  return {
    expert_name: expert,
    context: lines.join("\n"),
    // The call was taken by a press, so it opens on what was seen and a real
    // question, not on a greeting and "got two minutes?".
    opening: names.length > 1
      ? `I watched you move between ${names.join(" and ")} today. What were you trying to get done?`
      : names.length
        ? `I watched you work on ${names[0]} today. What were you trying to get done?`
        : "I saw very little today. What did you work on?",
  };
}
