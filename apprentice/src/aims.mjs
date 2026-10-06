import path from "node:path";
import { atomicJson, paths, readJson } from "./store.mjs";

// The aim of each day: the project the day was meant for and, in a few words,
// what about it. Kept by day, so the long view can show which days had one.

const file = () => path.join(paths.data, "aims.json");
let aims = null;

async function load() {
  aims ||= await readJson(file(), {});
  return aims;
}

export const aimOf = async (day) => (await load())[day] || null;

// Sets the aim of a day, or takes it away when none is given.
export async function setAim(day, aim) {
  const all = await load();
  if (aim?.project) {
    all[day] = {
      project: String(aim.project).replace(/\s+/g, " ").trim().slice(0, 80),
      text: String(aim.text || "").replace(/\s+/g, " ").trim().slice(0, 240),
      pickedAt: new Date().toISOString(),
    };
  } else {
    delete all[day];
  }
  await atomicJson(file(), all);
  return all[day] || null;
}
