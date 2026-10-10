import { canDictate, dictate } from "/voice.js";
import { key, keyed, withKey } from "/key.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const native = window.webkit?.messageHandlers?.apprentice;

const VIEWS = ["today", "flow", "days", "workflow", "built", "more", "find", "recap", "agents", "settings"];
// Names a view once had, or that led to a page that is gone.
const LEGACY = { now: "today", capture: "today", mcp: "agents", map: "more", teach: "more" };
const TONES = { work: "var(--lime)", social: "var(--red)", other: "var(--grey)" };
const TOOLS = [
  ["what_happened_last", "What happened last?"],
  ["what_did_you_learn", "What did you learn?"],
  ["what_are_you_unsure_about", "What are you unsure about?"],
  ["how_was_the_day", "How was the day?"],
  ["how_was_it_built", "How was it built?"],
  ["guardrails_for_agents", "Guardrails an agent can load"],
];

let snapshot;
// The look of the window: the dark one, or liquid glass. An address can ask
// for one, and for a desktop to lie behind it, to look at it in a browser.
const asked = new URLSearchParams(location.search);
if (asked.get("wall")) document.documentElement.dataset.wall = asked.get("wall");
function applyLook() {
  const look = asked.get("look") ?? snapshot?.look ?? "";
  if (look) document.documentElement.dataset.look = look; else delete document.documentElement.dataset.look;
}
applyLook();
let view = "today";
// Which line of each result is pressed open.
const drill = { today: null, flow: null, workflow: null };
let listening = null;
let stream = null;
// The project whose recap is being read aloud right now, if any.
let playing = null;
let todayPlaying = false;
let airTimer = null;
// Whether the proposal on screen shows what it rests on.
let proposeOpen = false;
// What Mason can ask about each project, which question is up, and whether its answer shows.
let built = null;
let builtAt = { project: 0, card: 0 };
// What was last looked for, and what came back.
let found = null;
let findTimer = null;
let findTurn = 0;
let findOpen = null;
let builtShown = false;
let builtWhere = false;
// What the settings screen shows: the settings and the state of what Mason depends on.
let prefs = null;
// How a day moved between tools: the day shown (none is today) and the tool picked in it.
let flow = null;
let flowDay = null;
let flowTool = null;
// Whether the picture shows every tool, or only the few that matter most.
let flowAll = false;
// The long view: every day with its projects, the month shown, and what is picked in it.
let days = null;
let month = null;
let dayOpen = null;
let lane = null;
let toldError = null;

function toast(text) {
  const node = $("#toast");
  node.textContent = text;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 4200);
}

async function api(url, options = {}) {
  const response = await fetch(url, { headers: withKey({ "content-type": "application/json" }), ...options });
  const value = await response.json();
  if (!response.ok) throw Object.assign(new Error(value.error || "Something went wrong"), { status: response.status, value });
  return value;
}
const post = (url, body = {}) => api(url, { method: "POST", body: JSON.stringify(body) });

const clock = (iso, seconds = false) => iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}) }) : "";
const short = (text, max = 80) => {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};
const minutes = (seconds) => {
  const total = Math.round((seconds || 0) / 60);
  return total < 1 ? "<1 min" : total < 60 ? `${total} min` : `${Math.floor(total / 60)}h ${total % 60}m`;
};

// Markup is replaced only when its signature changes. A half-typed answer and a
// finished entrance animation both survive the next live update.
function paint(node, signature, html) {
  if (node.dataset.sig === signature) return false;
  node.dataset.sig = signature;
  node.innerHTML = html;
  return true;
}

function renderBigs(container, rows, open) {
  const keys = rows.map((row) => row.key).join("|");
  if (container.dataset.keys !== keys) {
    container.dataset.keys = keys;
    container.innerHTML = rows.map((row, index) => `<button class="big" type="button" data-key="${row.key}" style="--i:${index};--tone:${row.tone}" aria-pressed="false"><b></b><span></span><em></em></button>`).join("");
  }
  rows.forEach((row, index) => {
    const node = container.children[index];
    const number = `${row.number}${row.unit ? `<i>${row.unit}</i>` : ""}`;
    if ($("b", node).innerHTML !== number) $("b", node).innerHTML = number;
    $("span", node).textContent = row.word;
    $("em", node).textContent = row.meta;
    node.setAttribute("aria-pressed", String(open === row.key));
  });
  // What opens under the numbers is told which of them it belongs to: its
  // words and its colour, for a look in which the two do not touch.
  const pressed = rows.find((row) => row.key === open);
  const under = container.nextElementSibling;
  if (pressed && under?.classList.contains("drill")) {
    under.dataset.of = `${pressed.number}${pressed.unit ? ` ${pressed.unit}` : ""} ${pressed.word}`.replace(" %", "%");
    under.style.setProperty("--of", pressed.tone);
  }
  if (open) container.dataset.open = open;
  else delete container.dataset.open;
}

const momentChip = (moment) => moment?.at ? `<p class="moment"><b>Screen moment</b><span>${clock(moment.at, true)}</span>${moment.app ? `<span>${esc(moment.app)}</span>` : ""}<span>${esc(short(moment.window || moment.evidence, 70))}</span></p>` : "";
const canVoice = () => snapshot.voice.scribe && canDictate();
const voiceNote = () => canVoice() ? "press the microphone and say it" : "spoken by the Mac voice until ElevenLabs is connected";
const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;
// An answer field that can be spoken into: the words appear as they are heard.
const answerField = (id, placeholder) => `<div class="composer"><textarea id="${id}" rows="2" placeholder="${placeholder}"></textarea>${canVoice() ? `<button class="mic" type="button" data-mic="${id}" aria-pressed="false" aria-label="Answer by voice" title="Answer by voice">${MIC}</button>` : ""}</div>`;

/* Today: the mirror, and after a few days how the work was done */

// Every view is read in a second or three: figures in large type, a few words,
// and the detail one press away.
let openProject = null;
// Whether the line about waiting answers, and the look back, show their numbers.
let waitedOpen = false;
let lookbackOpen = false;

const barsOf = (items, label, value, tone, shown) => {
  const longest = Math.max(1, ...items.map(value));
  return items.length ? `<ul class="bars wide">${items.map((item) => `<li style="--w:${Math.round((value(item) / longest) * 100)}%;--tone:${tone}"><span><em>${esc(label(item))}</em></span><i></i><b>${shown(item)}</b></li>`).join("")}</ul>` : "";
};
const dates = (from, to) => {
  const [first, last] = [dateOf(from), dateOf(to)];
  const month = (date) => date.toLocaleDateString("en-GB", { month: "short" });
  return from === to ? `${first.getDate()} ${month(first)}` : first.getMonth() === last.getMonth() ? `${first.getDate()}–${last.getDate()} ${month(last)}` : `${first.getDate()} ${month(first)} – ${last.getDate()} ${month(last)}`;
};

// The first start: what Mason already read, and the one thing it asks for,
// with what that lets it see and what it never does. Nothing else is asked.
let welcomeAsked = false;
function renderWelcome() {
  const node = $("#welcome");
  const welcome = snapshot.welcome;
  const page = node.closest("[data-page]");
  node.hidden = !welcome?.show;
  if (node.hidden) { delete node.dataset.sig; delete page.dataset.welcome; return false; }
  page.dataset.welcome = "true";
  const on = welcome.access === "on";
  const read = !welcome.read ? ["Reading what your agents kept on this Mac.", "A moment. Nothing is recorded for it."]
    : welcome.days ? [`${welcome.days} ${welcome.days === 1 ? "day" : "days"} of your work with agents, already read.`, `${welcome.hours} hours, from the logs Claude Code, Codex, Grok and Cursor keep themselves. Nothing was recorded for it.`]
    : ["No agent has left a log on this Mac yet.", "When you work with Claude Code, Codex, Grok or Cursor, it shows up here by itself."];
  paint(node, JSON.stringify([welcome, welcomeAsked]), `<p class="label">Welcome</p>
    <h1 class="statement">Mason was there.</h1>
    <ol class="steps">
      <li data-done="${welcome.read}">
        <i></i>
        <div><h2>${read[0]}</h2><p>${read[1]}</p></div>
        ${welcome.read && welcome.days ? `<button class="secondary" type="button" data-view="workflow">See how you work</button>` : ""}
      </li>
      <li data-done="${on}">
        <i></i>
        <div><h2>${on ? "Mason sees which window is in front." : "Let Mason see which window is in front."}</h2>
          <p>The app, the title of its window, the site of a tab, and the prompt you are writing. Never a picture of the screen, never what you type anywhere else.</p>
          ${welcomeAsked && !on ? `<p class="hint">Switch Mason on in the list that opened. This screen follows by itself.</p>` : ""}</div>
        ${on ? "" : `<button class="primary" type="button" data-welcome-access>${welcomeAsked ? "Open it again" : "Open System Settings"}</button>`}
      </li>
    </ol>
    <div class="row"><button class="${on ? "primary" : "secondary"}" type="button" data-welcome-done>${on ? "Start" : "Not now"}</button><span class="after">That is all Mason asks for. The rest has a switch in Settings.</span></div>`);
  return true;
}

function renderToday() {
  if (renderWelcome()) return;
  const { activity, waiting } = snapshot;
  const measured = activity.totalSeconds > 0;
  // Before anything is measured the page says what happens next.
  $("#today-meta").textContent = measured ? `${new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} · ${minutes(activity.totalSeconds)}` : "Work as usual. Mason is watching.";
  renderBigs($("#today-bigs"), ["work", "social", "other"].map((name) => ({
    key: name, number: measured ? activity.groups[name].percent : "–", unit: measured ? "%" : "", word: name, meta: "", tone: TONES[name],
  })), drill.today);
  renderDrill();

  // The first minutes after Mason is installed there is nothing to show of
  // the screen yet, but the agents' logs were already read: how its owner
  // works with agents is one press away.
  const first = $("#today-first");
  first.hidden = !(snapshot.trial?.day === 0 && snapshot.days > 0);
  first.textContent = `Mason has read ${snapshot.days} ${snapshot.days === 1 ? "day" : "days"} of your work with agents. See how you work.`;

  // The one thing worth saying about today: an answer that is ready now, or
  // how long finished answers were left. Pressed, it shows where the time went.
  const said = $("#today-said");
  const ready = [...new Set(waiting.ready.map((answer) => answer.project))];
  const line = ready.length ? `${ready.length === 1 ? "An answer is" : `${ready.length} answers are`} ready: ${ready.join(", ")}.` : waiting.sentence?.text || "";
  said.hidden = !line;
  said.dataset.tone = ready.length ? "ready" : waiting.sentence?.tone || "plain";
  said.textContent = line;
  said.setAttribute("aria-expanded", String(waitedOpen));
  const where = $("#today-waited");
  where.hidden = !line || !waitedOpen || !waiting.waited.where.length;
  if (where.hidden) delete where.dataset.sig;
  else paint(where, JSON.stringify(waiting.waited), `<header><h2>Answers waited ${minutes(waiting.waited.seconds)}</h2><p>${waiting.waited.answers} finished while you were somewhere else</p></header>${barsOf(waiting.waited.where, (item) => item.tool, (item) => item.seconds, "var(--gold)", (item) => minutes(item.seconds))}`);

  renderTrial();
  renderLookback();
  renderPropose();
  renderProjects();
  renderQuestion();
  renderSignals();
}

function renderDrill() {
  const node = $("#today-drill");
  const name = drill.today;
  node.hidden = !name;
  if (!name) { delete node.dataset.sig; return; }
  const group = snapshot.activity.groups[name];
  const longest = Math.max(1, ...group.apps.map((item) => item.seconds));
  paint(node, JSON.stringify([name, group.seconds, group.apps.length]), `
    <div class="drill-grid">
      <div>${group.apps.length ? `<ul class="bars">${group.apps.map((item) => `<li style="--w:${Math.round((item.seconds / longest) * 100)}%;--tone:${item.color}"><span>${esc(item.app)}</span><i></i><b>${minutes(item.seconds)}</b></li>`).join("")}</ul>` : `<p class="empty">Nothing.</p>`}</div>
      <div>${group.windows.length ? `<ul class="windows">${group.windows.slice(0, 5).map((item) => `<li><span>${esc(item.window || item.app)}</span><b>${minutes(item.seconds)}</b></li>`).join("")}</ul>` : ""}</div>
    </div>`);
}

// After forty days of work Mason says, the way an old archiver did, that the
// trial has ended and a license must be bought, and then that there is none.
// It asks once for a coffee for the man who built it, or for work for him.
function renderTrial() {
  const node = $("#trial");
  const trial = snapshot.trial;
  node.hidden = !trial?.due;
  if (node.hidden) { delete node.dataset.sig; return; }
  const second = trial.rules ? [trial.rules, trial.rules === 1 ? "rule handed to your agents" : "rules handed to your agents"] : [trial.projects, trial.projects === 1 ? "project remembered" : "projects remembered"];
  paint(node, JSON.stringify(trial), `<p class="label">Day ${trial.day} of ${trial.of}</p>
    <h2>Your trial has ended.</h2>
    <p class="ask">Buy a license or remove Mason from this Mac.</p>
    <p class="none">There is no license. I’ll be at work tomorrow.</p>
    <p class="figures"><span><b>${thousands(trial.prompts)}</b>prompts remembered</span><span><b>${second[0]}</b>${second[1]}</span></p>
    <p class="ask">The man who built me runs on coffee.</p>
    <div class="row">${trial.coffee ? `<a class="primary" href="${esc(trial.coffee)}" target="_blank" rel="noopener">Buy him a coffee</a>` : ""}<a class="${trial.coffee ? "secondary" : "primary"}" href="${esc(trial.hire)}" target="_blank" rel="noopener">Hire him</a><button class="link" type="button" data-trial-end>Use evaluation copy</button></div>`);
}

