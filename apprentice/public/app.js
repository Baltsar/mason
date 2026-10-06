import { canDictate, dictate } from "/voice.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const native = window.webkit?.messageHandlers?.apprentice;

const VIEWS = ["today", "flow", "days", "more", "map", "teach", "recap", "agents", "settings"];
const LEGACY = { now: "today", capture: "today", mcp: "agents" };
const TONES = { work: "var(--lime)", social: "var(--red)", other: "var(--grey)" };
// Cases to try in Teach are made from the rules that are really in the map:
// two that go against a rule, in the owner's own words, and one that is safe.
function presets() {
  const rules = (snapshot?.map.decisions || []).filter((item) => item.kind !== "decision" && item.quote).slice(0, 2);
  if (!rules.length) return [];
  return [
    ...rules.map((rule) => ({ label: short(rule.title, 30), text: `Do it anyway, although: ${rule.quote}` })),
    { label: "Something safe", text: "Add a keyboard shortcut that opens the Work Map from the island." },
  ];
}
const TOOLS = [
  ["what_happened_last", "What happened last?"],
  ["what_did_you_learn", "What did you learn?"],
  ["what_are_you_unsure_about", "What are you unsure about?"],
  ["how_was_the_day", "How was the day?"],
  ["how_was_it_built", "How was it built?"],
  ["guardrails_for_agents", "Guardrails an agent can load"],
];

let snapshot;
let view = "today";
// Which line of each result is pressed open.
const drill = { today: null, map: null, flow: null };
let verdict = null;
let lastStop = null;
let listening = null;
let stream = null;
let clockTimer = null;
// The project whose recap is being read aloud right now, if any.
let playing = null;
let todayPlaying = false;
let airTimer = null;
// Whether the proposal on screen shows what it rests on.
let proposeOpen = false;
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
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
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
  if (open) container.dataset.open = open;
  else delete container.dataset.open;
}

