import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The docs, checked against the code. The pages in docs/ are what the site is
// built from, so a setting, a variable, a tool or a view that is in the code
// and not in the docs fails here, and so does one the docs still name after
// it is gone. Nobody has to remember to update a page: the test says which.
const app = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.join(app, "..");
const read = (...parts) => readFile(path.join(repo, ...parts), "utf8");
const sorted = (names) => [...new Set(names)].sort();
const all = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1]);
// What a reader sees as text: code blocks and code spans hold no links.
const prose = (text) => text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
// The id GitHub gives a heading, which is also the one the site gives it.
const anchor = (heading) => heading.replace(/[`*_]|\[|\]\([^)]*\)/g, "").trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
const anchors = (text) => all(text.replace(/```[\s\S]*?```/g, ""), /^#{1,4} (.+)$/gm).map(anchor);
// The part of a page under one heading, down to the next of the same level.
const section = (text, heading) => text.split(new RegExp(`^## ${heading}$`, "m"))[1]?.split(/^## /m)[0] ?? "";
const firstCells = (table) => all(table, /^\| (?:\*\*|`)([^*`|]+)(?:\*\*|`) \|/gm);

const manifest = JSON.parse(await read("docs", "docs.json"));
const pages = manifest.groups.flatMap((group) => group.pages);
const texts = new Map(await Promise.all(pages.map(async ({ file }) => [file, await read(file)])));
const configuration = texts.get("docs/configuration.md");
const VARIABLE = /\b((?:APPRENTICE|ELEVENLABS)_[A-Z0-9_]+|PORT)\b/g;

test("every page in docs/ is in docs.json, once, and opens with its title", async () => {
  const listed = pages.map((page) => page.file);
  const there = (await readdir(path.join(repo, "docs"))).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`);
  assert.deepEqual(there.filter((file) => !listed.includes(file)), [], "in docs/ and not in docs.json");
  assert.equal(new Set(listed).size, listed.length, "a file is listed twice");
  assert.equal(new Set(pages.map((page) => page.slug)).size, pages.length, "a slug is used twice");
  for (const { slug, file } of pages) {
    assert.match(slug, /^[a-z0-9-]+$/, slug);
    assert.match(texts.get(file), /^(<!--[\s\S]*?-->\s*)?# \S/, `${file} does not open with a # heading`);
  }
});

test("no link in the docs is dead: the file is there, and so is the heading", async () => {
  const dead = [];
  for (const [file, text] of texts) {
    for (const target of all(prose(text), /\]\(([^)\s]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const [to, hash] = target.split("#");
      const where = to ? path.normalize(path.join(path.dirname(file), to)) : file;
      if (where.startsWith("..") || !existsSync(path.join(repo, where))) { dead.push(`${file}: ${target}`); continue; }
      if (!hash || !where.endsWith(".md") || /^L\d+/.test(hash)) continue;
      if (!anchors(texts.get(where) ?? await read(where)).includes(hash)) dead.push(`${file}: ${target} (no such heading)`);
    }
  }
  assert.deepEqual(dead, []);
});

test("every switch in Settings is in the docs, with the default it has", async () => {
  const defaults = Object.fromEntries(all((await read("apprentice", "src", "settings.mjs")).match(/const DEFAULTS = \{([^}]+)\}/)[1], /(\w+: (?:true|false))/g).map((pair) => pair.split(": ")));
  const switches = [...(await read("apprentice", "public", "app.js")).matchAll(/\brow\("(\w+)", "([^"]+)"/g)].map(([, key, label]) => `${label}: ${defaults[key] === "true" ? "On" : "Off"}`);
  const written = [...section(configuration, "Settings").matchAll(/^\| \*\*([^*]+)\*\* \| (On|Off) \|/gm)].map(([, label, state]) => `${label}: ${state}`);
  assert.ok(switches.length >= 9);
  assert.deepEqual(sorted(written), sorted(switches));
});

test("what .env.local may set is what the docs say it may set", async () => {
  const allowed = all((await read("apprentice", "src", "config.mjs")).match(/const allowed = new Set\(\[([\s\S]*?)\]\)/)[1], /"([A-Z0-9_]+)"/g);
  assert.deepEqual(sorted(firstCells(section(configuration, "In \\.env\\.local"))), sorted(allowed));
  const example = all(await read("apprentice", ".env.local.example"), /^([A-Z0-9_]+)=/gm);
  assert.deepEqual(example.filter((name) => !allowed.includes(name)), [], "in .env.local.example and never read from it");
});

test("every variable the code reads is in the docs, and the docs name none that is gone", async () => {
  const inCode = new Set();
  for (const folder of ["src", "scripts", "native", "."]) {
    for (const name of await readdir(path.join(app, folder))) {
      if (!/\.(mjs|swift|command)$/.test(name)) continue;
      const text = await read("apprentice", folder, name);
      for (const variable of all(text, /(?:process\.env\.|environment\["|^|\s)((?:APPRENTICE|ELEVENLABS)_[A-Z0-9_]+|PORT)\b/gm)) inCode.add(variable);
    }
  }
  assert.deepEqual(sorted([...inCode].filter((name) => !configuration.includes(`\`${name}\``))), [], "read by the code and not in docs/configuration.md");
  const gone = [];
  for (const file of [...texts.keys(), "README.md", "apprentice/README.md"]) {
    for (const name of sorted(all(texts.get(file) ?? await read(file), VARIABLE))) if (!inCode.has(name)) gone.push(`${file}: ${name}`);
  }
  assert.deepEqual(gone, []);
});

test("the MCP tools in the docs are the ones an agent is given", async () => {
  const given = all(await read("apprentice", "src", "mcp-handler.mjs"), /\{ name: "(\w+)", description:/g);
  assert.ok(given.length >= 8);
  assert.deepEqual(sorted(firstCells(section(texts.get("docs/agents-and-mcp.md"), "The tools"))), sorted(given));
});

test("every command and every view of the app window has its place in the docs", async () => {
  const { scripts } = JSON.parse(await read("apprentice", "package.json"));
  for (const name of Object.keys(scripts)) assert.ok(configuration.includes(`\`npm ${["test", "start"].includes(name) ? name : `run ${name}`}\``), `npm run ${name}`);
  const views = all(await read("apprentice", "public", "index.html"), /data-view="\w+"[^>]*><span>([^<]+)<\/span>/g);
  assert.ok(views.length >= 5);
  const shown = anchors(texts.get("docs/what-you-see.md"));
  for (const view of views) assert.ok(shown.includes(anchor(view)), `${view} has no heading in docs/what-you-see.md`);
});
