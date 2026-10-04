import { randomUUID } from "node:crypto";

const rejection = /\b(avvisa|avvisade|ratad|rata|bygg inte|gör inte om|inte iterera|sluta|stoppa|rev|skit i|reject(?:ed)?|do not build|don'?t build|discard(?:ed)?|stop(?:ped)?)\b/i;
const boundary = /\b(aldrig|får aldrig|inte röra|rör inte|gräns|deadline|högst|bara om|never|must not|do not touch|don'?t touch|boundary|at most|only if|no more than)\b/i;
const choice = /\b(valde|byter?|bytte|istället|stack|spår|väg|beslut|ship(?:pa|par|pade)?|chose|choose|switch(?:ed)?|instead|track|direction|decision|ship(?:ped)?)\b/i;

function subject(text, max = 90) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 3)}…` : clean;
}

// Ambient mode is one sharp question, then a long silence. A capture session is
// the five-to-ten-minute task from the brief: three to five questions, spaced.
export function limits(runtime = {}) {
  const demo = Boolean(process.env.APPRENTICE_DEMO);
  if (runtime.session?.active) {
    return { pause: demo ? 1800 : 6000, cooldown: demo ? 12_000 : 90_000, max: 5, asked: runtime.session.questions || 0, threshold: 3, session: true };
  }
  return { pause: demo ? 1800 : 7000, cooldown: demo ? 12_000 : 4 * 60_000, max: 5, asked: runtime.questionsToday || 0, threshold: 4, session: false };
}

export function rankQuestion({ prompt = "", app = "", recentApps = [], now = Date.now(), runtime = {}, pauseMs = 0 }) {
  if (!prompt || prompt.length < 18 || runtime.offTheRecord || runtime.recording === false) return null;
  const limit = limits(runtime);
  if (pauseMs < limit.pause) return null;
  const last = runtime.lastQuestionAt ? Date.parse(runtime.lastQuestionAt) : 0;
  if (last && now - last < limit.cooldown) return null;
  if (limit.asked >= limit.max) return null;

  let score = 0;
  let kind = "reason";
  let text;
  if (rejection.test(prompt)) {
    score += 6;
    kind = "guardrail";
    text = "What must never come back here?";
  } else if (boundary.test(prompt)) {
    score += 5;
    kind = "guardrail";
    text = "When should I stop and ask you?";
  } else if (choice.test(prompt)) {
    score += 4;
    text = "Why this path, not the other?";
  }
  const uniqueApps = [...new Set(recentApps.filter(Boolean))];
  if (uniqueApps.length >= 3) {
    score += 2;
    if (!text) text = "What were you checking?";
  }
  if (prompt.length > 220) score += 1;
  if (limit.session) {
    // Inside a session any real prompt is a step worth a why. The brief also
    // wants a guardrail, so one is asked by the third question at the latest.
    if (prompt.length >= 40) score = Math.max(score, 3);
    if (!text) text = "Why this step?";
    if (kind !== "guardrail" && limit.asked >= 2 && !runtime.session.guardrailAsked) {
      kind = "guardrail";
      text = "Where is the limit here?";
    }
  }
  if (score < limit.threshold || !text) return null;
  return {
    id: randomUUID(),
    kind,
    score,
    text,
    evidence: subject(prompt),
    askedAt: new Date(now).toISOString(),
    status: "open",
  };
}

// The same pause, cooldown and ceiling for a question about a move between apps.
export function rankSwitch({ from, to, window = "", runtime = {}, idleMs = 0, now = Date.now() }) {
  const limit = limits(runtime);
  if (!limit.session || !from || !to || from === to) return null;
  if (runtime.offTheRecord || runtime.recording === false || idleMs < limit.pause) return null;
  const last = runtime.lastQuestionAt ? Date.parse(runtime.lastQuestionAt) : 0;
  if ((last && now - last < limit.cooldown) || limit.asked >= limit.max) return null;
  const title = subject(window, 60);
  const guardrail = limit.asked >= 2 && !runtime.session.guardrailAsked;
  return {
    id: randomUUID(),
    kind: guardrail ? "guardrail" : "reason",
    score: 3,
    text: guardrail ? "Where would you stop and ask?" : `What did you need in ${to}?`,
    evidence: `${from} → ${to}${title ? ` · ${title}` : ""}`,
    askedAt: new Date(now).toISOString(),
    status: "open",
  };
}

// Which rule a prompt carries, for the debrief: a signal that was seen but not
// asked about during the task is a gap.
export function signalOf(prompt = "") {
  if (rejection.test(prompt)) return "rejection";
  if (boundary.test(prompt)) return "boundary";
  if (choice.test(prompt)) return "choice";
  return null;
}

export const patterns = { rejection, boundary, choice };
