import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Its own data folder, set before anything is loaded. This file runs in its own process.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-logos-"));
const { siteIconsFor, ICON_FILE } = await import("../src/icons.mjs");
const { loadSettings, saveSettings } = await import("../src/settings.mjs");

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(200, 3)]);
// A stand-in for the web: figma.com has an icon, nothing else answers.
function web() {
  const asked = [];
  const fetcher = async (url) => {
    asked.push(String(url));
    if (String(url) === "https://www.figma.com/apple-touch-icon.png") return new Response(png, { status: 200 });
    return new Response("", { status: 404 });
  };
  return { asked, fetcher };
}
const settled = () => new Promise((resolve) => setTimeout(resolve, 60));

test("a site is asked for its icon only when that is switched on, once, and the picture is kept", async () => {
  const tools = [{ name: "Figma", host: "www.figma.com" }, { name: "flora.ai", host: "app.flora.ai" }, { name: "Cursor", host: "" }, { name: "Localhost", host: "" }];
  assert.equal((await loadSettings()).logos, false);
  const off = web();
  assert.deepEqual(await siteIconsFor(tools, { fetcher: off.fetcher }), {});
  await settled();
  assert.deepEqual(off.asked, []);

  await saveSettings({ logos: true });
  const on = web();
  let arrived = 0;
  // Nothing waits for the web: the first answer has no icons yet.
  assert.deepEqual(await siteIconsFor(tools, { fetcher: on.fetcher, arrived: () => { arrived += 1; } }), {});
  await settled();
  assert.equal(arrived, 1);
  const icons = await siteIconsFor(tools, { fetcher: on.fetcher });
  assert.deepEqual(Object.keys(icons), ["Figma"]);
  const file = icons.Figma.replace("/icons/", "");
  assert.match(file, ICON_FILE);
  assert.deepEqual(await readFile(path.join(process.env.APPRENTICE_DATA, "icons", file)), png);

  // Neither the site that answered nor the one that did not is asked again.
  const before = on.asked.length;
  await siteIconsFor(tools, { fetcher: on.fetcher });
  await settled();
  assert.equal(on.asked.length, before);
  assert.equal(on.asked.some((url) => url.includes("localhost")), false);
});