const momentChip = (moment) => moment?.at ? `<p class="moment"><b>Screen moment</b><span>${clock(moment.at, true)}</span>${moment.app ? `<span>${esc(moment.app)}</span>` : ""}<span>${esc(short(moment.window || moment.evidence, 70))}</span></p>` : "";
const sourceText = (source) => source ? `${source.label || "Local signal"}${source.lines ? ` · lines ${source.lines}` : ""}` : "Local signal";
const canVoice = () => snapshot.voice.scribe && canDictate();
const voiceNote = () => canVoice() ? "press the microphone and say it" : "spoken by the Mac voice until ElevenLabs is connected";
const MIC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>`;
// An answer field that can be spoken into: the words appear as they are heard.
const answerField = (id, placeholder) => `<div class="composer"><textarea id="${id}" rows="2" placeholder="${placeholder}"></textarea>${canVoice() ? `<button class="mic" type="button" data-mic="${id}" aria-pressed="false" aria-label="Answer by voice" title="Answer by voice">${MIC}</button>` : ""}</div>`;

/* Today: the day against what it is for */

// Every view is read in a second or three: figures in large type, a few words,
// and the detail one press away.
let openProject = null;
// The list of every recent project, opened from "Another project".
let aimOthers = false;

function renderToday() {
  const { activity, aim } = snapshot;
  const measured = activity.totalSeconds > 0;
  const day = new Date().toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  $("#today-meta").textContent = measured ? `${day} · ${minutes(activity.totalSeconds)}` : "Work as usual. Mason is watching.";
  $("#aim-change").hidden = !aim.aim;

  // The aim, or the question of what it is: three things left open, one press.
  const node = $("#aim");
  if (aim.aim) {
    paint(node, JSON.stringify(aim.aim), `<h1 class="statement">${esc(aim.aim.project)}</h1>${aim.aim.text ? `<p class="lede">${esc(aim.aim.text)}</p>` : ""}`);
  } else if (aim.proposals.length) {
    const others = aimOthers ? aim.others.filter((name) => !aim.proposals.some((item) => item.project === name)) : [];
    paint(node, JSON.stringify([aim.proposals, aimOthers, others]), `<h1 class="statement">What is today for?</h1>
      <ol class="aims">${aim.proposals.map((item) => `<li><button type="button" data-aim="${esc(item.project)}" data-text="${esc(item.text)}"><b>${esc(item.project)}</b><span>${esc(item.text || item.headline)}</span></button></li>`).join("")}
      ${others.map((name) => `<li><button type="button" data-aim="${esc(name)}" data-text=""><b>${esc(name)}</b><span></span></button></li>`).join("")}</ol>
      ${aim.others.length > aim.proposals.length && !aimOthers ? `<button class="quiet" type="button" data-aim-others>Another project</button>` : ""}`);
  } else {
    paint(node, "none", "");
  }

  // Against an aim the day splits into on it, social and elsewhere; without
  // one it is work, social and other, as before.
  const rows = aim.aim
    ? [
      { key: "on", number: measured ? aim.onPercent : "–", unit: measured ? "%" : "", word: "on it", meta: aim.longestOn ? `longest ${minutes(aim.longestOn.seconds)}` : "", tone: "var(--lime)" },
      { key: "social", number: measured ? aim.socialPercent : "–", unit: measured ? "%" : "", word: "social", meta: "", tone: TONES.social },
      { key: "elsewhere", number: measured ? aim.elsewherePercent : "–", unit: measured ? "%" : "", word: "elsewhere", meta: aim.away.count ? `left ${aim.away.count} ${aim.away.count === 1 ? "time" : "times"}` : "", tone: TONES.other },
    ]
    : ["work", "social", "other"].map((name) => ({ key: name, number: measured ? activity.groups[name].percent : "–", unit: measured ? "%" : "", word: name, meta: "", tone: TONES[name] }));
  if (drill.today && !rows.some((row) => row.key === drill.today)) drill.today = null;
  renderBigs($("#today-bigs"), rows, drill.today);
  renderDrill();

  // The one thing worth saying about the day, and what is waiting right now.
  const said = $("#today-said");
  const ready = aim.ready.map((answer) => answer.project).filter((name, index, all) => all.indexOf(name) === index);
  const line = ready.length ? `${ready.length === 1 ? "An answer is" : `${ready.length} answers are`} ready: ${ready.join(", ")}.` : aim.sentence?.text || "";
  said.hidden = !line;
  said.dataset.tone = ready.length ? "ready" : aim.sentence?.tone || "plain";
  said.textContent = line;

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
  const { aim } = snapshot;
  const bars = (items, label, value, tone) => {
    const longest = Math.max(1, ...items.map(value));
    return items.length ? `<ul class="bars wide">${items.map((item) => `<li style="--w:${Math.round((value(item) / longest) * 100)}%;--tone:${tone}"><span><em>${esc(label(item))}</em></span><i></i><b>${item.count ?? minutes(item.seconds)}</b></li>`).join("")}</ul>` : `<p class="empty">Nothing.</p>`;
  };
  if (name === "on") {
    // When it was begun, the longest stretch, and what it was left for.
    const facts = [aim.startedOnAt ? `Begun ${clock(aim.startedOnAt)}` : "Not begun", aim.longestOn ? `longest ${minutes(aim.longestOn.seconds)} at ${clock(aim.longestOn.startedAt)}` : null, aim.away.count ? `left ${aim.away.count} times` : null].filter(Boolean).join(" · ");
    return paint(node, JSON.stringify(["on", facts, aim.away.to]), `<header><h2>${esc(aim.aim.project)}</h2><p>${esc(facts)}</p></header>${aim.away.to.length ? bars(aim.away.to, (item) => item.name, (item) => item.count, "var(--lime)") : ""}`);
  }
  if (name === "elsewhere") {
    const waited = aim.waited.seconds >= 60 ? `<header><h2>Answers waited ${minutes(aim.waited.seconds)}</h2><p>${aim.waited.answers} finished while you were elsewhere</p></header>${bars(aim.waited.where, (item) => item.tool, (item) => item.seconds, "var(--gold)")}` : "";
    return paint(node, JSON.stringify(["elsewhere", aim.elsewhere, aim.waited]), `${bars(aim.elsewhere, (item) => item.tool, (item) => item.seconds, TONES.other)}${waited}`);
  }
  const group = snapshot.activity.groups[name];
  const longest = Math.max(1, ...group.apps.map((item) => item.seconds));
  paint(node, JSON.stringify([name, group.seconds, group.apps.length]), `
    <div class="drill-grid">
      <div>${group.apps.length ? `<ul class="bars">${group.apps.map((item) => `<li style="--w:${Math.round((item.seconds / longest) * 100)}%;--tone:${item.color}"><span>${esc(item.app)}</span><i></i><b>${minutes(item.seconds)}</b></li>`).join("")}</ul>` : `<p class="empty">Nothing.</p>`}</div>
      <div>${group.windows.length ? `<ul class="windows">${group.windows.slice(0, 5).map((item) => `<li><span>${esc(item.window || item.app)}</span><b>${minutes(item.seconds)}</b></li>`).join("")}</ul>` : ""}</div>
    </div>`);
}

// Something Mason has seen often enough to propose a change. One at a time,
// with what it rests on, and never done without a press.
function renderPropose() {
  const node = $("#propose");
  const proposal = snapshot.suggestions?.open?.[0];
  node.hidden = !proposal;
  if (!proposal) { delete node.dataset.sig; return; }
  paint(node, JSON.stringify([proposal, proposeOpen]), `<p class="label">You keep saying this · ${proposal.times} times in ${proposal.projects} projects</p>
    <h2>${esc(proposal.rule)}</h2>
    ${proposeOpen ? `<ul class="quotes">${proposal.evidence.map((item) => `<li><b>${esc(item.project)}</b><span>“${esc(item.example)}”</span></li>`).join("")}</ul>
      <textarea id="propose-rule" rows="2" aria-label="The rule, in the words it will be written in">${esc(proposal.rule)}</textarea>
      <p class="where">One line in ${esc(proposal.file)}, where every agent reads it. A default, not a law: what a prompt asks for comes first. It can be taken out again in Settings.</p>` : ""}
    <div class="row"><button class="primary" type="button" data-propose="apply" data-id="${esc(proposal.id)}">Tell every agent</button><button class="secondary" type="button" data-propose="dismiss" data-id="${esc(proposal.id)}">No</button><button class="quiet" type="button" data-propose-open>${proposeOpen ? "Less" : "What I said"}</button></div>`);
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

function tickClock() {
  const session = snapshot?.runtime.session;
  const node = $("#session-clock");
  if (!session?.active || !node) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - Date.parse(session.startedAt)) / 1000));
  node.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
}

function renderSession() {
  const node = $("#session-card");
  const session = snapshot.runtime.session;
  clearInterval(clockTimer);
  if (session?.active) {
    node.dataset.state = "active";
    paint(node, `active-${session.id}`, `<p class="clock" id="session-clock">00:00</p><p class="count" id="session-count"></p><button class="primary" type="button" data-session="end">End</button>`);
    $("#session-count").textContent = `${session.questions || 0}/5`;
    tickClock();
    clockTimer = setInterval(tickClock, 1000);
    return;
  }
  node.dataset.state = "idle";
  paint(node, "idle", `<h2>Capture session</h2><button class="primary" type="button" data-session="start">Start</button>`);
}

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

/* More: what was built for handing the work to someone else */

function renderMore() {
  const { stats, teach, podcast } = snapshot;
  const doors = [
    ["map", "Map", `${stats.steps} ${stats.steps === 1 ? "step" : "steps"}`],
    ["teach", "Teach", `${teach.stops} stopped`],
    ["recap", "Recap", podcast.episode ? podcast.episode.title : "The week as news"],
    ["agents", "Agents", "One memory, every agent"],
  ];
  paint($("#doors"), JSON.stringify(doors), doors.map(([name, title, note]) => `<button type="button" data-view="${name}"><b>${title}</b><span>${esc(note)}</span></button>`).join(""));
}

/* Map */

function renderMap() {
  const { stats } = snapshot;
  renderBigs($("#map-bigs"), [
    { key: "all", number: stats.steps, word: stats.steps === 1 ? "step" : "steps", meta: "", tone: "var(--paper)" },
    { key: "calls", number: stats.judgementCalls, word: "judgement calls", meta: "", tone: "var(--lime)" },
    { key: "guardrails", number: stats.guardrails, word: "guardrails", meta: "", tone: "var(--gold)" },
  ], drill.map);
  renderSession();
  renderDebrief();
  renderSteps();
}

function renderDebrief() {
  const node = $("#debrief-card");
  const debrief = snapshot.map.debrief;
  const progress = snapshot.debrief;
  const teachBack = debrief?.teachBack;
  const byVoice = snapshot.voice.elevenLabs;
  const start = `${byVoice ? `<button class="primary" type="button" data-call>Call</button>` : ""}<button class="${byVoice ? "secondary" : "primary"}" type="button" data-debrief="start">Write</button>`;
  if (!debrief) {
    node.dataset.state = "idle";
    paint(node, `idle-${byVoice}`, `<h2>Debrief</h2><div class="row">${start}</div>`);
  } else if (progress.current) {
    const gap = progress.current;
    node.dataset.state = "asking";
    paint(node, `gap-${gap.id}`, `<p class="big-text">${esc(gap.text)}</p>${answerField("gap-answer", "Answer")}<div class="row"><button class="primary" type="button" data-debrief="answer" data-id="${gap.id}">Answer</button><button class="secondary" type="button" data-debrief="skip" data-id="${gap.id}">Skip</button><span class="note">${progress.closed + 1}/${progress.total}</span></div>`);
  } else if (debrief.call) {
    const call = debrief.call;
    const confirmed = teachBack?.status === "confirmed";
    node.dataset.state = confirmed ? "confirmed" : "call";
    paint(node, `call-${call.startedAt}-${call.status}-${call.saved.length}-${teachBack?.status}`, `${confirmed ? `<p class="stamp">Confirmed · ${clock(teachBack.confirmedAt)}</p>` : `<h2>${call.status === "live" ? "On a call" : "Not confirmed"}</h2>`}<ul class="saved-list">${call.saved.map((step) => `<li>${esc(step.title)}</li>`).join("")}</ul><div class="row"><button class="secondary" type="button" data-call>Call again</button></div>`);
  } else if (teachBack?.status === "confirmed") {
    node.dataset.state = "confirmed";
    paint(node, `confirmed-${teachBack.confirmedAt}`, `<p class="stamp">Confirmed · ${clock(teachBack.confirmedAt)}</p><div class="row">${start}</div>`);
  } else if (teachBack) {
    node.dataset.state = "teach-back";
    paint(node, `teach-back-${teachBack.generatedAt}`, `<h2>Is this how it works?</h2><div class="row"><button class="secondary" type="button" data-debrief="repeat">Hear it</button><button class="primary" type="button" data-debrief="confirm">Yes</button><button class="secondary" type="button" data-correct>Correct</button>${canVoice() ? `<button class="secondary" type="button" data-hear>Say it</button>` : ""}</div><details class="read"><summary>Read</summary><p class="teach-back">${esc(teachBack.text)}</p></details><div id="correct-box" hidden>${answerField("correction", "What is wrong?")}<div class="row" style="margin-top:10px"><button class="primary" type="button" data-debrief="correct">Send</button></div></div>`);
  }
}

function stepMarkup(item, index, all) {
  const kind = item.kind === "discarded" ? "rejected" : item.kind;
  const moment = item.moment?.at
    ? `${clock(item.moment.at, true)} · ${esc(item.moment.app || "active app")}${item.moment.window ? `<br>${esc(short(item.moment.window, 90))}` : ""}`
    : esc(sourceText(item.source));
  const around = all.filter((other) => other.id !== item.id && other.kind !== "decision" && other.source?.label === item.source?.label).slice(0, 2);
  const guardrail = item.kind === "guardrail" ? "Stops a new hire here." : item.kind === "discarded" ? "Stops anyone who picks it up again." : around.map((other) => esc(other.title)).join(" · ") || "None yet.";
  return `<details class="step" id="step-${esc(item.id)}">
    <summary><span class="num">${String(index + 1).padStart(2, "0")}</span><h3>${esc(item.title)}</h3><span class="kind" data-kind="${esc(item.kind)}">${esc(kind)}</span></summary>
    <dl class="fields">
      <div><dt>Moment</dt><dd>${moment}<br><button type="button" data-source="${esc(item.id)}">Source</button></dd></div>
      <div><dt>Decision</dt><dd>${esc(item.title)}</dd></div>
      <div><dt>Your words</dt><dd class="words">${item.quote ? `“${esc(item.quote)}”` : "–"}</dd></div>
      <div><dt>Guardrail</dt><dd>${guardrail}</dd></div>
    </dl>
  </details>`;
}

function renderSteps() {
  const filter = drill.map;
  const all = snapshot.map.decisions;
  const rows = all.map((item, index) => ({ item, index })).filter(({ item }) => filter === "guardrails" ? item.kind === "guardrail" : filter === "calls" ? item.kind !== "guardrail" : true);
  paint($("#steps"), JSON.stringify([filter, all.length, all[0]?.id]), rows.map(({ item, index }) => stepMarkup(item, index, all)).join(""));
}

/* 03 · Teach */

function renderTeach() {
  const { teach } = snapshot;
  const mastered = teach.items.filter((item) => item.state === "mastered").length;
  renderBigs($("#teach-bigs"), [
    { key: "stopped", number: teach.stops, word: "stopped", meta: "", tone: "var(--red)" },
    { key: "cleared", number: teach.passes, word: "cleared", meta: "", tone: "var(--lime)" },
    { key: "mastered", number: mastered, word: "mastered", meta: "", tone: "var(--gold)" },
  ], null);
  const cases = presets();
  paint($("#case-presets"), JSON.stringify(cases.map((item) => item.label)), cases.map((preset, index) => `<button type="button" data-preset="${index}">${esc(preset.label)}</button>`).join(""));
  $("#teach-prompt").placeholder = cases.length ? "A decision about to be made" : "No rules yet. Take the debrief call first.";
  renderVerdict();
  paint($("#mastery"), JSON.stringify(teach.items), teach.items.map((item) => `<div><span>${esc(item.title)}</span><span class="kind" data-kind="${item.state === "mastered" ? "decision" : item.state}">${item.state}</span></div>`).join(""));
}

function renderVerdict() {
  const node = $("#teach-result");
  node.hidden = !verdict;
  if (!verdict) { delete node.dataset.sig; return; }
  if (verdict.stopped) {
    const stop = verdict.intervention;
    node.dataset.state = "stopped";
    paint(node, stop.id, `<h2>Stop.</h2><blockquote>“${esc(stop.quote)}”</blockquote><div class="row grow"><button class="secondary" type="button" data-source="${esc(stop.guardrailId)}">Source</button></div>`);
    return;
  }
  node.dataset.state = "passed";
  paint(node, `passed-${verdict.at}`, `<h2>Clear.</h2>`);
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
function face(tool, size = 28) {
  if (tool?.icon) return `<img class="logo" style="--s:${size}px" src="${tool.icon}" alt="" />`;
  const tile = tileFor(tool);
  return `<span class="logo" style="--s:${size}px;--bg:${tile.color};--fg:${inkOn(tile.color)}">${esc(tile.text)}</span>`;
}

async function loadFlow() {
  flow = await api(`/api/flow${flowDay ? `?day=${flowDay}` : ""}`);
  if (flowTool && !flow.tools.some((tool) => tool.name === flowTool)) flowTool = null;
  if (view === "flow") renderFlow();
}

// The tools as a picture, and only what is read at a glance: the five tools
// with the most time, each as large as its time, and the three habits between
// them as lines as thick as their jumps. The two biggest sit left and right, so
// the main loop lies flat, and the others go round them. Pressing a tool shows
// its own lines; the rest of the tools are one press away.
const FLOW_FEW = 5;
const FLOW_ALL = 10;

function flowMap(tools, total) {
  const width = 1000, height = flowAll ? 470 : 410, cx = width / 2, cy = flowAll ? 225 : 200, rx = 372, ry = flowAll ? 150 : 112;
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
  const most = tools[0].seconds;
  const at = new Map(tools.map((tool, rank) => {
    const angle = (angleOf(rank) * Math.PI) / 180;
    const place = count === 1 ? [cx, cy] : [cx + rx * Math.cos(angle), cy - ry * Math.sin(angle)];
    return [tool.name, { x: Math.round(place[0]), y: Math.round(place[1]), r: Math.round((flowAll ? 20 : 30) + (flowAll ? 30 : 34) * Math.sqrt(tool.seconds / most)) }];
  }));
  const between = flow.pairs.filter((pair) => at.has(pair.a) && at.has(pair.b));
  const touches = (pair) => pair.a === flowTool || pair.b === flowTool;
  // A single jump between two tools is not a habit.
  const habits = flowTool ? between.filter(touches) : flowAll ? between.filter((pair) => pair.count > 1).slice(0, 14) : between.slice(0, 3);
  // A tool none of the habits reaches is still tied to the one it trades places with most, by a quiet line.
  const reached = new Set(habits.flatMap((pair) => [pair.a, pair.b]));
  const ties = flowTool ? [] : tools.filter((tool) => !reached.has(tool.name)).map((tool) => between.find((pair) => pair.a === tool.name || pair.b === tool.name)).filter(Boolean);
  const lines = [...habits, ...ties.filter((pair, index) => ties.indexOf(pair) === index)];
  const strongest = lines[0]?.count || 1;
  const linked = new Set(lines.flatMap((pair) => [pair.a, pair.b]));
  const edges = [...lines].reverse().map((pair) => {
    const a = at.get(pair.a), b = at.get(pair.b);
    // The line bows towards the middle, so neighbours do not hide behind each other.
    const bend = [(a.x + b.x) / 2 + (cx - (a.x + b.x) / 2) * .28, (a.y + b.y) / 2 + (cy - (a.y + b.y) / 2) * .28];
    const share = pair.count / strongest;
    const main = pair === lines[0];
    const lit = main || Boolean(flowTool);
    const quiet = !habits.includes(pair);
    const numbered = !quiet && (!flowAll || lit || lines.indexOf(pair) < 3);
    return {
      line: `<path class="edge ${lit ? "on" : ""}" d="M${a.x} ${a.y} Q${Math.round(bend[0])} ${Math.round(bend[1])} ${b.x} ${b.y}" style="stroke-width:${quiet ? 2 : (3 + 15 * share).toFixed(1)};opacity:${(quiet ? .16 : main ? .95 : flowTool ? .4 + .5 * share : .16 + .34 * share).toFixed(2)}" />`,
      label: numbered ? `<g class="count ${main ? "main" : ""} ${lit ? "on" : ""}" transform="translate(${Math.round(.25 * a.x + .5 * bend[0] + .25 * b.x)} ${Math.round(.25 * a.y + .5 * bend[1] + .25 * b.y)})"><circle r="${main ? 31 : 20}" /><text>${pair.count}</text></g>` : "",
    };
  });
  const nodes = tools.map((tool) => {
    const { x, y, r } = at.get(tool.name);
    const tile = tileFor(tool);
    const side = r * 1.8;
    const mark = tool.icon
      ? `<image href="${tool.icon}" x="${x - r * 1.1}" y="${y - r * 1.1}" width="${r * 2.2}" height="${r * 2.2}" />`
      : `<rect x="${x - side / 2}" y="${y - side / 2}" width="${side}" height="${side}" rx="${side * .23}" fill="${tile.color}" stroke="rgba(255,255,255,.16)" /><text class="letters" x="${x}" y="${y}" fill="${inkOn(tile.color)}" font-size="${Math.round(side * .42)}">${esc(tile.text)}</text>`;
    const faded = flowTool && tool.name !== flowTool && !linked.has(tool.name);
    // A name never stands between its tool and the middle of the picture.
    const nameAt = y < cy - 10 ? y - r - 16 : y + r + 30;
    return `<g class="node" data-tool="${esc(tool.name)}" role="button" tabindex="0" aria-pressed="${tool.name === flowTool}" aria-label="${esc(tool.name)}, ${minutes(tool.seconds)}" ${faded ? "data-faded" : ""}><circle cx="${x}" cy="${y}" r="${r + 12}" />${mark}<text class="name" x="${x}" y="${nameAt}">${esc(short(tool.name, 20))}</text></g>`;
  });
  const more = total > FLOW_FEW ? `<button class="all" type="button" data-flow-all aria-pressed="${flowAll}">${flowAll ? "Fewer" : `All ${Math.min(total, FLOW_ALL)}`}</button>` : "";
  return `<svg viewBox="0 0 ${width} ${height}" role="img">${edges.map((edge) => edge.line).join("")}${nodes.join("")}${edges.map((edge) => edge.label).join("")}</svg>${more}`;
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
  const tools = visited.slice(0, flowAll ? FLOW_ALL : FLOW_FEW);
  const map = $("#flow-map");
  map.hidden = !tools.length;
  if (tools.length) paint(map, JSON.stringify([flow.day, flowTool, flowAll, visited.length, tools.map((tool) => [tool.name, Math.round(tool.seconds / 20), tool.icon]), flow.pairs.slice(0, 18)]), flowMap(tools, visited.length));
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
      const total = totals.get(name) || { name, minutes: 0, prompts: 0, days: 0 };
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
  renderBigs($("#days-bigs"), [
    { key: "days", number: workedDays.length, word: workedDays.length === 1 ? "day" : "days", meta: "", tone: "var(--paper)" },
    { key: "hours", number: Math.round(total / 60), unit: "h", word: "built", meta: "", tone: "var(--lime)" },
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
      <ul class="bars wide">${shown.map(([name, work]) => `<li style="--w:${Math.round((work.minutes / most) * 100)}%;--tone:${toneOf.get(name)}"><span>${esc(name)}</span><i></i><b>${minutes(work.minutes * 60)}</b></li>`).join("")}</ul>`);
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

