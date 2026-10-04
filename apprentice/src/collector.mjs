import { spawn } from "node:child_process";
import { appendEvent, loadMap, loadRuntime, paths, saveMap, saveRuntime } from "./store.mjs";
import { fingerprint, redact, safeTitle } from "./redact.mjs";
import { rankQuestion, rankSwitch } from "./question-engine.mjs";
import { notifyAndSpeak, speak } from "./voice.mjs";
import { catchGuardrail } from "./teach-engine.mjs";
import { classifyActivity, dayStart } from "./activity.mjs";
import { projectIndex, summarizeProjects } from "./projects.mjs";
import { readEventsSince } from "./store.mjs";

const EXCLUDED_APPS = [
  "com.apple.keychainaccess", "com.apple.Passwords", "com.1password.1password", "com.agilebits.onepassword7",
  "com.bitwarden.desktop", "com.apple.MobileSMS", "com.apple.mail", "com.tinyspeck.slackmacgap",
  "net.whatsapp.WhatsApp", "org.whispersystems.signal-desktop", "com.microsoft.Outlook",
  "com.hnc.Discord", "ru.keepcoder.Telegram", "com.microsoft.teams2", "us.zoom.xos",
];

const PRIVATE_TITLE_WORDS = [
  "incognito", "private browsing", "private window", "inprivate", "password", "keychain",
  "1password", "bitwarden", "bank", "swedbank", "seb", "handelsbanken", "nordea", "klarna",
  "1177", "health", "medical", "journal", "gmail", "outlook", "mail", "messages", "meddelanden",
  "whatsapp", "signal", "telegram", "discord", "slack", "family", "photos",
];

const TICK_MS = process.env.APPRENTICE_DEMO ? 750 : 2000;
const OWN_BUNDLE = "design.headless.apprentice";
const STILL_FRESH_MS = 45_000;
// Coming back from a few minutes away, after real project work, is the natural
// moment for a debrief. It is only ever offered, as a line under the island.
const AWAY_SECONDS = 180;
const WORK_WORTH_A_DEBRIEF_SECONDS = 20 * 60;
// A live question nobody answered stops waiting and moves to the debrief.
const QUESTION_WAITS_MS = 10 * 60_000;

