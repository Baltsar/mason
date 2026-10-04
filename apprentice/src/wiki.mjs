import { writeFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "./store.mjs";

const esc = (value) => String(value ?? "").replaceAll("\n", " ").trim();
const clock = (iso) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export async function writeWiki(map) {
  const session = map.sessions[0];
  const title = session?.title || "Latest work session";
  const decisions = map.decisions.map((item) => {
    const wikiPath = item.source?.path?.startsWith("../") ? `../${item.source.path}` : item.source?.path;
    const link = wikiPath ? `[${esc(item.source.label)}](${esc(wikiPath)}${item.source.lines ? `#L${item.source.lines}` : ""})` : esc(item.source?.label || "Local signal");
    const moment = item.moment ? `\n\nScreen moment: ${clock(item.moment.at)} · ${esc(item.moment.app)} · ${esc(item.moment.window || item.moment.evidence)}` : "";
    const quote = item.quote ? `\n\n> ${esc(item.quote)}` : "";
    return `## ${esc(item.title)}\n\nKind: ${esc(item.kind)}\n\n${esc(item.body)}${quote}${moment}\n\nSource: ${link}`;
  }).join("\n\n");
  const unknowns = map.uncertainties.map((item) => `- ${esc(item.text)}${item.status === "resolved" ? " ✓" : ""}`).join("\n") || "- No open questions.";
  const teachBack = map.debrief?.teachBack;
  const understood = teachBack
    ? `\n## Teach-back\n\n${esc(teachBack.text)}\n\nStatus: ${teachBack.status === "confirmed" ? `confirmed by the expert at ${clock(teachBack.confirmedAt)}` : "waiting for the expert"}\n`
    : "";
  const body = `---\ntitle: "${esc(title)}"\ntype: work-map\nupdated: ${new Date().toISOString()}\n---\n\n# ${esc(title)}\n\n${esc(session?.summary || "")}\n\n${decisions}\n${understood}\n## Still uncertain\n\n${unknowns}\n`;
  await writeFile(path.join(paths.wiki, "work-map.md"), body);
}

export function buildRecap(map, events, activity = null) {
  const decisions = map.decisions.filter((item) => item.kind !== "context");
  const apps = [...new Set(events.filter((event) => event.app).map((event) => event.app))];
  const summary = map.sessions[0]?.summary || "Mason does not have a complete session to summarize yet.";
  const open = map.uncertainties.find((item) => item.status !== "resolved");
  const split = activity?.totalSeconds
    ? `Today was ${activity.workPercent} percent work, ${activity.socialPercent} percent social and ${activity.otherPercent} percent other, over ${Math.max(1, Math.round(activity.totalSeconds / 60))} active minutes.`
    : "";
  const script = [
    "Here is your recap.",
    split,
    summary,
    ...decisions.slice(0, 4).map((item) => `${item.kind === "guardrail" ? "Boundary" : item.kind === "discarded" ? "You discarded" : "Decision"}: ${item.title}. ${item.quote && item.quote !== item.body ? `In your words: ${item.quote}` : item.body}`),
    open ? `One question remains: ${open.text}` : "There are no open questions right now.",
  ].filter(Boolean).join(" ");
  return {
    generatedAt: new Date().toISOString(),
    title: activity?.totalSeconds ? `${activity.workPercent}% work. ${activity.socialPercent}% social.` : "Your day, without the private parts",
    summary,
    apps,
    decisions: decisions.slice(0, 6),
    openQuestion: open?.text || null,
    script,
  };
}
