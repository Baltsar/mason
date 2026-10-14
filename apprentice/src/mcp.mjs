import readline from "node:readline";
import { loadLocalEnv } from "./config.mjs";
import { loadSettings } from "./settings.mjs";

// What is written here is for its owner alone, as in the server.
process.umask(0o077);
// An agent that starts Mason over stdio is held to the same switches as the
// window: with the agents' logs switched off none is read, and what
// .env.local and Settings say is what holds. And it asks no model: the
// summaries are written by the server, once, and this only reads what is
// kept. Otherwise a question from an agent could send excerpts of the
// owner's prompts to a model with Summaries switched off, or write a memory
// beside the server writing the same one.
await loadLocalEnv();
await loadSettings();
process.env.APPRENTICE_LLM = "0";
const { handleMcp } = await import("./mcp-handler.mjs");

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const response = await handleMcp(JSON.parse(line));
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } })}\n`);
  }
}