// After a few days of work Mason says how it was done: up to three plain
// sentences, written once and left as they were. The numbers are one press away.
function renderLookback() {
  const node = $("#lookback");
  const back = snapshot.lookback;
  node.hidden = !back?.lines.length;
  if (node.hidden) { delete node.dataset.sig; return; }
  const numbers = lookbackOpen ? `
    <p class="stats"><b>${back.perHour}</b> changes of tool an hour<b>${Math.max(1, Math.round((back.longest?.seconds || 0) / 60))} min</b> longest in one<b>${back.prompts}</b> prompts<b>${Math.round(back.changes / back.days)}</b> changes of project a day</p>
    <div class="drill-grid">
      <div><h3>Where the time went</h3>${barsOf(back.projects, (item) => item.name, (item) => item.seconds, "var(--lime)", (item) => `${item.share}%`)}</div>
      <div>${back.left.to.length ? `<h3>Right after a prompt</h3>${barsOf(back.left.to, (item) => item.tool, (item) => item.count, "var(--paper)", (item) => item.count)}` : ""}${back.waited.where.length ? `<h3>While answers waited</h3>${barsOf(back.waited.where.slice(0, 4), (item) => item.tool, (item) => item.seconds, "var(--gold)", (item) => minutes(item.seconds))}` : ""}</div>
    </div>` : "";
  paint(node, JSON.stringify([back.from, back.to, back.lines, lookbackOpen]), `<p class="label">${dates(back.from, back.to)} · how you worked</p>
    ${back.lines.map((line) => `<p class="line">${esc(line)}</p>`).join("")}
    ${numbers}
    <button class="quiet" type="button" data-lookback-open>${lookbackOpen ? "Less" : "The numbers"}</button>`);
}

// Something Mason has seen often enough to propose a change. One at a time,
// with what it rests on. Mason writes it nowhere: it is handed to an agent as
// a prompt that is ready and not sent, and is gone from here once the rule
// stands in the agents' rules.
function renderPropose() {
  const node = $("#propose");
  const proposal = snapshot.suggestions?.open?.[0];
  node.hidden = !proposal;
  if (!proposal) { delete node.dataset.sig; return; }
  const links = proposal.hand?.links || [];
  paint(node, JSON.stringify([proposal, proposeOpen]), `<p class="label">You keep saying this · ${proposal.times} times in ${proposal.projects} projects</p>
    <h2>${esc(proposal.rule)}</h2>
    ${proposeOpen ? `<ul class="quotes">${proposal.evidence.map((item) => `<li><b>${esc(item.project)}</b><span>“${esc(item.example)}”</span></li>`).join("")}</ul>
      <textarea id="propose-rule" rows="2" data-id="${esc(proposal.id)}" aria-label="The rule, in the words it will be handed over in">${esc(proposal.rule)}</textarea>
      <p class="where">Mason writes this nowhere. Choose an agent: it opens with a prompt ready and not sent. Read it, press Enter, and the agent shows you the change before it saves, one line in the file each of your agents reads its rules from. A default, not a law: what a prompt asks for comes first.</p>` : ""}
    <div class="row"><span class="hand">${links.map((link, index) => `<a class="${index ? "secondary" : "primary"}" href="${esc(link.url)}" data-hand>${index ? "" : "Give it to "}${esc(link.agent)}</a>`).join("")}<button class="secondary" type="button" data-propose-copy>Copy prompt</button></span><button class="secondary" type="button" data-propose="dismiss" data-id="${esc(proposal.id)}">No</button><button class="quiet" type="button" data-propose-open>${proposeOpen ? "Less" : "What I said"}</button></div>`);
}

// A project is one line: its name, where it was left in a few words, its time.
// Pressing it opens the rest; the round button reads it aloud.
function renderProjects() {
  const node = $("#projects-card");
  const { projects } = snapshot;
  const rows = projects.projects.filter((item) => item.seconds >= 30 || item.prompts);
  node.hidden = !rows.length;
  if (!rows.length) return;
  const off = projects.offProject;
  const longest = Math.max(1, off.seconds, ...rows.map((item) => item.seconds));
  const width = (seconds) => Math.round((seconds / longest) * 100);
  const signature = JSON.stringify([rows.map((item) => [item.name, Math.round(item.seconds / 30), snapshot.memories[item.name]?.generatedAt]), Math.round(off.seconds / 30), openProject, playing]);
  paint(node, signature, `<ol>
    ${rows.map((item) => {
      const memory = snapshot.memories[item.name];
      const isOpen = openProject === item.name;
      const more = isOpen && memory?.left_off ? `<div class="more">
          ${memory.how?.length ? `<ul class="how">${memory.how.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
          <p>${esc(memory.left_off)}</p>
          ${memory.open?.length ? `<ul>${memory.open.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}
          ${memory.keeps_saying?.length ? `<p class="says">${memory.keeps_saying.map((rule) => `<em>${esc(rule.rule)} <u>×${rule.times}</u></em>`).join("")}</p>` : ""}
          ${snapshot.voice.elevenLabs ? `<div class="row"><button class="secondary" type="button" data-recall="${esc(item.name)}">Quiz me</button></div>` : ""}
        </div>` : "";
      const hear = memory?.spoken ? `<button class="hear" type="button" data-hear-project="${esc(item.name)}" data-state="${playing === item.name ? "playing" : "idle"}" aria-label="${playing === item.name ? "Stop" : "Hear where you left off"}"></button>` : `<span></span>`;
      return `<li data-open="${isOpen}"><button class="line" type="button" data-project="${esc(item.name)}"><b>${esc(item.name)}</b><span class="hl">${esc(memory?.headline || "")}</span><i style="--w:${width(item.seconds)}%"></i><span class="time">${item.seconds >= 30 ? minutes(item.seconds) : ""}</span></button>${hear}${more}</li>`;
    }).join("")}
    ${off.seconds >= 30 ? `<li class="off"><div class="line"><b>Outside</b><span class="hl"></span><i style="--w:${width(off.seconds)}%"></i><span class="time">${minutes(off.seconds)}</span></div><span></span></li>` : ""}
  </ol>`);
}

const placeCall = (kind = "call") => native ? native.postMessage({ type: "call", kind }) : (location.href = `/overview?mode=${kind}`);

function renderQuestion() {
  const node = $("#question-card");
  const open = snapshot.map.questions.find((item) => item.status === "open");
  node.hidden = !open;
  if (!open) { delete node.dataset.sig; return; }
  node.dataset.state = "open";
  paint(node, `open-${open.id}`, `<h2>${esc(open.text)}</h2>${answerField("live-answer", "Answer")}<div class="row"><button class="primary" type="button" data-answer="${open.id}">Answer</button><button class="secondary" type="button" data-later="${open.id}">Later</button></div>`);
}

function describe(event) {
  const control = { "off-the-record": "went private", "on-the-record": "observing again", pause: "paused", resume: "resumed" };
  switch (event.type) {
    case "window": return event.window || "new window";
    case "prompt": return `“${short(event.excerpt)}”`;
    case "question": return event.question;
    case "answer": return `“${short(event.answer)}”`;
    case "intervention": return `stopped · ${event.guardrailTitle || "guardrail"}`;
    case "teach-stop": return `stopped · ${event.guardrailTitle || "guardrail"}`;
    case "control": return control[event.action] || event.action;
    case "session": return event.action === "start" ? "session started" : "session ended";
    case "debrief": return "debrief";
    default: return null;
  }
}

function renderSignals() {
  const { events, stats } = snapshot;
  $("#trust-line").textContent = `${stats.privateRefusals} private refused`;
  const rows = events.filter((event) => describe(event)).slice(-7).reverse();
  paint($("#signals"), rows[0]?.id || "none", rows.map((event) => `<li data-type="${esc(event.type)}"><time>${clock(event.at, true)}</time><b>${esc(event.app || "Mason")}</b><span>${esc(describe(event))}</span></li>`).join(""));
}

/* Built: Mason asks about your own work, and holds the answer */

async function loadBuilt() {
  built = await api("/api/built");
  if (view === "built") renderBuilt();
}

function renderBuilt() {
  if (!built) return;
  const card = $("#built-card");
  const { projects } = built;
  if (!projects.length) {
    $("#built-meta").textContent = "";
    paint($("#built-projects"), "none", "");
    // Nothing is due: either all of it was known lately, or nothing is remembered yet.
    const back = built.next ? Math.max(1, Math.round((Date.parse(built.next) - Date.now()) / 86_400_000)) : 0;
    return paint(card, `empty-${back}`, back
      ? `<h1 class="question">Nothing to recall today.</h1><p class="lede">The next question comes back ${back === 1 ? "tomorrow" : `in ${back} days`}. What you knew comes back after longer each time.</p>`
      : `<h1 class="question">Nothing to ask about yet.</h1><p class="lede">It fills by itself as you work with your agents.</p>`);
  }
  builtAt.project = Math.min(builtAt.project, projects.length - 1);
  const item = projects[builtAt.project];
  builtAt.card = Math.min(builtAt.card, item.cards.length - 1);
  const asked = item.cards[builtAt.card];
  const days = Math.round((dateOf(built.today) - dateOf(item.lastDay)) / 86_400_000);
  const left = projects.reduce((count, project) => count + project.cards.length, 0);
  $("#built-meta").textContent = `${item.project} · ${days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`} · ${left} to recall`;
  // The question first, in large type. Say the answer to yourself, then look:
  // what was not known comes back tomorrow, what was known after longer.
  paint(card, JSON.stringify([asked, builtShown, builtWhere, snapshot.voice.elevenLabs]), `<h1 class="question">${esc(asked.question)}</h1>
    ${builtShown ? `<ul class="held">${asked.answer.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>
      ${builtWhere && asked.where.length ? `<ul class="where-in-code">${asked.where.map((line) => `<li>${esc(line)}</li>`).join("")}</ul>` : ""}` : `<p class="lede">Say it to yourself first. Then look.</p>`}
    <div class="row">${builtShown
      ? `<button class="primary" type="button" data-built="knew">Knew it</button><button class="secondary" type="button" data-built="not">Did not</button>${asked.where.length && !builtWhere ? `<button class="quiet" type="button" data-built="where">Where in the code</button>` : ""}`
      : `<button class="primary" type="button" data-built="show">Show</button><button class="quiet" type="button" data-built="skip">Skip</button>`}${snapshot.voice.elevenLabs ? `<button class="secondary" type="button" data-recall="${esc(item.project)}">Ask me aloud</button>` : ""}</div>`);
  paint($("#built-projects"), JSON.stringify([projects.map((project) => project.project), builtAt.project]), projects.map((project, index) => `<button type="button" data-built-project="${index}" aria-pressed="${index === builtAt.project}">${esc(project.project)}</button>`).join(""));
}

/* Find: something that was said, by what it means */

const agoOf = (iso) => {
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : new Date(iso).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
};

async function seek(query) {
  const turn = ++findTurn;
  const answer = await post("/api/find", { query });
  // An answer to something that is no longer asked is dropped.
  if (turn !== findTurn) return;
  found = answer;
  if (view === "find") renderFind();
}

function renderFind() {
  const node = $("#find-results");
  const field = $("#find-query");
  if (!found) return;
  field.hidden = Boolean(found.off || found.unavailable);
  if (found.off) {
    $("#find-meta").textContent = "";
    return paint(node, "off", `<h1 class="question">Find what you said, by what it means.</h1><p class="lede">A model on this Mac reads what you said to your agents. Nothing is sent anywhere.</p><div class="row"><button class="primary" type="button" data-find-on>Switch on</button></div>`);
  }
  if (found.unavailable) {
    $("#find-meta").textContent = "";
    const [title, lede] = found.unavailable === "runner"
      ? ["llama.cpp is not on this Mac.", "It runs the model. In a terminal: brew install llama.cpp"]
      : ["No model on this Mac yet.", "Put an embedding model, a .gguf file, in the folder data/models."];
    return paint(node, found.unavailable, `<h1 class="question">${title}</h1><p class="lede">${lede}</p>`);
  }
  $("#find-meta").textContent = found.read ? `${thousands(found.read)} prompts read${found.waiting ? ` · ${thousands(found.waiting)} to go` : ""}` : found.waiting === null ? "Nothing read yet" : "Reading";
  if (!found.query) {
    // Nothing asked for: what was said again and again, in the words it was said in.
    const repeated = found.repeated || [];
    return paint(node, JSON.stringify([repeated.map((demand) => [demand.id, demand.times]), findOpen]), repeated.length ? `<p class="label">Said again and again</p>${repeated.map((demand) => `<article class="again" data-again="${esc(demand.id)}" role="button" tabindex="0" aria-expanded="${demand.id === findOpen}">
      <b>${demand.times}×</b><h2>${esc(demand.text)}</h2><p>${demand.projects.length} projects</p>
      ${demand.id === findOpen ? `<ul>${demand.ways.slice(1).map((way) => `<li><span>${esc(way.text)}</span><time>${esc(way.project)}</time></li>`).join("")}</ul>` : ""}</article>`).join("")}` : "");
  }
  if (!found.projects.length) return paint(node, `none ${found.query}`, `<p class="lede">Nothing you said is close to that.</p>`);
  // The project is the answer, in large type. Under it, the words it rests on.
  paint(node, JSON.stringify(found.projects), found.projects.map((entry) => `<article class="hit"><header><h2>${esc(entry.project)}</h2><p>${entry.count} said · ${agoOf(entry.last)}</p></header>
    <ul>${entry.said.map((hit) => `<li><span>${esc(hit.text)}</span><time>${new Date(hit.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</time></li>`).join("")}</ul></article>`).join(""));
}

/* More: what is not looked at every day */

function renderMore() {
  const { podcast } = snapshot;
  const doors = [
    ["find", "Find", "Something you said, by what it means"],
    ["recap", "Recap", podcast.episode ? podcast.episode.title : "The week as news"],
    ["agents", "Agents", "One memory, every agent"],
  ];
  paint($("#doors"), JSON.stringify(doors), doors.map(([name, title, note]) => `<button type="button" data-view="${name}"><b>${title}</b><span>${esc(note)}</span></button>`).join(""));
}

/* Flow: how the day moved between tools */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const GROUP_TONES = { ...TONES, chat: "var(--gold)" };
const dateOf = (day) => { const [year, number, date] = day.split("-").map(Number); return new Date(year, number - 1, date); };
// Dark letters on a light tile, light letters on a dark one.
const inkOn = (color) => {
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16));
  return red * .299 + green * .587 + blue * .114 > 150 ? "#141414" : "#ffffff";
};
const tileFor = (tool) => tool?.tile || { text: String(tool?.name || "?").slice(0, 1).toUpperCase(), color: "#2b2823" };
// A tool's face: its app icon when the app is on this Mac, otherwise a letter
// or two on the colour it is known by.
// An icon a site gave of itself is a full square, cut here to the shape of a
// tile; an app's icon already has its own shape and air around it.
const fromSite = (tool) => Boolean(tool?.icon?.includes("/site-"));
function face(tool, size = 28) {
  const tile = tileFor(tool);
  // The letter and its colour ride along, for the moment the picture does not come.
  if (tool?.icon) return `<img class="logo ${fromSite(tool) ? "site" : ""}" style="--s:${size}px" src="${esc(keyed(tool.icon))}" alt="" data-letter="${esc(tile.text)}" data-colour="${esc(tile.color)}" />`;
  return `<span class="logo" style="--s:${size}px;--bg:${tile.color};--fg:${inkOn(tile.color)}">${esc(tile.text)}</span>`;
}

async function loadFlow() {
  flow = await api(`/api/flow${flowDay ? `?day=${flowDay}` : ""}`);
  if (flowTool && !flow.tools.some((tool) => tool.name === flowTool)) flowTool = null;
  if (view === "flow") renderFlow();
}

// The tools as a picture, and only what is read at a glance: the five tools
// with the most time, each as large as its time, and the three habits between
// them as lines as thick as their jumps. Pressing a tool shows its own lines.
// Under the picture every tool of the day is named, so that nothing that was
// used is left unsaid.
const FLOW_FEW = 5;
// The tools named under the picture before the rest are asked for.
const FLOW_NAMED = 12;
// The most tools the picture to share has room for.
const SHARE_MOST = 7;

// The tools in the picture: the five with the most time. A tool picked from
// further down is shown among the ones it trades places with most.
function pictured(visited, pairs, picked) {
  const top = visited.slice(0, FLOW_FEW);
  const tool = visited.find((item) => item.name === picked);
  if (!tool || top.includes(tool)) return top;
  const byName = new Map(visited.map((item) => [item.name, item]));
  const near = pairs.filter((pair) => pair.a === picked || pair.b === picked).map((pair) => byName.get(pair.a === picked ? pair.b : pair.a)).filter(Boolean);
  return [...new Set([tool, ...near, ...top])].slice(0, FLOW_FEW).sort((a, b) => b.seconds - a.seconds);
}

// Where everything in the picture goes. The window draws it as it is; the
// picture to share draws the same thing larger. `picked` is a tool whose own
// lines are shown.
function flowLayout(used, pairs, { width, height, cx, cy, rx, ry, small, grow, picked = null }) {
  // The two tools with the most jumps between them sit left and right, so the
  // main loop lies flat across the middle; the others go round them by time.
  const loop = pairs.find((pair) => used.some((tool) => tool.name === pair.a) && used.some((tool) => tool.name === pair.b));
  const ends = loop ? used.filter((tool) => tool.name === loop.a || tool.name === loop.b) : [];
  const tools = ends.length === 2 ? [...ends, ...used.filter((tool) => !ends.includes(tool))] : used;
  const count = tools.length;
  const above = Math.ceil((count - 2) / 2);
  const below = count - 2 - above;
  // On each arc the middle place is taken first.
  const middleFirst = (places) => Array.from({ length: places }, (_, index) => index).sort((a, b) => Math.abs(a - (places - 1) / 2) - Math.abs(b - (places - 1) / 2) || a - b);
  const [upper, lower] = [middleFirst(above), middleFirst(below)];
  const angleOf = (rank) => {
    if (rank < 2) return rank ? 0 : 180;
    const turn = Math.floor((rank - 2) / 2);
    return (rank - 2) % 2 === 0 ? 180 - ((upper[turn] + 1) * 180) / (above + 1) : 180 + ((lower[turn] + 1) * 180) / (below + 1);
  };
  const most = Math.max(...tools.map((tool) => tool.seconds));
  const at = new Map(tools.map((tool, rank) => {
    const angle = (angleOf(rank) * Math.PI) / 180;
    const place = count === 1 ? [cx, cy] : [cx + rx * Math.cos(angle), cy - ry * Math.sin(angle)];
    return [tool.name, { x: Math.round(place[0]), y: Math.round(place[1]), r: Math.round(small + grow * Math.sqrt(tool.seconds / most)) }];
  }));
  const between = pairs.filter((pair) => at.has(pair.a) && at.has(pair.b));
  const touches = (pair) => pair.a === picked || pair.b === picked;
  // A single jump between two tools is not a habit.
  const habits = picked ? between.filter(touches) : between.slice(0, 3);
  // A tool none of the habits reaches is still tied to the one it trades places with most, by a quiet line.
  const reached = new Set(habits.flatMap((pair) => [pair.a, pair.b]));
  const ties = picked ? [] : tools.filter((tool) => !reached.has(tool.name)).map((tool) => between.find((pair) => pair.a === tool.name || pair.b === tool.name)).filter(Boolean);
  const shown = [...habits, ...ties.filter((pair, index) => ties.indexOf(pair) === index)];
  const strongest = shown[0]?.count || 1;
  const linked = new Set(shown.flatMap((pair) => [pair.a, pair.b]));
  const lines = shown.map((pair, index) => {
    const a = at.get(pair.a), b = at.get(pair.b);
    // The line bows towards the middle, so neighbours do not hide behind each other.
    const bend = [Math.round((a.x + b.x) / 2 + (cx - (a.x + b.x) / 2) * .28), Math.round((a.y + b.y) / 2 + (cy - (a.y + b.y) / 2) * .28)];
    const share = pair.count / strongest;
    const main = index === 0;
    const lit = main || Boolean(picked);
    const quiet = !habits.includes(pair);
    // The number sits in the middle of the part of the line that shows between the two tools.
    const far = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const t = Math.min(.75, Math.max(.25, (a.r / far + 1 - b.r / far) / 2));
    const along = (from, by, to) => Math.round((1 - t) ** 2 * from + 2 * (1 - t) * t * by + t ** 2 * to);
    return {
      a, b, bend, count: pair.count, main, lit, quiet,
      label: [along(a.x, bend[0], b.x), along(a.y, bend[1], b.y)],
      numbered: !quiet,
      thick: quiet ? 2 : 3 + 15 * share,
      opacity: quiet ? .16 : main ? .95 : picked ? .4 + .5 * share : .16 + .34 * share,
    };
  });
  const nodes = tools.map((tool) => {
    const { x, y, r } = at.get(tool.name);
    // A name never stands between its tool and the middle of the picture.
    return { tool, x, y, r, nameAt: y < cy - 10 ? y - r - 16 : y + r + 30, faded: Boolean(picked) && tool.name !== picked && !linked.has(tool.name) };
  });
  return { width, height, nodes, lines };
}

function flowMap(tools) {
  const { width, height, nodes, lines } = flowLayout(tools, flow.pairs, { width: 1000, height: 410, cx: 500, cy: 200, rx: 372, ry: 112, small: 30, grow: 34, picked: flowTool });
  // The weakest line is drawn first, so the strongest lies on top.
  const drawn = [...lines].reverse();
  const edges = drawn.map((line) => `<path class="edge ${line.lit ? "on" : ""}" d="M${line.a.x} ${line.a.y} Q${line.bend[0]} ${line.bend[1]} ${line.b.x} ${line.b.y}" style="stroke-width:${line.thick.toFixed(1)};opacity:${line.opacity.toFixed(2)}" />`);
  const labels = drawn.filter((line) => line.numbered).map((line) => `<g class="count ${line.main ? "main" : ""} ${line.lit ? "on" : ""}" transform="translate(${line.label[0]} ${line.label[1]})"><circle r="${line.main ? 31 : 20}" /><text>${line.count}</text></g>`);
  const marks = nodes.map(({ tool, x, y, r, nameAt, faded }) => {
    const tile = tileFor(tool);
    const side = r * 1.8;
    const cut = `cut-${Math.round(x)}-${Math.round(y)}`;
    // A tool with no picture is a letter on its colour. The same tile waits,
    // unseen, behind a picture, and shows if the picture does not come.
    const letters = `<rect x="${x - side / 2}" y="${y - side / 2}" width="${side}" height="${side}" rx="${side * .23}" fill="${tile.color}" stroke="rgba(255,255,255,.16)" /><text class="letters" x="${x}" y="${y}" fill="${inkOn(tile.color)}" font-size="${Math.round(side * .42)}">${esc(tile.text)}</text>`;
    const under = `<g class="under" hidden>${letters}</g>`;
    const mark = fromSite(tool)
      ? `<clipPath id="${cut}"><rect x="${x - side / 2}" y="${y - side / 2}" width="${side}" height="${side}" rx="${side * .23}" /></clipPath>${under}<image href="${esc(keyed(tool.icon))}" x="${x - side / 2}" y="${y - side / 2}" width="${side}" height="${side}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${cut})" /><rect x="${x - side / 2}" y="${y - side / 2}" width="${side}" height="${side}" rx="${side * .23}" fill="none" stroke="rgba(255,255,255,.16)" />`
      : tool.icon
        ? `${under}<image href="${esc(keyed(tool.icon))}" x="${x - r * 1.1}" y="${y - r * 1.1}" width="${r * 2.2}" height="${r * 2.2}" />`
        : letters;
    return `<g class="node" data-tool="${esc(tool.name)}" role="button" tabindex="0" aria-pressed="${tool.name === flowTool}" aria-label="${esc(tool.name)}, ${minutes(tool.seconds)}" ${faded ? "data-faded" : ""}><circle cx="${x}" cy="${y}" r="${r + 12}" />${mark}<text class="name" x="${x}" y="${nameAt}">${esc(short(tool.name, 20))}</text></g>`;
  });
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${edges.join("")}${marks.join("")}${labels.join("")}</svg>`;
}

