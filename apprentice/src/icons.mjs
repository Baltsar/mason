import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { settings } from "./settings.mjs";
import { fetchSiteIcon } from "./site-icons.mjs";
import { paths } from "./store.mjs";

// The icon of each app a day was spent in, as macOS draws it, kept as a small
// picture in the data folder. An app is asked for once: a name that gave no
// icon is not asked for again until Mason restarts.

export const ICON_FILE = /^(site-)?[a-f0-9]{16}\.(png|ico|jpg|gif|webp)$/;
export const ICON_TYPES = { png: "image/png", ico: "image/x-icon", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
const fileOf = (name) => `${createHash("sha256").update(name).digest("hex").slice(0, 16)}.png`;
const known = new Map();

export const iconFolder = () => path.join(paths.data, "icons");

function draw(apps) {
  return new Promise((resolve) => {
    const child = spawn(paths.icons, [], { stdio: ["pipe", "pipe", "ignore"] });
    let output = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 8000);
    child.stdout.on("data", (chunk) => { output += chunk; });
    // No helper was built: every tool then keeps its lettered tile.
    child.once("error", () => { clearTimeout(timer); resolve([]); });
    child.once("exit", () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(output.trim().split("\n").at(-1)).found || []); } catch { resolve([]); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${JSON.stringify({ folder: iconFolder(), apps })}\n`);
  });
}

// The address of each name's icon, for the names that have one.
export async function iconsFor(names) {
  const missing = [];
  for (const name of new Set(names)) {
    if (known.has(name)) continue;
    const file = fileOf(name);
    try { await access(path.join(iconFolder(), file)); known.set(name, file); }
    catch { missing.push({ name, file }); }
  }
  if (missing.length) {
    const found = new Set(await draw(missing));
    for (const { name, file } of missing) known.set(name, found.has(name) ? file : null);
  }
  const icons = {};
  for (const name of names) if (known.get(name)) icons[name] = `/icons/${known.get(name)}`;
  return icons;
}

// A tool that is a site has no app to lend it an icon. When its owner has
// switched that on, the site itself is asked for one, once, and the picture is
// kept. Nothing waits for the answer: what is already kept is given at once,
// and `arrived` is called when a new one has come.
const sites = new Map();
const asking = new Set();
const siteFile = (host) => `site-${createHash("sha256").update(host).digest("hex").slice(0, 16)}`;

export async function siteIconsFor(tools, { arrived = () => {}, fetcher } = {}) {
  let kept = [];
  try { kept = await readdir(iconFolder()); } catch {}
  const icons = {};
  for (const { name, host } of tools) {
    if (!host) continue;
    if (!sites.has(host)) {
      const file = kept.find((item) => item.startsWith(`${siteFile(host)}.`));
      if (file) sites.set(host, file);
    }
    if (sites.get(host)) icons[name] = `/icons/${sites.get(host)}`;
    else if (!sites.has(host) && !asking.has(host) && settings().logos) {
      asking.add(host);
      fetchSiteIcon(host, fetcher ? { fetcher } : {}).then(async (icon) => {
        // A site that gave nothing is not asked again until Mason restarts.
        if (!icon) return sites.set(host, null);
        await mkdir(iconFolder(), { recursive: true });
        const file = `${siteFile(host)}.${icon.type}`;
        await writeFile(path.join(iconFolder(), file), icon.bytes);
        sites.set(host, file);
        arrived();
      }).catch(() => sites.set(host, null)).finally(() => asking.delete(host));
    }
  }
  return icons;
}
