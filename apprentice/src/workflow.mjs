import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { lookBack, usualWait } from "./coach.mjs";
import { dayStart } from "./activity.mjs";
import { dayKey, daysOf } from "./days.mjs";
import { buildFlow } from "./flow.mjs";
import { askModel } from "./llm.mjs";
import { fingerprint, redact } from "./redact.mjs";
import { handover, heldBy, promptFor } from "./handover.mjs";
import { heldBack, nameFrom, tidy } from "./rules.mjs";

export { handover, heldBack, heldBy, promptFor };
import { atomicJson, paths, readJson } from "./store.mjs";

// A workflow is how someone works with agents, measured and not told: which
// agents, at what pace, how a piece of work runs from its first prompt to its
// last, and what the agents were told again and again. It is read out of the
// agents' own logs, so it is there the first day, for the weeks before Mason
// was installed. What the screen adds (the tools around the agents, how long
// an answer waits) is there only for the days Mason was watching.
//
// It is made to be handed to someone else. So it holds no name of a project,
// no file, nothing that was said: figures, the names of well-known tools, and
// the rules its owner chooses to put in it.

export const WORKFLOW_DAYS = 30;
// What the work was for. A short list that does not depend on any tool, so
// that two people's workflows for the same thing can be laid side by side.
export const PURPOSES = [
  { key: "build", word: "building software" },
  { key: "design", word: "design" },
  { key: "content", word: "writing and video" },
  { key: "research", word: "research" },
  { key: "market", word: "going to market" },
];
const PURPOSE_KEYS = new Set(PURPOSES.map((purpose) => purpose.key));
// Less work than this in a project says too little about what it was for.
const WORTH_PLACING_MINUTES = 30;
// Less work than this for one purpose is not a workflow of its own.
const WORTH_A_CARD_MINUTES = 120;
// A silence this long between two prompts in a project is a new piece of work.
const SILENCE_MS = 30 * 60_000;
// The agents' logs keep the beginning of what was said. A count of words at
// this length or above means "at least".
const WORDS_KEPT = 80;
const TOOLS_SHOWN = 6;

// What a tool is for. Only tools on this list are named in a workflow: a tool
// that is not known here could be a customer's site, and is counted as "other".
const ROLES = [
  ["coding agent", /^(claude|claude code|codex|cursor|windsurf|grok build|grok bot|cline|devin|replit|lovable|bolt|v0)$/i],
  ["terminal", /^(terminal|iterm2?|warp|ghostty|kitty|alacritty)$/i],
  ["editor", /^(visual studio code|code|zed|xcode|sublime text|intellij idea|webstorm|neovim|vim)$/i],
  ["chat with a model", /^(chatgpt|gemini|perplexity|grok|copilot|mistral|deepseek|notebooklm)$/i],
  ["design", /^(figma|pencil|sketch|framer|canva|blender|photoshop|illustrator|after effects|premiere pro|final cut pro|davinci resolve|capcut|affinity designer)$/i],
  ["browser", /^(comet|safari|google chrome|chrome|arc|firefox|brave browser|brave|microsoft edge|dia)$/i],
  ["code hosting", /^(github|gitlab|vercel|supabase|netlify|cloudflare)$/i],
  ["notes", /^(notion|obsidian|notes|anteckningar|linear|google docs|docs|pages)$/i],
  ["chat with people", /^(discord|slack|telegram|whatsapp|messages|meddelanden|microsoft teams|signal)$/i],
  ["mail", /^(gmail|mail|outlook|superhuman)$/i],
  ["social", /^(x|twitter|linkedin|youtube|reddit|instagram|tiktok|threads|bluesky|facebook)$/i],
];
export const roleOf = (tool) => {
  const name = String(tool ?? "").replace(/[‎‏]/g, "").trim();
  return ROLES.find(([, pattern]) => pattern.test(name))?.[0] || null;
};

const middle = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : null;
};
const share = (part, whole) => whole ? Math.round((part / whole) * 100) : 0;
const wordsIn = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;

