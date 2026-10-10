// Only what runs on this Mac talks to the server: Mason's own window, the
// island, and the agents that were given its address. But a page in a browser
// is on this Mac too, and a browser lets any page send a request to an
// address on the same machine. Left unchecked, a page someone was sent a link
// to could switch a setting, or have a line written where every agent reads
// its rules; and by pointing a name of its own at 127.0.0.1 it could read
// what is kept here.
//
// So a request is answered only when it was addressed to this Mac, by number
// or as localhost, and, when a browser says which page sent it, only when
// that page is Mason's own.
//
// That stops a page and nothing else. The island, an agent and a terminal say
// nothing about a page, and so does any other program on this Mac: another
// account, an app kept in a sandbox, an agent that may call a local address
// and may not touch a file. So there is a key as well, made anew at every
// start and handed only to Mason's own windows, the island and whoever the
// owner gives it to. The pages themselves are no secret and are served
// without it; everything they then ask for is not.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const HERE = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

// Whether a request with these headers came from this Mac and not from a page
// somewhere else.
export function fromHere(headers = {}) {
  const host = String(headers.host ?? "");
  // A name that only resolves to this Mac is not this Mac's name.
  if (!HERE.test(host)) return false;
  // A browser says how the page relates to the address it is asking.
  const site = headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin" && site !== "none") return false;
  const origin = headers.origin;
  if (origin === undefined) return true;
  try { return new URL(origin).host.toLowerCase() === host.toLowerCase(); } catch { return false; }
}

export const KEY_HEADER = "x-mason-key";

export const makeKey = () => randomBytes(32).toString("hex");

// A key handed over by whoever started the server is used only when it is
// long enough not to be guessed.
export const usableKey = (given) => /^[A-Za-z0-9_-]{32,200}$/.test(String(given ?? ""));

// Whether a request needs the key: all but the reading of a page and its
// files, which say nothing about the person. Unknown paths need it too.
export function needsKey(method, pathname) {
  if (method !== "GET" && method !== "HEAD") return true;
  return /^\/(api|icons|mcp)(\/|$)/i.test(String(pathname));
}

// Compared by digest, so that neither the length of a guess nor how much of
// it was right can be read from the time the answer took.
const digest = (text) => createHash("sha256").update(String(text)).digest();

// Whether a request carries the key: in its own header, as a bearer token
// (what an agent's MCP settings know how to send), or, where `asked` is
// given, in the address, which is all a picture or an event stream can do.
export function holdsKey(key, headers = {}, asked = null) {
  if (!usableKey(key)) return false;
  const bearer = /^Bearer\s+(\S+)$/i.exec(String(headers.authorization ?? ""))?.[1];
  const given = headers[KEY_HEADER] ?? bearer ?? asked;
  if (typeof given !== "string" || !given) return false;
  return timingSafeEqual(digest(given), digest(key));
}
