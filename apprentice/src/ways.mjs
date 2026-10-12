import { askModel, claudeFound, modelStatus } from "./llm.mjs";
import { settings } from "./settings.mjs";

// The ways Mason can be run. It counts and measures by itself; a model adds
// the words (what a project is, the quiz, the rules that are repeated). Which
// model, if any, is the first thing a new owner should be able to see and
// choose, with what each one costs and what it sends, instead of finding out
// later from a switch.
//
// There are three ways, and a fourth that only shows when it is set up by
// hand: no model; the Claude login already on this Mac; a model running on
// this Mac; and an endpoint named in .env.local. Only what works is offered.

// The programs that run a model on this Mac, at the address each listens on
// by default. Only these are looked for and only these can be chosen here:
// any other address is set by hand in .env.local.
export const ON_THIS_MAC = [["Ollama", "http://127.0.0.1:11434/v1"], ["LM Studio", "http://127.0.0.1:1234/v1"]];

// Which of them is running, and the models each has. One that does not
// answer in half a second is not running.
export async function localModels(fetcher = fetch) {
  const found = await Promise.all(ON_THIS_MAC.map(async ([app, url]) => {
    try {
      const response = await fetcher(`${url}/models`, { signal: AbortSignal.timeout(500) });
      if (!response.ok) return null;
      const models = ((await response.json()).data || []).map((model) => String(model?.id || "")).filter((id) => /^[\w.:\/-]{1,80}$/.test(id)).slice(0, 30);
      return { app, url, models };
    } catch { return null; }
  }));
  return found.filter(Boolean);
}

// The ways as they stand right now. `outside` is the endpoint .env.local names, if it names one.
export async function waysPayload({ outside = "", fetcher = fetch } = {}) {
  const chosen = settings();
  const status = modelStatus();
  let host = "";
  try { host = outside ? new URL(outside).host : ""; } catch {}
  return {
    // What is in use: nothing, Claude, a model on this Mac, or what .env.local names.
    chosen: !chosen.summaries ? "none" : chosen.writer === "local" ? "local" : chosen.writer === "claude" || !host ? "claude" : "own",
    // Whether Claude Code is on this Mac, and why it last refused when it is the one in use.
    claude: { found: claudeFound(), problem: status.name === "Claude" ? status.problem || "" : "" },
    local: await localModels(fetcher),
    localChosen: chosen.writer === "local" ? { url: chosen.localUrl, model: chosen.localModel } : null,
    own: host ? { host } : null,
  };
}

// One question to the model that is in use, to see that it answers. It is
// counted like any other call, and it says how long the answer took or, in a
// word, why there was none.
export async function checkModel(ask = askModel) {
  if (!settings().summaries) return { ok: false, why: "off" };
  const started = Date.now();
  const reply = await ask('Reply with JSON only, exactly this: {"ok": true}', "Are you there?", { timeoutMs: 40_000, purpose: "check" });
  const status = modelStatus();
  return reply ? { ok: true, ms: Date.now() - started, name: status.name } : { ok: false, why: status.problem || "not answering", name: status.name };
}
