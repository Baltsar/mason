import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { paths } from "./store.mjs";

// A picture of how the work moved, drawn in the window to be shared with
// others. It is written beside the memory, in a folder of its own, where its
// owner picks it up: Mason posts nothing anywhere.

const PNG = 0x89504e47;
const LARGEST = 8_000_000;

// Writes the picture and says where it is, or null when it is not a picture.
export async function saveShare(image, label = "") {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/]+=*)$/.exec(String(image || ""));
  if (!match) return null;
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 200 || bytes.length > LARGEST || bytes.readUInt32BE(0) !== PNG) return null;
  const folder = path.join(paths.data, "share");
  await mkdir(folder, { recursive: true });
  const name = String(label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "flow";
  const file = path.join(folder, `mason-${name}.png`);
  await writeFile(file, bytes);
  return file;
}