// A tool by name, to press. `on` is pressed, `lit` is in the picture.
const toolChip = (tool, { on = false, lit = false, time = true } = {}) => `<button type="button" data-tool="${esc(tool.name)}" aria-pressed="${on}" ${lit ? "data-lit" : ""}>${face(tool, 22)}<span>${esc(short(tool.name, 22))}</span>${time ? `<em>${brief(Math.max(1, Math.round(tool.seconds / 60)))}</em>` : ""}</button>`;

// Every tool by name, the ones with the most time first. A long day is cut
// after the first dozen, and the rest are one press away.
function toolStrip(tools, all, chip) {
  const open = all || tools.length <= FLOW_NAMED + 2;
  const named = open ? tools : tools.slice(0, FLOW_NAMED);
  const rest = tools.length - named.length;
  return `${named.map(chip).join("")}${rest ? `<button class="more" type="button" data-all>+${rest}</button>` : all && tools.length > FLOW_NAMED + 2 ? `<button class="more" type="button" data-all>Fewer</button>` : ""}`;
}

// The day in order, as one band: work, social, other and chat by colour. With a
// tool picked, the band shows where in the day that tool was, under its face.
function flowRibbon(byName) {
  const start = new Date(flow.from);
  start.setMinutes(0, 0, 0);
  const end = new Date(flow.to);
  if (end.getMinutes() || end.getSeconds()) end.setHours(end.getHours() + 1, 0, 0, 0);
  const span = Math.max(3_600_000, end - start);
  const place = (time) => ((time - start) / span) * 100;
  const block = (from, to, group, more = "") => `<i style="left:${place(from).toFixed(3)}%;width:${(place(to) - place(from)).toFixed(3)}%;--tone:${GROUP_TONES[group] || TONES.other}" ${more}></i>`;
  // Neighbours of the same kind are drawn as one stretch.
  const kinds = [];
  for (const stretch of flow.track) {
    const [from, to] = [Date.parse(stretch.startedAt), Date.parse(stretch.endedAt)];
    const last = kinds.at(-1);
    if (last && last.group === stretch.group && from - last.to < 120_000) last.to = Math.max(last.to, to);
    else kinds.push({ group: stretch.group, from, to });
  }
  const picked = flowTool ? flow.track.filter((stretch) => stretch.tool === flowTool) : [];
  const marks = [];
  for (const stretch of [...picked].sort((a, b) => b.seconds - a.seconds)) {
    const middle = place((Date.parse(stretch.startedAt) + Date.parse(stretch.endedAt)) / 2);
    if (marks.length >= 8 || marks.some((mark) => Math.abs(mark.middle - middle) < 7)) continue;
    marks.push({ middle, html: `<span style="left:${middle.toFixed(2)}%" title="${clock(stretch.startedAt)} · ${minutes(stretch.seconds)}">${face(byName.get(stretch.tool), 26)}</span>` });
  }
  const hours = span / 3_600_000;
  const step = hours <= 8 ? 1 : hours <= 16 ? 2 : 3;
  const ticks = [];
  for (let hour = 0; hour <= hours; hour += step) ticks.push(`<span style="left:${((hour / hours) * 100).toFixed(2)}%">${String(new Date(start.getTime() + hour * 3_600_000).getHours()).padStart(2, "0")}</span>`);
  return `<div class="marks">${marks.map((mark) => mark.html).join("")}</div>
    <div class="band" ${flowTool ? "data-picked" : ""}>${kinds.map((kind) => block(kind.from, kind.to, kind.group, `title="${kind.group} · ${clock(new Date(kind.from).toISOString())}"`)).join("")}${picked.map((stretch) => block(Date.parse(stretch.startedAt), Date.parse(stretch.endedAt), stretch.group, "data-on")).join("")}</div>
    <div class="hours">${ticks.join("")}</div>`;
}

