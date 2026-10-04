// Assembles the public page into site/dist: node site/build.mjs
//
// The tutor on the page is the app's own teach engine, copied as it is with
// only its Node import swapped for the browser's. The Work Map it runs on is a
// public subset: rules read from other projects' prompts never leave the Mac.

import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const app = path.join(root, "apprentice");
const dist = path.join(here, "dist");
const REPO = process.env.MASON_REPO || "https://github.com/Baltsar/mason";
// git clone makes a folder named after the repository; the app is one level in.
const CLONE = path.basename(new URL(REPO).pathname).replace(/\.git$/, "");
const PROJECT = "HACKNATION";
const FILMS = ["01-team-introduction.mp4", "02-product-demo.mp4", "03-technical-walkthrough.mp4"];

// dist is rebuilt from nothing, but its link to the Vercel project is kept,
// so a new build deploys to the same address.
const link = path.join(dist, ".vercel");
const kept = path.join(here, ".vercel-link");
if (existsSync(link)) { await rm(kept, { recursive: true, force: true }); await rename(link, kept); }
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "films"), { recursive: true });
if (existsSync(kept)) await rename(kept, link);

const engine = await readFile(path.join(app, "src", "teach-engine.mjs"), "utf8");
const nodeImport = 'import { randomUUID } from "node:crypto";';
if (!engine.includes(nodeImport)) throw new Error("teach-engine.mjs no longer starts with the import this build replaces.");
await writeFile(path.join(dist, "teach-engine.js"), engine.replace(nodeImport, "const randomUUID = () => crypto.randomUUID();"));

const map = JSON.parse(await readFile(path.join(app, "data", "work-map.json"), "utf8"));
const isPublic = (item) => item.source?.type !== "inferred" || item.source?.project === PROJECT;
// The Work Map was written while the product was still called the apprentice.
// The public copy carries the name it has now; the map on the Mac is not touched.
const renamed = (text) => typeof text === "string" ? text.replace(/\bthe apprentice\b/gi, "Mason") : text;
const decisions = map.decisions.filter(isPublic).map(({ id, kind, title, body, quote, moment, source }) => ({
  id, kind, title: renamed(title), body: renamed(body), quote: renamed(quote),
  moment: moment ? { at: moment.at, app: moment.app, evidence: moment.evidence } : null,
  source: { label: source?.label ?? "" },
}));
await writeFile(path.join(dist, "workmap.json"), JSON.stringify({ decisions }, null, 2));

const presets = JSON.parse(await readFile(path.join(here, "presets.json"), "utf8"));
const page = (await readFile(path.join(here, "index.html"), "utf8"))
  .replaceAll("__REPO__", REPO)
  .replaceAll("__CLONE__", CLONE)
  .replace("__PRESETS__", JSON.stringify(presets));
await writeFile(path.join(dist, "index.html"), page);

await copyFile(path.join(root, "film", "brand", "logo.png"), path.join(dist, "logo.png"));

const missing = [];
for (const film of FILMS) {
  const from = path.join(root, "film", "out", film);
  if (existsSync(from)) await copyFile(from, path.join(dist, "films", film));
  else missing.push(film);
}

console.log(`dist: ${decisions.length} of ${map.decisions.length} Work Map items are public`);
for (const item of decisions) console.log(`  ${item.kind.padEnd(9)} ${item.title}`);
if (missing.length) console.log(`films not cut yet: ${missing.join(", ")}`);
