import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Its own process, so the notes are written to a temporary folder.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-vault-"));
const { writeVault } = await import("../src/wiki.mjs");
const { paths } = await import("../src/store.mjs");

test("the memory is also a folder of linked Markdown notes", async () => {
  const map = { decisions: [{ id: "g1", kind: "guardrail", title: "Publish without asking", quote: "Ja sluta fråga publicera", source: { label: "Inferred · KUBB · said 2 times", type: "inferred", project: "KUBB" } }] };
  const memories = [{ project: "KUBB", one_line: "A Viking kubb brawler", how: ["KubbGame.ts runs the match"], built: ["A lobby"], left_off: "The rematch is broken.", open: ["Network lag"], keeps_saying: [{ rule: "Publish without asking", times: 2, example: "Ja sluta fråga publicera" }], parts: [{ file: "src/KubbGame.ts", edits: 12 }], prompts: 108, filesChanged: 121 }];
  await writeVault(map, memories);
  const read = (name) => readFile(path.join(paths.wiki, name), "utf8");
  assert.match(await read("Home.md"), /\[\[Projects\/KUBB\]\]: A Viking kubb brawler/);
  const project = await read("Projects/KUBB.md");
  assert.match(project, /## How it is put together\n\n- KubbGame\.ts runs the match/);
  assert.match(project, /The rematch is broken\./);
  assert.match(project, /said 2 times: "Ja sluta fråga publicera"/);
  const rules = await read("Rules.md");
  assert.match(rules, /> Ja sluta fråga publicera/);
  assert.match(rules, /\[\[Projects\/KUBB\]\]/);
});