function renderFlow() {
  if (!flow) return;
  const measured = flow.totalSeconds > 0;
  const today = flow.day === flow.today;
  const label = today ? "Today" : dateOf(flow.day).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  $("#flow-meta").textContent = measured ? `${label} · ${minutes(flow.totalSeconds)}` : `${label} · nothing measured yet`;
  const here = flow.days.indexOf(flow.day);
  $('[data-flow-step="-1"]').disabled = here <= 0;
  $('[data-flow-step="1"]').disabled = here < 0 || here >= flow.days.length - 1;
  const byName = new Map(flow.tools.map((tool) => [tool.name, tool]));
  const stay = flow.longest;
  renderBigs($("#flow-bigs"), [
    { key: "jumps", number: measured ? flow.jumps : "–", word: flow.jumps === 1 ? "jump" : "jumps", meta: flow.perHour ? `${flow.perHour} an hour` : "", tone: "var(--paper)" },
    { key: "stay", number: stay ? Math.max(1, Math.round(stay.seconds / 60)) : "–", unit: stay ? "min" : "", word: "unbroken", meta: stay ? `${stay.tool} · ${clock(stay.startedAt)}` : "", tone: "var(--lime)" },
  ], drill.flow);

  const open = $("#flow-drill");
  open.hidden = !drill.flow || !measured;
  if (open.hidden) delete open.dataset.sig;
  else if (drill.flow === "jumps") {
    const top = flow.pairs.slice(0, 6);
    const most = Math.max(1, top[0]?.count || 1);
    paint(open, JSON.stringify(["jumps", top]), `<ul class="bars wide">${top.map((pair) => `<li style="--w:${Math.round((pair.count / most) * 100)}%;--tone:var(--lime)"><span>${face(byName.get(pair.a) || { name: pair.a }, 26)}${face(byName.get(pair.b) || { name: pair.b }, 26)}<em>${esc(pair.a)} · ${esc(pair.b)}</em></span><i></i><b>${pair.count}</b></li>`).join("")}</ul>`);
  } else {
    const longest = [...flow.track].sort((a, b) => b.seconds - a.seconds).slice(0, 5);
    const most = Math.max(1, longest[0]?.seconds || 1);
    paint(open, JSON.stringify(["stay", longest]), `<ul class="bars wide">${longest.map((stretch) => `<li style="--w:${Math.round((stretch.seconds / most) * 100)}%;--tone:${GROUP_TONES[stretch.group] || TONES.other}"><span>${face(byName.get(stretch.tool) || { name: stretch.tool }, 26)}<em>${esc(stretch.tool)} · ${clock(stretch.startedAt)}</em></span><i></i><b>${minutes(stretch.seconds)}</b></li>`).join("")}</ul>`);
  }

  const visited = flow.tools.filter((tool) => tool.visits);
  const tools = pictured(visited, flow.pairs, flowTool);
  const inPicture = new Set(tools.map((tool) => tool.name));
  const map = $("#flow-map");
  map.hidden = !tools.length;
  if (tools.length) paint(map, JSON.stringify([flow.day, flowTool, tools.map((tool) => [tool.name, Math.round(tool.seconds / 20), tool.icon]), flow.pairs.filter((pair) => inPicture.has(pair.a) && inPicture.has(pair.b))]), flowMap(tools));
  const strip = $("#flow-tools");
  strip.hidden = visited.length <= FLOW_FEW;
  if (!strip.hidden) paint(strip, JSON.stringify([flow.day, flowTool, flowAll, visited.map((tool) => [tool.name, Math.round(tool.seconds / 60), tool.icon]), [...inPicture]]), toolStrip(visited, flowAll, (tool) => toolChip(tool, { on: tool.name === flowTool, lit: inPicture.has(tool.name) })));
  const ribbon = $("#flow-ribbon");
  ribbon.hidden = !flow.track.length;
  if (flow.track.length) paint(ribbon, JSON.stringify([flow.day, flowTool, flow.track.length, flow.to]), flowRibbon(byName));

  // One tool picked: where its jumps went.
  const detail = $("#flow-tool");
  const picked = byName.get(flowTool);
  detail.hidden = !picked;
  if (!picked) { delete detail.dataset.sig; return; }
  const ways = flow.pairs.filter((pair) => pair.a === flowTool || pair.b === flowTool).slice(0, 6).map((pair) => ({ other: pair.a === flowTool ? pair.b : pair.a, count: pair.count }));
  const most = Math.max(1, ways[0]?.count || 1);
  paint(detail, JSON.stringify([flowTool, picked.seconds, ways]), `<header>${face(picked, 40)}<h2>${esc(picked.name)}</h2><p>${minutes(picked.seconds)} · ${picked.visits} ${picked.visits === 1 ? "visit" : "visits"}</p></header>
    ${ways.length ? `<ul class="bars wide">${ways.map((way) => `<li data-tool="${esc(way.other)}" style="--w:${Math.round((way.count / most) * 100)}%;--tone:var(--lime)"><span>${face(byName.get(way.other) || { name: way.other }, 26)}<em>${esc(way.other)}</em></span><i></i><b>${way.count}</b></li>`).join("")}</ul>` : `<p class="empty">No jumps to or from it.</p>`}`);
}

/* Replay: a stretch of real work, for someone else to sit beside */

// The piece of work as it would be shown, which piece it is (none is the
// latest), whether names are shown, and the lines that were taken out of it.
let replay = null;
let replayPiece = null;
let replayNames = false;
const replayOut = new Set();

async function loadReplay() {
  replay = await post("/api/replay", { piece: replayPiece, names: replayNames });
  renderReplay();
}

function renderReplay() {
  // What is cut is a piece of work: one project, from its first prompt to its last.
  const pieces = [...replay.pieces.map((piece) => [piece.id, `${piece.project} · ${piece.prompts}`]), ["today", "All of today"]];
  paint($("#replay-span"), JSON.stringify([pieces, replay.piece]), pieces.map(([id, word]) => `<button type="button" data-replay-piece="${esc(id)}" aria-pressed="${id === replay.piece}">${esc(word)}</button>`).join(""));
  $("#replay-names").setAttribute("aria-checked", String(replayNames));
  const kept = replay.lines.filter((line) => !replayOut.has(line.id)).length;
  $("#replay-note").textContent = replay.lines.length ? `${kept} of ${replay.lines.length} prompts. Press one to leave it out. Read each before you save: this is what others will see.` : "Nothing was said to an agent today.";
  $("#replay-save").disabled = $("#replay-copy").disabled = !kept;
  paint($("#replay-lines"), JSON.stringify([replay.lines.map((line) => [line.id, line.project, line.text.length]), [...replayOut]]), replay.lines.map((line) => `<article class="cut" data-replay-line="${esc(line.id)}" role="button" tabindex="0" aria-pressed="${!replayOut.has(line.id)}">
    <header><time>${clock(line.at)}</time><b>${esc(line.project)}</b></header><p>${esc(line.text)}</p>${line.around ? `<footer>${esc(line.around)}</footer>` : ""}</article>`).join(""));
}

// The clipboard is asked the new way and, where that is refused, the old one.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  const field = document.createElement("textarea");
  field.value = text;
  document.body.append(field);
  field.select();
  const done = document.execCommand("copy");
  field.remove();
  return done;
}

/* Share: the flow as a picture to show others */

// The flow the picture is drawn from, the tools chosen for it, and where each
// tool sits in it, so that one can be pressed.
let shareFlow = null;
let shareSpan = "day";
let shareChosen = new Set();
let shareAll = false;
let shareNodes = [];
const pictures = new Map();
const POSTER = { width: 1080, height: 1350, left: 72, ink: "#0e0d0b", paper: "#f3eee2", lime: "#d7ff42", muted: "#a39d90", line: "#2e2b25" };
const FACE = `Inter, "SF Pro Display", -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`;

const pictureOf = (address) => {
  if (!pictures.has(address)) pictures.set(address, new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = keyed(address); }));
  return pictures.get(address);
};

// What the picture starts with: the five tools the building was done in. A
// day with fewer than five of those is filled up with what took the most time.
const builtWith = (visited) => new Set([...visited.filter((tool) => tool.group === "work"), ...visited].slice(0, FLOW_FEW).map((tool) => tool.name));

async function loadShare() {
  // Today's picture is the day that is open in Flow; the week is asked for.
  shareFlow = shareSpan === "week" ? await api("/api/flow?span=week") : flow;
  shareChosen = builtWith(shareFlow.tools.filter((tool) => tool.visits));
  shareAll = false;
  paint($("#share-span"), shareSpan, [["day", flow.day === flow.today ? "Today" : "This day"], ["week", "7 days"]].map(([span, word]) => `<button type="button" data-share-span="${span}" aria-pressed="${span === shareSpan}">${word}</button>`).join(""));
  await drawShare();
}

// The picture: what was built with, the three habits between the tools, and
// three figures. Tool names only: no project, no window title, no site address
// beyond the name of the site.
async function drawShare() {
  const canvas = $("#share-canvas");
  const pen = canvas.getContext("2d");
  const { width, height, left, ink, paper, lime, muted, line } = POSTER;
  const source = shareFlow;
  const visited = source.tools.filter((tool) => tool.visits);
  const tools = visited.filter((tool) => shareChosen.has(tool.name));
  $("#share-note").textContent = tools.length >= SHARE_MOST ? "Seven at most. Take one out to put another in." : "Press a tool to put it in or take it out.";
  paint($("#share-tools"), JSON.stringify([source.span, source.day, shareAll, [...shareChosen], visited.map((tool) => [tool.name, tool.icon])]), toolStrip(visited, shareAll, (tool) => toolChip(tool, { on: shareChosen.has(tool.name), time: false })));
  const write = (text, x, y, { size, weight = 720, color = paper, align = "left", spacing = 0, middle = false }) => {
    pen.font = `${weight} ${size}px ${FACE}`;
    pen.fillStyle = color;
    pen.textAlign = align;
    pen.textBaseline = middle ? "middle" : "alphabetic";
    if ("letterSpacing" in pen) pen.letterSpacing = `${spacing}px`;
    pen.fillText(text, x, y);
  };
  pen.setTransform(1, 0, 0, 1, 0, 0);
  pen.globalAlpha = 1;
  pen.fillStyle = ink;
  pen.fillRect(0, 0, width, height);

  const when = source.span === "week" ? "this week." : source.day === source.today ? "today." : `on ${dateOf(source.day).toLocaleDateString("en-GB", { weekday: "long" })}.`;
  write("How I built", left, 212, { size: 136, spacing: -9 });
  write(when, left, 340, { size: 136, spacing: -9, color: lime });

  shareNodes = [];
  if (tools.length) {
    const top = 410;
    // Six or seven tools are drawn smaller, so that none stands on another.
    const size = tools.length > FLOW_FEW ? 36 : 46;
    const layout = flowLayout(tools, source.pairs, { width: width - left * 2, height: 580, cx: (width - left * 2) / 2, cy: 290, rx: 372, ry: 178, small: size, grow: size });
    pen.save();
    pen.translate(left, top);
    pen.lineCap = "round";
    for (const edge of [...layout.lines].reverse()) {
      pen.beginPath();
      pen.moveTo(edge.a.x, edge.a.y);
      pen.quadraticCurveTo(edge.bend[0], edge.bend[1], edge.b.x, edge.b.y);
      pen.lineWidth = edge.quiet ? 3 : edge.thick * 1.5;
      pen.globalAlpha = edge.opacity;
      pen.strokeStyle = edge.lit ? lime : paper;
      pen.stroke();
    }
    pen.globalAlpha = 1;
    for (const { tool, x, y, r, nameAt } of layout.nodes) {
      const image = tool.icon ? await pictureOf(tool.icon) : null;
      const side = r * 1.8;
      if (image && fromSite(tool)) {
        pen.save();
        pen.beginPath();
        pen.roundRect(x - side / 2, y - side / 2, side, side, side * .23);
        pen.clip();
        pen.fillStyle = "#ffffff";
        pen.fillRect(x - side / 2, y - side / 2, side, side);
        pen.drawImage(image, x - side / 2, y - side / 2, side, side);
        pen.restore();
      } else if (image) pen.drawImage(image, x - r * 1.1, y - r * 1.1, r * 2.2, r * 2.2);
      else {
        const tile = tileFor(tool);
        pen.beginPath();
        pen.roundRect(x - side / 2, y - side / 2, side, side, side * .23);
        pen.fillStyle = tile.color;
        pen.fill();
        pen.lineWidth = 2;
        pen.strokeStyle = "rgba(255, 255, 255, .16)";
        pen.stroke();
        write(tile.text, x, y + 2, { size: Math.round(side * .42), weight: 700, color: inkOn(tile.color), align: "center", spacing: -1, middle: true });
      }
      write(short(tool.name, 18), x, nameAt < y ? y - r - 24 : y + r + 46, { size: 30, weight: 600, color: muted, align: "center", spacing: -.6 });
      shareNodes.push({ name: tool.name, x: x + left, y: y + top, r });
    }
    for (const edge of [...layout.lines].reverse().filter((item) => item.numbered)) {
      pen.beginPath();
      pen.arc(edge.label[0], edge.label[1], edge.main ? 46 : 30, 0, Math.PI * 2);
      pen.fillStyle = ink;
      pen.fill();
      write(String(edge.count), edge.label[0], edge.label[1] + 2, { size: edge.main ? 50 : 30, weight: 700, color: edge.lit ? lime : paper, align: "center", spacing: -1.5, middle: true });
    }
    pen.restore();
  }

  // Three figures, each with two words under it.
  const stay = source.longest ? Math.max(1, Math.round(source.longest.seconds / 60)) : null;
  // A tool counts when it took at least a hundredth of the time.
  const used = visited.filter((tool) => tool.seconds >= source.totalSeconds / 100).length;
  const figures = [[source.perHour ?? "–", "changes of tool an hour"], [stay ? `${stay} min` : "–", "longest in one tool"], [used, used === 1 ? "tool" : "tools"]];
  figures.forEach(([figure, words], index) => {
    const x = left + [0, 328, 668][index];
    write(String(figure), x, 1142, { size: 92, spacing: -5, color: index === 0 ? lime : paper });
    write(words, x, 1186, { size: 25, weight: 500, color: muted });
  });

  pen.fillStyle = line;
  pen.fillRect(left, 1238, width - left * 2, 2);
  const span = source.span === "week" ? dates(source.fromDay, source.day) : dates(source.day, source.day);
  write(`${source.owner} · ${span}`, left, 1294, { size: 30, weight: 600 });
  const mark = await pictureOf("/brand/mason-mark.png");
  write("made with Mason", width - left - (mark ? 58 : 0), 1294, { size: 26, weight: 500, color: muted, align: "right" });
  if (mark) pen.drawImage(mark, width - left - 46, 1262, 46, 43);
}

