import { activityPatterns } from "./activity.mjs";

// How a day moved between tools. A tool is what the hands were on: an app, or
// in a browser the site named in the window title. A chat or mail surface is a
// tool too, known only by its name and the time spent there.

// Sites that say who they are in their window title: "SvenskTiger - Grok",
// "Home / X", "Feed | LinkedIn". Each has a tile for when no app of that name
// is installed to lend its icon: a letter or two on the colour it is known by.
const SITES = [
  ["Grok", "G", "#0b0b0c"], ["ChatGPT", "GPT", "#10a37f"], ["Claude", "C", "#d97757"], ["Gemini", "Ge", "#4285f4"],
  ["Perplexity", "P", "#20808d"], ["Copilot", "Co", "#0078d4"], ["Lovable", "L", "#ff4f6e"], ["v0", "v0", "#0b0b0c"],
  ["GitHub", "GH", "#24292f"], ["Vercel", "▲", "#0b0b0c"], ["Supabase", "S", "#3ecf8e"], ["Figma", "F", "#a259ff"],
  ["Notion", "N", "#f3eee2"], ["Linear", "L", "#5e6ad2"], ["ElevenLabs", "II", "#0b0b0c"],
  ["YouTube", "\u25B6\uFE0E", "#ff0033"], ["LinkedIn", "in", "#0a66c2"], ["X", "X", "#0b0b0c"], ["Reddit", "r", "#ff4500"],
  ["Facebook", "f", "#1877f2"], ["Instagram", "IG", "#e1306c"], ["TikTok", "T", "#0b0b0c"], ["Threads", "@", "#0b0b0c"],
  ["Bluesky", "b", "#0085ff"], ["Twitch", "t", "#9146ff"],
  ["Google Calendar", "31", "#1a73e8"], ["Google Docs", "D", "#4285f4"], ["Google Sheets", "S", "#0f9d58"], ["Google Drive", "Dr", "#fbbc04"],
  // Chat, mail and meetings: named by the collector, never read.
  ["Discord", "D", "#5865f2"], ["Slack", "#", "#4a154b"], ["Gmail", "M", "#ea4335"], ["Outlook", "O", "#0078d4"],
  ["WhatsApp", "W", "#25d366"], ["Telegram", "T", "#229ed9"], ["Signal", "S", "#3a76f0"], ["Messages", "M", "#34c759"],
  ["Mail", "@", "#1b8cf2"], ["Microsoft Teams", "T", "#6264a7"], ["zoom.us", "Z", "#2d8cff"],
];
const KNOWN = new Map(SITES.map(([name, text, color]) => [name.toLowerCase(), { name, tile: { text, color } }]));
const ALIASES = new Map([["google gemini", "gemini"], ["twitter", "x"], ["youtube music", "youtube"]]);

// What a browser adds to the page's own title.
const BROWSER_NOTE = / [-–—] (audio (playing|muted)|(camera|microphone)( (and|or) (camera|microphone))? recording|picture[- ]in[- ]picture)$/i;
// On the day's ribbon, time in one tool is one stretch until two minutes go by.
const SAME_STRETCH_MS = 120_000;
// A longer gap than this is a break, and what comes after it is not a jump.
const BREAK_MS = 15 * 60_000;
// Under five seconds in front is a glance or a pass on the way somewhere else:
// a new tab, the Finder flashing by. It is neither a visit nor a jump.
const GLANCE_SECONDS = 5;

// What macOS puts in front by itself is not a tool anyone went to.
export const NOT_A_TOOL = /^(usernotificationcenter|coreservicesuiagent|securityagent|loginwindow|screensaverengine|dock|mason|apprentice)$/i;

export const tileOf = (name) => KNOWN.get(String(name).toLowerCase())?.tile || null;

// The parts of a window title, with a count of unread things taken off.
function partsOf(title) {
  return title.split(/\s+[-|/·–—]\s+|:\s+/).map((part) => part.replace(/^\(\d+\+?\)\s*/, "").trim()).filter(Boolean);
}

function siteOf(app, title) {
  let clean = title.trim();
  // "Page - Audio playing - Comet" is the page.
  const browser = new RegExp(` [-–—] (${app.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|Mozilla Firefox)$`, "i");
  clean = clean.replace(browser, "").replace(BROWSER_NOTE, "").replace(browser, "");
  const parts = partsOf(clean);
  if (!parts.length) return null;
  // The site is named last, or first, as a whole part of the title: a page
  // that only mentions a tool is not that tool.
  for (const part of [parts.at(-1), parts[0]]) {
    const key = part.toLowerCase();
    const known = KNOWN.get(ALIASES.get(key) || key);
    if (known) return known.name;
  }
  // "Someone on X: what they wrote"
  if (/ on X$/.test(parts[0])) return "X";
  return null;
}

