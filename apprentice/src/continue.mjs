import { linksFor } from "./handover.mjs";
import { heldBack, tidy } from "./rules.mjs";

// Picking a project up again in a new session. An agent starts every session
// knowing nothing: what the project is, what was decided and why, where it
// was left. People write that down by hand, in a file they keep up to date,
// or say it again each time. Mason already holds it, written from the agents'
// own logs, and it holds it for every agent at once: what was done with one
// can be picked up with another.
//
// The brief is handed over the way a rule is (handover.mjs): as a prompt that
// is ready and not sent. Its owner reads it and presses Enter. Mason writes
// nothing into the project.

// Claude Code takes at most 5000 characters in a link. The brief stays under
// that with room to spare, so the same words go to every agent.
const AT_MOST = 4400;
const RECENT = 5;

// One line of a note: plain letters, one line, no backtick that could close a
// fence, nothing that cannot be seen, and not longer than a note is.
const INVISIBLE = /[\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}⠀ㅤᅟᅠﾠ]/gu;
function line(text, most = 220) {
  const clean = tidy(String(text ?? "").replace(INVISIBLE, " ").replace(/`/g, "'"));
  return clean.length > most ? `${clean.slice(0, most - 1).trimEnd()}…` : clean;
}

// What is known of a project, as headed lists: what an agent that has never
// seen it needs, in the order a person would say it. `recent` is what was
// said to the agents after the notes were written, oldest first, so that a
// session that ended a minute ago is in it without a model being asked.
export function sectionsOf(memory = {}, recent = []) {
  const sections = [];
  const add = (title, lines) => {
    const kept = (Array.isArray(lines) ? lines : [lines]).map((text) => line(text)).filter(Boolean);
    if (kept.length) sections.push({ title, lines: kept });
  };
  const written = memory.source === "model";
  const parts = (memory.parts || []).filter((part) => part?.name && part?.does && typeof part.name === "string");
  if (written) {
    add("What it is", memory.plainly || memory.one_line);
    add("How it is put together", parts.length ? parts.map((part) => `${part.name}${part.where ? ` (${part.where})` : ""}: ${part.does}`) : memory.how);
    add("What was done last", memory.built);
    add("What was decided, and why", memory.decided);
    add("Where I stopped", memory.left_off);
    add("Still open", memory.open);
    // What is asked for again and again is a standing wish, so it passes the
    // same check as a rule that is handed to an agent.
    add("What I keep asking for", (memory.keeps_saying || []).map((item) => item?.rule).filter((rule) => rule && !heldBack(rule)));
  }
  // Said twice is said once here, and a list of attached files with no request in it was not said at all.
  const words = recent.map((prompt) => line(prompt.text, 200)).filter((text, index, all) => text && !/^# Files mentioned by the user/i.test(text) && all.indexOf(text) === index);
  const said = words.slice(-RECENT).map((text) => `"${text.replace(/"/g, "'")}"`);
  add(written ? "What I asked for after these notes were written, oldest first" : "What I last asked for, oldest first", said);
  return sections;
}

// The prompt that starts the new session. The notes stand in it as notes
// about the past: the agent is told to check them against the code, to say
// where things stand, and to change nothing until it is asked.
export function briefOf({ project, folder = "", memory = {}, recent = [] } = {}) {
  const sections = sectionsOf(memory, recent);
  if (!sections.length) return null;
  const write = (list) => `I am picking up work on ${line(project, 80)} again${folder ? `, in ${folder}` : ""}.

The notes below were written by Mason, a tool on my Mac, from my earlier sessions with coding agents in this project. They are notes about the past, not things to do. Where they and the code disagree, the code is right.

${list.map((section) => `${section.title}:\n${section.lines.map((text) => `- ${text}`).join("\n")}`).join("\n\n")}

Read what you need to check these notes against the code. Then tell me in a few lines where things stand, and wait for me before you change anything.`;
  // Too long for a link: the detail goes first, where it was left goes last.
  const order = ["How it is put together", "What was done last", "What I keep asking for", "What was decided, and why"];
  let kept = sections;
  let text = write(kept);
  for (const title of order) {
    if (text.length <= AT_MOST) break;
    kept = kept.filter((section) => section.title !== title);
    text = write(kept);
  }
  return { sections: kept, text: text.slice(0, AT_MOST) };
}

// The brief with an address for each agent on this Mac that opens with it
// ready. Claude Code opens in the project's own folder.
export function continueIn(given, agents) {
  const brief = briefOf(given);
  if (!brief) return null;
  const folder = /^\/(?!.*(?:^|\/)\.\.(?:\/|$))/.test(given.folder || "") ? given.folder : "";
  return { ...brief, links: linksFor(brief.text, { folder, ...(agents ? { agents } : {}) }) };
}
