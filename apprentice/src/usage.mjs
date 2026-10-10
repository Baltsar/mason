import path from "node:path";
import { dayKey } from "./days.mjs";
import { atomicJson, paths, readJson } from "./store.mjs";

// What the model was asked for and how much it took: for each day, the calls
// and the tokens of each thing Mason uses a model for. The count is the
// provider's own, as it came back with the answer; nothing of what was sent
// or answered is kept. With the login Mason borrows, these tokens come out of
// its owner's own allowance, so they are shown where the switch is.

const file = () => path.join(paths.data, "usage.json");
const KEPT_DAYS = 60;
let ledger = null;
let writing = Promise.resolve();

async function load() {
  ledger ||= { days: {}, ...(await readJson(file(), {})) };
  return ledger;
}

// One call that was answered. `purpose` is what it was for.
export function recordUse({ purpose = "other", input = 0, output = 0, at = Date.now() } = {}) {
  writing = writing.catch(() => {}).then(async () => {
    const known = await load();
    const spent = ((known.days[dayKey(at)] ||= {})[purpose] ||= { calls: 0, input: 0, output: 0 });
    spent.calls += 1;
    spent.input += Math.max(0, Math.round(Number(input) || 0));
    spent.output += Math.max(0, Math.round(Number(output) || 0));
    for (const day of Object.keys(known.days).sort().slice(0, -KEPT_DAYS)) delete known.days[day];
    await atomicJson(file(), known);
  });
  return writing;
}

// Today and the last seven days, in all and by what it was for, the most first.
export async function usagePayload(now = Date.now()) {
  const known = await load();
  const today = dayKey(now);
  const week = new Set(Array.from({ length: 7 }, (_, back) => dayKey(now - back * 86_400_000)));
  const sum = (days) => {
    const by = {};
    let calls = 0;
    let tokens = 0;
    for (const day of days) for (const [purpose, spent] of Object.entries(known.days[day] || {})) {
      calls += spent.calls;
      tokens += spent.input + spent.output;
      by[purpose] = (by[purpose] || 0) + spent.input + spent.output;
    }
    return { calls, tokens, by: Object.entries(by).sort((a, b) => b[1] - a[1]).map(([purpose, spent]) => ({ purpose, tokens: spent })) };
  };
  return { today: sum([today]), week: sum(week) };
}
