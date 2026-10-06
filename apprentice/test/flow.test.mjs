import test from "node:test";
import assert from "node:assert/strict";
import { buildFlow, tileOf, toolOf } from "../src/flow.mjs";

const at = (minute, second = 0) => new Date(Date.UTC(2026, 9, 4, 9, minute, second)).toISOString();
const spent = (app, window, minute, seconds, more = {}) => ({ type: "activity", app, window, group: "work", durationSec: seconds, startedAt: at(minute), at: at(minute), ...more });

test("a tool is the app, or in a browser the site its window title names", () => {
  assert.equal(toolOf({ app: "Cursor", window: "flow.mjs" }), "Cursor");
  assert.equal(toolOf({ app: "Comet", window: "SvenskTiger - Grok" }), "Grok");
  assert.equal(toolOf({ app: "Comet", window: "(2) Home / X - Comet" }), "X");
  assert.equal(toolOf({ app: "Comet", window: "R on X: \"The prompt: an isometric object\"" }), "X");
  assert.equal(toolOf({ app: "Safari", window: "Feed | LinkedIn" }), "LinkedIn");
  assert.equal(toolOf({ app: "Comet", window: "What a cheeky scam - YouTube - Audio playing - Comet" }), "YouTube");
  assert.equal(toolOf({ app: "Google Chrome", window: "Google Calendar - Saturday, 17 October 2026 - Google Chrome" }), "Google Calendar");
  // A page that only mentions a tool is the browser, not the tool.
  assert.equal(toolOf({ app: "Comet", window: "Why Grok and Claude disagree - a blog" }), "Comet");
  assert.equal(toolOf({ app: "Comet", window: "Bitmagic Game - Comet" }), "Comet");
  // A private surface is known by the name the collector gave it.
  assert.equal(toolOf({ type: "private", app: "Discord" }), "Discord");
  assert.deepEqual(tileOf("LinkedIn"), { text: "in", color: "#0a66c2" });
  assert.equal(tileOf("Cursor"), null);
});

test("in a browser the address of the tab says which tool it is, whatever the page is called", () => {
  assert.equal(toolOf({ app: "Comet", window: "Untitled", host: "www.figma.com" }), "Figma");
  assert.equal(toolOf({ app: "Comet", window: "Board 3", host: "miro.com" }), "Miro");
  assert.equal(toolOf({ app: "Safari", window: "Inbox", host: "calendar.google.com" }), "Google Calendar");
  // A site with no name of its own is known by its address, without what is in front of it.
  assert.equal(toolOf({ app: "Comet", window: "FLORA - Home", host: "app.flora.ai" }), "flora.ai");
  assert.equal(toolOf({ app: "Comet", window: "Why Grok and Claude disagree - YouTube", host: "techembassy.org" }), "techembassy.org");
  // A page served from this Mac is the thing being built.
  assert.equal(toolOf({ app: "Comet", window: "Kubb & Blood", host: "localhost:8787" }), "Localhost");
  // Without an address the title still says it, as before.
  assert.equal(toolOf({ app: "Comet", window: "Feed | LinkedIn" }), "LinkedIn");
  assert.deepEqual(tileOf("Localhost"), { text: "~", color: "#d7ff42" });
  assert.equal(tileOf("flora.ai").text, "F");
  assert.deepEqual(tileOf("flora.ai"), tileOf("flora.ai"));
  const flow = buildFlow([spent("Comet", "Untitled", 0, 120, { host: "www.figma.com" }), spent("Comet", "Kubb", 3, 60, { host: "localhost:8787" }), spent("Cursor", "flow.mjs", 5, 60)]);
  assert.deepEqual(flow.tools.map((tool) => [tool.name, tool.host]), [["Figma", "www.figma.com"], ["Localhost", ""], ["Cursor", ""]]);
});

test("jumps are counted between tools: a glance, a pause and a break are not jumps", () => {
  const flow = buildFlow([
    spent("Claude", "Mason", 0, 300),
    spent("Comet", "Home / X", 6, 60, { group: "social" }),
    spent("Claude", "Mason", 8, 120),
    // Two seconds of Finder on the way back is a glance.
    { type: "activity", app: "Finder", window: "", group: "work", durationSec: 2, startedAt: at(10, 10), at: at(10, 10) },
    { type: "activity", app: "Claude", window: "Mason", group: "work", durationSec: 60, startedAt: at(10, 20), at: at(10, 20) },
    { type: "private", app: "Discord", durationSec: 90, startedAt: at(12), at: at(12) },
    // Half an hour later is a new sitting, not a jump from Discord.
    spent("Cursor", "flow.mjs", 45, 600),
    { type: "window", app: "Cursor", window: "flow.mjs", at: at(45) },
  ]);
  assert.equal(flow.jumps, 3);
  assert.equal(flow.sittings, 2);
  assert.equal(flow.totalSeconds, 1232);
  assert.deepEqual(flow.pairs.map((pair) => [pair.a, pair.b, pair.count, pair.there, pair.back]), [["Claude", "X", 2, 1, 1], ["Claude", "Discord", 1, 1, 0]]);
  assert.deepEqual(flow.tools.map((tool) => [tool.name, tool.seconds, tool.visits, tool.group]), [
    ["Cursor", 600, 1, "work"], ["Claude", 480, 2, "work"], ["Discord", 90, 1, "chat"], ["X", 60, 1, "social"], ["Finder", 2, 0, "work"],
  ]);
  assert.deepEqual([flow.longest.tool, flow.longest.seconds], ["Cursor", 600]);
  // The ribbon keeps the day in order, glance and all.
  assert.deepEqual(flow.track.map((stretch) => stretch.tool), ["Claude", "X", "Claude", "Finder", "Claude", "Discord", "Cursor"]);
  assert.equal(flow.from, at(0));
});

test("a day with nothing measured is an empty flow", () => {
  const flow = buildFlow([{ type: "window", app: "Claude", window: "x", at: at(0) }]);
  assert.deepEqual([flow.jumps, flow.sittings, flow.tools.length, flow.longest, flow.from, flow.perHour], [0, 0, 0, null, null, null]);
});

test("time in a project is work, whatever the window is called", () => {
  const flow = buildFlow([spent("Comet", "Kubb & Blood", 0, 120, { group: "other" })], { groupOf: () => "work" });
  assert.equal(flow.tools[0].group, "work");
});
