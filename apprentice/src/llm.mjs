import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Mason needs a model for two things only: the summary of a project and the
// script of the weekly recap. Any model can write them. Out of the box it is
// the Claude login already on this Mac, through the Claude Code CLI in its
// leanest form: no tools, no plugins, no settings, no saved session, so a
// digest costs a fraction of a cent instead of loading the whole coding
// environment. With APPRENTICE_LLM_URL set it is instead whatever answers
// there in the OpenAI chat format: a model running on this Mac (Ollama,
// LM Studio) or any provider's endpoint.

const local = path.join(os.homedir(), ".local", "bin", "claude");
const bin = process.env.APPRENTICE_LLM_BIN || (existsSync(local) ? local : "claude");
const endpoint = () => (process.env.APPRENTICE_LLM_URL || "").trim().replace(/\/+$/, "");

// What a provider wants beside the model and the messages, as one JSON object
// in APPRENTICE_LLM_EXTRA: Venice's venice_parameters, a temperature. Null when
// it is set but is not such an object: then nothing is asked at all, rather
// than a request in another form than the one that was written down.
function extraFields() {
  const text = (process.env.APPRENTICE_LLM_EXTRA || "").trim();
  if (!text) return {};
  try {
    const fields = JSON.parse(text);
    return fields && typeof fields === "object" && !Array.isArray(fields) ? fields : null;
  } catch { return null; }
}

export const modelAvailable = () => process.env.APPRENTICE_LLM !== "0";
// Whether the Claude Code CLI is on this Mac at all.
const claudeFound = () => existsSync(bin) || bin === "claude" && (process.env.PATH || "").split(":").some((folder) => existsSync(path.join(folder, "claude")));

// Which model writes the summaries and where it runs, for the settings screen.
export function modelStatus() {
  const url = endpoint();
  if (!url) return { name: "Claude", where: "your own login", ready: claudeFound(), onThisMac: false };
  let host = url;
  try { host = new URL(url).host; } catch {}
  const name = (process.env.APPRENTICE_LLM_MODEL || "").trim();
  return { name, where: host, ready: Boolean(name) && extraFields() !== null, onThisMac:/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) };
}

// The reply is the JSON that was asked for, with or without a fence around it
// and whatever the model thought aloud before it.
function parsed(text) {
  try {
    const reply = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "").trim();
    return JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1));
  } catch { return null; }
}

function askClaude(system, prompt, timeoutMs, model) {
  return new Promise((resolve) => {
    // A summary needs no long deliberation: without thinking the same answer
    // comes in seconds instead of a minute. A session's own CLAUDE_* settings
    // are not passed on, so the call behaves the same however Mason was started.
    const env = { ...process.env, MAX_THINKING_TOKENS: "0" };
    for (const key of Object.keys(env)) if (/^CLAUDE_|^CLAUDECODE$/.test(key)) delete env[key];
    const child = spawn(bin, [
      "-p", "--model", model, "--effort", "low", "--output-format", "json", "--no-session-persistence",
      "--system-prompt", system, "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "",
    ], { cwd: os.tmpdir(), stdio: ["pipe", "pipe", "ignore"], env });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.once("error", () => { clearTimeout(timer); resolve(null); });
    child.once("exit", () => {
      clearTimeout(timer);
      try { resolve(parsed(JSON.parse(output).result)); } catch { resolve(null); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}

async function askEndpoint(system, prompt, timeoutMs) {
  const model = (process.env.APPRENTICE_LLM_MODEL || "").trim();
  const extra = extraFields();
  if (!model || !extra) return null;
  try {
    const key = process.env.APPRENTICE_LLM_KEY;
    const response = await fetch(`${endpoint()}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ ...extra, model, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    return parsed((await response.json()).choices?.[0]?.message?.content);
  } catch { return null; }
}

// Returns the parsed JSON the model replied with, or null when there is no
// model, it timed out, or the reply was not the JSON that was asked for.
// `model` names a Claude model; an endpoint always uses the model it was given.
export async function askModel(system, prompt, { timeoutMs = 75_000, model = process.env.APPRENTICE_LLM_MODEL || "haiku" } = {}) {
  if (!modelAvailable()) return null;
  return endpoint() ? askEndpoint(system, prompt, timeoutMs) : askClaude(system, prompt, timeoutMs, model);
}
