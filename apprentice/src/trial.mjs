import path from "node:path";
import { atomicJson, paths, readJson } from "./store.mjs";

// Mason is free, and says so the way an old archiver did: after forty days of
// work a card tells its owner that the trial has ended and that a license must
// be bought, and then that there is no license. It asks for a coffee for the
// man who built it, or work for him, once. "Use evaluation copy" puts the card
// away for good.

export const TRIAL_DAYS = 40;
// Where a coffee can be bought, once there is such a place. Empty, the button is left out.
const COFFEE = "";
const HIRE = "https://headless.design";
// A day counts when Mason watched the work for at least this long.
const WORKED_SECONDS = 600;
const file = () => path.join(paths.data, "trial.json");

// The card, and whether it is due. `moves` are the days Mason watched, `days`
// the long view of work with agents, `rules` the rules standing in the agents' rules.
export async function trialPayload({ moves = {}, days = {}, rules = 0 } = {}) {
  const kept = await readJson(file(), {});
  const day = Object.values(moves).filter((moved) => moved.seconds >= WORKED_SECONDS).length;
  const worked = Object.values(days);
  return {
    day,
    of: TRIAL_DAYS,
    due: day >= TRIAL_DAYS && !kept.endedAt,
    prompts: worked.reduce((sum, projects) => sum + Object.values(projects).reduce((ofDay, work) => ofDay + (work.prompts || 0), 0), 0),
    projects: new Set(worked.flatMap((projects) => Object.keys(projects))).size,
    rules,
    coffee: COFFEE,
    hire: HIRE,
  };
}

// "Use evaluation copy": the card is not shown again.
export async function endTrial(now = Date.now()) {
  await atomicJson(file(), { endedAt: new Date(now).toISOString() });
}
