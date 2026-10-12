import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder at the first import.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-own-"));
for (const name of ["APPRENTICE_LLM", "APPRENTICE_LLM_URL", "APPRENTICE_LLM_MODEL", "APPRENTICE_LLM_KEY"]) delete process.env[name];
const { CATALOG, ROOM_TO_SPARE, fetchFile, fits, ownFile, ownModel, ownReady, suggested } = await import("../src/own-model.mjs");
const { loadSettings, saveSettings } = await import("../src/settings.mjs");
const { modelStatus } = await import("../src/llm.mjs");
await loadSettings();

const GB = 1e9;
// A file of a hundred thousand bytes, and something that serves it the way a web server does.
const whole = Buffer.from(Array.from({ length: 100_000 }, (_, index) => index % 251));
const named = { url: "https://example.test/model.gguf", bytes: whole.length, sha256: createHash("sha256").update(whole).digest("hex") };
const serving = (body = whole, { ranges = true, stopAfter = Infinity } = {}) => {
  const asked = [];
  const fetcher = async (url, { headers = {}, signal } = {}) => {
    const from = ranges && headers.range ? Number(/bytes=(\d+)-/.exec(headers.range)[1]) : 0;
    asked.push(headers.range || "all");
    const rest = body.subarray(from);
    return {
      ok: true,
      status: from ? 206 : 200,
      body: (async function* () {
        for (let at = 0; at < rest.length; at += 10_000) {
          if (signal?.aborted) throw new Error("aborted");
          if (at >= stopAfter) throw new Error("the line dropped");
          yield rest.subarray(at, at + 10_000);
        }
      })(),
    };
  };
  return { fetcher, asked };
};
const folder = await mkdtemp(path.join(os.tmpdir(), "mason-fetch-"));

test("only two models can be asked for, each pinned to one commit and to the sum of its file", () => {
  assert.deepEqual(Object.keys(CATALOG), ["gemma-4-e2b", "gemma-4-e4b"]);
  for (const model of Object.values(CATALOG)) {
    assert.match(model.url, /^https:\/\/huggingface\.co\/ggml-org\/[\w.-]+\/resolve\/[0-9a-f]{40}\/[\w.-]+\.gguf$/);
    assert.ok(model.url.endsWith(`/${model.file}`));
    assert.match(model.sha256, /^[0-9a-f]{64}$/);
    assert.ok(model.bytes > GB);
  }
  // Each has a place of its own, apart from the model that places texts by meaning.
  assert.ok(ownFile("gemma-4-e2b").endsWith(path.join("models", "writer", "gemma-4-E2B-it-Q4_0.gguf")));
  assert.equal(ownFile("../../etc/passwd"), null);
  assert.equal(ownReady("gemma-4-e2b"), false);
});

test("a model fits when there is room for it with room to spare, and memory enough to hold it", () => {
  const small = CATALOG["gemma-4-e2b"];
  assert.deepEqual(fits(small, { free: small.bytes + ROOM_TO_SPARE, memory: 16 * GB }), { disk: true, memory: true });
  assert.deepEqual(fits(small, { free: small.bytes + ROOM_TO_SPARE - 1, memory: 4 * GB }), { disk: false, memory: false });
  // What is already fetched does not have to fit once more.
  assert.equal(fits(small, { free: 3 * GB, memory: 16 * GB }, 2 * GB).disk, true);
  // The larger one is offered first only where it fits twice over; a full disk or little memory gets the small one.
  assert.equal(suggested({ free: 200 * GB, memory: 16 * GB }), "gemma-4-e4b");
  assert.equal(suggested({ free: 7 * GB, memory: 16 * GB }), "gemma-4-e2b");
  assert.equal(suggested({ free: 200 * GB, memory: 8 * GB }), "gemma-4-e2b");
});

test("a file is kept only when it is, to the byte, the one that was named", async () => {
  const file = path.join(folder, "right.gguf");
  const seen = [];
  assert.equal(await fetchFile({ ...named, file }, { fetcher: serving().fetcher, onProgress: (got) => seen.push(got) }), file);
  assert.deepEqual(await readFile(file), whole);
  assert.equal(seen.at(-1), whole.length);
  // Another file under the same name, of the right length, is thrown away, and nothing is left behind.
  const other = Buffer.from(whole);
  other[5] ^= 1;
  const wrong = path.join(folder, "wrong.gguf");
  await assert.rejects(fetchFile({ ...named, file: wrong }, { fetcher: serving(other).fetcher }), /not the one that was named/);
  assert.equal(await stat(wrong).catch(() => null), null);
  assert.equal(await stat(`${wrong}.part`).catch(() => null), null);
  // So is one that is longer than it should be, before it has filled the disk.
  await assert.rejects(fetchFile({ ...named, file: wrong }, { fetcher: serving(Buffer.concat([whole, whole])).fetcher }), /larger/);
});

test("a fetch that was stopped goes on from where it was, and still has to add up", async () => {
  const file = path.join(folder, "resumed.gguf");
  // The line drops after thirty thousand bytes: what came is kept under another name.
  await assert.rejects(fetchFile({ ...named, file }, { fetcher: serving(whole, { stopAfter: 30_000 }).fetcher }), /dropped/);
  assert.equal((await stat(`${file}.part`)).size, 30_000);
  assert.equal(await stat(file).catch(() => null), null);
  // The next time only the rest is asked for.
  const again = serving();
  await fetchFile({ ...named, file }, { fetcher: again.fetcher });
  assert.deepEqual(again.asked, ["bytes=30000-"]);
  assert.deepEqual(await readFile(file), whole);
  // A server that answers with the whole file anyway is taken from the start.
  const fresh = path.join(folder, "fresh.gguf");
  await writeFile(`${fresh}.part`, whole.subarray(0, 20_000));
  const deaf = serving(whole, { ranges: false });
  await fetchFile({ ...named, file: fresh }, { fetcher: deaf.fetcher });
  assert.deepEqual(deaf.asked, ["bytes=20000-", "all"]);
  assert.deepEqual(await readFile(fresh), whole);
  // What was kept from before and is not the beginning of this file does not pass.
  const stale = path.join(folder, "stale.gguf");
  await writeFile(`${stale}.part`, Buffer.alloc(20_000, 7));
  await assert.rejects(fetchFile({ ...named, file: stale }, { fetcher: serving().fetcher }), /not the one that was named/);
});

test("the model that writes can be one of Mason's own, by a name from the list and nothing else", async () => {
  assert.equal((await saveSettings({ summaries: true, writer: "mason", ownModel: "gemma-4-e2b" })).writer, "mason");
  assert.equal(ownModel(), "gemma-4-e2b");
  // No endpoint is left named, and the file is not there yet, so it is not ready.
  assert.equal(process.env.APPRENTICE_LLM_URL, undefined);
  assert.deepEqual(modelStatus(), { name: "Gemma 4 E2B", where: "this Mac", ready: false, onThisMac: true });
  for (const ownModelName of ["../../x", "https://evil.example/m.gguf", "", "constructor"]) {
    const kept = await saveSettings({ writer: "mason", ownModel: ownModelName });
    assert.deepEqual([kept.writer, kept.ownModel], ["", ""]);
    assert.equal(ownModel(), "");
  }
  assert.equal(modelStatus().name, "Claude");
});