function renderAgents() {
  paint($("#mcp-config"), "config", esc(`{
  "mcpServers": {
    "mason": {
      "command": "node",
      "args": ["…/apprentice/src/mcp.mjs"]
    }
  }
}`));
  paint($("#tools"), "tools", TOOLS.map(([name, label], index) => `<button type="button" data-tool="${name}"><small>${String(index + 1).padStart(2, "0")}</small><b>${esc(label)}</b></button>`).join(""));
}

/* Settings */

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
  const { model, logs } = status;
  const applied = snapshot?.suggestions?.applied || [];
  const writer = model.ready ? (model.name === "Claude" ? "Claude" : `${model.name} · ${model.onThisMac ? "on this Mac" : model.where}`) : model.name === "Claude" ? "Claude not found" : "No model named";
  paint(node, JSON.stringify([prefs, applied]), `
    <label class="set"><span>Name</span><input id="set-name" type="text" value="${esc(settings.name || name)}" maxlength="40" autocomplete="off" spellcheck="false" /></label>
    ${row("speech", "Sound")}
    ${row("cues", "A word on the island", settings.cues ? on("Answer ready, time away") : off("Silent"))}
    <p class="group">Reads</p>
    <div class="set"><span>Screen: app, window, prompt</span>${status.access === "on" ? on("On") : `<button class="primary" type="button" data-fix-access>Fix access</button>`}</div>
    ${row("logs", "Agent logs", settings.logs ? on(`Claude Code · ${logs.claude} ${logs.claude === 1 ? "project" : "projects"}`) : off("Not read"))}
    ${row("chats", "Chat and mail by name", settings.chats ? on("Name and time") : off("Counted, not named"))}
    <p class="group">Sends</p>
    ${row("summaries", "Summaries", settings.summaries ? (model.ready ? on(writer) : off(writer)) : off("Your own words"))}
    ${status.elevenLabsKey
      ? row("elevenlabs", "ElevenLabs voice", settings.elevenlabs ? (status.credits ? on(`${thousands(status.credits.left)} credits left`) : "") : off("Mac voice, no calls"))
      : `<div class="set"><span>ElevenLabs voice</span>${off("No key in .env.local")}</div>`}
    ${applied.length ? `<p class="group">Told every agent</p>${applied.map((rule) => `<div class="set rule"><span>${esc(rule.rule)}</span><button class="secondary" type="button" data-rule-remove="${esc(rule.id)}">Take out</button></div>`).join("")}` : ""}
    <p class="group">Keeps</p>
    <div class="set"><span>Memory</span><button class="secondary" type="button" data-reveal="reveal" title="${esc(status.data)}">Show in Finder</button></div>
    <div class="set"><span>Notes for Obsidian</span><button class="secondary" type="button" data-reveal="notes">Show in Finder</button></div>
    <p class="fine">No screenshots, no keystrokes. The agent logs are the files Claude Code already writes on this Mac; Mason keeps short, redacted excerpts. With Summaries and ElevenLabs switched off, nothing leaves this Mac.</p>`);
}

