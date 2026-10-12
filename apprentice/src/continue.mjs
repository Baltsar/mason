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
//
// There are two sizes of it. All the notes are for copying, and are kept as
// a file in Mason's own folder. What goes into a link is the short of it: a
// few lines that can be read before Enter is pressed. A link to Claude Code
// starts it in a terminal, with everything in the link packed into the
// command that is shown there, so a long brief is a wall of letters before
// the agent has said a word.

// All the notes, at most. Claude Code takes no more than 5000 characters in a link.
const AT_MOST = 4400;
// The short of it, at most, and one line of it.
const SHORT_AT_MOST = 640;
const SHORT_LINE = 110;
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

// The short of it: what the project is, where it was left, what is open, and
// the last thing asked for, each in one line. `named` says whether the folder
// is said in words (an agent that is not started in it has to be told), and
// `notes` is where all the notes are kept, for an agent that wants more.
export function shortOf({ project, folder = "", memory = {}, recent = [], notes = "" } = {}, named = true) {
  const written = memory.source === "model";
  const one = (text) => line(text, SHORT_LINE);
  const said = recent.map((prompt) => one(prompt.text)).filter((text, index, all) => text && !/^# Files mentioned by the user/i.test(text) && all.indexOf(text) === index);
  // In the order they are said, each with how early it is left out when there is no room.
  const items = [
    written && [3, "It is", one(memory.plainly || memory.one_line)],
    written && [5, "I stopped at", one(memory.left_off)],
    ...(written ? (memory.open || []).slice(0, 2).map((text, index) => [index ? 1 : 4, "Still open", one(text)]) : []),
    written && [2, "Decided", one((memory.decided || [])[0])],
    ...said.slice(written ? -1 : -2).map((text, index, all) => [written ? 2 : 4 + index - all.length, "I last asked", `"${text.replace(/"/g, "'")}"`]),
  ].filter((item) => item && item[2] && item[2] !== '""');
  if (!items.length) return "";
  const write = (list) => `Picking up ${line(project, 60)} again${named && folder ? `, in ${folder}` : ""}. Notes Mason wrote from my earlier sessions, to check against the code:
${list.map(([, title, text]) => `- ${title}: ${text}`).join("\n")}
${notes ? `All the notes: ${notes}\n` : ""}Say where things stand in a few lines, and wait for me before changing anything.`;
  let kept = items;
  while (write(kept).length > SHORT_AT_MOST && kept.length > 1) {
    const least = Math.min(...kept.map(([weight]) => weight));
    kept = kept.filter((item, index) => index !== kept.findIndex(([weight]) => weight === least));
  }
  return write(kept);
}

// The brief with an address for each agent on this Mac that opens with the
// short of it ready. Claude Code is started in the project's own folder; the
// others are told where it is.
export function continueIn(given, agents) {
  const brief = briefOf(given);
  if (!brief) return null;
  const folder = /^\/(?!.*(?:^|\/)\.\.(?:\/|$))/.test(given.folder || "") ? given.folder : "";
  const short = shortOf({ ...given, folder });
  const links = linksFor(short, agents ? { agents } : {}).map((link) => link.agent === "Claude Code" && folder
    ? linksFor(shortOf({ ...given, folder }, false), { agents: ["Claude Code"], folder })[0]
    : link);
  return { ...brief, short, links };
}

// The name of the file all the notes of a project are kept in.
export const notesName = (project) => `${String(project ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project"}.md`;
