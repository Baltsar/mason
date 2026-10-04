import { randomUUID } from "node:crypto";

const rejectedSurface = /\b(demo\/index\.html|faktura(?:skärm|demo|ui|prototyp)|invoice(?: screen| demo| ui| prototype)?|sabine|lena)\b/i;
const forwardAction = /\b(bygg|putsa|iterera|förbättra|fortsätt|vidare|skicka|publicera|radera|polish|ship|implementera|lägg till|build|iterate|improve|continue|implement|add|send|submit|publish|deploy|release|delete|remove|reuse|skip|record|store)\b/i;

const STOP = new Set(`the a an and or but for with without from into onto over under about this that these those then than have has had
will would should could must never always not what when where which who why how you your his her its our their they them there here just only
also very more most some any each every been being was were are is it in on at to of as by be do does did done if so no yes can may might we he
she me my us use make made get got need want like new next first last own same real work apprentice gustaf every before after because
det den de att och eller men för med utan från på av är var ska skulle kan måste inte en ett som om så vi jag han hon du din ditt här där bara`.split(/\s+/));

// Words that mean the same move. A new hire rarely repeats the expert's verb.
const SYNONYMS = [
  ["ship", "deploy", "release", "publish", "push", "submit", "send", "launch", "skicka", "publicera"],
  ["build", "implement", "create", "add", "bygg", "bygga", "implementera"],
  ["delete", "remove", "drop", "discard", "erase", "radera"],
  ["skip", "bypass", "ignore", "omit"],
  ["record", "film", "video", "screenshot", "screencast"],
  ["question", "ask", "interrupt", "fråga"],
  ["prototype", "demo", "mockup", "prototyp"],
  ["invoice", "faktura"],
  ["polish", "iterate", "improve", "refine", "putsa", "iterera"],
  ["private", "secret", "password", "personal", "privat"],
];

const stem = (word) => {
  const cut = word.length > 4 ? word.replace(/(ing|ed|es|s)$/, "") : word;
  return cut.length > 4 ? cut.replace(/e$/, "") : cut;
};
const canonical = new Map();
for (const group of SYNONYMS) for (const word of group) canonical.set(stem(word), stem(group[0]));

// Canonical term -> the word as it was written, so a match can be shown back.
export function terms(text) {
  const found = new Map();
  for (const raw of String(text ?? "").toLowerCase().split(/[^a-z0-9åäö]+/)) {
    if (raw.length < 3 || STOP.has(raw)) continue;
    const stemmed = stem(raw);
    const key = canonical.get(stemmed) || stemmed;
    if (!found.has(key)) found.set(key, raw);
  }
  return found;
}

const rulesOf = (map) => (map.decisions || []).filter((item) => item.kind === "guardrail" || item.kind === "discarded");
const ruleTerms = (item) => terms(`${item.title} ${item.body} ${item.quote || ""} ${item.moment?.evidence || ""}`);

function stopFor(item, prompt, matched, voice) {
  const quote = item.quote || item.body;
  const expert = voice === "tutor" ? "Gustaf would stop here. He said:" : "Stop. You said:";
  const ending = voice === "tutor" ? "Why do you think he draws the line there?" : "Change the object before sending this prompt.";
  return {
    id: randomUUID(),
    kind: "guardrail-stop",
    text: `${expert} “${quote}” ${item.title}. ${ending}`,
    evidence: prompt.slice(0, 220),
    guardrailId: item.id,
    guardrailTitle: item.title,
    quote,
    matched,
    moment: item.moment || null,
    source: item.source,
    at: new Date().toISOString(),
  };
}

// Live work is interrupted only on a strong match. A decision handed over for
// review in Teach is checked against every learned guardrail.
export function catchGuardrail(prompt, map, { live = true, voice = "self" } = {}) {
  const rules = rulesOf(map);
  if (rejectedSurface.test(prompt) && forwardAction.test(prompt)) {
    const rule = rules.find((item) => item.id === "d1") || rules.find((item) => item.kind === "discarded");
    if (rule) return stopFor(rule, prompt, ["rejected surface"], voice);
  }
  if (live && !forwardAction.test(prompt)) return null;
  const said = terms(prompt);
  let best = null;
  for (const item of rules) {
    const matched = [...ruleTerms(item).keys()].filter((term) => said.has(term)).map((term) => said.get(term));
    if (matched.length >= (live ? 3 : 2) && (!best || matched.length > best.matched.length)) best = { item, matched };
  }
  return best ? stopFor(best.item, prompt, best.matched, voice) : null;
}

export function reviewDecision(prompt, map) {
  return { intervention: catchGuardrail(prompt, map, { live: false, voice: "tutor" }), checked: rulesOf(map).length };
}

// What the new hire was stopped on, and what they got right on the second try.
export function mastery(map, events) {
  const stopped = new Set();
  const mastered = new Set();
  let stops = 0;
  let passes = 0;
  for (const event of events) {
    if (event.type === "teach-stop") { stops += 1; stopped.add(event.guardrailId); }
    if (event.type === "teach-pass") { passes += 1; if (event.afterStop) mastered.add(event.afterStop); }
  }
  const rules = rulesOf(map);
  return {
    stops,
    passes,
    guardrails: rules.length,
    items: rules.map((item) => ({
      id: item.id,
      title: item.title,
      state: mastered.has(item.id) ? "mastered" : stopped.has(item.id) ? "practice" : "untested",
    })),
  };
}