function runReader({ prompt = false, enhance = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(paths.reader, [], { stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", () => { clearTimeout(timer); resolve({ status: "error" }); });
    child.on("exit", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(output.trim().split("\n").at(-1))); }
      catch { resolve({ status: "error" }); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify({ prompt, enhance, excludedApps: EXCLUDED_APPS, privateTitleWords: PRIVATE_TITLE_WORDS })}\n`);
  });
}

export class Collector {
  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.timer = null;
    this.busy = false;
    this.first = true;
    this.lastWindowKey = "";
    this.lastPromptHash = "";
    this.pendingPrompt = null;
    this.recentApps = [];
    this.activity = null;
    // Full accessibility is costly for Chromium and Electron apps. It is asked
    // for once per process, and only where a prompt can actually be read.
    this.enhanced = new Set();
    this.enhanceNext = false;
    this.wasPrivate = false;
    this.lastSwitch = null;
    this.wasAway = false;
  }

  async offerDebrief(runtime) {
    if (runtime.debriefReady || runtime.session?.active || !process.env.ELEVENLABS_API_KEY) return;
    const since = Math.max(dayStart(), Date.parse(runtime.lastDebriefAt || 0) || 0);
    const worked = summarizeProjects(await readEventsSince(since), await projectIndex(dayStart())).projects.reduce((sum, item) => sum + item.seconds, 0);
    if (worked < WORK_WORTH_A_DEBRIEF_SECONDS) return;
    runtime.debriefReady = true;
    this.onChange("call");
  }

  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return this.flushActivity().catch(() => {});
  }

  async flushActivity() {
    if (!this.activity || this.activity.seconds < 1) { this.activity = null; return; }
    const segment = this.activity;
    this.activity = null;
    const index = await projectIndex(dayStart()).catch(() => null);
    await appendEvent({
      type: "activity",
      app: segment.app,
      window: segment.window,
      project: index?.resolve({ app: segment.app, window: segment.window, startedAt: segment.startedAt }) || null,
      group: segment.classification.group,
      category: segment.classification.category,
      color: segment.classification.color,
      durationSec: Math.round(segment.seconds),
      startedAt: segment.startedAt,
      source: "foreground active time",
    });
    this.onChange("activity");
  }

  async observeActivity(snapshot, app, window) {
    const now = Date.now();
    const classification = classifyActivity({ app, window });
    const active = classification && Number(snapshot.idleSeconds ?? 0) < 60;
    const key = active ? fingerprint(`${app}:${window}:${classification.category}`) : null;
    if (!active) { await this.flushActivity(); return; }
    if (!this.activity || this.activity.key !== key) {
      await this.flushActivity();
      this.activity = { key, app, window, classification, startedAt: new Date(now).toISOString(), lastAt: now, seconds: 0 };
      return;
    }
    const elapsed = Math.max(0, Math.min((now - this.activity.lastAt) / 1000, 5));
    this.activity.seconds += elapsed;
    this.activity.lastAt = now;
    if (this.activity.seconds >= 30) await this.flushActivity();
  }

  rollDay(runtime) {
    const day = new Date(dayStart()).toISOString().slice(0, 10);
    if (runtime.questionsDay === day) return;
    runtime.questionsDay = day;
    runtime.questionsToday = 0;
    runtime.privateRefusals = 0;
  }

  // One question at a time: nothing new is asked while one is still waiting.
  async ask(runtime, map, question, source) {
    if (map.questions.some((item) => item.status === "open")) return false;
    // The same thing on screen is never asked about twice.
    if (map.questions.some((item) => item.evidence === question.evidence)) return true;
    runtime.lastQuestionAt = question.askedAt;
    if (runtime.session?.active) {
      runtime.session.questions = (runtime.session.questions || 0) + 1;
      if (question.kind === "guardrail") runtime.session.guardrailAsked = true;
    } else {
      runtime.questionsToday = (runtime.questionsToday || 0) + 1;
    }
    map.questions.unshift({ ...question, source });
    await saveMap(map);
    await appendEvent({ type: "question", question: question.text, kind: question.kind, evidence: question.evidence, app: source.app });
    // The question arrives as a spoken sentence and a small panel under the
    // island. No system notification: it must not pile up or steal focus.
    const spoken = await speak(question.text);
    this.onChange("question");
    // In a capture session the answer is hands-free: once the question has been
    // said, the panel listens by itself. Outside a session it waits for a press.
    if (runtime.session?.active) spoken.done.then(() => this.onChange("listen"));
    return true;
  }

  async parkStaleQuestions() {
    const map = await loadMap();
    const stale = map.questions.filter((item) => item.status === "open" && Date.now() - Date.parse(item.askedAt) > QUESTION_WAITS_MS);
    if (!stale.length) return;
    for (const question of stale) question.status = "parked";
    await saveMap(map);
    this.onChange("question");
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const runtime = await loadRuntime();
      this.rollDay(runtime);
      if (!runtime.recording || runtime.offTheRecord) {
        await this.flushActivity();
        await saveRuntime(runtime);
        return;
      }
      const snapshot = await runReader({ prompt: this.first, enhance: this.enhanceNext });
      this.first = false;
      this.enhanceNext = false;
      // Looking at Apprentice itself is neither work nor a private surface:
      // the last real app stays on the island and no time is counted.
      if (snapshot.bundle === OWN_BUNDLE) {
        await this.flushActivity();
        return;
      }
      runtime.permission = snapshot.status === "permission" ? "needed" : snapshot.status === "reading" ? "granted" : runtime.permission;
      runtime.collector = snapshot.status;
      const before = `${runtime.currentApp}|${runtime.currentCategory}|${runtime.currentPrivate}|${(runtime.currentIdleSeconds ?? 0) >= 60}`;

      if (snapshot.status === "reading") {
        const app = redact(snapshot.app, 80);
        const window = safeTitle(snapshot.window);
        const classification = classifyActivity({ app, window });
        runtime.currentApp = app;
        runtime.currentWindow = window;
        runtime.currentCategory = classification?.category || null;
        runtime.currentGroup = classification?.group || null;
        runtime.currentIdleSeconds = Math.round(Number(snapshot.idleSeconds || 0));
        runtime.currentPrivate = !classification;
        const away = runtime.currentIdleSeconds >= AWAY_SECONDS;
        if (this.wasAway && !away) await this.offerDebrief(runtime).catch(() => {});
        this.wasAway = away;
        this.wasPrivate = false;
        if (snapshot.promptSurface && snapshot.pid && !this.enhanced.has(snapshot.pid)) {
          this.enhanced.add(snapshot.pid);
          this.enhanceNext = true;
        }
        await this.observeActivity(snapshot, app, window);
        const windowKey = fingerprint(`${snapshot.bundle}:${window}`);
        if (classification && windowKey !== this.lastWindowKey) {
          this.lastWindowKey = windowKey;
          const from = this.recentApps.at(-1);
          if (from && from !== app) this.lastSwitch = { from, to: app, window, at: Date.now(), asked: false };
          this.recentApps.push(app);
          this.recentApps = this.recentApps.slice(-8);
          await appendEvent({ type: "window", app, window, source: "macOS Accessibility", stored: "event-not-image" });
          runtime.lastEventAt = new Date().toISOString();
          this.onChange("window");
        }

        // A surface that classified as private gives up its window title and its prompt.
        const prompt = classification ? redact(snapshot.focusedText, 2400) : "";
        const promptHash = snapshot.focusedHash || fingerprint(prompt);
        if (prompt && promptHash !== this.lastPromptHash) {
          this.lastPromptHash = promptHash;
          this.pendingPrompt = { text: prompt, hash: promptHash, changedAt: Date.now(), app, window };
        } else if (this.pendingPrompt) {
          const pauseMs = Date.now() - this.pendingPrompt.changedAt;
          if (!this.pendingPrompt.saved && pauseMs >= 2200) {
            await appendEvent({
              type: "prompt",
              app: this.pendingPrompt.app,
              window: this.pendingPrompt.window,
              excerpt: this.pendingPrompt.text,
              fingerprint: this.pendingPrompt.hash.slice(0, 16),
              source: "focused prompt field",
            });
            this.pendingPrompt.saved = true;
            runtime.lastEventAt = new Date().toISOString();
            this.onChange("prompt");
          }
          // A prompt is only worth a question while it is still the last thing that happened.
          if (!this.pendingPrompt.asked && pauseMs < STILL_FRESH_MS && (runtime.session?.active || runtime.ambientQuestions)) {
            const map = await loadMap();
            const intervention = catchGuardrail(this.pendingPrompt.text, map);
            const question = intervention ? null : rankQuestion({
              prompt: this.pendingPrompt.text,
              app: this.pendingPrompt.app,
              recentApps: this.recentApps,
              runtime,
              pauseMs,
            });
            if (intervention) {
              this.pendingPrompt.asked = true;
              await appendEvent({ type: "intervention", ...intervention });
              await notifyAndSpeak(intervention.text, { id: intervention.id, title: "Apprentice · guardrail" });
              this.onChange("intervention");
            } else if (question) {
              this.pendingPrompt.asked = await this.ask(runtime, map, question, {
                type: "prompt",
                fingerprint: this.pendingPrompt.hash.slice(0, 16),
                app: this.pendingPrompt.app,
                window: this.pendingPrompt.window,
                at: new Date(this.pendingPrompt.changedAt).toISOString(),
              });
            }
          }
        }

        // Inside a session a move between apps is a step too. If the hands have
        // been still since the move, that is the pause to ask in.
        const moved = this.lastSwitch;
        if (moved && !moved.asked && classification && Date.now() - moved.at < STILL_FRESH_MS) {
          const question = rankSwitch({ ...moved, runtime, idleMs: Number(snapshot.idleSeconds || 0) * 1000 });
          if (question) {
            moved.asked = await this.ask(runtime, await loadMap(), question, { type: "window", app: moved.to, window: moved.window, at: new Date(moved.at).toISOString() });
          }
        }
      } else {
        const isPrivate = snapshot.status === "excluded";
        // One refusal per visit to a private surface, never its name or title.
        if (isPrivate && !this.wasPrivate) runtime.privateRefusals = (runtime.privateRefusals || 0) + 1;
        this.wasPrivate = isPrivate;
        runtime.currentApp = null;
        runtime.currentWindow = null;
        runtime.currentCategory = null;
        runtime.currentGroup = null;
        runtime.currentIdleSeconds = null;
        runtime.currentPrivate = isPrivate;
        await this.flushActivity();
      }
      await this.parkStaleQuestions();
      await saveRuntime(runtime);
      const after = `${runtime.currentApp}|${runtime.currentCategory}|${runtime.currentPrivate}|${(runtime.currentIdleSeconds ?? 0) >= 60}`;
      if (after !== before) this.onChange("presence");
    } finally {
      this.busy = false;
    }
  }
}
