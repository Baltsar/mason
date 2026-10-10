import path from "node:path";
import { atomicJson, paths, readJson } from "./store.mjs";

// The first start. Mason needs one thing from its owner: leave to see which
// window is in front, which macOS calls Accessibility. Asked for at the first
// second, by a system dialog and with no reason given, that is where a new
// owner stops. So the first start shows what Mason already knows, from the
// agents' own logs and with no leave from anyone, and then asks for the one
// thing, saying what it reads and what it never does. Nothing else is asked:
// a model, a voice and the rest have switches and can wait.

const file = () => path.join(paths.data, "welcome.json");

// Whether the welcome is shown, and what it says. `permission` is what macOS
// last said about the leave to see the front window; `days` the long view.
export async function welcomePayload({ permission = "unknown", days = {}, through = 0 } = {}) {
  const kept = await readJson(file(), {});
  const worked = Object.values(days);
  const minutes = worked.reduce((sum, projects) => sum + Object.values(projects).reduce((ofDay, work) => ofDay + (work.minutes || 0), 0), 0);
  return {
    // Someone who already gave the leave, or said "not now", is not welcomed again.
    show: !kept.doneAt && permission !== "granted",
    access: permission === "granted" ? "on" : "needed",
    // Until the logs have been read once there is nothing to say of them yet.
    read: Boolean(through),
    days: worked.length,
    hours: Math.round(minutes / 60),
  };
}

// "Start", or "Not now": the welcome is over.
export async function endWelcome(now = Date.now()) {
  await atomicJson(file(), { doneAt: new Date(now).toISOString() });
}