/* Workflow: how the work with agents is done, to keep and to hand on */

// Thirty days of the agents' logs, as one workflow for all of the work and
// one for each thing the work was for. Reading them takes a few seconds.
let workflow = null;
let workflowPurpose = "all";
// The rules left out of what is shared. Until a rule is pressed, the three
// said most often go with it and the rest stay behind.
let workflowOut = null;
const RULES_SHARED = 3;
// Where the collection of workflows is kept, and the form that proposes one.
// Mason sends nothing there: it copies the file, and the form opens in the browser.
const REPOSITORY = "https://github.com/Baltsar/mason";
const COLLECTION = `${REPOSITORY}/tree/main/workflows`;
const COLLECTION_FORM = `${REPOSITORY}/issues/new?template=workflow.yml`;
// The workflow that is open in the share dialog, in the form the collection keeps.
let workflowCollect = null;
const AGENT_TONES = ["var(--lime)", "var(--paper)", "var(--gold)", "var(--cyan)"];
const lasted = (seconds) => seconds >= 3600 ? `${(seconds / 3600).toFixed(1)} h` : seconds >= 600 ? `${Math.round(seconds / 60)} min` : mmss(seconds);
const purposeWord = (key) => workflow.purposes.find((purpose) => purpose.key === key)?.word || "all of it";
const workflowCard = () => workflow.cards.find((card) => card.purpose === workflowPurpose) || workflow.cards[0];
const factsOf = (rows) => `<ul class="facts">${rows.filter(Boolean).map(([figure, words]) => `<li><b>${esc(figure)}</b><span>${esc(words)}</span></li>`).join("")}</ul>`;
const often = (rule) => rule.written ? "written in your rules" : `${rule.times} times · ${rule.projects} projects`;

async function loadWorkflow() {
  if (!workflow) renderWorkflow();
  workflow = await api("/api/workflow");
  if (view === "workflow") renderWorkflow();
}

// Someone else's workflow, opened from a file: theirs in large figures, one's
// own beside each, and their rules to take over one at a time.
let workflowOpened = null;

// What the opened file holds, kept to look again at whose rules already hold which rule.
let workflowOpenedText = "";

async function openWorkflow(file) {
  if (!file) return;
  const text = (await file.text()).slice(0, 300_000);
  try { workflowOpened = await post("/api/workflow/open", { text }); }
  catch { return toast("That is not a workflow from Mason."); }
  workflowOpenedText = text;
  drill.workflow = null;
  renderWorkflow();
}

// Back from an agent, the rules files may have changed: they are read again.
async function lookAgainAtOpened() {
  if (!workflowOpened || view !== "workflow") return;
  workflowOpened = await post("/api/workflow/open", { text: workflowOpenedText }).catch(() => workflowOpened);
  if (workflowOpened && view === "workflow") renderWorkflow();
}

function renderOpened() {
  const { theirs, mine } = workflowOpened;
  const you = (value) => value === null || value === undefined ? "" : `you: ${value}`;
  $("#workflow-meta").textContent = [theirs.by, theirs.purpose === "all" ? "all of their work" : purposeWord(theirs.purpose), theirs.from && theirs.to ? dates(theirs.from, theirs.to) : ""].filter(Boolean).join(" · ");
  $("#workflow-purposes").hidden = true;
  const most = theirs.agents[0];
  const bigs = $("#workflow-bigs");
  bigs.dataset.still = "true";
  renderBigs(bigs, [
    most && { key: "agents", number: most.share ?? "–", unit: "%", word: most.name, meta: mine.agents[0] ? you(`${mine.agents[0].share}% ${mine.agents[0].name}`) : "", tone: "var(--lime)" },
    theirs.perHour !== null && { key: "pace", number: theirs.perHour, word: "prompts an hour", meta: you(mine.perHour), tone: "var(--paper)" },
    theirs.parallel.usual !== null && { key: "spread", number: theirs.parallel.usual, word: theirs.parallel.usual === 1 ? "project a day" : "projects a day", meta: you(mine.parallel.usual), tone: "var(--gold)" },
    theirs.turn?.seconds && { key: "turn", number: lasted(theirs.turn.seconds).split(" ")[0], unit: lasted(theirs.turn.seconds).split(" ")[1] || "", word: "per prompt", meta: mine.turn ? you(lasted(mine.turn.seconds)) : "", tone: "var(--cyan)" },
  ].filter(Boolean), null);
  $("#workflow-drill").hidden = true;
  delete $("#workflow-drill").dataset.sig;

  const told = $("#workflow-rules");
  told.hidden = !theirs.rules.length;
  if (told.hidden) delete told.dataset.sig;
  else paint(told, JSON.stringify(["theirs", theirs.by, theirs.rules]), `<p class="label">What ${esc(theirs.by)} tells their agents</p><ol>${theirs.rules.map((rule, index) => `<li><p>${esc(rule.rule)}</p>${
    rule.held || !rule.hand ? `<span>Not offered: ${esc(rule.held)}</span>`
      : `<span class="hand">${rule.told.length ? `<em>${esc(rule.told.join(" and "))} ${rule.told.length === 1 ? "has" : "have"} it</em>` : ""}${rule.hand.links.filter((link) => !rule.told.includes(link.agent)).map((link) => `<a class="secondary" href="${esc(link.url)}" data-hand>${esc(link.agent)}</a>`).join("")}<button class="secondary" type="button" data-hand-copy="${index}">Copy prompt</button></span>`}</li>`).join("")}</ol>
    <p class="where">Mason writes none of this for you. A press opens that agent with a prompt ready and not sent: read it, press Enter, and the agent shows you the change before it saves. The prompt asks for one line in the file each of your agents reads its rules from.</p>`);
}

function renderWorkflow() {
  const share = $("#workflow-share");
  $("#workflow-open").hidden = !workflow;
  $("#workflow-back").hidden = !workflowOpened;
  $("#workflow-collection").hidden = !workflow;
  $("#workflow-collection").href = COLLECTION;
  if (!workflow) {
    $("#workflow-meta").textContent = "Reading thirty days of what you said to your agents";
    share.hidden = true;
    return;
  }
  if (workflowOpened) { share.hidden = true; return renderOpened(); }
  delete $("#workflow-bigs").dataset.still;
  const card = workflowCard();
  $("#nav-workflow").textContent = workflow.cards[0].perHour ?? "–";
  $("#workflow-meta").textContent = card.prompts ? `${dates(workflow.from, workflow.to)} · ${card.days} ${card.days === 1 ? "day" : "days"} with agents` : "Nothing was said to an agent in thirty days.";
  share.hidden = !card.prompts;

  // One workflow for all of the work, and one for each thing it was for.
  const purposes = $("#workflow-purposes");
  purposes.hidden = workflow.cards.length < 2;
  paint(purposes, JSON.stringify([workflow.cards.map((item) => item.purpose), card.purpose]), workflow.cards.map((item) => `<button type="button" data-purpose="${item.purpose}" aria-pressed="${item.purpose === card.purpose}">${esc(item.purpose === "all" ? "All of it" : purposeWord(item.purpose).replace(/^./, (letter) => letter.toUpperCase()))}</button>`).join(""));

  const most = card.agents[0];
  const screen = card.screen;
  renderBigs($("#workflow-bigs"), card.prompts ? [
    { key: "agents", number: most.share, unit: "%", word: most.name, meta: card.agents.length > 1 ? `${card.agents.length - 1} more` : "", tone: "var(--lime)" },
    { key: "pace", number: card.perHour ?? "–", word: "prompts an hour", meta: "", tone: "var(--paper)" },
    { key: "spread", number: card.parallel.usual ?? "–", word: card.parallel.usual === 1 ? "project a day" : "projects a day", meta: "", tone: "var(--gold)" },
    ...(screen?.waitSeconds ? [{ key: "wait", number: lasted(screen.waitSeconds), word: "an answer waits", meta: "", tone: "var(--cyan)" }] : []),
  ] : [], drill.workflow);

  const open = $("#workflow-drill");
  const name = card.prompts ? drill.workflow : null;
  open.hidden = !name;
  if (!name) delete open.dataset.sig;
  else {
    const head = (title, note) => `<header><h2>${title}</h2><p>${esc(note)}</p></header>`;
    const html = {
      agents: () => `${head("Who you say it to", `${card.prompts} prompts in ${card.days} days`)}
        <div class="drill-grid">
          <div>${barsOf(card.agents, (item) => item.name, (item) => item.prompts, "var(--lime)", (item) => `${item.share}%`)}</div>
          <div>${card.handed.length ? `<h3>Started by another agent, not by you</h3>${barsOf(card.handed, (item) => item.name, (item) => item.sessions, "var(--paper)", (item) => `${item.sessions}`)}` : ""}</div>
        </div>`,
      pace: () => `${head("A piece of work", card.piece ? `${card.piece.count} of them in ${card.days} days` : "too few to say what is usual")}
        ${factsOf([
          card.piece && [card.piece.prompts, `prompts, over ${card.piece.minutes} minutes`],
          card.piece && [`${card.piece.opener}${card.piece.atLeast ? "+" : ""}`, `words in the first prompt, ${card.piece.follower} in the ones after`],
          card.turn && [lasted(card.turn.seconds), "the agent works on one prompt"],
          card.turn && [lasted(card.turn.long), "on a long one: one in ten takes this or more"],
        ])}`,
      spread: () => `${head("How it is spread", `${Math.round(card.minutes / 60)} hours with agents`)}
        ${factsOf([
          [card.projects, `${card.projects === 1 ? "project" : "projects"} in ${card.days} days`],
          [card.parallel.usual, "on a usual day"],
          [`${card.parallel.share}%`, "of the time agents were at work in two projects at once"],
          card.tokens && [tokens(card.tokens.aDay), `tokens on a day of work, ${tokens(Math.round(card.tokens.written / Math.max(1, card.days)))} of them written by the agents`],
        ])}`,
      wait: () => `${head("Around a prompt", `from the ${screen.days} days Mason was watching`)}
        <div class="drill-grid">
          <div>${factsOf([
            [lasted(screen.waitSeconds), "a finished answer is usually left"],
            screen.left !== null && [`${screen.left}%`, "of your prompts: somewhere else within a minute"],
            screen.perHour && [screen.perHour, "changes of tool an hour"],
          ])}</div>
          <div><h3>Where the hands were</h3>${barsOf(screen.tools, (item) => `${item.name} · ${item.role}`, (item) => item.share, "var(--cyan)", (item) => `${item.share}%`)}</div>
        </div>`,
    }[name];
    paint(open, JSON.stringify([card.purpose, name, workflow.to, card.prompts]), html());
  }

  // What the agents were told again and again: the part someone else can take over.
  const told = $("#workflow-rules");
  told.hidden = !card.rules.length;
  if (told.hidden) delete told.dataset.sig;
  else paint(told, JSON.stringify(card.rules), `<p class="label">What you tell your agents, again and again</p><ol>${card.rules.map((rule) => `<li><p>${esc(rule.rule)}</p><span>${often(rule)}</span></li>`).join("")}</ol>`);
}

