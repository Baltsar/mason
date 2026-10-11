import { fingerprint } from "./redact.mjs";

// A quiz about one's own projects. Reading an answer does not make it stay;
// picking it out from among others that could be true does. Each question has
// one right answer and up to three wrong ones of the same kind.
//
// The wrong answers come from two places, and neither costs a call of its
// own. The model that writes a project's memory also writes a few questions
// of fact with believable wrong answers (where it runs, what it is written
// in). And what is true of the other projects is a wrong answer here: their
// one-line descriptions, their parts, where they were left.

const AT_MOST_WRONG = 3;
// With fewer wrong answers than this there is nothing to choose between.
const AT_LEAST_WRONG = 2;

const same = (text) => String(text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const mixed = (items, salt) => [...items].sort((a, b) => fingerprint(`${salt}\n${a}`).localeCompare(fingerprint(`${salt}\n${b}`)));

// The questions one project gives. `others` is what is remembered of every
// project, by name; `day` changes which wrong answers are drawn and the order
// they stand in, so that a position is never what is learned.
export function quizOf(project, memory, others = {}, day = "") {
  if (!memory || memory.source !== "model") return [];
  const rest = Object.entries(others).filter(([name, other]) => name !== project && other?.source === "model").map(([, other]) => other);
  const questions = [];
  const add = (kind, question, right, wrong, why = "") => {
    if (!right) return;
    const id = fingerprint(`${project}\n${question}`);
    const seen = new Set([same(right)]);
    const others = [];
    for (const text of wrong) {
      if (!text || seen.has(same(text))) continue;
      seen.add(same(text));
      others.push(text);
    }
    if (others.length < AT_LEAST_WRONG) return;
    const options = mixed([right, ...mixed(others, `${id}${day}`).slice(0, AT_MOST_WRONG)], `${day}${id}`);
    questions.push({ id, kind, project, question, options, right: options.indexOf(right), why: why && same(why) !== same(right) ? why : "" });
  };
  const said = (other) => other.plainly || other.one_line;
  const parts = (other) => (other.parts || []).filter((part) => part?.name && part?.does);

  add("what", `Which one is ${project}?`, said(memory), rest.map(said));
  for (const fact of memory.quiz || []) add("fact", fact.ask, fact.right, fact.wrong || [], fact.why);
  for (const part of parts(memory)) {
    // The other parts of the same project first: telling those apart is knowing how it works.
    const wrong = [...parts(memory).filter((other) => other !== part), ...rest.flatMap(parts)].map((other) => other.does);
    add("part", `What does “${part.name}” do?`, part.does, wrong, part.like ? `${part.name} is ${part.like}.` : "");
  }
  add("left", `Where did you leave ${project}?`, memory.headline, rest.map((other) => other.headline), memory.left_off);
  return questions;
}
