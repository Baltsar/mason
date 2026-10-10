// The key of this start. The server answers a page's own files to anyone on
// this Mac and everything else only to who holds the key, so that another
// program here cannot ask what a window can.
//
// In the desktop app the key is put in the page before it loads. In a browser
// it arrives once, in the address Mason printed or opened, and is taken out
// of the address at once so that it is not copied, bookmarked or passed on
// with it. It is kept for this tab only, which is what lets a reload and the
// way from one of Mason's pages to another go on working.

const KEPT = "mason-key";
// A test reads the modules of the page where there is no page, and no key.
const root = globalThis.document?.documentElement;
const asked = new URLSearchParams(globalThis.location?.search);

let found = root?.dataset.key || asked.get("key") || "";
if (root) delete root.dataset.key;
try {
  if (found) sessionStorage.setItem(KEPT, found);
  else found = sessionStorage.getItem(KEPT) || "";
} catch {}
if (asked.has("key")) {
  asked.delete("key");
  const rest = String(asked);
  history.replaceState(history.state, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
}

export const key = found;
export const KEY_HEADER = "x-mason-key";

// The headers of a request to Mason's own server, with the key among them.
export const withKey = (headers = {}) => ({ ...headers, [KEY_HEADER]: key });

// A picture and an event stream cannot send a header: for those, and only for
// addresses on Mason's own server, the key goes in the address.
export const keyed = (address) => /^\/(api|icons)\//.test(String(address)) ? `${address}${address.includes("?") ? "&" : "?"}key=${key}` : address;