// The workflow as a picture: who is talked to, three figures, and the rules
// that were left in. No project, no file, nothing that was said.
async function drawWorkflow() {
  const card = workflowCard();
  workflowOut ||= new Set(card.rules.slice(RULES_SHARED).map((rule) => rule.id));
  const kept = card.rules.filter((rule) => !workflowOut.has(rule.id));
  $("#wshare-note").textContent = card.rules.length ? `${kept.length} of ${card.rules.length} rules go with it. Press one to put it in or leave it out. Read each: this is what others will see. The picture shows the first three.` : "The figures and the names of well-known tools. No project, no file, nothing you said.";
  paint($("#wshare-rules"), JSON.stringify([card.purpose, card.rules.map((rule) => rule.id), [...workflowOut]]), card.rules.map((rule) => `<article class="cut" data-wrule="${esc(rule.id)}" role="button" tabindex="0" aria-pressed="${!workflowOut.has(rule.id)}"><p>${esc(rule.rule)}</p><footer>${often(rule)}</footer></article>`).join(""));

  // The same workflow as the collection would keep it, ready for when that is pressed.
  workflowCollect = null;
  $("#wshare-collect").disabled = true;
  post("/api/workflow/collect", { purpose: card.purpose, rules: kept.map((rule) => rule.id) }).then((ready) => {
    if (workflowCard() !== card) return;
    workflowCollect = ready;
    $("#wshare-collect").disabled = false;
    if (ready.dropped.length) $("#wshare-note").textContent += ` The collection leaves out ${ready.dropped.length === 1 ? "one of them" : `${ready.dropped.length} of them`}: ${ready.dropped[0].why}.`;
  }).catch(() => {});

  const canvas = $("#wshare-canvas");
  const pen = canvas.getContext("2d");
  const { width, height, left, ink, paper, lime, muted, line } = POSTER;
  const inner = width - left * 2;
  const colours = [lime, paper, "#d6a647", "#6fe4ff"];
  const write = (text, x, y, { size, weight = 720, color = paper, align = "left", spacing = 0 }) => {
    pen.font = `${weight} ${size}px ${FACE}`;
    pen.fillStyle = color;
    pen.textAlign = align;
    pen.textBaseline = "alphabetic";
    if ("letterSpacing" in pen) pen.letterSpacing = `${spacing}px`;
    pen.fillText(text, x, y);
    return pen.measureText(text).width;
  };
  // The size at which a line fits the width, starting from the one asked for.
  const fitted = (text, size, spacing) => {
    for (let now = size; now > 40; now -= 4) {
      pen.font = `720 ${now}px ${FACE}`;
      if ("letterSpacing" in pen) pen.letterSpacing = `${spacing * (now / size)}px`;
      if (pen.measureText(text).width <= inner) return now;
    }
    return 40;
  };
  pen.setTransform(1, 0, 0, 1, 0, 0);
  pen.globalAlpha = 1;
  pen.fillStyle = ink;
  pen.fillRect(0, 0, width, height);

  write("How I work", left, 212, { size: 136, spacing: -9 });
  const second = card.purpose === "all" ? "with agents." : `on ${purposeWord(card.purpose)}.`;
  const size = fitted(second, 136, -9);
  write(second, left, 340, { size, spacing: -9 * (size / 136), color: lime });

  // Who it is said to: one bar, shared out by the prompts each agent got.
  write(`${card.prompts} prompts · ${card.days} days`, left, 446, { size: 26, weight: 500, color: muted });
  const agents = card.agents.filter((agent) => agent.share >= 1).slice(0, 4);
  let x = left;
  agents.forEach((agent, index) => {
    const wide = Math.max(10, Math.round((agent.share / 100) * inner) - 6);
    pen.beginPath();
    pen.roundRect(x, 478, Math.min(wide, left + inner - x), 34, 10);
    pen.fillStyle = colours[index];
    pen.fill();
    x += wide + 6;
  });
  x = left;
  agents.forEach((agent, index) => {
    const share = write(`${agent.share}%`, x, 584, { size: 50, spacing: -2.5, color: colours[index] });
    const named = write(agent.name, x + share + 14, 584, { size: 30, weight: 600, color: muted, spacing: -.6 });
    x += share + named + 54;
  });

  const figures = [[card.perHour ?? "–", "prompts an hour"], [card.turn ? lasted(card.turn.seconds) : "–", "an agent works on one"], [card.parallel.usual ?? "–", card.parallel.usual === 1 ? "project a day" : "projects a day"]];
  figures.forEach(([figure, words], index) => {
    const at = left + [0, 328, 668][index];
    write(String(figure), at, 760, { size: 92, spacing: -5, color: index === 0 ? lime : paper });
    write(words, at, 804, { size: 25, weight: 500, color: muted });
  });

  // The rules that go with it, or, with none, how a piece of work runs.
  const shown = kept.slice(0, RULES_SHARED);
  pen.fillStyle = line;
  pen.fillRect(left, 866, inner, 2);
  if (shown.length) {
    write("What I tell them every time", left, 914, { size: 25, weight: 500, color: muted });
    let y = 964;
    for (const rule of shown) {
      // At most two lines for a rule; the rest of a long one is cut with a mark.
      pen.font = `620 32px ${FACE}`;
      if ("letterSpacing" in pen) pen.letterSpacing = "-1px";
      const rows = [""];
      for (const word of rule.rule.split(/\s+/)) {
        const tried = rows.at(-1) ? `${rows.at(-1)} ${word}` : word;
        if (pen.measureText(tried).width <= inner - 44) rows[rows.length - 1] = tried;
        else rows.push(word);
      }
      if (rows.length > 2) { rows.length = 2; rows[1] = `${rows[1].replace(/[.,;:]$/, "")}…`; }
      pen.fillStyle = lime;
      pen.fillRect(left, y - 25, 6, rows.length * 40 - 10);
      rows.forEach((row, index) => write(row, left + 28, y + index * 40, { size: 32, weight: 620, spacing: -1 }));
      y += rows.length * 40 + 20;
    }
    // With a rule or two there is room to say how a piece of work runs.
    if (shown.length < RULES_SHARED && card.piece) write(`A piece of work: ${card.piece.prompts} prompts over ${card.piece.minutes} minutes.`, left, 1190, { size: 30, weight: 600, color: muted, spacing: -.6 });
  } else if (card.piece) {
    write("A piece of work", left, 920, { size: 25, weight: 500, color: muted });
    write(`${card.piece.prompts} prompts over ${card.piece.minutes} minutes.`, left, 990, { size: 50, spacing: -2.5 });
    write(`${card.piece.opener}${card.piece.atLeast ? "+" : ""} words first, then ${card.piece.follower}.`, left, 1056, { size: 50, spacing: -2.5, color: muted });
  }

  pen.fillStyle = line;
  pen.fillRect(left, 1238, inner, 2);
  write(`${workflow.owner} · ${dates(workflow.from, workflow.to)}`, left, 1294, { size: 30, weight: 600 });
  const mark = await pictureOf("/brand/mason-mark.png");
  write("made with Mason", width - left - (mark ? 58 : 0), 1294, { size: 26, weight: 500, color: muted, align: "right" });
  if (mark) pen.drawImage(mark, width - left - 46, 1262, 46, 43);
}

/* Days: the long view */

// The four biggest projects of a month have a colour of their own. Red is
// kept for what it means elsewhere: social, and a stop.
const PALETTE = ["var(--lime)", "var(--gold)", "var(--cyan)", "var(--paper)"];
const brief = (count) => count >= 60 ? `${Math.round(count / 60)}h` : `${count}m`;

async function loadDays() {
  days = await api("/api/days");
  month ||= days.today.slice(0, 7);
  if (view === "days") renderDays();
}

