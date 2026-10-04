import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The thinking is done by the Claude login already on this Mac, through the
// Claude Code CLI in its leanest form: no tools, no plugins, no settings, no
// saved session. A digest then costs a fraction of a cent instead of loading
// the whole coding environment for every call.

const local = path.join(os.homedir(), ".local", "bin", "claude");
const bin = process.env.APPRENTICE_LLM_BIN || (existsSync(local) ? local : "claude");

export const modelAvailable = () => process.env.APPRENTICE_LLM !== "0";

// Returns the parsed JSON the model replied with, or null when there is no
// model, it timed out, or the reply was not the JSON that was asked for.
export function askModel(system, prompt, { timeoutMs = 75_000, model = process.env.APPRENTICE_LLM_MODEL || "haiku" } = {}) {
  return new Promise((resolve) => {
    if (!modelAvailable()) return resolve(null);
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
      try {
        const reply = String(JSON.parse(output).result || "").replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
        resolve(JSON.parse(reply.slice(reply.indexOf("{"), reply.lastIndexOf("}") + 1)));
      } catch { resolve(null); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}
