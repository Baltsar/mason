const SOCIAL = /\b(facebook|instagram|tiktok|twitter|x\.com|reddit|threads|snapchat|linkedin|bluesky|youtube|twitch)\b|\/ X\b|\bon X: /i;
const CREATION = /\b(codex|chatgpt|claude|gemini|grok|muse|lovable|cursor|windsurf|figma|pencil|framer|github|vercel|supabase|visual studio|xcode|terminal|iterm2?|warp|ghostty|wispr flow|localhost|127\.0\.0\.1)\b/i;
const RESEARCH = /\b(search|google|docs?|documentation|wikipedia|notion|linear|readme|stackoverflow|stack overflow|arxiv|hack-?nation|elevenlabs)\b/i;
const OPERATIONS = /\b(finder|system settings|systeminställningar|activity monitor|aktivitetskontroll|calendar|kalender|preview|förhandsvisning|notes|anteckningar)\b/i;
const LEISURE = /\b(spotify|netflix|steam|geforce now|game|gaming|twitch|apple tv|music|musik|hbo|disney|viaplay|svt play)\b/i;
const PRIVATE = /\b(password|keychain|1password|bitwarden|bank|swedbank|seb|handelsbanken|nordea|klarna|1177|health|medical|journal|mail|outlook|gmail|messages|whatsapp|signal|telegram|discord|slack)\b/i;
const BROWSER = /^(comet|safari|google chrome|chrome|arc|dia|firefox|microsoft edge|brave browser|brave|opera|vivaldi|orion|zen)$/i;
// The lock screen and the screen saver are not work, leisure or anything else.
const SYSTEM = /^(loginwindow|screensaverengine|apprentice|mason)$/i;

const GROUP_COLORS = { work: "#d7ff42", social: "#ff6b5f", other: "#7b7b82" };
// Mason's day turns over at 04:00, so a late night stays one day.
const DAY_STARTS_AT_HOUR = 4;

export function classifyActivity({ app = "", window = "" } = {}) {
  const haystack = `${app} ${window}`;
  if (SYSTEM.test(app.trim())) return null;
  if (PRIVATE.test(haystack)) return null;
  if (LEISURE.test(app)) return { group: "other", category: "Leisure", color: "#7b7b82" };
  if (SOCIAL.test(haystack)) return { group: "social", category: "Social", color: "#ff6b5f" };
  if (CREATION.test(haystack)) return { group: "work", category: "Creating", color: "#d7ff42" };
  if (RESEARCH.test(haystack)) return { group: "work", category: "Research", color: "#6fe4ff" };
  if (OPERATIONS.test(haystack)) return { group: "work", category: "Operations", color: "#a98bff" };
  if (LEISURE.test(haystack)) return { group: "other", category: "Leisure", color: "#7b7b82" };
  // Reading in a browser that is neither social nor leisure counts as research.
  if (BROWSER.test(app.trim())) return { group: "work", category: "Research", color: "#6fe4ff" };
  return { group: "other", category: "Other", color: "#7b7b82" };
}

export function dayStart(now = Date.now()) {
  const start = new Date(now);
  if (start.getHours() < DAY_STARTS_AT_HOUR) start.setDate(start.getDate() - 1);
  start.setHours(DAY_STARTS_AT_HOUR, 0, 0, 0);
  return start.getTime();
}

// Largest remainder, so work + social + other always reads as exactly 100.
function percentages(values) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const floors = exact.map(Math.floor);
  let rest = 100 - floors.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => [value - floors[index], index]).sort((a, b) => b[0] - a[0]);
  for (const [, index] of order) {
    if (rest <= 0) break;
    floors[index] += 1;
    rest -= 1;
  }
  return floors;
}

const ranked = (entries, limit) => [...entries.values()].sort((a, b) => b.seconds - a.seconds).slice(0, limit)
  .map((item) => ({ ...item, seconds: Math.round(item.seconds) }));