function renderDays() {
  if (!days) return;
  const [year, number] = month.split("-").map(Number);
  const length = new Date(year, number, 0).getDate();
  const keys = Array.from({ length }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
  const all = Object.keys(days.days).sort();
  const first = (all[0] || days.today).slice(0, 7);
  $("#days-meta").textContent = new Date(year, number - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  $('[data-month-step="-1"]').disabled = month <= first;
  $('[data-month-step="1"]').disabled = month >= days.today.slice(0, 7);

  const totals = new Map();
  for (const key of keys) {
    for (const [name, work] of Object.entries(days.days[key] || {})) {
      const total = totals.get(name) || { name, minutes: 0, prompts: 0, days: 0, tokens: 0 };
      total.tokens += work.tokens || 0;
      total.minutes += work.minutes;
      total.prompts += work.prompts;
      total.days += 1;
      totals.set(name, total);
    }
  }
  const projects = [...totals.values()].sort((a, b) => b.minutes - a.minutes).map((project, rank) => ({ ...project, tone: PALETTE[rank] || "var(--grey)" }));
  const toneOf = new Map(projects.map((project) => [project.name, project.tone]));
  if (lane && !toneOf.has(lane)) lane = null;
  const worked = (key) => Object.entries(days.days[key] || {}).filter(([name]) => !lane || name === lane).sort((a, b) => b[1].minutes - a[1].minutes);
  const sum = (key) => worked(key).reduce((total, [, work]) => total + work.minutes, 0);
  const workedDays = keys.filter((key) => sum(key) > 0);
  const total = workedDays.reduce((count, key) => count + sum(key), 0);
  // What the agents took that month, by their own logs' count.
  const took = keys.reduce((count, key) => count + worked(key).reduce((ofDay, [, work]) => ofDay + (work.tokens || 0), 0), 0);
  renderBigs($("#days-bigs"), [
    { key: "days", number: workedDays.length, word: workedDays.length === 1 ? "day" : "days", meta: "", tone: "var(--paper)" },
    { key: "hours", number: Math.round(total / 60), unit: "h", word: "with agents", meta: "", tone: "var(--lime)" },
    ...(took ? [{ key: "tokens", number: tokens(took).slice(0, -1), unit: tokens(took).slice(-1), word: "tokens", meta: "", tone: "var(--gold)" }] : []),
  ], null);

  const busiest = Math.max(1, ...keys.map(sum));
  const blanks = (new Date(year, number - 1, 1).getDay() + 6) % 7;
  // The weeks that have not begun yet are left out of the month that is still running.
  const now = keys.indexOf(days.today);
  const until = now < 0 ? length : Math.min(length, now + 7 - (blanks + now) % 7);
  const cells = keys.slice(0, until).map((key, index) => {
    const minutesOfDay = sum(key);
    const today = key === days.today ? "data-today" : "";
    if (!minutesOfDay) return `<div class="day rest" ${today}><small>${index + 1}</small></div>`;
    return `<button class="day" type="button" data-day="${key}" aria-pressed="${dayOpen === key}" ${today} style="--heat:${(minutesOfDay / busiest).toFixed(2)}"><small>${index + 1}</small><b>${brief(minutesOfDay)}</b><i class="mix">${worked(key).map(([name, work]) => `<u style="flex:${work.minutes};--tone:${toneOf.get(name)}"></u>`).join("")}</i></button>`;
  });
  paint($("#days-month"), JSON.stringify([month, lane, dayOpen, days.through, days.today]), `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name) => `<span class="wd">${name}</span>`).join("")}${"<span></span>".repeat(blanks)}${cells.join("")}`);

  const open = $("#days-drill");
  const shown = dayOpen && dayOpen.startsWith(month) ? Object.entries(days.days[dayOpen] || {}).sort((a, b) => b[1].minutes - a[1].minutes) : [];
  open.hidden = !shown.length;
  if (!shown.length) delete open.dataset.sig;
  else {
    const most = Math.max(1, shown[0][1].minutes);
    const moved = days.moves[dayOpen];
    paint(open, JSON.stringify([dayOpen, shown, moved]), `<header><h2>${dateOf(dayOpen).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</h2>${moved ? `<p>${moved.jumps} jumps · ${minutes(moved.seconds)} in front</p><button type="button" data-flow-day="${dayOpen}">Flow →</button>` : ""}</header>
      <ul class="bars wide">${shown.map(([name, work]) => `<li style="--w:${Math.round((work.minutes / most) * 100)}%;--tone:${toneOf.get(name)}"><span>${esc(name)}</span><i></i><b>${minutes(work.minutes * 60)}${work.tokens ? ` · ${tokens(work.tokens)}` : ""}</b></li>`).join("")}</ul>
      ${shown.some(([, work]) => work.tokens) ? `<p class="took">${tokens(shown.reduce((count, [, work]) => count + (work.tokens || 0), 0))} tokens, ${tokens(shown.reduce((count, [, work]) => count + (work.written || 0), 0))} of them written by the agents. The rest is what they read, most of it the same conversation again.</p>` : ""}`);
  }

  // Each project's month as a strip: the days it was worked on.
  const lanes = $("#days-lanes");
  if (lane) lanes.dataset.picked = "true"; else delete lanes.dataset.picked;
  paint(lanes, JSON.stringify([month, lane, days.through, projects.map((project) => [project.name, project.minutes])]), projects.map((project) => {
    const peak = Math.max(1, ...keys.map((key) => days.days[key]?.[project.name]?.minutes || 0));
    const strip = keys.map((key) => {
      const count = days.days[key]?.[project.name]?.minutes || 0;
      return count ? `<u data-on style="--heat:${(count / peak).toFixed(2)}"></u>` : "<u></u>";
    }).join("");
    return `<button class="lane" type="button" data-lane="${esc(project.name)}" aria-pressed="${lane === project.name}" style="--tone:${project.tone};--n:${length}"><i class="dot"></i><b>${esc(project.name)}</b><span class="strip">${strip}</span><span class="time">${minutes(project.minutes * 60)}</span></button>`;
  }).join("") || `<p class="empty">Nothing was built this month.</p>`);
}

/* Recap and Agents */

const mmss = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds) % 60).padStart(2, "0")}`;

function renderRecap() {
  const { podcast, map } = snapshot;
  const { episode } = podcast;
  const busy = podcast.status === "writing" || podcast.status === "recording";
  const onAir = Boolean(podcast.playing);
  $("#recap-meta").textContent = episode ? episode.week : "The last seven days";
  $("#recap-heading").textContent = episode ? episode.title : "Your week, as news.";
  const play = $("#play-week");
  play.textContent = busy ? (podcast.status === "writing" ? "Writing…" : "Recording…") : onAir ? "Stop" : episode ? `Play · ${mmss(episode.seconds)}` : "Make episode";
  play.disabled = busy;
  play.dataset.state = busy ? "busy" : onAir ? "on" : "idle";
  $("#play-recap").textContent = todayPlaying ? "Stop" : "Today";
  $("#play-recap").hidden = onAir || busy;
  $("#new-week").hidden = !episode || busy || onAir;
  const beats = episode?.headlines.length ? episode.headlines : map.recap.decisions.slice(0, 6).map((item) => item.title);
  paint($("#recap-grid"), `${episode?.key}-${map.recap.generatedAt}`, beats.map((title, index) => `<article><small>${String(index + 1).padStart(2, "0")}</small><h2>${esc(title)}</h2></article>`).join(""));
  if (podcast.status === "failed" && podcast.error !== toldError) toast(podcast.error);
  toldError = podcast.status === "failed" ? podcast.error : null;
  onAirNow();
  clearInterval(airTimer);
  if (onAir) airTimer = setInterval(onAirNow, 400);
}

// The line being read, worked out from how far in the episode is. The share of
// the text that has gone by is close to the share of the time.
function onAirNow() {
  const node = $("#onair");
  const { episode, playing: started } = snapshot.podcast;
  if (!episode || !started || view !== "recap") { node.hidden = true; return clearInterval(airTimer); }
  const share = Math.min(1, (Date.now() - started.startedAt) / 1000 / episode.seconds);
  const total = episode.lines.reduce((sum, line) => sum + line.text.length, 0);
  let read = 0;
  const line = episode.lines.find((item) => (read += item.text.length) / total > share) || episode.lines.at(-1);
  node.hidden = false;
  node.dataset.speaker = line.speaker;
  $("i", node).style.width = `${share * 100}%`;
  $("small", node).textContent = line.speaker === "anchor" ? "Studio" : "Field";
  if ($("p", node).textContent !== line.text) $("p", node).textContent = line.text;
}

// The same memory by address: it needs the key of this start, which the
// command does not, since that one reads the files and asks no server.
const mcpByAddress = (secret) => `{
  "mcpServers": {
    "mason": {
      "type": "http",
      "url": "${location.origin}/mcp",
      "headers": { "Authorization": "Bearer ${secret}" }
    }
  }
}`;

function renderAgents() {
  paint($("#mcp-config"), "config", esc(`{
  "mcpServers": {
    "mason": {
      "command": "node",
      "args": ["…/apprentice/src/mcp.mjs"]
    }
  }
}`));
  // The address works too, for an agent that cannot start a command. The key
  // is not shown: what stands in a window is read by whatever reads the screen.
  paint($("#mcp-http"), "http", esc(mcpByAddress("new at every start")));
  paint($("#tools"), "tools", TOOLS.map(([name, label], index) => `<button type="button" data-tool="${name}"><small>${String(index + 1).padStart(2, "0")}</small><b>${esc(label)}</b></button>`).join(""));
}

/* Settings */

const tokens = (count) => count >= 1_000_000_000 ? `${(count / 1_000_000_000).toFixed(1)}B` : count >= 10_000_000 ? `${Math.round(count / 1_000_000)}M` : count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count);
const thousands = (count) => count >= 10_000 ? `${Math.round(count / 1000)}k` : String(count);

// Three questions, one line per answer: what Mason reads, what it sends away
// from this Mac, and where it keeps what it learned.
function renderSettings() {
  const node = $("#settings");
  if (!prefs) return paint(node, "loading", "");
  const { settings, status, name } = prefs;
  const row = (key, label, note = "") => `<div class="set"><span>${label}</span><span class="with">${note}<button class="switch" type="button" role="switch" aria-checked="${settings[key]}" aria-label="${label}" data-setting="${key}"></button></span></div>`;
  const on = (text) => `<b>${esc(text)}</b>`;
  const off = (text) => `<b data-off>${esc(text)}</b>`;
  const { model, logs, said } = status;
  // How the nudges of the last week went, in place of a setting for them.
  const { said: nudges = 0, followed = 0, quiet = [] } = snapshot?.nudges || {};
  const nudged = nudges ? `${nudges} this week · ${followed} followed${quiet.length ? " · one kind gone quiet" : ""}` : "When an answer is ready";
  const reader = !settings.meaning ? off("Not read")
    : !said.ready ? off(said.missing === "runner" ? "llama.cpp not found" : "No model in data/models")
    : said.waiting ? on(`Reading · ${thousands(said.waiting)} to go`)
    : on(`${thousands(said.count)} read · ${said.onThisMac ? "on this Mac" : said.where}`);
  const applied = snapshot?.suggestions?.applied || [];
  const writer = model.problem ? `${model.name || "Model"} · ${model.problem}`
    : model.ready ? (model.name === "Claude" ? "Claude" : `${model.name} · ${model.onThisMac ? "on this Mac" : model.where}`) : model.name === "Claude" ? "Claude not found" : "No model named";
  // A model that refuses is said with what to do about it: nothing else shows it.
  const mend = !model.problem || !settings.summaries ? ""
    : model.problem !== "login expired" ? `${model.name || "The model"} gave no answer the last time it was asked. Summaries, proposals and the recap wait until it does.`
    : model.name === "Claude" ? "Summaries, proposals and the recap wait for a login. Open a terminal, run claude, then /login."
    : `Summaries, proposals and the recap wait: ${model.where} did not take the key in APPRENTICE_LLM_KEY.`;
  // What the model took, where the switch for it is: today in the row, the week under it.
  const { usage, update } = status;
  const spent = usage.today.tokens ? ` · ${tokens(usage.today.tokens)} tokens today` : "";
  const most = usage.week.by[0];
  const week = usage.week.calls ? `7 days: ${tokens(usage.week.tokens)} tokens in ${usage.week.calls} ${usage.week.calls === 1 ? "call" : "calls"}${most && usage.week.by.length > 1 ? `, ${Math.round((most.tokens / usage.week.tokens) * 100)}% of it ${most.purpose}` : ""}. A summary is written an hour after you leave a project, not while you work in it.` : "";
  const voice = !status.elevenLabsKey ? off("No key in .env.local") : !settings.elevenlabs ? off("Mac voice, no calls") : status.credits ? on(`ElevenLabs · ${thousands(status.credits.left)} credits left`) : on("ElevenLabs");
  paint(node, JSON.stringify([prefs, applied, snapshot?.nudges]), `
    <label class="set"><span>Name</span><input id="set-name" type="text" value="${esc(settings.name || name)}" maxlength="40" autocomplete="off" spellcheck="false" /></label>
    <p class="group">Leaves this Mac</p>
    ${row("summaries", "Summaries", settings.summaries ? (model.ready ? on(`${writer}${spent}`) : off(writer)) : off("Your own words"))}
    ${mend ? `<p class="fine mend">${esc(mend)}</p>` : settings.summaries && week ? `<p class="fine under">${esc(week)}</p>` : ""}
    ${status.elevenLabsKey ? row("elevenlabs", "Voice", voice) : `<div class="set"><span>Voice</span>${voice}</div>`}
    ${row("logos", "Logos from the web", settings.logos ? on("Asks each site once") : off("Lettered tiles"))}
    ${row("updates", "New versions", !settings.updates ? off("Not looked for") : update.latest ? on(`${update.latest.version} is out`) : on(`Up to date · ${update.version}`))}
    ${settings.updates && update.latest ? `<p class="fine under">This is Mason ${esc(update.version)}. <a href="${esc(update.latest.url)}" target="_blank" rel="noopener">See what is new in ${esc(update.latest.version)}, and how to get it</a>. Mason installs nothing by itself.</p>` : ""}
    <p class="group">Stays on this Mac</p>
    <div class="set"><span>Screen</span>${status.access === "on" ? on("App, window, site") : `<button class="primary" type="button" data-fix-access>Fix access</button>`}</div>
    ${row("logs", "Agent logs", settings.logs ? on([`Claude Code ${logs.claude}`, logs.codex ? `Codex ${logs.codex}` : "", logs.grok ? `Grok ${logs.grok}` : "", logs.cursor ? `Cursor ${logs.cursor}` : ""].filter(Boolean).join(" · ")) : off("Not read"))}
    ${row("meaning", "What you said, by meaning", reader)}
    ${row("chats", "Chat and mail by name", settings.chats ? on("Name and time") : off("Counted, not named"))}
    <p class="group">Look and sound</p>
    ${row("speech", "Sound")}
    ${row("ready", "Answer ready", settings.ready ? on("A card when an agent is done") : off("Not said"))}
    ${row("chime", "A lute with it", settings.chime ? on("Two notes") : off("Silent"))}
    ${row("cues", "A word on the island", settings.cues ? on(nudged) : off("Silent"))}
    ${row("island", "Island by the notch", settings.island ? on("Shows the day") : off("An icon among the others"))}
    <div class="barpicks" role="group" aria-label="Where Mason sits in the menu bar">${[[true, "Island", "Beside the notch, with the day in it"], [false, "Icon", "One mark among the others"]].map(([island, name, note]) => `<button type="button" class="barpick" data-island="${island}" aria-pressed="${settings.island === island}">
      <span class="minibar" data-kind="${island ? "island" : "icon"}"><i class="menus"></i>${island ? `<i class="isle">${snapshot?.activity?.workPercent ?? 65}%</i>` : ""}<i class="notch"></i>${island ? `<i class="eye"></i>` : ""}<i class="gap"></i>${island ? "" : `<i class="mark"></i>`}<i class="dots"></i></span>
      <b>${name}</b><small>${note}</small></button>`).join("")}</div>
    ${row("glass", "Liquid glass", settings.glass ? on("A look to try") : off("Dark"))}
    ${applied.length ? `<p class="group">In your agents' rules</p>${applied.map((rule) => `<div class="set rule"><span>${esc(rule.rule)}</span><b>${esc(rule.by.join(" · "))}</b></div>`).join("")}` : ""}
    <p class="group">Kept on this Mac</p>
    <div class="set files"><span>Open</span><span class="with"><button class="secondary" type="button" data-reveal="reveal" title="${esc(status.data)}">Memory</button><button class="secondary" type="button" data-reveal="notes">Notes for Obsidian</button></span></div>
    ${said.count ? `<div class="set files"><span>${thousands(said.count)} prompts, read by meaning</span><button class="secondary" type="button" data-forget-said>Forget</button></div>` : ""}
    <p class="fine">No screenshots, no keystrokes, and of a page in a browser only the site. With everything under Leaves this Mac switched off, nothing does.</p>
    <p class="fine">Evaluation copy. Has been since day one.</p>`);
}

async function loadPrefs() {
  prefs = await api("/api/settings");
  if (view === "settings") renderSettings();
}

/* Shell */

function renderShell() {
  const { activity, runtime, presence } = snapshot;
  $("#nav-today").textContent = activity.totalSeconds ? `${activity.workPercent}%` : "–";
  $("#nav-flow").textContent = activity.totalSeconds ? snapshot.flow.jumps : "–";
  $("#nav-days").textContent = snapshot.days || "–";
  $("#nav-built").textContent = snapshot.built || "–";
  const pill = $("#presence");
  pill.dataset.state = presence;
  $("span", pill).textContent = {
    watching: snapshot.now.project || runtime.currentApp || "Watching",
    "private-surface": "Private",
    private: "Private",
    paused: "Paused",
    idle: "Idle",
    permission: "Fix access",
    starting: "Starting",
  }[presence];
  pill.title = presence === "permission" ? "Ask macOS for access again" : runtime.offTheRecord ? "Resume observing" : "Go private: nothing is recorded until you resume";
}

function render() {
  applyLook();
  renderShell();
  ({ today: renderToday, flow: renderFlow, days: renderDays, workflow: renderWorkflow, built: renderBuilt, more: renderMore, find: renderFind, recap: renderRecap, agents: renderAgents, settings: renderSettings })[view]();
}

async function load() {
  snapshot = await api("/api/state");
  render();
  // Today's flow follows the day as it happens; an earlier day is finished.
  if (view === "flow" && !flowDay) loadFlow().catch(() => {});
}

function show(name, arg) {
  view = VIEWS.includes(name) ? name : LEGACY[name] || "today";
  $$("[data-page]").forEach((section) => { section.hidden = section.dataset.page !== view; });
  $$("[data-view]").forEach((button) => button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false"));
  if (view === "flow") {
    // "#flow/2026-10-03" opens that day; without a day it is today.
    if (arg !== undefined) { flowDay = DAY.test(arg) ? arg : null; flowTool = null; }
    loadFlow().catch(() => {});
  } else if (arg !== undefined && view in drill) drill[view] = arg || null;
  history.replaceState(null, "", `#${view}`);
  if (view === "settings") loadPrefs().catch(() => {});
  if (view === "days") loadDays().catch(() => {});
  if (view === "workflow") loadWorkflow().catch(() => {});
  if (view === "built") loadBuilt().catch(() => {});
  if (view === "find") {
    // Opened from a nudge about work done before: what was just said is looked for.
    const nudge = snapshot?.nudges?.latest;
    if (nudge?.kind === "before" && !$("#find-query").value) { $("#find-query").value = nudge.query; post("/api/nudge", { id: nudge.id }).catch(() => {}); }
    seek($("#find-query").value.trim()).catch(() => {});
    $("#find-query").focus();
  }
  window.scrollTo(0, 0);
  if (snapshot) render();
}
// The desktop app steers the window: a line pressed in the drop panel lands here.
window.apprenticeGo = (target) => {
  const [name, arg] = String(target).split("/");
  show(name, arg ?? "");
  load();
};

/* Voice: press, speak, and ElevenLabs Scribe v2 Realtime writes it into the field. */

async function speakInto(button) {
  if (listening) return listening.stop();
  const target = $(`#${button.dataset.mic}`);
  const before = target.value.trim();
  button.setAttribute("aria-pressed", "true");
  try {
    listening = await dictate({
      language: snapshot.voice.language,
      onPartial: (text) => { target.value = `${before} ${text}`.trim(); },
      onLevels: (bars) => button.style.setProperty("--level", (bars.reduce((sum, bar) => sum + bar, 0) / bars.length).toFixed(2)),
    });
    const text = await listening.done;
    if (text) { target.value = `${before} ${text}`.trim(); target.dataset.spoken = "true"; }
    else toast("Nothing was heard. Press the microphone and say it again.");
  } catch (error) {
    toast(error.name === "NotAllowedError" ? "The microphone is blocked for Mason. Allow it in System Settings, or type." : error.message);
  } finally {
    listening = null;
    button.setAttribute("aria-pressed", "false");
    button.style.removeProperty("--level");
    target.focus();
  }
}

const sourceOf = (node) => node?.dataset.spoken ? "voice" : "typed";

/* Events */

