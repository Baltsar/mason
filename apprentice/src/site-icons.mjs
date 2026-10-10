// The icon a site offers of itself, so a browser tool can show its real mark
// instead of a lettered tile. Mason asks only when its owner has switched this
// on, and only for a site they actually visited. Only a picture is kept. An
// SVG is never kept, because it would be served from Mason's own address.

const MAX_BYTES = 512 * 1024;
const MIN_ICON = 100;
const MAX_ICONS = 4;
const MAX_HOPS = 4;
const AGENT = "Mason (local, asks once for a site icon)";

// A name that stays on a machine or a home network, whatever it would resolve to.
const PRIVATE_TAIL = /\.(?:localhost|local|test|internal|lan|home)$/;
// Four numbers separated by dots is an address, not a name. It is not asked.
const IPV4 = /^(?:\d+\.){3}\d+$/;

const PNG = [0x89, 0x50, 0x4e, 0x47];
const ICO = [0x00, 0x00, 0x01, 0x00];
const JPEG = [0xff, 0xd8, 0xff];
const GIF = [0x47, 0x49, 0x46, 0x38];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const matches = (bytes, at, signature) => signature.every((byte, index) => bytes[at + index] === byte);

// The kind of picture is decided from its first bytes alone. A name or a
// content-type header can say anything, and an SVG can wear either.
const pictureType = (bytes) => {
  if (matches(bytes, 0, PNG)) return "png";
  if (matches(bytes, 0, ICO)) return "ico";
  if (matches(bytes, 0, JPEG)) return "jpg";
  if (matches(bytes, 0, GIF)) return "gif";
  if (matches(bytes, 0, RIFF) && matches(bytes, 8, WEBP)) return "webp";
  return null;
};

// Anything past this is not an icon worth keeping, and is not held in memory.
const readBytes = async (response, limit) => {
  const stream = response?.body;
  if (stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const parts = [];
    let seen = 0;
    try {
      while (seen < limit) {
        const step = await reader.read();
        if (step.done) break;
        const chunk = Buffer.from(step.value);
        const room = limit - seen;
        parts.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
        seen += Math.min(chunk.length, room);
      }
    } finally {
      // Cancelling drops the rest of a file that was too big to keep.
      try { await reader.cancel(); } catch { /* The body may already be closed. */ }
    }
    return Buffer.concat(parts);
  }
  if (typeof response?.arrayBuffer === "function") {
    const all = Buffer.from(await response.arrayBuffer());
    return all.length > limit ? all.subarray(0, limit) : all;
  }
  return Buffer.alloc(0);
};

const dropBody = async (response) => {
  try { await response?.body?.cancel?.(); } catch { /* Nothing was opened. */ }
};

