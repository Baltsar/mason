import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import { paths } from "./store.mjs";

// The icon of each app a day was spent in, as macOS draws it, kept as a small
// picture in the data folder. An app is asked for once: a name that gave no
// icon is not asked for again until Mason restarts.

export const ICON_FILE = /^[a-f0-9]{16}\.png$/;
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