async function act(event) {
  const target = event.target;
  const nav = target.closest("[data-view]");
  if (nav) return show(nav.dataset.view);

  const turned = target.closest("[data-built]");
  if (turned) {
    const what = turned.dataset.built;
    if (what === "show") builtShown = true;
    else if (what === "where") builtWhere = true;
    else if (what === "skip") {
      // The next question of the project, and after its last one the next project.
      const more = builtAt.card + 1 < built.projects[builtAt.project].cards.length;
      builtAt = more ? { project: builtAt.project, card: builtAt.card + 1 } : { project: (builtAt.project + 1) % built.projects.length, card: 0 };
    } else {
      // Known or not: the card leaves, and comes back when it is due.
      const asked = built.projects[builtAt.project].cards[builtAt.card];
      built = await post("/api/built", { id: asked.id, knew: what === "knew" });
    }
    if (what !== "show" && what !== "where") { builtShown = false; builtWhere = false; }
    return renderBuilt();
  }
  const about = target.closest("[data-built-project]");
  if (about) { builtAt = { project: Number(about.dataset.builtProject), card: 0 }; builtShown = false; builtWhere = false; return renderBuilt(); }
  if (target.closest("#today-said")) { waitedOpen = !waitedOpen; return render(); }
  if (target.closest("[data-lookback-open]")) { lookbackOpen = !lookbackOpen; return render(); }
  if (target.closest("[data-propose-open]")) { proposeOpen = !proposeOpen; return render(); }
  const proposed = target.closest("[data-propose]");
  if (proposed) {
    snapshot.suggestions = await post("/api/suggestions", { action: proposed.dataset.propose, id: proposed.dataset.id });
    proposeOpen = false;
    return render();
  }
  if (target.closest("[data-welcome-access]")) {
    welcomeAsked = true;
    await post("/api/access", { action: "fix" });
    return render();
  }
  if (target.closest("[data-welcome-done]")) {
    await post("/api/welcome");
    snapshot.welcome.show = false;
    return render();
  }
  if (target.closest("[data-trial-end]")) {
    await post("/api/trial");
    snapshot.trial.due = false;
    return render();
  }
  if (target.closest("[data-propose-copy]")) {
    const prompt = snapshot.suggestions?.open?.[0]?.hand?.prompt;
    return toast(prompt && await copyText(prompt) ? "Copied. Paste it to the agent you choose, and read it before you send it." : "Could not copy.");
  }

  const step = target.closest("[data-flow-step]");
  if (step) {
    const next = flow.days[flow.days.indexOf(flow.day) + Number(step.dataset.flowStep)];
    if (!next) return;
    flowDay = next === flow.today ? null : next;
    flowTool = null;
    return loadFlow();
  }
  if (target.closest("#flow-tools [data-all]")) { flowAll = !flowAll; return renderFlow(); }
  if (target.closest("#flow-share")) {
    if (!flow?.totalSeconds) return toast("Nothing to share yet.");
    shareSpan = "day";
    $("#share").showModal();
    return loadShare();
  }
  if (target.closest("#share-close")) return $("#share").close();
  const purpose = target.closest("[data-purpose]");
  if (purpose) { workflowPurpose = purpose.dataset.purpose; drill.workflow = null; workflowOut = null; return renderWorkflow(); }
  if (target.closest("#workflow-share")) { $("#wshare").showModal(); return drawWorkflow(); }
  if (target.closest("#wshare-collect") && workflowCollect) {
    // The file is copied here; the form it is pasted into opens in the browser, and is sent from there or not at all.
    const copying = copyText(workflowCollect.text);
    const link = Object.assign(document.createElement("a"), { href: COLLECTION_FORM, target: "_blank", rel: "noopener" });
    link.click();
    return toast(await copying ? "Copied. Paste it in the form that opened, and send it from there." : "Could not copy. Save the file instead, and paste what is in it.");
  }
  if (target.closest("#workflow-open")) return $("#workflow-file").click();
  if (target.closest("#workflow-back")) { workflowOpened = null; return renderWorkflow(); }
  const handed = target.closest("[data-hand-copy]");
  if (handed && workflowOpened) {
    const rule = workflowOpened.theirs.rules[Number(handed.dataset.handCopy)];
    return toast(await copyText(rule.hand.prompt) ? "Copied. Paste it to the agent you choose, and read it before you send it." : "Could not copy.");
  }
  if (target.closest("[data-hand]")) return toast("Opened with the prompt ready. Nothing is sent until you press Enter there.");
  if (target.closest("#wshare-close")) return $("#wshare").close();
  const told = target.closest("[data-wrule]");
  if (told) { if (!workflowOut.delete(told.dataset.wrule)) workflowOut.add(told.dataset.wrule); return drawWorkflow(); }
  if (target.closest("#wshare-save")) {
    const card = workflowCard();
    const saved = await post("/api/workflow", { purpose: card.purpose, rules: card.rules.filter((rule) => !workflowOut.has(rule.id)).map((rule) => rule.id), image: $("#wshare-canvas").toDataURL("image/png") });
    return toast(`Saved: ${saved.file}`);
  }
  if (target.closest("#flow-replay")) { replayPiece = null; replayOut.clear(); $("#replay").showModal(); return loadReplay(); }
  if (target.closest("#replay-close")) return $("#replay").close();
  const piece = target.closest("[data-replay-piece]");
  if (piece) { replayPiece = piece.dataset.replayPiece; replayOut.clear(); return loadReplay(); }
  if (target.closest("#replay-names")) { replayNames = !replayNames; return loadReplay(); }
  const cut = target.closest("[data-replay-line]");
  if (cut) { if (!replayOut.delete(cut.dataset.replayLine)) replayOut.add(cut.dataset.replayLine); return renderReplay(); }
  if (target.closest("#replay-save")) {
    const saved = await post("/api/replay", { action: "save", piece: replay.piece, names: replayNames, hidden: [...replayOut] });
    return toast(`Saved: ${saved.file}`);
  }
  if (target.closest("#replay-copy")) {
    const { text } = await post("/api/replay", { action: "text", piece: replay.piece, names: replayNames, hidden: [...replayOut] });
    return toast(await copyText(text) ? "Copied. Paste it where you want it read." : "Could not copy. Save the page instead.");
  }
  const span = target.closest("[data-share-span]");
  if (span) { shareSpan = span.dataset.shareSpan; return loadShare(); }
  if (target.closest("#share-tools [data-all]")) { shareAll = !shareAll; return drawShare(); }
  const chosen = target.closest("#share-tools [data-tool]");
  if (chosen) {
    // A tool pressed by name goes into the picture, or out of it.
    const name = chosen.dataset.tool;
    if (shareChosen.has(name)) shareChosen.delete(name);
    else if (shareChosen.size < SHARE_MOST) shareChosen.add(name);
    return drawShare();
  }
  if (target.closest("#share-canvas")) {
    // A tool pressed in the picture is left out of it.
    const canvas = $("#share-canvas");
    const box = canvas.getBoundingClientRect();
    const [x, y] = [(event.clientX - box.left) * (canvas.width / box.width), (event.clientY - box.top) * (canvas.height / box.height)];
    const hit = shareNodes.find((node) => Math.hypot(node.x - x, node.y - y) <= node.r + 18);
    if (!hit) return;
    shareChosen.delete(hit.name);
    return drawShare();
  }
  if (target.closest("#share-save")) {
    const saved = await post("/api/share", { image: $("#share-canvas").toDataURL("image/png"), label: `${shareFlow.span} ${shareFlow.day}` });
    return toast(`Saved: ${saved.file}`);
  }
  const tool = target.closest(".flowmap [data-tool], #flow-tools [data-tool], #flow-tool [data-tool], #flow-drill [data-tool]");
  if (tool) { flowTool = flowTool === tool.dataset.tool ? null : tool.dataset.tool; return renderFlow(); }
  const turn = target.closest("[data-month-step]");
  if (turn) {
    const [year, number] = month.split("-").map(Number);
    const moved = new Date(year, number - 1 + Number(turn.dataset.monthStep), 1);
    month = `${moved.getFullYear()}-${String(moved.getMonth() + 1).padStart(2, "0")}`;
    dayOpen = null;
    return renderDays();
  }
  const day = target.closest("[data-day]");
  if (day) { dayOpen = dayOpen === day.dataset.day ? null : day.dataset.day; return renderDays(); }
  const picked = target.closest("[data-lane]");
  if (picked) { lane = lane === picked.dataset.lane ? null : picked.dataset.lane; return renderDays(); }
  const toFlow = target.closest("[data-flow-day]");
  if (toFlow) return show("flow", toFlow.dataset.flowDay === days.today ? "" : toFlow.dataset.flowDay);

  const big = target.closest(".big");
  if (big) {
    if (view === "days" || (view === "workflow" && workflowOpened)) return;
    const key = big.dataset.key === "all" ? null : big.dataset.key;
    drill[view] = drill[view] === key ? null : key;
    return render();
  }

  const answer = target.closest("[data-answer]");
  if (answer) {
    const text = $("#live-answer").value.trim();
    if (!text) return $("#live-answer").focus();
    await post("/api/answer", { id: answer.dataset.answer, answer: text, source: sourceOf($("#live-answer")) });
    toast("Saved");
    return load();
  }
  const later = target.closest("[data-later]");
  if (later) { await post("/api/answer", { id: later.dataset.later, action: "later" }); return load(); }

  const barPicked = target.closest("[data-island]");
  if (barPicked) {
    prefs = await post("/api/settings", { island: barPicked.dataset.island === "true" });
    return renderSettings();
  }
  const setting = target.closest("[data-setting]");
  if (setting) {
    prefs = await post("/api/settings", { [setting.dataset.setting]: setting.getAttribute("aria-checked") !== "true" });
    renderSettings();
    // The rest of the window follows: with the voice off there is no call to place.
    return load();
  }
  if (target.closest("[data-fix-access]")) { await post("/api/access", { action: "fix" }); return toast("Switch Mason on in the list"); }
  const again = target.closest("[data-again]");
  if (again) { findOpen = findOpen === again.dataset.again ? null : again.dataset.again; return renderFind(); }
  if (target.closest("[data-forget-said]")) { await post("/api/settings", { action: "forget-said" }); toast("Forgotten"); return loadPrefs(); }
  if (target.closest("[data-find-on]")) { prefs = await post("/api/settings", { meaning: true }); return seek(""); }
  const reveal = target.closest("[data-reveal]");
  if (reveal) return post("/api/settings", { action: reveal.dataset.reveal });
  const recallOn = target.closest("[data-recall]");
  if (recallOn) {
    // The call panel is told which project through the server, then opened.
    await post("/api/call", { action: "aim", kind: "recall", project: recallOn.dataset.recall });
    return placeCall("recall");
  }
  const line = target.closest("[data-project]");
  if (line) { openProject = openProject === line.dataset.project ? null : line.dataset.project; return render(); }
  const recall = target.closest("[data-hear-project]");
  if (recall) {
    if (playing) { playing = null; render(); return post("/api/speak", { stop: true }); }
    playing = recall.dataset.hearProject;
    render();
    return post("/api/memory", { project: playing });
  }
  if (target.closest("#play-week")) {
    const { podcast } = snapshot;
    const action = podcast.playing ? "stop" : podcast.episode ? "play" : "make";
    snapshot.podcast = await post("/api/podcast", { action });
    return render();
  }
  if (target.closest("#new-week")) { snapshot.podcast = await post("/api/podcast", { action: "make" }); return render(); }
  if (target.closest("#play-recap")) {
    if (todayPlaying) { todayPlaying = false; render(); return post("/api/speak", { stop: true }); }
    todayPlaying = true;
    render();
    await post("/api/recap");
    return post("/api/speak", { what: "recap" });
  }

  const mic = target.closest("[data-mic]");
  if (mic) return speakInto(mic);
  if (target.closest("#presence")) {
    // Without access the pill is the way to get it: asked again for this build.
    if (snapshot.presence === "permission") { await post("/api/access", { action: "fix" }); return toast("Switch Mason on in the list"); }
    const action = snapshot.runtime.offTheRecord ? "on-the-record" : "off-the-record";
    await post("/api/control", { action });
    return load();
  }

  if (target.closest("#mcp-copy")) {
    return toast(await copyText(mcpByAddress(key)) ? "Copied, with the key of this start" : "Could not copy");
  }

  const asked = target.closest("#tools [data-tool]");
  if (asked) {
    const reply = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: asked.dataset.tool, arguments: {} } });
    $("#mcp-answer").textContent = reply.result?.content?.[0]?.text || "No answer.";
  }
}

document.addEventListener("click", (event) => { act(event).catch((error) => toast(error.message)); });
// The name is saved when the field is left or Enter is pressed.
document.addEventListener("change", (event) => {
  if (event.target.id !== "set-name") return;
  post("/api/settings", { name: event.target.value }).then((value) => { prefs = value; toast("Saved"); }).catch((error) => toast(error.message));
});
// What is looked for is asked a moment after the typing stops.
document.addEventListener("input", (event) => {
  if (event.target.id !== "find-query") return;
  clearTimeout(findTimer);
  findTimer = setTimeout(() => seek(event.target.value.trim()).catch((error) => toast(error.message)), 320);
});
document.addEventListener("keydown", (event) => {
  // A tool in the flow picture is pressed with the keyboard like any button.
  if ((event.key === "Enter" || event.key === " ") && event.target.matches?.(".flowmap .node, [data-again], [data-replay-line], [data-wrule]")) { event.preventDefault(); return event.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  if (event.key !== "Enter" || event.shiftKey) return;
  const button = { "live-answer": "[data-answer]" }[event.target.id];
  if (!button) return;
  event.preventDefault();
  $(button).click();
});

function connect() {
  stream?.close();
  stream = new EventSource(keyed("/api/stream"));
  let timer;
  stream.addEventListener("update", (event) => {
    const { kind } = JSON.parse(event.data);
    if (kind === "spoken") { playing = null; todayPlaying = false; if (snapshot) render(); return; }
    if (kind === "days" && view === "days") loadDays().catch(() => {});
    // More was read: the count in view follows.
    if (kind === "said") { if (view === "settings") loadPrefs().catch(() => {}); if (view === "find" && !$("#find-query").value.trim()) seek("").catch(() => {}); return; }
    clearTimeout(timer);
    timer = setTimeout(() => load().catch(() => {}), 250);
  });
}
// A window that is closed or behind everything holds no connection.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stream?.close(); stream = null; }
  else { load().catch(() => {}); connect(); lookAgainAtOpened(); }
});
window.addEventListener("focus", () => { lookAgainAtOpened(); });

const [initialView, initialArg] = location.hash.slice(1).split("/");
show(initialView, initialArg);
// An address typed or followed while the window is open goes there too.
window.addEventListener("hashchange", () => {
  const [name, arg] = location.hash.slice(1).split("/");
  if (name && (name !== view || arg !== undefined)) show(name, arg);
});
// A tab that was opened without the key says so, and goes on saying it, instead of standing empty.
try { await load(); } catch (error) {
  if (error.status !== 401) throw error;
  toast(error.message);
  clearTimeout(toast.timer);
}
if (snapshot) connect();

// Other words for a proposal are kept when the field is left, and the prompt follows them.
document.addEventListener("change", async (event) => {
  if (event.target.id !== "propose-rule") return;
  try { snapshot.suggestions = await post("/api/suggestions", { action: "word", id: event.target.dataset.id, rule: event.target.value }); }
  catch (error) { return toast(error.message); }
  render();
});

// A workflow file is opened by choosing it, or by dropping it on the Workflow view.
document.addEventListener("change", (event) => {
  if (event.target.id !== "workflow-file") return;
  openWorkflow(event.target.files[0]);
  event.target.value = "";
});
document.addEventListener("dragover", (event) => { if (view === "workflow") event.preventDefault(); });
document.addEventListener("drop", (event) => {
  if (view !== "workflow") return;
  event.preventDefault();
  openWorkflow(event.dataTransfer?.files?.[0]);
});

// A picture that does not come is never left as a broken one: the tool falls
// back to its letter on its colour, in a chip and in the map alike.
document.addEventListener("error", (event) => {
  const picture = event.target;
  if (picture instanceof HTMLImageElement && picture.classList.contains("logo")) {
    const tile = document.createElement("span");
    tile.className = "logo";
    tile.style.cssText = `--s:${picture.style.getPropertyValue("--s")};--bg:${picture.dataset.colour || "#2b2823"};--fg:${inkOn(picture.dataset.colour || "#2b2823")}`;
    tile.textContent = picture.dataset.letter || "?";
    picture.replaceWith(tile);
  } else if (picture instanceof SVGImageElement) {
    picture.previousElementSibling?.removeAttribute("hidden");
    picture.remove();
  }
}, true);