async function loadPrefs() {
  prefs = await api("/api/settings");
  if (view === "settings") renderSettings();
}

/* Shell */

function renderShell() {
  const { activity, runtime, presence } = snapshot;
  // With an aim the figure is how much of the day went to it; without one, the share that was work.
  $("#nav-today").textContent = activity.totalSeconds ? `${snapshot.aim.aim ? snapshot.aim.onPercent : activity.workPercent}%` : "–";
  $("#nav-flow").textContent = activity.totalSeconds ? snapshot.flow.jumps : "–";
  $("#nav-days").textContent = snapshot.days || "–";
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
  renderShell();
  ({ today: renderToday, flow: renderFlow, days: renderDays, more: renderMore, map: renderMap, teach: renderTeach, recap: renderRecap, agents: renderAgents, settings: renderSettings })[view]();
}

async function load() {
  snapshot = await api("/api/state");
  render();
  // Today's flow follows the day as it happens; an earlier day is finished.
  if (view === "flow" && !flowDay) loadFlow().catch(() => {});
}

function show(name, arg) {
  view = VIEWS.includes(name) ? name : LEGACY[name] || "capture";
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
  window.scrollTo(0, 0);
  if (snapshot) render();
}
// The desktop app steers the window: a line pressed in the drop panel lands here.
window.apprenticeGo = (target) => {
  const [name, arg] = String(target).split("/");
  show(name, arg ?? "");
  load();
};