// The tool a moment was spent in.
export function toolOf({ type, app = "", window = "" } = {}) {
  const name = String(app).trim();
  if (type === "private" || !activityPatterns.BROWSER.test(name)) return name;
  return siteOf(name, String(window)) || name;
}

const pairKey = (a, b) => a < b ? `${a}\n${b}` : `${b}\n${a}`;
const mostOf = (groups) => Object.entries(groups).sort((a, b) => b[1] - a[1])[0]?.[0] || "other";

// Time in one tool, joined while the next moment in it comes soon enough.
function joined(samples, withinMs) {
  const stretches = [];
  for (const sample of samples) {
    const last = stretches.at(-1);
    if (last && last.tool === sample.tool && sample.start - last.end < withinMs) {
      last.end = Math.max(last.end, sample.end);
      last.seconds += sample.seconds;
      for (const [group, seconds] of Object.entries(sample.groups)) last.groups[group] = (last.groups[group] || 0) + seconds;
    } else {
      stretches.push({ ...sample, groups: { ...sample.groups } });
    }
  }
  return stretches;
}

// `groupOf` says whether a moment was work, social or other; time inside a
// project is work whatever its window is called. Chat is its own group.
export function buildFlow(events, { groupOf = (sample) => sample.group || "other" } = {}) {
  const samples = [];
  for (const event of events) {
    if (event.type !== "activity" && event.type !== "private") continue;
    const seconds = Math.min(Number(event.durationSec) || 0, 3600);
    const start = Date.parse(event.startedAt || event.at);
    const tool = toolOf(event);
    if (!(seconds > 0) || !Number.isFinite(start) || !tool || NOT_A_TOOL.test(tool)) continue;
    const group = event.type === "private" ? "chat" : groupOf(event) || "other";
    samples.push({ tool, start, end: start + seconds * 1000, seconds, groups: { [group]: seconds } });
  }
  samples.sort((a, b) => a.start - b.start);

  // A visit lasts until another tool takes over. A pause in the same tool does
  // not end it, and a glance at something else does not interrupt it.
  const visits = joined(joined(samples, BREAK_MS).filter((visit) => visit.seconds >= GLANCE_SECONDS), BREAK_MS);

  const tools = new Map();
  for (const sample of samples) {
    const tool = tools.get(sample.tool) || { name: sample.tool, seconds: 0, visits: 0, groups: {} };
    tool.seconds += sample.seconds;
    for (const [group, seconds] of Object.entries(sample.groups)) tool.groups[group] = (tool.groups[group] || 0) + seconds;
    tools.set(sample.tool, tool);
  }

  const pairs = new Map();
  let jumps = 0;
  let sittings = visits.length ? 1 : 0;
  let longest = null;
  visits.forEach((visit, index) => {
    tools.get(visit.tool).visits += 1;
    if (!longest || visit.seconds > longest.seconds) longest = visit;
    const before = visits[index - 1];
    if (!before) return;
    if (visit.start - before.end >= BREAK_MS) { sittings += 1; return; }
    jumps += 1;
    const key = pairKey(before.tool, visit.tool);
    const [a, b] = key.split("\n");
    const pair = pairs.get(key) || { a, b, count: 0, there: 0, back: 0 };
    pair.count += 1;
    if (before.tool === a) pair.there += 1; else pair.back += 1;
    pairs.set(key, pair);
  });

  const totalSeconds = samples.reduce((sum, sample) => sum + sample.seconds, 0);
  const iso = (time) => new Date(time).toISOString();
  return {
    totalSeconds: Math.round(totalSeconds),
    jumps,
    // Jumps for every hour the hands were actually on something.
    perHour: totalSeconds >= 600 ? Math.round(jumps / (totalSeconds / 3600)) : null,
    sittings,
    tools: [...tools.values()].sort((a, b) => b.seconds - a.seconds)
      .map((tool) => ({ name: tool.name, seconds: Math.round(tool.seconds), visits: tool.visits, group: mostOf(tool.groups), tile: tileOf(tool.name) })),
    pairs: [...pairs.values()].sort((a, b) => b.count - a.count),
    longest: longest ? { tool: longest.tool, seconds: Math.round(longest.seconds), startedAt: iso(longest.start) } : null,
    // The day in order, for the ribbon: what was in front, and when.
    track: joined(samples, SAME_STRETCH_MS).map((stretch) => ({ tool: stretch.tool, group: mostOf(stretch.groups), startedAt: iso(stretch.start), endedAt: iso(stretch.end), seconds: Math.round(stretch.seconds) })),
    from: samples.length ? iso(samples[0].start) : null,
    to: samples.length ? iso(Math.max(...samples.map((sample) => sample.end))) : null,
  };
}