// What the agents' logs say about how these projects were worked on between
// two moments. `projects` are as the index holds them: prompts, turns, the
// minutes an agent was at work, and the sessions handed from agent to agent.
export function cardOf(projects, { from, to }) {
  const inside = (at) => at >= from && at <= to;
  // A minute is one minute however many agents were at work in it.
  const busy = new Map();
  for (const project of projects) for (const minute of project.minutes) if (inside(minute * 60_000)) busy.set(minute, (busy.get(minute) || 0) + 1);
  const minutes = busy.size;
  const worked = daysOf(projects.map((project) => ({ ...project, minutes: [...project.minutes].filter((minute) => inside(minute * 60_000)), prompts: project.prompts.filter((prompt) => inside(prompt.at)) })), from);

  const said = projects.flatMap((project) => project.prompts.filter((prompt) => inside(prompt.at)).map((prompt) => ({ ...prompt, project: project.name }))).sort((a, b) => a.at - b.at);
  const byAgent = {};
  for (const prompt of said) byAgent[prompt.agent || "Claude Code"] = (byAgent[prompt.agent || "Claude Code"] || 0) + 1;
  const handed = {};
  for (const project of projects) for (const [agent, sessions] of Object.entries(project.handed || {})) handed[agent] = (handed[agent] || 0) + sessions;

  // A piece of work: what was said in one project with no long silence in it.
  const last = new Map();
  const pieces = [];
  const openers = [];
  const followers = [];
  for (const prompt of said) {
    const piece = last.get(prompt.project);
    if (piece && prompt.at - piece.to <= SILENCE_MS) { piece.to = prompt.at; piece.prompts += 1; followers.push(wordsIn(prompt.text)); continue; }
    const fresh = { from: prompt.at, to: prompt.at, prompts: 1, opener: wordsIn(prompt.text) };
    last.set(prompt.project, fresh);
    pieces.push(fresh);
  }
  // One prompt alone is not a piece of work.
  const real = pieces.filter((piece) => piece.prompts > 1);
  for (const piece of real) openers.push(piece.opener);

  // How long an agent worked on one thing that was asked for, start to finish.
  const turns = projects.flatMap((project) => project.turns).filter((turn) => turn.ended && inside(turn.prompt)).map((turn) => (turn.done - turn.prompt) / 1000).filter((seconds) => seconds > 0).sort((a, b) => a - b);

  // What the agents took, by their own count: all of it, and the part they wrote.
  const taken = { all: 0, written: 0 };
  for (const project of projects) for (const [day, spent] of project.spent || []) {
    if (day < dayStart(from) || day > to) continue;
    taken.all += spent.fresh + spent.cached + spent.written;
    taken.written += spent.written;
  }
  const days = Object.keys(worked).length;

  return {
    days,
    minutes,
    tokens: taken.all ? { ...taken, aDay: Math.round(taken.all / Math.max(1, days)) } : null,
    projects: projects.filter((project) => [...project.minutes].some((minute) => inside(minute * 60_000))).length,
    prompts: said.length,
    perHour: minutes >= 60 ? Math.round(said.length / (minutes / 60)) : null,
    // An agent that was said a word to and no more is not one of the agents worked with.
    agents: Object.entries(byAgent).sort((a, b) => b[1] - a[1]).map(([name, prompts]) => ({ name, prompts, share: share(prompts, said.length) })).filter((agent) => agent.share >= 1),
    handed: Object.entries(handed).sort((a, b) => b[1] - a[1]).map(([name, sessions]) => ({ name, sessions })),
    // How many projects a day of work was spread over, and how much of the
    // time more than one of them had an agent at work.
    parallel: { usual: middle(Object.values(worked).map((day) => Object.keys(day).length)), share: share([...busy.values()].filter((count) => count > 1).length, minutes) },
    turn: turns.length >= 8 ? { seconds: Math.round(middle(turns)), long: Math.round(turns[Math.floor(turns.length * .9)]), count: turns.length } : null,
    piece: real.length >= 4 ? {
      count: real.length,
      prompts: middle(real.map((item) => item.prompts)),
      minutes: Math.max(1, Math.round(middle(real.map((item) => item.to - item.from)) / 60_000)),
      opener: Math.min(WORDS_KEPT, middle(openers)),
      follower: Math.min(WORDS_KEPT, middle(followers)),
      atLeast: middle(openers) >= WORDS_KEPT,
    } : null,
  };
}

