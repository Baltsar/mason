import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder when it is first loaded; this file has its own.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-share-"));
const { saveShare } = await import("../src/share.mjs");

// The first bytes of a PNG, padded to the size of a small picture.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(400, 7)]);
const asData = (bytes, type = "image/png") => `data:${type};base64,${bytes.toString("base64")}`;

test("a picture to share is written beside the memory, and only a picture is", async () => {
  const file = await saveShare(asData(png), "Week 1–7 Oct / Gustaf");
  assert.equal(file, path.join(process.env.APPRENTICE_DATA, "share", "mason-week-1-7-oct-gustaf.png"));
  assert.deepEqual(await readFile(file), png);
  // Not a PNG, not a data address, or nothing at all: nothing is written.
  assert.equal(await saveShare(asData(Buffer.alloc(400, 1)), "x"), null);
  assert.equal(await saveShare(asData(png, "text/html"), "x"), null);
  assert.equal(await saveShare("../../etc/passwd", "x"), null);
  assert.equal(await saveShare("", "x"), null);
  // A name that is no name still gives a file inside the folder.
  assert.equal(await saveShare(asData(png), "../../.."), path.join(process.env.APPRENTICE_DATA, "share", "mason-flow.png"));
});