// There is no HTML parser here. A site's icon is a link tag near the top, and
// the attributes come in either quote style and in any order.
const attributesOf = (source) => {
  const attrs = Object.create(null);
  for (const match of source.matchAll(/([^\s"'=<>`/]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1].toLowerCase();
    if (name in attrs) continue;
    attrs[name] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attrs;
};

const largestSize = (sizes) => {
  const numbers = String(sizes ?? "").match(/\d+/g);
  if (!numbers) return 0;
  return numbers.reduce((biggest, item) => Math.max(biggest, Number(item)), 0);
};

const pathOf = (href) => href.split("?")[0].toLowerCase();

const extOf = (href) => {
  const path = pathOf(href);
  if (path.endsWith(".png")) return "png";
  if (path.endsWith(".ico")) return "ico";
  return "";
};

const iconsIn = (html) => {
  const found = [];
  for (const match of String(html).matchAll(/<link\b([^>]*)>/gi)) {
    const attrs = attributesOf(match[1].replace(/\/\s*$/, ""));
    const rel = (attrs.rel ?? "").toLowerCase();
    // "mask-icon" contains the word "icon", and it is a drawing for a pinned tab.
    if (!rel.includes("icon") || rel.includes("mask-icon")) continue;
    const href = (attrs.href ?? "").trim();
    if (!href || href.toLowerCase().startsWith("data:")) continue;
    if (pathOf(href).endsWith(".svg")) continue;
    if ((attrs.type ?? "").toLowerCase().includes("svg")) continue;
    found.push({ href, rel, size: largestSize(attrs.sizes), ext: extOf(href) });
  }
  // An apple icon wins even when a plain one is larger. A png wins a tie with an ico.
  found.sort((a, b) => {
    const appleA = a.rel.includes("apple-touch-icon") ? 0 : 1;
    const appleB = b.rel.includes("apple-touch-icon") ? 0 : 1;
    if (appleA !== appleB) return appleA - appleB;
    if (a.size !== b.size) return b.size - a.size;
    if (a.ext === "png" && b.ext === "ico") return -1;
    if (a.ext === "ico" && b.ext === "png") return 1;
    return 0;
  });
  return found.map((item) => item.href);
};

const withFallbacks = (hrefs, base) => {
  let origin = "";
  try { origin = new URL(base).origin; } catch { origin = ""; }
  const all = origin ? [...hrefs, `${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`] : [...hrefs];
  const seen = new Set();
  const list = [];
  for (const href of all) {
    let absolute;
    try { absolute = new URL(href, base).href; } catch { continue; }
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    list.push(absolute);
  }
  return list;
};

const requestOf = (timeoutMs, accept) => ({
  // A site is not followed wherever it points: see `reach`.
  redirect: "manual",
  // Asked as a stranger: nothing the browser has saved is sent along.
  credentials: "omit",
  headers: { accept, "user-agent": AGENT },
  signal: AbortSignal.timeout(timeoutMs),
});

const allowed = (href) => {
  try {
    const url = new URL(href);
    if (url.protocol !== "https:" || !isPublicHost(url.hostname)) return null;
    return url.href;
  } catch {
    return null;
  }
};

// Asks an address and goes where it is sent on to, one step at a time. Each
// step is looked at first: a site could otherwise send Mason to an address on
// this Mac or on the network at home. Returns the answer and where it came from.
const reach = async (address, fetcher, timeoutMs, accept) => {
  let url = address;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const response = await fetcher(url, requestOf(timeoutMs, accept));
    const status = Number(response?.status);
    if (!(status >= 300 && status < 400)) return { response, url };
    await dropBody(response);
    let next = null;
    try { next = allowed(new URL(response.headers?.get?.("location") ?? "", url).href); } catch { next = null; }
    if (!next) return { response: null, url };
    url = next;
  }
  return { response: null, url };
};

const readPage = async (host, fetcher, timeoutMs) => {
  const { response, url } = await reach(`https://${host}/`, fetcher, timeoutMs, "text/html");
  if (!response?.ok) {
    await dropBody(response);
    return null;
  }
  const html = (await readBytes(response, MAX_BYTES)).toString("utf8");
  return { html, base: url };
};

const readIcon = async (address, fetcher, timeoutMs) => {
  const { response } = await reach(address, fetcher, timeoutMs, "image/*");
  if (!response?.ok) {
    await dropBody(response);
    return null;
  }
  // One byte past the limit separates a picture that is too big from one that fits.
  const bytes = await readBytes(response, MAX_BYTES + 1);
  if (bytes.length < MIN_ICON || bytes.length > MAX_BYTES) return null;
  const type = pictureType(bytes);
  if (!type) return null;
  return { bytes: Buffer.from(bytes), type };
};

// True for a public DNS name such as "figma.com". A local name, a private
// address, or anything that is not a plain host is refused before a request.
export function isPublicHost(host) {
  if (typeof host !== "string" || host.length === 0 || host.length > 253) return false;
  // A port, a path, a space or an address in brackets is not a name to ask.
  if (!/^[a-z0-9.-]+$/.test(host)) return false;
  if (host === "localhost" || PRIVATE_TAIL.test(host)) return false;
  if (IPV4.test(host)) return false;
  // A name ends in letters. One that ends in a figure is a number written
  // short ("127.1"), which is read as an address on this Mac or at home.
  if (!/[a-z]/.test(host.slice(host.lastIndexOf(".") + 1))) return false;
  return host.includes(".");
}

// The site's own icon, or null. Nothing here is tried twice, and nothing throws.
export async function fetchSiteIcon(host, { timeoutMs = 4000, fetcher = fetch } = {}) {
  try {
    if (!isPublicHost(host)) return null;
    let html = "";
    let base = `https://${host}/`;
    try {
      const page = await readPage(host, fetcher, timeoutMs);
      if (page) ({ html, base } = page);
    } catch {
      // The page did not answer. The two well-known icons are still worth asking for.
    }
    // An icon is named in the head of a page: the beginning is enough, and a
    // page made to be slow to read is not read to its end.
    const candidates = withFallbacks(iconsIn(html.slice(0, 65_536)), base);
    let tried = 0;
    for (const href of candidates) {
      if (tried >= MAX_ICONS) break;
      const url = allowed(href);
      // A page may point at a private address, or an unencrypted one. Neither is asked.
      if (!url) continue;
      tried += 1;
      try {
        const icon = await readIcon(url, fetcher, timeoutMs);
        if (icon) return icon;
      } catch {
        // This address did not answer. A later one may still be a picture.
      }
    }
    return null;
  } catch {
    return null;
  }
}
