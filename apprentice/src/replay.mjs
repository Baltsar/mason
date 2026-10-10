import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readsAnswers } from "./coach.mjs";
import { buildFlow, NOT_A_TOOL, toolOf } from "./flow.mjs";
import { fingerprint } from "./redact.mjs";
import { paths } from "./store.mjs";

// A replay is a stretch of real work, laid out so that someone else can sit
// beside it: every prompt as it was said, how long the agent worked on it,
// where its owner was meanwhile, and how long the answer waited. Nothing is
// recorded for it. It is cut afterwards from what Mason keeps anyway, the way
// a clip is saved from a game that was being played: the stretch is chosen
// after it happened, and nothing exists outside this Mac until it is saved.
//
// What others get to see is the owner's to decide, line by line. Until they
// say otherwise a project is "Project A", a site that has no name of its own
// is "a website", and the home folder is "~".

// A piece of work is what is cut, not a length of time: the prompts said in
// one project with no long silence between them, from the first to the last.
// Half an hour by the clock runs across two projects and says little about
// either; a piece of work is how one thing was tackled.
const SILENCE_MS = 30 * 60_000;

// The pieces of work in these prompts, the latest first. One prompt alone is
// not a piece of work.
export function piecesOf(prompts) {
  const pieces = [];
  const open = new Map();
  for (const prompt of [...prompts].sort((a, b) => a.at - b.at)) {
    const piece = open.get(prompt.project);
    if (piece && prompt.at - piece.to <= SILENCE_MS) { piece.to = prompt.at; piece.prompts += 1; continue; }
    const fresh = { id: fingerprint(`${prompt.project}\n${prompt.at}`), project: prompt.project, from: prompt.at, to: prompt.at, prompts: 1 };
    open.set(prompt.project, fresh);
    pieces.push(fresh);
  }
  return pieces.filter((piece) => piece.prompts > 1).sort((a, b) => b.to - a.to);
}

// Less time than this in a tool is not worth a mention.
const WORTH_A_MENTION_SECONDS = 20;

const minutesOf = (seconds) => seconds < 90 ? `${Math.max(1, Math.round(seconds))} s` : `${Math.round(seconds / 60)} min`;
const clockOf = (at) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

// What was in front between two moments, the tools with the most time first.
function toolsBetween(spans, from, to) {
  const seconds = {};
  for (const span of spans) {
    const overlap = (Math.min(span.end, to) - Math.max(span.start, from)) / 1000;
    if (overlap > 0) seconds[span.tool] = (seconds[span.tool] || 0) + overlap;
  }
  return Object.entries(seconds).map(([tool, value]) => ({ tool, seconds: Math.round(value) })).sort((a, b) => b.seconds - a.seconds);
}

// The stretch from `from` to `to`, as it is before anything is hidden.
// `prompts` are [{ project, at, text }], `turns` come from the agents' logs.
export function replayOf({ events, prompts, turns, from, to }) {
  const inside = events.filter((event) => {
    const at = Date.parse(event.startedAt || event.at);
    return (event.type === "activity" || event.type === "private") && at >= from && at <= to;
  });
  const spans = inside.map((event) => {
    const start = Date.parse(event.startedAt || event.at);
    return { start, end: start + Math.min(Number(event.durationSec) || 0, 3600) * 1000, tool: toolOf(event) };
  }).filter((span) => span.tool && !NOT_A_TOOL.test(span.tool)).sort((a, b) => a.start - b.start);
  const flow = buildFlow(inside);
  const said = prompts.filter((prompt) => prompt.at >= from && prompt.at <= to).sort((a, b) => a.at - b.at);
  const lines = said.map((prompt, place) => {
    const next = said[place + 1]?.at ?? to;
    const turn = turns.find((item) => item.project === prompt.project && item.prompt === prompt.at);
    // The answer was finished before the next thing was said, or it was not.
    const done = turn?.ended && turn.done <= next ? turn.done : null;
    const back = done === null ? null : spans.find((span) => readsAnswers(span.tool) && span.end > done);
    const read = done === null ? null : Math.min(back ? Math.max(back.start, done) : next, next);
    return {
      id: fingerprint(`${prompt.project}\n${prompt.at}`),
      at: new Date(prompt.at).toISOString(),
      project: prompt.project,
      text: prompt.text,
      // How long the agent worked, where its owner was while it did and until
      // the next prompt, and how long the finished answer was left.
      workedSeconds: done === null ? null : Math.round((done - prompt.at) / 1000),
      meanwhile: toolsBetween(spans, prompt.at, next).filter((item) => !readsAnswers(item.tool) && item.seconds >= WORTH_A_MENTION_SECONDS).slice(0, 2),
      waitedSeconds: read === null ? null : Math.round((read - done) / 1000),
    };
  });
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    activeSeconds: flow.totalSeconds,
    jumps: flow.jumps,
    perHour: flow.perHour,
    longest: flow.longest ? { tool: flow.longest.tool, seconds: flow.longest.seconds } : null,
    tools: flow.tools.filter((tool) => tool.visits).slice(0, 6).map((tool) => ({ name: tool.name, seconds: tool.seconds })),
    lines,
  };
}