async function openSource(id) {
  const item = snapshot.map.decisions.find((decision) => decision.id === id);
  if (!item) return;
  $("#source-title").textContent = sourceText(item.source);
  if (item.source?.path?.endsWith("HANDOVER.md")) {
    const [from, to] = String(item.source.lines || "1-1").split("-").map(Number);
    const lines = (await (await fetch("/source/handover")).text()).split("\n");
    $("#source-body").innerHTML = lines.map((line, index) => {
      const row = `${String(index + 1).padStart(3, " ")}  ${esc(line)}`;
      return index + 1 >= from && index + 1 <= (to || from) ? `<mark>${row}</mark>` : row;
    }).join("\n");
  } else {
    $("#source-body").textContent = [
      item.moment?.at ? `Screen moment   ${clock(item.moment.at, true)} · ${item.moment.app || ""}` : null,
      item.moment?.window ? `Window          ${item.moment.window}` : null,
      item.moment?.evidence ? `Seen on screen  “${item.moment.evidence}”` : null,
      `Asked           ${item.body}`,
      `Expert’s words  “${item.quote || ""}”`,
      item.source?.answeredBy ? `Answered by     ${item.source.answeredBy}` : null,
    ].filter(Boolean).join("\n\n");
  }
  $("#source").showModal();
  $("#source mark")?.scrollIntoView({ block: "center" });
}

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

