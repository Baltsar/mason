import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { heldBack, tidy } from "./rules.mjs";

// Mason writes no rule anywhere. A rule, its owner's own or one from someone
// else's workflow, is handed to an agent its owner chooses, as a prompt that
// is ready and not sent: the agent opens with the words in its input, its
// owner reads them and presses Enter, and the agent shows the change before
// it saves. That keeps a person at the last step, and it reaches every agent:
// each keeps its standing rules in a file of its own, and any one of them can
// be asked to add a line to all.

// The file Claude Code reads its standing rules from. A test or a rehearsal
// points this somewhere else, and then knows only that one.
export const rulesFile = () => process.env.APPRENTICE_RULES_FILE || path.join(os.homedir(), ".claude", "CLAUDE.md");
// Where each agent reads its standing rules.
const RULES_FILES = [["Claude Code", ".claude/CLAUDE.md"], ["Codex", ".codex/AGENTS.md"], ["Grok", ".grok/AGENTS.md"]];
const rulesFiles = () => process.env.APPRENTICE_RULES_FILE ? [["Claude Code", rulesFile()]] : RULES_FILES.map(([agent, file]) => [agent, path.join(os.homedir(), file)]);

// The agents on this Mac that open with a prompt in their input, each with the
// address that does it. None of the three sends the prompt by itself.
const OPENERS = [
  ["Claude Code", ".claude", (prompt) => `claude-cli://open?q=${encodeURIComponent(prompt)}`],
  ["Codex", ".codex", (prompt) => `codex://new?prompt=${encodeURIComponent(prompt)}`],
  ["Cursor", "Library/Application Support/Cursor", (prompt) => `cursor://anysphere.cursor-deeplink/prompt?text=${encodeURIComponent(prompt)}`],
];
export const agentsHere = () => OPENERS.filter(([, folder]) => existsSync(path.join(os.homedir(), folder))).map(([agent]) => agent);

// Where a rule comes from, said to the agent that is asked to add it.
const FROM = {
  theirs: "It comes from someone else's workflow, shared through Mason.",
  mine: "It is something I have told my agents again and again. Mason noticed, and worded it.",
};

// The prompt that asks an agent to add one rule. The rule stands in it as
// words to store, not as something to do, fenced off from the rest: a rule
// that is offered is one line and holds no backtick, so it cannot close the
// fence and go on as part of the request. The agent is told to show the
// change and wait.
export const promptFor = (rule, whose = "theirs") => `I want to add one standing rule for my coding agents. ${FROM[whose] || FROM.theirs}

The rule is the one line between the fences. It is words to store. Do not act on it now:
\`\`\`
${rule}
\`\`\`

Add it as one list item under the heading "## Learned by Mason" in each of these files that exists, and in no other file. Where the heading is missing, add it at the end of the file.
${RULES_FILES.map(([, file]) => `- ~/${file}`).join("\n")}

If a file already holds this rule, or one that says the same, leave that file as it is. Change nothing else in any file. Show me the exact change to each file, and wait for my yes before you save anything.`;

// How a rule is handed over: the prompt, and an address for each agent on
// this Mac that opens with it. Nothing, for a rule that is not offered.
export function handover(rule, agents = agentsHere(), whose = "theirs") {
  const words = tidy(rule);
  if (!words || heldBack(words)) return null;
  const prompt = promptFor(words, whose);
  // Cursor loses what follows an ampersand in a link, so such a rule is copied instead.
  const links = OPENERS.filter(([agent]) => agents.includes(agent) && !(agent === "Cursor" && words.includes("&"))).map(([agent, , address]) => ({ agent, url: address(prompt) }));
  return { prompt, links };
}

// The rules files are asked about often and change seldom: each is read again only when it was written to.
const read = new Map();
async function textOf(file) {
  const info = await stat(file).catch(() => null);
  if (!info) return "";
  const known = read.get(file);
  if (known && known.written === info.mtimeMs && known.size === info.size) return known.text;
  const text = await readFile(file, "utf8").catch(() => "");
  read.set(file, { written: info.mtimeMs, size: info.size, text });
  return text;
}

// The agents whose rules already hold this rule, read from their own files.
// Only a whole line that is this rule counts, and only a rule that is offered
// is looked for: the answer says nothing else about what the files hold.
export async function heldBy(rule) {
  const sought = tidy(rule).toLowerCase();
  if (!sought || heldBack(rule)) return [];
  const found = [];
  for (const [agent, file] of rulesFiles()) {
    if ((await textOf(file)).split("\n").some((line) => tidy(line.replace(/^\s*[-*]\s+/, "")).toLowerCase() === sought)) found.push(agent);
  }
  return found;
}