// The replay as others may see it: without the lines that were taken out,
// and without names unless they are to be shown.
export function shownReplay(replay, { hidden = [], names = false } = {}) {
  const out = new Set(hidden);
  const projects = [...new Set(replay.lines.map((line) => line.project))];
  const alias = new Map(projects.map((project, place) => [project, names ? project : `Project ${String.fromCharCode(65 + (place % 26))}`]));
  // A site without a name of its own is known by its address, which says where someone was.
  const tool = (name) => names || !name.includes(".") ? name : "a website";
  const merged = (tools) => {
    const seconds = new Map();
    for (const item of tools) seconds.set(tool(item.tool ?? item.name), (seconds.get(tool(item.tool ?? item.name)) || 0) + item.seconds);
    return [...seconds].map(([name, value]) => ({ name, seconds: value })).sort((a, b) => b.seconds - a.seconds);
  };
  const worded = (text) => {
    let said = String(text).replace(/\/Users\/[^/\s"'`]+/g, "~");
    if (!names) for (const project of projects) said = said.split(project).join(alias.get(project));
    return said;
  };
  return {
    ...replay,
    longest: replay.longest ? { ...replay.longest, tool: tool(replay.longest.tool) } : null,
    tools: merged(replay.tools),
    lines: replay.lines.filter((line) => !out.has(line.id)).map((line) => ({ ...line, project: alias.get(line.project), text: worded(line.text), meanwhile: merged(line.meanwhile) })).map((line) => ({ ...line, around: aroundOf(line) })),
    left: replay.lines.filter((line) => out.has(line.id)).length,
  };
}

// What happened around one prompt, as a sentence of facts.
function aroundOf(line) {
  const parts = [];
  if (line.workedSeconds !== null) parts.push(`Agent worked ${minutesOf(line.workedSeconds)}`);
  if (line.meanwhile.length) parts.push(`meanwhile in ${line.meanwhile.map((item) => `${item.name} ${minutesOf(item.seconds)}`).join(", ")}`);
  if (line.waitedSeconds !== null && line.waitedSeconds >= 30) parts.push(`answer waited ${minutesOf(line.waitedSeconds)}`);
  return parts.join(" · ");
}

const headOf = (replay) => {
  const day = new Date(replay.from).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return { day, span: `${clockOf(replay.from)}–${clockOf(replay.to)}`, minutes: Math.max(1, Math.round((Date.parse(replay.to) - Date.parse(replay.from)) / 60_000)) };
};

// The numbers of a replay with none of its words: what could be put next to
// other people's without anyone reading anyone's prompts.
export function figuresOf(replay) {
  const lengths = replay.lines.map((line) => line.text.length).sort((a, b) => a - b);
  const waits = replay.lines.map((line) => line.waitedSeconds).filter((wait) => wait !== null).sort((a, b) => a - b);
  return {
    format: "mason-replay",
    version: 1,
    minutes: headOf(replay).minutes,
    activeSeconds: replay.activeSeconds,
    prompts: replay.lines.length,
    jumps: replay.jumps,
    jumpsPerHour: replay.perHour,
    tools: replay.tools,
    promptLetters: lengths.length ? lengths[lengths.length >> 1] : 0,
    waitedSeconds: waits.length ? waits[waits.length >> 1] : null,
  };
}

// The replay as text for a chat: it is read where it is posted.
export function textOf(replay, owner = "") {
  const head = headOf(replay);
  const top = [`**How ${owner ? `${owner} worked` : "I worked"} · ${head.minutes} minutes** · ${head.day}, ${head.span}`,
    `${replay.lines.length} prompts · ${replay.jumps} jumps between tools · ${replay.tools.slice(0, 4).map((tool) => tool.name).join(", ")}`];
  const lines = replay.lines.map((line) => {
    const { around } = line;
    return `\`${clockOf(line.at)}\` **${line.project}**\n> ${line.text.replace(/\s+/g, " ")}${around ? `\n_${around}_` : ""}`;
  });
  return `${top.join("\n")}\n\n${lines.join("\n\n")}\n\n_Made with Mason · github.com/Baltsar/mason_\n`;
}

// The replay as one page that stands by itself: no script, nothing fetched.
export function pageOf(replay, owner = "") {
  const head = headOf(replay);
  const figures = [[replay.lines.length, "prompts"], [replay.jumps, "jumps between tools"], [replay.longest ? minutesOf(replay.longest.seconds) : "–", replay.longest ? `longest in ${replay.longest.tool}` : "longest in one tool"]];
  const lines = replay.lines.map((line) => {
    const { around } = line;
    return `<article><header><time>${clockOf(line.at)}</time><b>${esc(line.project)}</b></header><p>${esc(line.text)}</p>${around ? `<footer>${esc(around)}</footer>` : ""}</article>`;
  }).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>How ${esc(owner || "I")} worked · ${head.minutes} minutes</title>
<style>
  :root { --ink: #0e0d0b; --paper: #f3eee2; --muted: #a39d90; --line: #2e2b25; --panel: #171512; --lime: #d7ff42; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ink); color: var(--paper); font: 17px/1.5 Inter, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif; -webkit-font-smoothing: antialiased; }
  main { width: min(780px, 100%); margin: 0 auto; padding: 56px 22px 80px; }
  .eyebrow { color: var(--muted); font: 500 12px/1.4 ui-monospace, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; }
  h1 { margin: 10px 0 0; font-size: clamp(44px, 9vw, 84px); line-height: .94; letter-spacing: -.06em; font-weight: 720; }
  h1 em { color: var(--lime); font-style: normal; }
  .figures { display: flex; flex-wrap: wrap; gap: 26px 44px; margin: 40px 0 0; }
  .figures b { display: block; font-size: 46px; line-height: 1; letter-spacing: -.05em; }
  .figures div:first-child b { color: var(--lime); }
  .figures span, .tools { color: var(--muted); font-size: 14px; }
  .tools { margin: 26px 0 44px; padding: 0 0 30px; border-bottom: 1px solid var(--line); }
  .tools b { color: var(--paper); font-weight: 600; }
  article { margin: 0 0 16px; padding: 20px 22px 18px; border: 1px solid var(--line); border-radius: 20px; background: var(--panel); }
  article header { display: flex; align-items: baseline; gap: 12px; color: var(--muted); font: 12px/1.4 ui-monospace, Menlo, monospace; }
  article header b { color: var(--lime); font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
  article p { margin: 10px 0 0; font-size: 19px; line-height: 1.38; letter-spacing: -.012em; white-space: pre-wrap; overflow-wrap: anywhere; }
  article footer { margin: 14px 0 0; padding: 12px 0 0; border-top: 1px solid var(--line); color: var(--muted); font-size: 14px; }
  .made { margin: 44px 0 0; color: var(--muted); font-size: 14px; }
  .made a { color: var(--paper); }
</style>
</head>
<body>
<main>
  <p class="eyebrow">${esc(head.day)} · ${esc(head.span)}</p>
  <h1>How ${esc(owner || "I")} worked,<br /><em>${head.minutes} minutes.</em></h1>
  <div class="figures">${figures.map(([figure, words]) => `<div><b>${esc(figure)}</b><span>${esc(words)}</span></div>`).join("")}</div>
  <p class="tools">${replay.tools.map((tool) => `<b>${esc(tool.name)}</b> ${minutesOf(tool.seconds)}`).join(" · ")}</p>
${lines}
  <p class="made">Every prompt as it was said, cut afterwards from a stretch of real work. Nothing was recorded for it.${replay.left ? ` ${replay.left} ${replay.left === 1 ? "prompt was" : "prompts were"} left out.` : ""} Made with <a href="https://github.com/Baltsar/mason">Mason</a>.</p>
</main>
<script type="application/json" id="mason-replay">${JSON.stringify(figuresOf(replay)).replace(/</g, "\\u003c")}</script>
</body>
</html>
`;
}

// Writes the page beside the memory and says where it is. Mason posts nothing.
export async function saveReplay(page, at = Date.now()) {
  const folder = path.join(paths.data, "share");
  await mkdir(folder, { recursive: true });
  const stamp = new Date(at).toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const file = path.join(folder, `mason-replay-${stamp}.html`);
  await writeFile(file, page);
  return file;
}