async function hearTeachBack(button) {
  if (listening) return listening.stop();
  const label = button.textContent;
  button.textContent = "Listening… press when done";
  try {
    listening = await dictate({ language: snapshot.voice.language });
    const text = await listening.done;
    if (!text) return toast("Nothing was heard.");
    const result = await post("/api/debrief", { action: "hear", text });
    if (result.heard === "confirmed") toast("Confirmed by voice. The Work Map is ready to teach.");
    else {
      await load();
      $("#correct-box").hidden = false;
      $("#correction").value = text;
      $("#correction").dataset.spoken = "true";
      toast("That sounded like a correction. Check it and send.");
    }
  } catch (error) {
    toast(error.message);
  } finally {
    listening = null;
    button.textContent = label;
  }
}
const sourceOf = (node) => node?.dataset.spoken ? "voice" : "typed";

/* Events */

async function act(event) {
  const target = event.target;
  const nav = target.closest("[data-view]");
  if (nav) return show(nav.dataset.view);

  const pick = target.closest("[data-aim]");
  if (pick) {
    snapshot.aim = await post("/api/aim", { action: "pick", project: pick.dataset.aim, text: pick.dataset.text });
    aimOthers = false;
    drill.today = null;
    return load();
  }
  if (target.closest("[data-aim-others]")) { aimOthers = true; return render(); }
  if (target.closest("#aim-change")) { snapshot.aim = await post("/api/aim", { action: "clear" }); drill.today = null; return load(); }
  if (target.closest("[data-propose-open]")) { proposeOpen = !proposeOpen; return render(); }
  const proposed = target.closest("[data-propose]");
  if (proposed) {
    snapshot.suggestions = await post("/api/suggestions", { action: proposed.dataset.propose, id: proposed.dataset.id, rule: $("#propose-rule")?.value || "" });
    proposeOpen = false;
    if (proposed.dataset.propose === "apply") toast("Added. Every agent reads it from now on.");
    return render();
  }
  const taken = target.closest("[data-rule-remove]");
  if (taken) { snapshot.suggestions = await post("/api/suggestions", { action: "remove", id: taken.dataset.ruleRemove }); toast("Taken out"); return renderSettings(); }

  const step = target.closest("[data-flow-step]");
  if (step) {
    const next = flow.days[flow.days.indexOf(flow.day) + Number(step.dataset.flowStep)];
    if (!next) return;
    flowDay = next === flow.today ? null : next;
    flowTool = null;
    return loadFlow();
  }
  if (target.closest("[data-flow-all]")) { flowAll = !flowAll; return renderFlow(); }
  const tool = target.closest(".flowmap [data-tool], #flow-tool [data-tool], #flow-drill [data-tool]");
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
    if (view === "days") return;
    if (view === "teach") return $("#mastery").scrollIntoView({ behavior: "smooth", block: "center" });
    const key = big.dataset.key === "all" ? null : big.dataset.key;
    drill[view] = drill[view] === key ? null : key;
    return render();
  }

  const session = target.closest("[data-session]");
  if (session) {
    await post("/api/session", { action: session.dataset.session });
    if (session.dataset.session === "end") show("map");
    return load();
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

  const setting = target.closest("[data-setting]");
  if (setting) {
    prefs = await post("/api/settings", { [setting.dataset.setting]: setting.getAttribute("aria-checked") !== "true" });
    renderSettings();
    // The rest of the window follows: with the voice off there is no call to place.
    return load();
  }
  if (target.closest("[data-fix-access]")) { await post("/api/access", { action: "fix" }); return toast("Switch Mason on in the list"); }
  const reveal = target.closest("[data-reveal]");
  if (reveal) return post("/api/settings", { action: reveal.dataset.reveal });
  if (target.closest("[data-tutor]")) return placeCall("tutor");
  const recallOn = target.closest("[data-recall]");
  if (recallOn) {
    // The call panel is told which project through the server, then opened.
    await post("/api/call", { action: "aim", kind: "recall", project: recallOn.dataset.recall });
    return placeCall("recall");
  }
  if (target.closest("[data-call]")) return placeCall();
  const line = target.closest("[data-project]");
  if (line) { openProject = openProject === line.dataset.project ? null : line.dataset.project; return render(); }
  const recall = target.closest("[data-hear-project]");
  if (recall) {
    if (playing) { playing = null; render(); return post("/api/speak", { stop: true }); }
    playing = recall.dataset.hearProject;
    render();
    return post("/api/memory", { project: playing });
  }
  if (target.closest("[data-correct]")) { $("#correct-box").hidden = false; return $("#correction").focus(); }
  const debrief = target.closest("[data-debrief]");
  if (debrief) {
    const action = debrief.dataset.debrief;
    const field = action === "answer" ? $("#gap-answer") : action === "correct" ? $("#correction") : null;
    if (field && !field.value.trim()) return field.focus();
    listening?.cancel();
    await post("/api/debrief", { action, id: debrief.dataset.id, text: field?.value.trim(), source: sourceOf(field) });
    if (action === "confirm") toast("Confirmed");
    return load();
  }

  const preset = target.closest("[data-preset]");
  if (preset) { $("#teach-prompt").value = presets()[Number(preset.dataset.preset)]?.text || ""; return $("#teach-prompt").focus(); }
  if (target.closest("[data-revise]")) return $("#teach-prompt").focus();
  if (target.closest("#teach-review")) {
    const prompt = $("#teach-prompt").value.trim();
    if (!prompt) return $("#teach-prompt").focus();
    verdict = { ...(await post("/api/teach", { prompt, afterStop: lastStop })), at: Date.now() };
    lastStop = verdict.stopped ? verdict.intervention.guardrailId : null;
    return load();
  }

  const source = target.closest("[data-source]");
  if (source) return openSource(source.dataset.source);
  if (target.closest("#source-close")) return $("#source").close();

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
  const hear = target.closest("[data-hear]");
  if (hear) { await hearTeachBack(hear); return load(); }
  if (target.closest("#presence")) {
    // Without access the pill is the way to get it: asked again for this build.
    if (snapshot.presence === "permission") { await post("/api/access", { action: "fix" }); return toast("Switch Mason on in the list"); }
    const action = snapshot.runtime.offTheRecord ? "on-the-record" : "off-the-record";
    await post("/api/control", { action });
    return load();
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
document.addEventListener("keydown", (event) => {
  // A tool in the flow picture is pressed with the keyboard like any button.
  if ((event.key === "Enter" || event.key === " ") && event.target.matches?.(".flowmap .node")) { event.preventDefault(); return event.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  if (event.key !== "Enter" || event.shiftKey) return;
  const button = { "live-answer": "[data-answer]", "gap-answer": '[data-debrief="answer"]', correction: '[data-debrief="correct"]' }[event.target.id];
  if (!button) return;
  event.preventDefault();
  $(button).click();
});

function connect() {
  stream?.close();
  stream = new EventSource("/api/stream");
  let timer;
  stream.addEventListener("update", (event) => {
    const { kind } = JSON.parse(event.data);
    if (kind === "spoken") { playing = null; todayPlaying = false; if (snapshot) render(); return; }
    if (kind === "days" && view === "days") loadDays().catch(() => {});
    clearTimeout(timer);
    timer = setTimeout(() => load().catch(() => {}), 250);
  });
}
// A window that is closed or behind everything holds no connection.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { stream?.close(); stream = null; clearInterval(clockTimer); }
  else { load().catch(() => {}); connect(); }
});

const [initialView, initialArg] = location.hash.slice(1).split("/");
show(initialView, initialArg);
// An address typed or followed while the window is open goes there too.
window.addEventListener("hashchange", () => {
  const [name, arg] = location.hash.slice(1).split("/");
  if (name && (name !== view || arg !== undefined)) show(name, arg);
});
await load();
connect();
