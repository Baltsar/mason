import { randomUUID } from "node:crypto";
import { signalOf } from "./question-engine.mjs";

const short = (text, max = 70) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

// The debrief asks only about what the task left open: signals that were seen
// but never asked about, switches nobody explained, and the case not shown.
export function buildGaps(map, events, { since = 0, projects = null, said = [] } = {}) {
  const scoped = events.filter((event) => Date.parse(event.at) >= since);
  const asked = new Set(map.questions.map((question) => question.source?.fingerprint).filter(Boolean));
  const gaps = [];
  const add = (gap) => gaps.push({ id: randomUUID(), status: "open", answer: null, ...gap });

  // A live question that was asked but never answered waits here, first in line.
  const waiting = map.questions.filter((item) => item.status === "parked" && Date.parse(item.askedAt) >= since);
  for (const question of waiting.filter((item, index) => waiting.findIndex((other) => other.evidence === item.evidence) === index).slice(0, 2)) {
    add({ kind: question.kind === "guardrail" ? "guardrail" : "decision", priority: 7, title: `${question.kind === "guardrail" ? "Guardrail" : "Step"}: ${short(question.evidence, 56)}`, moment: { at: question.source?.at || question.askedAt, app: question.source?.app, window: question.source?.window, evidence: question.evidence }, text: `Earlier I asked and you were busy. ${question.text}`, why: "Asked live, left unanswered, kept for the debrief." });
  }

  if (projects) {
    const worked = projects.projects.filter((item) => item.seconds >= 60);
    if (worked.length >= 2 && projects.switches >= 2) {
      const [first, second] = worked;
      add({ kind: "decision", priority: 6.5, title: `Why ${first.name} and ${second.name} at once`, moment: { at: projects.asOf, app: first.apps[0], window: `${first.name} ↔ ${second.name}`, evidence: `${projects.switches} moves between projects` }, text: `You moved between projects ${projects.switches} times, mostly ${first.name} and ${second.name}. What pulls you from one to the other?`, why: "Moving between projects is a decision nobody wrote down." });
    }
    // The longest stretch outside every project, right in the middle of one.
    const blocks = projects.blocks;
    let detour = null;
    for (let index = 1; index < blocks.length - 1; index += 1) {
      const [before, middle, after] = [blocks[index - 1], blocks[index], blocks[index + 1]];
      if (middle.project || !before.project || before.project !== after.project || middle.seconds < 90) continue;
      if (!detour || middle.seconds > detour.middle.seconds) detour = { before, middle };
    }
    if (detour) {
      const minutes = Math.max(1, Math.round(detour.middle.seconds / 60));
      add({ kind: "decision", priority: 5.5, title: `The detour from ${detour.before.project}`, moment: { at: detour.middle.startedAt, app: detour.middle.app, window: detour.middle.window, evidence: `${minutes} min outside ${detour.before.project}` }, text: `In the middle of ${detour.before.project} you spent ${minutes} minutes on “${short(detour.middle.window || detour.middle.app, 60)}”. A break, or something the work needed?`, why: "Only you know whether that was rest or research." });
    }
  }

  // What was said to the agents in each project, in the expert's own words.
  const spoken = new Set();
  for (const prompt of [...said].reverse()) {
    const signal = signalOf(prompt.text);
    if (!signal || signal === "choice" || spoken.has(signal)) continue;
    spoken.add(signal);
    const moment = { at: new Date(prompt.at).toISOString(), app: "Claude Code", window: prompt.project, evidence: short(prompt.text, 140) };
    if (signal === "rejection") add({ kind: "guardrail", priority: 6, moment, title: `Rejected in ${prompt.project}: ${short(prompt.text, 44)}`, text: `In ${prompt.project} at ${clock(moment.at)} you said: “${short(prompt.text)}”. What exactly must not come back, and why?`, why: "You stopped something in your own words; the reason was not said." });
    if (signal === "boundary") add({ kind: "guardrail", priority: 5, moment, title: `Limit in ${prompt.project}: ${short(prompt.text, 48)}`, text: `In ${prompt.project} at ${clock(moment.at)} you said: “${short(prompt.text)}”. Is that always true, or is there an exception?`, why: "A limit was said without its exception." });
  }

  const seen = new Set();
  for (const event of scoped.filter((item) => item.type === "prompt").reverse()) {
    const signal = signalOf(event.excerpt);
    if (!signal || asked.has(event.fingerprint) || seen.has(event.fingerprint)) continue;
    seen.add(event.fingerprint);
    const moment = { at: event.at, app: event.app, window: event.window, evidence: short(event.excerpt, 140) };
    if (signal === "rejection") add({ kind: "guardrail", priority: 6, moment, title: `Rejected: ${short(event.excerpt, 52)}`, text: `At ${clock(event.at)} in ${event.app} you stopped something: “${short(event.excerpt)}”. What must never be picked up again, and who may overrule that?`, why: "A rejected direction was seen but not asked about during the task." });
    if (signal === "boundary") add({ kind: "guardrail", priority: 5, moment, title: `Limit: ${short(event.excerpt, 56)}`, text: `At ${clock(event.at)} in ${event.app} you set a limit: “${short(event.excerpt)}”. Does it hold for every case, and what is the exception?`, why: "A limit was seen but its exception was never stated." });
    if (signal === "choice") add({ kind: "decision", priority: 4, moment, title: `Choice: ${short(event.excerpt, 56)}`, text: `At ${clock(event.at)} in ${event.app} you chose a path: “${short(event.excerpt)}”. What would have made you choose the other one?`, why: "A choice was seen without the reason behind it." });
    if (gaps.length >= 2) break;
  }

  const windows = scoped.filter((event) => event.type === "window" && event.app);
  const returns = new Map();
  for (let index = 2; index < windows.length; index += 1) {
    const [before, between, current] = [windows[index - 2], windows[index - 1], windows[index]];
    if (before.app !== current.app || between.app === current.app) continue;
    const key = [current.app, between.app].sort().join(" and ");
    const entry = returns.get(key) || { count: 0, last: current };
    entry.count += 1;
    entry.last = current;
    returns.set(key, entry);
  }
  const loop = [...returns.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (loop && loop[1].count >= 2) {
    add({ kind: "decision", priority: 3, title: `The check between ${loop[0]}`, moment: { at: loop[1].last.at, app: loop[1].last.app, window: loop[1].last.window, evidence: `${loop[1].count} returns between ${loop[0]}` }, text: `You went back and forth between ${loop[0]} ${loop[1].count} times. What were you checking before you let yourself continue?`, why: "A repeated check is usually an unwritten rule." });
  }

  const lastWork = [...scoped].reverse().find((event) => event.type === "activity" && event.group === "work") || [...scoped].reverse().find((event) => event.type === "window");
  const anchor = lastWork ? { at: lastWork.at, app: lastWork.app, window: lastWork.window, evidence: `Last active surface: ${lastWork.app}` } : null;
  const where = lastWork?.app ? ` in ${lastWork.app}` : "";
  add({ kind: "guardrail", priority: 2, moment: anchor, title: "The case that was not shown", text: `Which case did not come up today${where}, where the move you made would be wrong?`, why: "The tutor must handle a case the expert never showed." });
  add({ kind: "guardrail", priority: 1, moment: anchor, title: "When to stop and ask", text: "When should a new person stop and ask you instead of deciding alone?", why: "The moment to stop and ask is rarely written down." });
  add({ kind: "decision", priority: 0, moment: anchor, title: "How finished is decided", text: "How do you know this piece of work is finished?", why: "The stopping rule was not visible on screen." });

  return gaps.sort((a, b) => b.priority - a.priority).slice(0, 3).map(({ priority, ...gap }) => gap);
}

// The teach-back is the apprentice explaining the process in its own words,
// built only from sourced decisions, so the expert can confirm or correct it.
export function buildTeachBack(map) {
  const corrections = map.debrief?.teachBack?.corrections || [];
  const steps = map.decisions.filter((item) => item.kind === "decision" && !item.id.startsWith("correction-")).slice(0, 3);
  const dropped = map.decisions.filter((item) => item.kind === "discarded").slice(0, 2);
  const guardrails = map.decisions.filter((item) => item.kind === "guardrail").slice(0, 4);
  const say = (item) => item.quote && item.quote !== item.body ? `${item.title}: “${short(item.quote, 140)}”` : `${item.title}. ${short(item.body, 140)}`;
  // One paragraph per kind of knowledge. Read aloud, the breaks become pauses.
  const parts = ["Here is how I understand your work."];
  if (steps.length) parts.push(`You decide like this. ${steps.map(say).join(" ")}`);
  if (dropped.length) parts.push(`You dropped this, and it stays dropped. ${dropped.map(say).join(" ")}`);
  if (guardrails.length) parts.push(`I stop and ask before a guardrail is crossed. ${guardrails.map(say).join(" ")}`);
  if (corrections.length) parts.push(`You corrected me. ${corrections.map((item) => `“${short(item.text, 140)}”`).join(" ")}`);
  parts.push("Is that how it works?");
  return {
    text: parts.join("\n\n"),
    generatedAt: new Date().toISOString(),
    status: "pending",
    confirmedAt: null,
    corrections,
    counts: { steps: steps.length + dropped.length, guardrails: guardrails.length },
  };
}

export function debriefProgress(debrief) {
  const gaps = debrief?.gaps || [];
  const closed = gaps.filter((gap) => gap.status !== "open").length;
  return {
    total: gaps.length,
    closed,
    current: gaps.find((gap) => gap.status === "open") || null,
    // Done means every gap was answered or set aside, and the expert said yes.
    understood: gaps.length > 0 && closed === gaps.length,
    confirmed: debrief?.teachBack?.status === "confirmed",
  };
}

export const confirmation = /^\s*(yes|yeah|yep|correct|exactly|that'?s right|that is right|that'?s how it works|that is how it works|ja|japp|precis|stämmer|det stämmer|rätt)\b/i;