// What the screen adds, for the days Mason was watching: the tools the work
// went through, by what each is for, and what happened around a prompt.
// `mine` says whether a moment on screen belongs to this workflow.
export function screenOf(events, { projectOf = (event) => event.project || null, turns = [], mine = () => true, now = Date.now() } = {}) {
  const watched = events.filter((event) => event.type === "activity" || event.type === "private");
  if (!watched.length) return null;
  const own = watched.filter(mine);
  const flow = buildFlow(own);
  if (flow.totalSeconds < 3600) return null;
  const seconds = {};
  for (const tool of flow.tools) {
    const role = roleOf(tool.name);
    const key = role ? tool.name.replace(/[‎‏]/g, "").trim() : "other";
    seconds[key] = { role: role || "other", seconds: (seconds[key]?.seconds || 0) + tool.seconds };
  }
  const tools = Object.entries(seconds).filter(([name]) => name !== "other").map(([name, tool]) => ({ name, role: tool.role, share: share(tool.seconds, flow.totalSeconds) })).filter((tool) => tool.share >= 1).sort((a, b) => b.share - a.share);
  const byDay = new Map();
  for (const event of watched) {
    const day = dayKey(Date.parse(event.startedAt || event.at));
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(event);
  }
  const looked = lookBack([...byDay].sort((a, b) => a[0].localeCompare(b[0])).map(([day, ofDay]) => ({ day, events: ofDay })), { projectOf, turns });
  const wait = usualWait(watched, { projectOf, turns, now });
  return {
    // The days this work was on the screen, not every day that was watched.
    days: new Set(own.map((event) => dayKey(Date.parse(event.startedAt || event.at)))).size,
    hours: Math.round(flow.totalSeconds / 3600),
    tools: tools.slice(0, TOOLS_SHOWN),
    other: share(seconds.other?.seconds || 0, flow.totalSeconds),
    perHour: flow.perHour,
    // After how many of the prompts their owner was somewhere else within a minute.
    left: looked && looked.prompts >= 10 ? looked.left.share : null,
    waitSeconds: wait ? Math.round(wait / 1000) : null,
  };
}

/* What each project was for */

const file = () => path.join(paths.data, "workflow.json");
const SYSTEM = `You are given projects one person worked on with coding agents. Each numbered line says what one project is, in a sentence or in a few things its owner asked for.

Say for each project what the work in it was for. Choose exactly one:
- "build": making software work: an app, a site, an API, a tool, a script, a game.
- "design": how something looks or moves: a brand, a layout, a design system, an illustration, 3D.
- "content": making something to be read or watched: texts, posts, a film, a presentation, a podcast.
- "research": finding out: an analysis, a comparison, reading up, working with data to answer a question.
- "market": getting something in front of people: a launch, a landing page for a product, outreach, sales, a pitch.

When a project is mostly one and a little of another, choose the one most of the work went to. When a line says too little to tell, use "unknown".

Reply with JSON only, no code fence: {"projects": [{"line": 1, "purpose": "build"}]}`;

let placing = null;

// What each project was for: asked of the model once for a project and kept
// until what the project is said to be changes. `known` are [{ name, about }].
// With no model nothing is placed, and there is one workflow for all the work.
export function placeProjects(known) {
  // One at a time: a second list waits for the first, and is then asked about itself.
  const next = (placing || Promise.resolve()).catch(() => {}).then(async () => {
    const store = { placed: {}, ...(await readJson(file(), {})) };
    const asked = known.filter((project) => project.about && store.placed[project.name]?.basis !== fingerprint(project.about));
    if (asked.length) {
      const reply = await askModel(SYSTEM, asked.map((project, index) => `${index + 1}. ${project.about}`).join("\n"), { purpose: "purposes" });
      for (const item of Array.isArray(reply?.projects) ? reply.projects : []) {
        const project = asked[Number(item?.line) - 1];
        if (project) store.placed[project.name] = { purpose: PURPOSE_KEYS.has(item.purpose) ? item.purpose : null, basis: fingerprint(project.about) };
      }
      if (reply) await atomicJson(file(), store);
    }
    return Object.fromEntries(known.map((project) => [project.name, store.placed[project.name]?.purpose || null]));
  });
  placing = next;
  return next;
}

const short = (text, max) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// What is said about a project when it is placed: what Mason remembers it to
// be, or, of a project it holds no memory of, the first things asked for in it.
export const aboutOf = (project, memory) => memory?.one_line
  ? short(`${memory.one_line}. ${(memory.built || []).slice(0, 2).join(". ")}`, 320)
  : short(project.prompts.slice(0, 3).map((prompt) => short(prompt.text, 140)).join(" / "), 420);

/* The workflow, for the window */

