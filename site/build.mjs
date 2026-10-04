// Assembles the public page into site/dist: node site/build.mjs
//
// The tutor on the page is the app's own teach engine, copied as it is with
// only its Node import swapped for the browser's. The Work Map it runs on is a
// public subset: rules read from other projects' prompts never leave the Mac.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const app = path.join(root, "apprentice");
const dist = path.join(here, "dist");
const REPO = process.env.APPRENTICE_REPO || "https://github.com/Baltsar/apprentice";
const PROJECT = "HACKNATION";
const FILMS = ["01-team-introduction.mp4", "02-product-demo.mp4", "03-technical-walkthrough.mp4"];

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "films"), { recursive: true });

const engine = await readFile(path.join(app, "src", "teach-engine.mjs"), "utf8");
const nodeImport = 'import { randomUUID } from "node:crypto";';
if (!engine.includes(nodeImport)) throw new Error("teach-engine.mjs no longer starts with the import this build replaces.");
await writeFile(path.join(dist, "teach-engine.js"), engine.replace(nodeImport, "const randomUUID = () => crypto.randomUUID();"));

const map = JSON.parse(await readFile(path.join(app, "data", "work-map.json"), "utf8"));
const isPublic = (item) => item.source?.type !== "inferred" || item.source?.project === PROJECT;
const decisions = map.decisions.filter(isPublic).map(({ id, kind, title, body, quote, moment, source }) => ({
  id, kind, title, body, quote,
  moment: moment ? { at: moment.at, app: moment.app, evidence: moment.evidence } : null,
  source: { label: source?.label ?? "" },
}));
await writeFile(path.join(dist, "workmap.json"), JSON.stringify({ decisions }, null, 2));

const presets = JSON.parse(await readFile(path.join(here, "presets.json"), "utf8"));
const page = (await readFile(path.join(here, "index.html"), "utf8"))
  .replaceAll("__REPO__", REPO)
  .replace("__PRESETS__", JSON.stringify(presets));
await writeFile(path.join(dist, "index.html"), page);

const missing = [];
for (const film of FILMS) {
  const from = path.join(root, "film", "out", film);
  if (existsSync(from)) await copyFile(from, path.join(dist, "films", film));
  else missing.push(film);
}

console.log(`dist: ${decisions.length} of ${map.decisions.length} Work Map items are public`);
for (const item of decisions) console.log(`  ${item.kind.padEnd(9)} ${item.title}`);
if (missing.length) console.log(`films not cut yet: ${missing.join(", ")}`);
