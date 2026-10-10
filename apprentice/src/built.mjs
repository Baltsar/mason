// What Mason can teach its owner about their own work. Someone who builds by
// talking to agents often no longer knows how the thing is put together or why
// it was done that way. Mason does: it is in what it remembers of each project.
// So it asks one question at a time and holds the answer. Nothing is typed and
// no model is asked: a question, a press, the answer.

// The questions one project gives, each with the answer that is remembered.
// A project nothing was summarised for gives none.
export function cardsOf(project, memory) {
  if (!memory || memory.source !== "model") return [];
  const cards = [];
  const add = (question, lines) => {
    const answer = lines.filter(Boolean);
    if (answer.length) cards.push({ question, answer });
  };
  add(`How is ${project} put together?`, memory.how || []);
  add(`What did you decide in ${project}?`, memory.decided || []);
  add(`What did you build last in ${project}?`, memory.built || []);
  add(`Where did you leave ${project}?`, [memory.left_off, ...(memory.open || []).map((line) => `Open: ${line}`)]);
  add(`What do you keep telling the agents in ${project}?`, (memory.keeps_saying || []).map((item) => `${item.rule}: “${item.example}”`));
  return cards;
}

// Every project of the last three weeks that there is something to ask about,
// the one not touched for the longest first: that is the one being forgotten.
// `days` is the ledger of the long view; `memories` what is remembered of each
// project, by its name.
export function builtOf({ days = {}, memories = {}, today } = {}) {
  const last = new Map();
  for (const day of Object.keys(days).filter((key) => key <= today).sort().slice(-21)) {
    for (const name of Object.keys(days[day])) last.set(name, day);
  }
  return [...last]
    .map(([project, lastDay]) => ({ project, lastDay, about: memories[project]?.one_line || "", cards: cardsOf(project, memories[project]) }))
    .filter((item) => item.cards.length)
    .sort((a, b) => a.lastDay.localeCompare(b.lastDay) || a.project.localeCompare(b.project));
}