// The rules a workflow can carry: what its owner told the agents again and
// again, as Mason worded it, with how often and in how many projects.
function rulesFor(suggestions, names) {
  const open = (suggestions?.open || []).filter((proposal) => !names || (proposal.evidence || []).some((item) => names.has(item.project)));
  const written = names ? [] : suggestions?.applied || [];
  return [
    ...written.map((rule) => ({ id: rule.id, rule: rule.rule, written: true })),
    ...open.map((proposal) => ({ id: proposal.id, rule: proposal.rule, projects: proposal.projects, times: proposal.times, written: false })),
  ].sort((a, b) => (b.times || 0) - (a.times || 0));
}

// Every workflow there is enough work for: one for all of it, and one for
// each purpose that got at least a couple of hours.
export async function workflowPayload({ index, events, memories = {}, suggestions = null, owner = "", now = Date.now(), from = now - WORKFLOW_DAYS * 86_400_000, place = placeProjects }) {
  const minutesIn = (project) => [...project.minutes].filter((minute) => minute * 60_000 >= from).length;
  const active = index.list.filter((project) => minutesIn(project) > 0);
  const placed = await place(active.filter((project) => minutesIn(project) >= WORTH_PLACING_MINUTES).map((project) => ({ name: project.name, about: aboutOf(project, memories[project.name]) })).filter((project) => project.about));
  const turns = index.turns();
  const card = (key, projects) => {
    const names = key === "all" ? null : new Set(projects.map((project) => project.name));
    return {
      purpose: key,
      ...cardOf(projects, { from, to: now }),
      screen: screenOf(events, { projectOf: (event) => index.of(event), turns: names ? turns.filter((turn) => names.has(turn.project)) : turns, mine: names ? (event) => names.has(index.of(event)) : () => true, now }),
      rules: rulesFor(suggestions, names),
    };
  };
  const cards = [card("all", active)];
  for (const purpose of PURPOSES) {
    const projects = active.filter((project) => placed[project.name] === purpose.key);
    const made = projects.length ? card(purpose.key, projects) : null;
    if (made && made.minutes >= WORTH_A_CARD_MINUTES) cards.push({ ...made, names: projects.map((project) => project.name) });
  }
  return { owner, from: dayKey(from), to: dayKey(now), days: WORKFLOW_DAYS, purposes: PURPOSES, cards };
}

/* The workflow, as a file to hand to someone */

// What leaves with a workflow: the figures, the tools by what they are for,
// and the rules that were chosen. `rules` are the ids its owner left in.
export function fileOf(payload, purpose, rules = []) {
  const card = payload.cards.find((item) => item.purpose === purpose);
  if (!card) return null;
  const chosen = new Set(rules);
  const { purpose: key, names, rules: all, screen, ...figures } = card;
  return {
    format: "mason.workflow",
    version: 1,
    by: payload.owner,
    purpose: PURPOSES.find((item) => item.key === purpose)?.word || "all my work",
    from: payload.from,
    to: payload.to,
    ...figures,
    screen,
    rules: all.filter((rule) => chosen.has(rule.id)).map(({ rule, projects, times }) => ({ rule, ...(times ? { projects, times } : {}) })),
  };
}

// Writes the workflow beside the pictures that are shared, and says where.
export async function saveWorkflow(workflow, label = workflow.purpose) {
  const folder = path.join(paths.data, "share");
  await mkdir(folder, { recursive: true });
  const name = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all";
  const target = path.join(folder, `mason-workflow-${name}.json`);
  await writeFile(target, `${JSON.stringify(workflow, null, 2)}\n`);
  return target;
}

/* Someone else's workflow, opened here */

// A workflow that is opened was written by a stranger, and its rules are made
// to be put where every agent on this Mac reads them. So nothing in the file
// is taken as it stands. Figures are read as figures, names are cut short,
// and a rule is offered only when it is one plain sentence about how to work:
// no command, no address, no path, nothing about secrets, nothing that tells
// an agent to disregard what it was told, and nothing that takes away the
// question before something is published, sent, deleted or paid for. What is
// held back is still shown, with the reason, and its owner reads every rule
// before pressing.
const RULES_AT_MOST = 12;

// Only a number, or a number written out, is a figure: anything else in its place is nothing.
const figure = (value, most = 1e12) => (typeof value === "number" || (typeof value === "string" && value.trim())) && Number.isFinite(Number(value)) && Number(value) >= 0 ? Math.min(most, Math.round(Number(value))) : null;
// A name of a tool, to be looked up among the tools known here and shown only when it is one.
const named = (value, most) => redact(tidy(value).replace(/[<>]/g, " "), most);