// `resolve` says which project a moment belongs to. Time inside a project is
// work whatever its window is called: a game being built is not leisure.
export function aggregateActivity(events, now = Date.now(), resolve = null) {
  const measured = events.filter((event) => event.type === "activity" && Number(event.durationSec) > 0);
  const samples = measured.length ? measured : estimateFromWindows(events, now);
  const categories = new Map();
  const groups = { work: { seconds: 0, apps: new Map(), windows: new Map() }, social: { seconds: 0, apps: new Map(), windows: new Map() }, other: { seconds: 0, apps: new Map(), windows: new Map() } };
  const apps = new Map();
  for (const sample of samples) {
    // A stored work or social label is kept. "Other" is classified again, so a
    // rule that improved also corrects what was measured earlier in the day.
    const stored = sample.category ? { group: sample.group, category: sample.category, color: sample.color } : null;
    const project = resolve ? resolve(sample) : sample.project || null;
    const classification = project ? { group: "work", category: "Project", color: "#d7ff42" }
      : stored && stored.group !== "other" ? stored : classifyActivity(sample);
    if (!classification) continue;
    const seconds = Math.max(0, Math.min(Number(sample.durationSec) || 0, 3600));
    const category = categories.get(classification.category) || { ...classification, seconds: 0 };
    category.seconds += seconds;
    categories.set(classification.category, category);
    const group = groups[classification.group];
    group.seconds += seconds;
    if (sample.app) {
      const entry = group.apps.get(sample.app) || { app: sample.app, category: classification.category, color: classification.color, seconds: 0 };
      entry.seconds += seconds;
      group.apps.set(sample.app, entry);
      apps.set(sample.app, { app: sample.app, seconds: (apps.get(sample.app)?.seconds || 0) + seconds });
      const key = `${sample.app}\n${sample.window || ""}`;
      const window = group.windows.get(key) || { app: sample.app, window: sample.window || "", project, seconds: 0 };
      window.seconds += seconds;
      group.windows.set(key, window);
    }
  }
  const totalSeconds = groups.work.seconds + groups.social.seconds + groups.other.seconds;
  const [workPercent, socialPercent, otherPercent] = percentages([groups.work.seconds, groups.social.seconds, groups.other.seconds]);
  const share = (seconds) => totalSeconds ? Math.round((seconds / totalSeconds) * 100) : 0;
  const detail = (name, percent) => ({
    group: name,
    color: GROUP_COLORS[name],
    seconds: Math.round(groups[name].seconds),
    percent,
    apps: ranked(groups[name].apps, 6).map((item) => ({ ...item, percent: share(item.seconds) })),
    windows: ranked(groups[name].windows, 6),
  });
  return {
    totalSeconds: Math.round(totalSeconds),
    workSeconds: Math.round(groups.work.seconds),
    socialSeconds: Math.round(groups.social.seconds),
    otherSeconds: Math.round(groups.other.seconds),
    workPercent,
    socialPercent,
    otherPercent,
    groups: { work: detail("work", workPercent), social: detail("social", socialPercent), other: detail("other", otherPercent) },
    categories: ranked(categories, 8).map((item) => ({ ...item, percent: share(item.seconds) })),
    topApps: ranked(apps, 6).map((item) => ({ ...item, percent: share(item.seconds) })),
    switches: events.filter((event) => event.type === "window").length,
    source: measured.length ? "measured-active-time" : samples.length ? "estimated-from-window-switches" : "waiting-for-activity",
    sampleCount: samples.length,
    privatePolicy: "Private surfaces and idle time are excluded, not classified.",
  };
}

function estimateFromWindows(events, now) {
  const windows = events.filter((event) => event.type === "window" && classifyActivity(event));
  return windows.map((event, index) => {
    const start = Date.parse(event.at);
    const next = index + 1 < windows.length ? Date.parse(windows[index + 1].at) : now;
    return { ...event, durationSec: Math.max(2, Math.min((next - start) / 1000, 300)) };
  }).filter((event) => Number.isFinite(event.durationSec));
}

export const activityPatterns = { SOCIAL, CREATION, RESEARCH, OPERATIONS, LEISURE, PRIVATE, BROWSER };
