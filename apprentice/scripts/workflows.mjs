import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectable, galleryOf, indexOf, problemsOf, textOf } from "../src/collection.mjs";

// The collection of workflows in `workflows/` at the top of the repository.
//   npm run workflows -- check        every file may be there, and the page is up to date
//   npm run workflows -- build        write the page and the index from the files
//   npm run workflows -- add <file>   put a workflow in, in the form the collection keeps

const folder = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "workflows");
const [command = "check", given] = process.argv.slice(2);

async function entries() {
  const names = (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".json") && name !== "index.json").sort();
  return Promise.all(names.map(async (name) => ({ name, text: await readFile(path.join(folder, name), "utf8") })));
}
const made = (found) => found.map(({ name, text }) => ({ name, file: JSON.parse(text) }));
const pages = (found) => ({ "README.md": galleryOf(made(found)), "index.json": textOf(indexOf(made(found))) });

if (command === "add") {
  if (!given) { console.error("Which file? npm run workflows -- add <file>"); process.exit(1); }
  const workflow = collectable(await readFile(given, "utf8"));
  if (!workflow) { console.error("That is not a workflow from Mason."); process.exit(1); }
  for (const left of workflow.dropped) console.error(`Left out, because ${left.why}: "${left.rule}"`);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, workflow.name), workflow.text);
  console.log(`Added workflows/${workflow.name}`);
}

const found = await entries();
let wrong = 0;
for (const { name, text } of found) for (const problem of problemsOf(name, text)) { wrong += 1; console.error(`workflows/${name}: ${problem}`); }
if (wrong) process.exit(1);

if (command === "check") {
  for (const [name, text] of Object.entries(pages(found))) {
    if ((await readFile(path.join(folder, name), "utf8").catch(() => "")) !== text) { wrong += 1; console.error(`workflows/${name} is not up to date (run: npm run workflows -- build)`); }
  }
  if (wrong) process.exit(1);
  console.log(`${found.length} ${found.length === 1 ? "workflow" : "workflows"}, each as a careful reading gives it.`);
} else {
  await mkdir(folder, { recursive: true });
  for (const [name, text] of Object.entries(pages(found))) await writeFile(path.join(folder, name), text);
  console.log(`Wrote workflows/README.md and workflows/index.json from ${found.length} ${found.length === 1 ? "file" : "files"}.`);
}
