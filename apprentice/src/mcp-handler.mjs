import { loadMap, readEvents, readEventsSince } from "./store.mjs";
import { aggregateActivity, dayStart } from "./activity.mjs";
import { reviewDecision } from "./teach-engine.mjs";
import { projectIndex } from "./projects.mjs";
import { projectMemory } from "./memory.mjs";

const toolDefinitions = [
  { name: "what_happened_last", description: "Summarize the latest observed work session with source references.", inputSchema: { type: "object", properties: {} } },
  { name: "what_did_you_learn", description: "Return learned decisions and guardrails in the expert's own words, with sources.", inputSchema: { type: "object", properties: {} } },
  { name: "what_are_you_unsure_about", description: "Return unresolved questions Mason should ask when timing is right.", inputSchema: { type: "object", properties: {} } },
  { name: "how_was_the_day", description: "Today's measured active time split into work, social and other, with the top apps. Private surfaces and idle time are never included.", inputSchema: { type: "object", properties: {} } },
  { name: "check_decision", description: "Check a planned action against the expert's guardrails before doing it. Returns STOP with the expert's own words, or CLEAR.", inputSchema: { type: "object", required: ["decision"], properties: { decision: { type: "string", minLength: 4 } } } },
  { name: "guardrails_for_agents", description: "Export the Work Map as instructions an agent can load: the steps to follow and where to stop and ask.", inputSchema: { type: "object", properties: {} } },
  { name: "how_was_it_built", description: "How one of the expert's projects is put together, what was built, where it was left and what they keep telling their agents. Read from their own prompts and the files their agents changed. Without a project, the one worked on last.", inputSchema: { type: "object", properties: { project: { type: "string" } } } },
  { name: "search_work_map", description: "Search decisions, guardrails and discarded directions in the local Work Map.", inputSchema: { type: "object", required: ["query"], properties: { query: { type: "string", minLength: 2 } } } },
];

function sourceLine(source) {
  if (!source) return "";
  return `Source: ${source.label || source.type || "local event"}${source.path ? ` · ${source.path}` : ""}${source.lines ? `:${source.lines}` : ""}`;
}

export async function callTool(name, args = {}) {
  const [map, events] = await Promise.all([loadMap(), readEvents(80)]);
  if (name === "what_happened_last") {
    const session = map.sessions[0];
    const lastEvents = events.slice(-8).map((event) => `${event.at} · ${event.type} · ${event.app || event.question || event.window || ""}`);
    return [session?.title, session?.summary, session?.source ? sourceLine(session.source) : "", lastEvents.length ? `Latest signals:\n${lastEvents.join("\n")}` : "No live events yet."].filter(Boolean).join("\n\n");
  }
  if (name === "what_did_you_learn") {
    return map.decisions.map((item) => `${item.kind.toUpperCase()}: ${item.title}\n${item.body}\n${item.quote ? `Expert's words: “${item.quote}”\n` : ""}${sourceLine(item.source)}`).join("\n\n");
  }
  if (name === "what_are_you_unsure_about") {
    const open = map.uncertainties.filter((item) => item.status !== "resolved");
    return open.length ? open.map((item) => `- ${item.text}${item.why ? ` (${item.why})` : ""}`).join("\n") : "No open questions.";
  }
  if (name === "how_was_the_day") {
    const activity = aggregateActivity(await readEventsSince(dayStart()));
    if (!activity.totalSeconds) return "No active time has been measured today.";
    const apps = activity.topApps.map((item) => `${item.app} ${item.percent}%`).join(", ");
    return `${activity.workPercent}% work, ${activity.socialPercent}% social, ${activity.otherPercent}% other over ${Math.round(activity.totalSeconds / 60)} active minutes.\nTop apps: ${apps}\n${activity.privatePolicy}`;
  }
  if (name === "check_decision") {
    const { intervention, checked } = reviewDecision(String(args.decision || ""), map);
    return intervention
      ? `STOP. ${intervention.guardrailTitle}\nExpert's words: “${intervention.quote}”\n${sourceLine(intervention.source)}`
      : `CLEAR. Checked against ${checked} guardrails; none applies.`;
  }
  if (name === "guardrails_for_agents") {
    const steps = map.decisions.filter((item) => item.kind === "decision").map((item) => `- ${item.title}: ${item.quote || item.body}`);
    const stops = map.decisions.filter((item) => item.kind !== "decision").map((item) => `- ${item.title}: “${item.quote || item.body}” (${sourceLine(item.source)})`);
    return `# How this expert works\n\n## Follow\n${steps.join("\n") || "- Nothing captured yet."}\n\n## Stop and ask before\n${stops.join("\n") || "- Nothing captured yet."}\n\nCall check_decision before any step that is not listed here.`;
  }
  if (name === "how_was_it_built") {
    const index = await projectIndex(dayStart() - 20 * 86_400_000, { maxAgeMs: 120_000 });
    const worked = index.list.filter((project) => project.prompts.length).sort((a, b) => b.prompts.at(-1).at - a.prompts.at(-1).at);
    const wanted = String(args.project || "").trim().toLowerCase();
    const project = wanted ? worked.find((item) => item.name.toLowerCase().includes(wanted)) : worked[0];
    if (!project) return worked.length ? `No project matches “${args.project}”. Known projects: ${worked.map((item) => item.name).join(", ")}.` : "No project has been worked on yet.";
    const memory = await projectMemory(project, { wait: true });
    const block = (title, lines) => lines?.length ? `## ${title}\n${lines.map((line) => `- ${line}`).join("\n")}` : "";
    return [
      `# ${project.name}${memory.one_line ? `\n${memory.one_line}` : ""}`,
      block("How it is put together", memory.how),
      block("Files changed most", (memory.parts || []).map((item) => `${item.file} (${item.edits} changes)`)),
      block("Built or changed", memory.built),
      memory.left_off ? `## Where it was left\n${memory.left_off}` : "",
      block("Still open", memory.open),
      block("What they keep telling their agents", (memory.keeps_saying || []).map((item) => `${item.rule} (said ${item.times} times: “${item.example}”)`)),
      `Source: ${memory.prompts} prompts over ${memory.days} days and ${memory.filesChanged} files changed by their agents, read from the Claude Code logs on this Mac.`,
    ].filter(Boolean).join("\n\n");
  }
  if (name === "search_work_map") {
    const query = String(args.query || "").toLocaleLowerCase("en");
    const found = map.decisions.filter((item) => JSON.stringify(item).toLocaleLowerCase("en").includes(query));
    return found.length ? found.map((item) => `${item.title}\n${item.body}\n${sourceLine(item.source)}`).join("\n\n") : `Nothing in the Work Map matched “${args.query}”.`;
  }
  throw new Error(`Unknown tool: ${name}`);
}

export async function handleMcp(message) {
  const { id = null, method, params = {} } = message || {};
  if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "mason", version: "0.1.0" } } };
  if (method === "notifications/initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: toolDefinitions } };
  if (method === "tools/call") {
    try {
      const text = await callTool(params.name, params.arguments || {});
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: false } };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error.message }], isError: true } };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

export { toolDefinitions };