// A workflow file as it may be shown here, or null when it is not one.
// `text` is what the file holds.
export function readWorkflow(text) {
  let raw;
  try { raw = typeof text === "string" ? JSON.parse(text) : text; } catch { return null; }
  if (!raw || typeof raw !== "object" || raw.format !== "mason.workflow" || raw.version !== 1) return null;
  const list = (value, most) => (Array.isArray(value) ? value : []).slice(0, most).filter((item) => item && typeof item === "object");
  const purpose = PURPOSES.find((item) => item.word === raw.purpose);
  const day = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  const screen = raw.screen && typeof raw.screen === "object" ? raw.screen : null;
  return {
    by: nameFrom(raw.by) || "Someone",
    purpose: purpose?.key || "all",
    from: day(raw.from),
    to: day(raw.to),
    days: figure(raw.days, 366),
    minutes: figure(raw.minutes),
    projects: figure(raw.projects, 10_000),
    prompts: figure(raw.prompts),
    perHour: figure(raw.perHour, 10_000),
    tokens: raw.tokens && typeof raw.tokens === "object" ? { all: figure(raw.tokens.all, 1e15), written: figure(raw.tokens.written, 1e15), aDay: figure(raw.tokens.aDay, 1e15) } : null,
    // An agent is named only when it is one known here, as a tool is.
    agents: list(raw.agents, 6).map((agent) => ({ name: named(agent.name, 30), prompts: figure(agent.prompts), share: figure(agent.share, 100) })).filter((agent) => roleOf(agent.name)),
    handed: list(raw.handed, 6).map((agent) => ({ name: named(agent.name, 30), sessions: figure(agent.sessions) })).filter((agent) => roleOf(agent.name)),
    parallel: { usual: figure(raw.parallel?.usual, 1000), share: figure(raw.parallel?.share, 100) },
    turn: raw.turn && typeof raw.turn === "object" ? { seconds: figure(raw.turn.seconds), long: figure(raw.turn.long), count: figure(raw.turn.count) } : null,
    piece: raw.piece && typeof raw.piece === "object" ? { count: figure(raw.piece.count), prompts: figure(raw.piece.prompts, 10_000), minutes: figure(raw.piece.minutes), opener: figure(raw.piece.opener, 10_000), follower: figure(raw.piece.follower, 10_000), atLeast: raw.piece.atLeast === true } : null,
    // Only tools known here are named: a name in a file could be anything.
    screen: screen ? { days: figure(screen.days, 366), hours: figure(screen.hours), other: figure(screen.other, 100), perHour: figure(screen.perHour, 10_000), waitSeconds: figure(screen.waitSeconds), left: figure(screen.left, 100), tools: list(screen.tools, 8).map((tool) => ({ name: named(tool.name, 30), role: roleOf(named(tool.name, 30)), share: figure(tool.share, 100) })).filter((tool) => tool.role) } : null,
    rules: list(raw.rules, RULES_AT_MOST).map((item) => {
      // Shown, checked and handed on in one form: what is read is what is checked.
      const said = typeof item.rule === "string" ? item.rule.slice(0, 600) : "";
      return { rule: tidy(said).slice(0, 400), times: figure(item.times, 100_000), projects: figure(item.projects, 10_000), held: heldBack(said) };
    }).filter((item) => item.rule),
  };
}

// A workflow that was read with care, as a file again: only what the reading
// kept, in one fixed order, and without the rules that were held back. This is
// the form a workflow has in the collection, so that a file there holds
// nothing a reader here would not show.
export function fileFrom(opened) {
  const kept = (value) => {
    if (Array.isArray(value)) return value.map(kept);
    if (!value || typeof value !== "object") return value;
    const entries = Object.entries(value).map(([key, inner]) => [key, kept(inner)]).filter(([, inner]) => inner !== null && inner !== undefined && !(typeof inner === "object" && !Array.isArray(inner) && !Object.keys(inner).length));
    return Object.fromEntries(entries);
  };
  const { by, purpose, from, to, days, minutes, projects, prompts, perHour, tokens, agents, handed, parallel, turn, piece, screen, rules } = opened;
  return kept({
    format: "mason.workflow",
    version: 1,
    by,
    purpose: PURPOSES.find((item) => item.key === purpose)?.word || "all my work",
    from, to, days, minutes, projects, prompts, perHour, tokens, agents, handed, parallel, turn,
    piece: piece && { ...piece, atLeast: piece.atLeast || null },
    screen,
    rules: rules.filter((rule) => !rule.held).map(({ rule, projects: inProjects, times }) => ({ rule, projects: inProjects, times })),
  });
}
