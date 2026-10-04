// Assembles the public page into site/dist: node site/build.mjs
//
// The page is one file: the pitch film, the app's screens drawn in its own
// colours, the woodcuts and where to find the rest. The build writes in the
// addresses, copies the films and takes the poster from the film itself.
// site/assets holds the brand images at web size, cut with cwebp from
// apprentice/native and the brand sources.

import { execFile } from "node:child_process";
import { copyFile, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const dist = path.join(here, "dist");
const REPO = process.env.MASON_REPO || "https://github.com/Baltsar/mason";
const SITE = process.env.MASON_SITE || "https://mason-demo-eight.vercel.app";
const FFMPEG = process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg";
// Only the product demo is on the page. The other two are still copied, so a
// link to a film that was shared before keeps opening it.
const FILMS = ["01-team-introduction.mp4", "02-product-demo.mp4", "03-technical-walkthrough.mp4"];
const PITCH = "02-product-demo.mp4";
// Early in the opening, where the question and Gustaf's face are both on screen.
const POSTER_AT = "2.5";

// dist is rebuilt from nothing, but its link to the Vercel project is kept,
// so a new build deploys to the same address.
const link = path.join(dist, ".vercel");
const kept = path.join(here, ".vercel-link");
if (existsSync(link)) { await rm(kept, { recursive: true, force: true }); await rename(link, kept); }
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "films"), { recursive: true });
if (existsSync(kept)) await rename(kept, link);

const page = (await readFile(path.join(here, "index.html"), "utf8"))
  .replaceAll("__REPO_NAME__", REPO.replace(/^https?:\/\//, ""))
  .replaceAll("__REPO__", REPO)
  .replaceAll("__SITE__", SITE.replace(/\/$/, ""));
await writeFile(path.join(dist, "index.html"), page);
await cp(path.join(here, "assets"), path.join(dist, "assets"), { recursive: true });

const missing = [];
for (const film of FILMS) {
  const from = path.join(root, "film", "out", film);
  if (existsSync(from)) await copyFile(from, path.join(dist, "films", film));
  else missing.push(film);
}

const pitch = path.join(dist, "films", PITCH);
const poster = existsSync(pitch) && existsSync(FFMPEG);
if (poster) await run(FFMPEG, ["-y", "-v", "error", "-ss", POSTER_AT, "-i", pitch, "-frames:v", "1", "-q:v", "4", path.join(dist, "poster.jpg")]);

console.log(`dist: page for ${SITE}, source at ${REPO}`);
if (missing.length) console.log(`films not cut yet: ${missing.join(", ")}`);
if (!poster) console.log("no poster: the pitch film or ffmpeg is missing");
