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
// that page is Mason's own. The island, the agents and a terminal say nothing
// about a page, and are let through.

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
