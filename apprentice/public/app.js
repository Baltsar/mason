import { canDictate, dictate } from "/voice.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
const native = window.webkit?.messageHandlers?.apprentice;

const VIEWS = ["capture", "map", "teach", "recap", "agents", "settings"];
const LEGACY = { now: "capture", mcp: "agents" };
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
let view = "capture";
// Which line of each result is pressed open.
const drill = { capture: null, map: null };
let verdict = null;
let lastStop = null;
let listening = null;
let stream = null;
let clockTimer = null;
// The project whose recap is being read aloud right now, if any.
let playing = null;
let todayPlaying = false;
let airTimer = null;
// What the settings screen shows: the settings and the state of what Mason depends on.
let prefs = null;
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

/* 01 · Capture */

// Every view is read in a second or three: figures in large type, a few words,
// and the detail one press away.
let openProject = null;

function renderCapture() {
  const { activity } = snapshot;
  const measured = activity.totalSeconds > 0;
  // Before anything is measured the page says what happens next.
  $("#capture-meta").textContent = measured ? minutes(activity.totalSeconds) : "Work as usual. Mason is watching.";
  renderBigs($("#capture-bigs"), ["work", "social", "other"].map((name) => ({
    key: name, number: measured ? activity.groups[name].percent : "–", unit: measured ? "%" : "", word: name, meta: "", tone: TONES[name],
  })), drill.capture);
  renderDrill();
  renderProjects();
  renderSession();
  renderQuestion();
  renderSignals();
}

function renderDrill() {
  const node = $("#capture-drill");
  const name = drill.capture;
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

/* 02 · Map */

function renderMap() {
  const { stats } = snapshot;
  renderBigs($("#map-bigs"), [
    { key: "all", number: stats.steps, word: stats.steps === 1 ? "step" : "steps", meta: "", tone: "var(--paper)" },
    { key: "calls", number: stats.judgementCalls, word: "judgement calls", meta: "", tone: "var(--lime)" },
    { key: "guardrails", number: stats.guardrails, word: "guardrails", meta: "", tone: "var(--gold)" },
  ], drill.map);
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

function renderSettings() {
  const node = $("#settings");
  if (!prefs) return paint(node, "loading", "");
  const { settings, status, name } = prefs;
  const toggle = (key, label) => `<div class="set"><span>${label}</span><button class="switch" type="button" role="switch" aria-checked="${settings[key]}" aria-label="${label}" data-setting="${key}"></button></div>`;
  const state = (label, on, yes, no) => `<div class="set"><span>${label}</span><b ${on ? "" : "data-off"}>${on ? yes : no}</b></div>`;
  paint(node, JSON.stringify(prefs), `
    <label class="set"><span>Name</span><input id="set-name" type="text" value="${esc(settings.name || name)}" maxlength="40" autocomplete="off" spellcheck="false" /></label>
    ${toggle("speech", "Sound")}
    ${toggle("summaries", "Summaries by Claude")}
    <div class="set"><span>Screen access</span>${status.access === "on" ? "<b>On</b>" : `<button class="primary" type="button" data-fix-access>Fix access</button>`}</div>
    ${state("ElevenLabs", status.elevenLabs, "Connected", "No key in .env.local")}
    ${state("Claude", status.claude, "Found", "Not found")}
    <div class="set"><span>Memory</span><button class="secondary" type="button" data-reveal title="${esc(status.data)}">Show in Finder</button></div>
    <p class="fine">Mason reads the front app, the window title and the prompt field. No screenshots, no keystrokes. Summaries are written through your own Claude login; without them the memory is your own words. It all stays in this folder.</p>`);
}

async function loadPrefs() {
  prefs = await api("/api/settings");
  if (view === "settings") renderSettings();
}

/* Shell */

function renderShell() {
  const { activity, stats, teach, runtime, presence } = snapshot;
  $("#nav-capture").textContent = activity.totalSeconds ? `${activity.workPercent}%` : "–";
  $("#nav-map").textContent = stats.steps;
  $("#nav-teach").textContent = teach.stops;
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
  ({ capture: renderCapture, map: renderMap, teach: renderTeach, recap: renderRecap, agents: renderAgents, settings: renderSettings })[view]();
}

async function load() {
  snapshot = await api("/api/state");
  render();
}

function show(name, arg) {
  view = VIEWS.includes(name) ? name : LEGACY[name] || "capture";
  $$("[data-page]").forEach((section) => { section.hidden = section.dataset.page !== view; });
  $$("[data-view]").forEach((button) => button.setAttribute("aria-current", button.dataset.view === view ? "page" : "false"));
  if (arg !== undefined && view in drill) drill[view] = arg || null;
  history.replaceState(null, "", `#${view}`);
  if (view === "settings") loadPrefs().catch(() => {});
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

  const big = target.closest(".big");
  if (big) {
    if (view === "teach") return $("#mastery").scrollIntoView({ behavior: "smooth", block: "center" });
    const key = big.dataset.key === "all" ? null : big.dataset.key;
    drill[view] = drill[view] === key ? null : key;
    return render();
  }
  if (target.closest("[data-drill-close]")) { drill.capture = null; return render(); }

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
  if (setting) { prefs = await post("/api/settings", { [setting.dataset.setting]: setting.getAttribute("aria-checked") !== "true" }); return renderSettings(); }
  if (target.closest("[data-fix-access]")) { await post("/api/access", { action: "fix" }); return toast("Switch Mason on in the list"); }
  if (target.closest("[data-reveal]")) return post("/api/settings", { action: "reveal" });
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

  const tool = target.closest("[data-tool]");
  if (tool) {
    const reply = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool.dataset.tool, arguments: {} } });
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
    if (JSON.parse(event.data).kind === "spoken") { playing = null; todayPlaying = false; if (snapshot) render(); return; }
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
await load();
connect();
