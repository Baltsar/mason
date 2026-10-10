import { fileFrom, PURPOSES, readWorkflow } from "./workflow.mjs";

// The collection: workflows people chose to hand on, one file each, in the
// folder `workflows/` of the repository. Anyone may propose one, so a file is
// let in only in the form a careful reading gives it: the figures as figures,
// tools known by name, and rules that are plain habits of work. A file that
// holds anything else, or says it in another order, is turned away, so that
// what is in the collection is exactly what Mason would show of it.

export const FILE_NAME = /^[a-z0-9][a-z0-9-]{1,60}\.json$/;
const LARGEST_BYTES = 16_000;

export const textOf = (file) => `${JSON.stringify(file, null, 2)}\n`;
// A name for the file, from whose it is and what the work was for.
export const slugOf = (file) => `${file.by} ${file.purpose}`.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "workflow";

// A workflow as it may go into the collection, with what was left out of it
// and why. Null when the text is not a workflow.
export function collectable(text) {
  const opened = readWorkflow(text);
  if (!opened) return null;
  const file = fileFrom(opened);
  return { file, name: `${slugOf(file)}.json`, text: textOf(file), dropped: opened.rules.filter((rule) => rule.held).map((rule) => ({ rule: rule.rule, why: rule.held })) };
}

// What stands in the way of this file being in the collection. Nothing, when it may be.
export function problemsOf(name, text) {
  const problems = [];
  if (!FILE_NAME.test(name)) problems.push("its name is not small letters, figures and hyphens, ending in .json");
  if (Buffer.byteLength(text) > LARGEST_BYTES) problems.push(`it is larger than ${LARGEST_BYTES} bytes`);
  const made = collectable(text);
  if (!made) return [...problems, "it is not a workflow from Mason"];
  for (const left of made.dropped) problems.push(`a rule is not one that is offered, because ${left.why}: "${left.rule.slice(0, 80)}"`);
  if (!made.file.by || made.file.by === "Someone") problems.push("it does not say whose it is");
  if (!made.file.prompts || !made.file.days) problems.push("it holds no prompts or no days: nothing was measured");
  if (!problems.length && made.text !== text) problems.push("it holds something a careful reading does not keep, or in another order (run: npm run workflows -- add <file>)");
  return problems;
}

/* The collection as a page, and as an index */

// Words from a file, set in a page: nothing in them may lay the page out.
const plain = (text) => String(text ?? "").replace(/[\\`*_{}\[\]()#+!|<>~]/g, "\\$&").replace(/\s+/g, " ").trim();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayOf = (day) => { const [year, month, date] = day.split("-").map(Number); return { year, text: `${date} ${MONTHS[month - 1] || "?"}` }; };
const span = (from, to) => from && to ? `${dayOf(from).text} to ${dayOf(to).text} ${dayOf(to).year}` : "";
const lasted = (seconds) => seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : seconds >= 600 ? `${Math.round(seconds / 60)} min` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
const short = (count) => count >= 1e9 ? `${(count / 1e9).toFixed(1)}B` : count >= 1e6 ? `${Math.round(count / 1e6)}M` : count >= 1e3 ? `${Math.round(count / 1e3)}k` : String(count);
const dash = (value) => value === undefined || value === null ? "–" : value;

function cardOf({ name, file }) {
  const agents = (file.agents || []).filter((agent) => agent.share >= 1).map((agent) => `${plain(agent.name)} ${agent.share}%`).join(", ");
  const rules = file.rules || [];
  return [
    `### ${plain(file.by)}`,
    "",
    [file.days ? `${file.days} days with agents` : "", span(file.from, file.to), file.prompts ? `${file.prompts} prompts` : ""].filter(Boolean).join(" · "),
    "",
    "| Talks to | Prompts an hour | An agent works on one | Projects a day | Tokens a day |",
    "|---|---|---|---|---|",
    `| ${agents || "–"} | ${dash(file.perHour)} | ${file.turn?.seconds ? lasted(file.turn.seconds) : "–"} | ${dash(file.parallel?.usual)} | ${file.tokens?.aDay ? short(file.tokens.aDay) : "–"} |`,
    "",
    ...(rules.length ? ["What they tell their agents, again and again:", "", ...rules.map((rule) => `- ${plain(rule.rule)}${rule.times ? ` *(${rule.times} times, ${rule.projects} projects)*` : ""}`), ""] : []),
    `[${name}](${name})`,
    "",
  ].join("\n");
}

// The page of the collection. `entries` are [{ name, file }].
export function galleryOf(entries) {
  const groups = [...PURPOSES.map((purpose) => [purpose.word, purpose.word.replace(/^./, (letter) => letter.toUpperCase())]), ["all my work", "All of the work"]];
  const sorted = [...entries].sort((a, b) => (b.file.days || 0) - (a.file.days || 0) || a.name.localeCompare(b.name));
  const sections = groups.map(([word, title]) => [title, sorted.filter((entry) => entry.file.purpose === word)]).filter(([, found]) => found.length);
  return `<!-- Written by "npm run workflows -- build" from the files in this folder. Change a file, not this page. -->

# Workflows

How people work with coding agents, measured and not told. Each one was read by [Mason](../README.md) out of the agents' own logs on its owner's Mac: who they talk to, at what pace, how long an agent works on one thing, and what they tell their agents again and again. No project, no file name and nothing that was said is in any of them.

**Try one.** Save its file, open Workflow in Mason and drop the file there (or press *Open one*). Theirs is shown beside yours, and a rule of theirs can be taken over with one press: one line where your agents read their rules, taken out again in Settings.

**Add yours.** In Mason, open Workflow, press *Share*, choose the rules that go with it and press *Add to the collection*. That copies the file and opens a form here to paste it in. Or open a pull request that adds the file to this folder. Either way it is checked the same way as a file someone opens: see [what is let in](#what-is-let-in).

${sections.map(([title, found]) => `## ${title}\n\n${found.map(cardOf).join("\n")}`).join("\n") || "Nothing here yet.\n"}
## What is let in

A file in this folder is a stranger's, and its rules are made to be put where an agent reads its instructions. So a file is let in only as a careful reading gives it:

- figures are figures, and names are cut short;
- only tools Mason knows by name are named, so a customer's site cannot ride along;
- a rule is one plain sentence about how to work: no command, no address, no path, nothing about secrets, nothing that tells an agent to set its rules aside or to stop asking, nothing about publishing, sending, deleting or paying, and no character that cannot be seen;
- the file says nothing else, and says it in one fixed order.

\`npm run workflows -- check\` in \`apprentice/\` runs that check, and it runs on every pull request. Mason runs the same reading again on your Mac when you open a file, and once more when you take a rule over. Read a rule before you press: the check is a net, not a judge.
`;
}

// The same collection for a program to read.
export const indexOf = (entries) => ({
  format: "mason.workflows",
  version: 1,
  workflows: [...entries].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, file }) => ({ file: name, by: file.by, purpose: file.purpose, days: file.days ?? null, prompts: file.prompts ?? null, perHour: file.perHour ?? null, rules: (file.rules || []).length })),
});
