import test from "node:test";
import assert from "node:assert/strict";
import { fetchSiteIcon, isPublicHost } from "../src/site-icons.mjs";

const FAST = 20;

// A stand-in for fetch. It records every address it was given and answers from
// the map. An address with no answer is a 404, and nothing here touches the network.
function site(routes) {
  const asked = [];
  const fetcher = async (url, init = {}) => {
    const address = String(url);
    asked.push({ url: address, redirect: init.redirect, credentials: init.credentials, headers: { ...init.headers }, signal: init.signal });
    const route = routes[address];
    if (!route) return { ok: false, status: 404, url: address, arrayBuffer: async () => Buffer.alloc(0) };
    // A site that sends its visitor on somewhere else.
    if (route.to) return new Response(null, { status: 302, headers: { location: route.to } });
    const body = Buffer.isBuffer(route.body) ? route.body : Buffer.from(String(route.body ?? ""));
    const response = new Response(body, { status: route.ok === false ? (route.status ?? 500) : (route.status ?? 200) });
    Object.defineProperty(response, "url", { value: route.url ?? address });
    return response;
  };
  return { asked, fetcher };
}

const urlsOf = (asked) => asked.map((item) => item.url);

function picture(type, length = 128) {
  const bytes = Buffer.alloc(length, 0x11);
  if (type === "webp") {
    Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(bytes, 0);
    Buffer.from([0x57, 0x45, 0x42, 0x50]).copy(bytes, 8);
    return bytes;
  }
  const marks = {
    png: [0x89, 0x50, 0x4e, 0x47],
    ico: [0x00, 0x00, 0x01, 0x00],
    jpg: [0xff, 0xd8, 0xff],
    gif: [0x47, 0x49, 0x46, 0x38],
  };
  Buffer.from(marks[type]).copy(bytes, 0);
  return bytes;
}

const ask = (host, fetcher) => fetchSiteIcon(host, { fetcher, timeoutMs: FAST });

test("a public site name may be asked, and a local or private one may not", () => {
  assert.equal(isPublicHost("figma.com"), true);
  assert.equal(isPublicHost("app.flora.ai"), true);
  assert.equal(isPublicHost(`${"a".repeat(249)}.com`), true);
  for (const host of [
    "localhost", "localhost:3000", "127.0.0.1", "192.168.1.10", "10.0.0.1",
    "printer.local", "dev.test", "box.internal", "nas.lan", "printer.home", "dev.localhost",
    "[::1]", "::1", "intranet", "figma.com/path", "figma.com/path extra", "",
    "Figma.com", "has space.com", `${"a".repeat(250)}.com`,
  ]) assert.equal(isPublicHost(host), false, host);
});

test("the apple touch icon is taken before a smaller one, and nothing further is asked", async () => {
  const apple = picture("png");
  const small = picture("png", 140);
  small[4] = 0x22;
  // The smaller icon is named first, and the attributes are not all double-quoted.
  const html = `<link sizes=32x32 href=small.png rel=icon><link sizes='180x180' href='/apple.png' rel='apple-touch-icon'>`;
  const { asked, fetcher } = site({
    "https://figma.com/": { body: html },
    "https://figma.com/apple.png": { body: apple },
    "https://figma.com/small.png": { body: small },
  });
  const found = await ask("figma.com", fetcher);
  assert.equal(found.type, "png");
  assert.deepEqual(found.bytes, apple);
  assert.deepEqual(urlsOf(asked), ["https://figma.com/", "https://figma.com/apple.png"]);
  assert.equal(asked[0].redirect, "manual");
  assert.equal(asked[0].credentials, "omit");
  assert.equal(asked[0].headers.accept, "text/html");
  assert.equal(asked[0].headers["user-agent"], "Mason (local, asks once for a site icon)");
  assert.equal(asked[0].signal.aborted, false);
  assert.equal(asked[1].headers.accept, "image/*");
});

test("an apple touch icon is preferred even when a plain icon is larger", async () => {
  const apple = picture("png", 120);
  const big = picture("png", 200);
  big[4] = 0x33;
  const html = `<link rel="icon" sizes="512x512" href="/big.png"><link rel=apple-touch-icon-precomposed href=/apple.png>`;
  const { asked, fetcher } = site({
    "https://figma.com/": { body: html },
    "https://figma.com/apple.png": { body: apple },
    "https://figma.com/big.png": { body: big },
  });
  const found = await ask("figma.com", fetcher);
  assert.deepEqual(found.bytes, apple);
  assert.deepEqual(urlsOf(asked), ["https://figma.com/", "https://figma.com/apple.png"]);
});

test("a png is asked before an ico when the two are the same size", async () => {
  const png = picture("png");
  const html = `<link rel="icon" sizes="32x32" href="/mark.ico"><link rel="icon" sizes="32x32" href="/mark.png">`;
  const { asked, fetcher } = site({
    "https://figma.com/": { body: html },
    "https://figma.com/mark.png": { body: png },
    "https://figma.com/mark.ico": { body: picture("ico") },
  });
  const found = await ask("figma.com", fetcher);
  assert.equal(found.type, "png");
  assert.deepEqual(urlsOf(asked), ["https://figma.com/", "https://figma.com/mark.png"]);
});

test("the well-known icons come from the page that was finally reached", async () => {
  const icon = picture("ico");
  const moved = site({
    "https://figma.com/": { to: "https://www.figma.com/welcome" },
    "https://www.figma.com/welcome": { body: "<html></html>" },
    "https://www.figma.com/favicon.ico": { body: icon },
  });
  const found = await ask("figma.com", moved.fetcher);
  assert.equal(found.type, "ico");
  assert.deepEqual(urlsOf(moved.asked), [
    "https://figma.com/",
    "https://www.figma.com/welcome",
    "https://www.figma.com/apple-touch-icon.png",
    "https://www.figma.com/favicon.ico",
  ]);
});

test("a site that sends its visitor to this Mac or to an unencrypted address is not followed there", async () => {
  const icon = picture("ico");
  for (const to of ["http://www.figma.com/welcome", "https://localhost:4317/api/state", "http://127.0.0.1:4317/", "https://192.168.1.1/admin", "https://router.lan/"]) {
    const sent = site({
      "https://figma.com/": { to },
      [to]: { body: "<link rel=icon href=/secret.png>" },
      "https://figma.com/favicon.ico": { body: icon },
    });
    // The page is given up on; the two well-known icons of the site itself are still asked for.
    assert.deepEqual((await ask("figma.com", sent.fetcher)).bytes, icon);
    assert.deepEqual(urlsOf(sent.asked), ["https://figma.com/", "https://figma.com/apple-touch-icon.png", "https://figma.com/favicon.ico"], to);
  }
  // An icon that sends on to a private address is refused the same way, and one that goes round in circles is given up on.
  const hops = site({
    "https://figma.com/": { body: `<link rel="apple-touch-icon" href="/a.png"><link rel="icon" href="/b.png">` },
    "https://figma.com/a.png": { to: "https://10.0.0.1/a.png" },
    "https://figma.com/b.png": { to: "https://figma.com/b.png" },
    "https://figma.com/favicon.ico": { body: icon },
  });
  assert.deepEqual((await ask("figma.com", hops.fetcher)).bytes, icon);
  assert.equal(urlsOf(hops.asked).includes("https://10.0.0.1/a.png"), false);
  assert.equal(urlsOf(hops.asked).filter((url) => url === "https://figma.com/b.png").length, 5);
});

test("a relative icon is resolved from the page the site finally returned", async () => {
  const icon = picture("png");
  const { asked, fetcher } = site({
    "https://figma.com/": { to: "/files/" },
    "https://figma.com/files/": { to: "https://www.figma.com/files/" },
    "https://www.figma.com/files/": { body: `<link rel="icon" href="images/mark.png">` },
    "https://www.figma.com/files/images/mark.png": { body: icon },
  });
  const found = await ask("figma.com", fetcher);
  assert.equal(found.type, "png");
  assert.deepEqual(found.bytes, icon);
  assert.deepEqual(urlsOf(asked), ["https://figma.com/", "https://figma.com/files/", "https://www.figma.com/files/", "https://www.figma.com/files/images/mark.png"]);
});

test("a drawing or a mask icon is passed over for the next picture", async () => {
  const icon = picture("ico");
  const html = [
    `<link rel="mask-icon" href="/pinned.svg" color="#000">`,
    `<link rel="icon" type="image/svg+xml" href="/vector.svg">`,
    `<link rel="icon" href="/vector.svg?v=3">`,
    `<link rel="icon" type="image/svg+xml" href="/pretend.png">`,
    `<link rel="icon" href="data:image/png;base64,aaaa">`,
    `<link rel="shortcut icon" href="/mark.ico">`,
  ].join("");
  const { asked, fetcher } = site({
    "https://figma.com/": { body: html },
    "https://figma.com/mark.ico": { body: icon },
    "https://figma.com/pretend.png": { body: picture("png") },
    "https://figma.com/pinned.svg": { body: picture("png") },
  });
  const found = await ask("figma.com", fetcher);
  assert.equal(found.type, "ico");
  assert.deepEqual(found.bytes, icon);
  assert.deepEqual(urlsOf(asked), ["https://figma.com/", "https://figma.com/mark.ico"]);
});

test("with no icon named, the apple touch icon is tried and then the favicon", async () => {
  const icon = picture("ico");
  const { asked, fetcher } = site({
    "https://miro.com/": { body: "<html><head><title>Miro</title></head></html>" },
    "https://miro.com/favicon.ico": { body: icon },
  });
  const found = await ask("miro.com", fetcher);
  assert.equal(found.type, "ico");
  assert.deepEqual(found.bytes, icon);
  assert.deepEqual(urlsOf(asked), [
    "https://miro.com/",
    "https://miro.com/apple-touch-icon.png",
    "https://miro.com/favicon.ico",
  ]);
});

test("a page that is not a picture is refused, and the next icon is tried", async () => {
  const icon = picture("png");
  const junk = Buffer.from(`<!doctype html><title>gone</title><p>${"no".repeat(80)}</p>`);
  const html = `<link rel="icon" href="/oops.png"><link rel="icon" href="/mark.png">`;
  const { asked, fetcher } = site({
    "https://figma.com/": { body: html },
    "https://figma.com/oops.png": { body: junk },
    "https://figma.com/mark.png": { body: icon },
  });
  const found = await ask("figma.com", fetcher);
  assert.equal(found.type, "png");
  assert.deepEqual(found.bytes, icon);
  assert.deepEqual(urlsOf(asked), ["https://figma.com/", "https://figma.com/oops.png", "https://figma.com/mark.png"]);
});

test("the kind of picture is decided from its first bytes, not its name", async () => {
  for (const type of ["png", "ico", "jpg", "gif", "webp"]) {
    const bytes = picture(type);
    const { fetcher } = site({
      "https://figma.com/": { body: `<link rel="icon" type="image/svg+xml" href="/nope.svg"><link rel="icon" href="/mark.bin">` },
      "https://figma.com/mark.bin": { body: bytes },
    });
    const found = await ask("figma.com", fetcher);
    assert.equal(found?.type, type);
    assert.deepEqual(found?.bytes, bytes);
  }
});

test("a picture that is too small or too big is refused", async () => {
  const tiny = picture("png", 99);
  const fit = picture("png", 100);
  const huge = picture("png", 512 * 1024 + 1);
  const fallback = picture("ico");
  const tinySite = site({
    "https://figma.com/": { body: `<link rel="icon" href="/tiny.png">` },
    "https://figma.com/tiny.png": { body: tiny },
    "https://figma.com/favicon.ico": { body: fallback },
  });
  assert.equal((await ask("figma.com", tinySite.fetcher)).type, "ico");
  assert.deepEqual(urlsOf(tinySite.asked), [
    "https://figma.com/",
    "https://figma.com/tiny.png",
    "https://figma.com/apple-touch-icon.png",
    "https://figma.com/favicon.ico",
  ]);

  const fitSite = site({
    "https://figma.com/": { body: `<link rel="icon" href="/fit.png">` },
    "https://figma.com/fit.png": { body: fit },
  });
  const fitted = await ask("figma.com", fitSite.fetcher);
  assert.equal(fitted.type, "png");
  assert.equal(fitted.bytes.length, 100);

  const hugeSite = site({
    "https://figma.com/": { body: `<link rel="icon" href="/huge.png">` },
    "https://figma.com/huge.png": { body: huge },
    "https://figma.com/favicon.ico": { body: fallback },
  });
  assert.deepEqual((await ask("figma.com", hugeSite.fetcher)).bytes, fallback);
});

test("the same icon is asked for once, and at most four icons are asked for", async () => {
  const once = site({
    "https://figma.com/": { body: `<link rel="icon" href="/favicon.ico">`, },
    "https://figma.com/favicon.ico": { body: Buffer.from("<html>not a picture</html>" + "x".repeat(120)) },
  });
  assert.equal(await ask("figma.com", once.fetcher), null);
  assert.deepEqual(urlsOf(once.asked), [
    "https://figma.com/",
    "https://figma.com/favicon.ico",
    "https://figma.com/apple-touch-icon.png",
  ]);

  const links = [1, 2, 3, 4, 5].map((n) => `<link rel="icon" href="/${n}.png">`).join("");
  const junk = Buffer.alloc(120, 0x41);
  const routes = { "https://figma.com/": { body: links } };
  for (let n = 1; n <= 5; n += 1) routes[`https://figma.com/${n}.png`] = { body: junk };
  const capped = site(routes);
  assert.equal(await ask("figma.com", capped.fetcher), null);
  assert.deepEqual(urlsOf(capped.asked), [
    "https://figma.com/",
    "https://figma.com/1.png",
    "https://figma.com/2.png",
    "https://figma.com/3.png",
    "https://figma.com/4.png",
  ]);
});

test("an icon on a private or unencrypted address is not requested", async () => {
  const icon = picture("png");
  const html = [
    `<link rel="apple-touch-icon" href="https://localhost/secret.png">`,
    `<link rel="icon" href="http://cdn.figma.com/a.png">`,
    `<link rel="icon" href="https://10.0.0.1/a.png">`,
    `<link rel="icon" href="https://192.168.1.10/a.png">`,
    `<link rel="icon" href="https://printer.local/a.png">`,
    `<link rel="icon" href="/mark.png">`,
  ].join("");
  const { asked, fetcher } = site({
    "https://figma.com/": { body: html },
    "https://figma.com/mark.png": { body: icon },
    "https://localhost/secret.png": { body: picture("png") },
    "http://cdn.figma.com/a.png": { body: picture("png") },
    "https://10.0.0.1/a.png": { body: picture("png") },
  });
  const found = await ask("figma.com", fetcher);
  assert.equal(found.type, "png");
  assert.deepEqual(found.bytes, icon);
  assert.deepEqual(urlsOf(asked), ["https://figma.com/", "https://figma.com/mark.png"]);
});

test("a page that does not answer still has its two well-known icons tried", async () => {
  const icon = picture("ico");
  const down = site({ "https://figma.com/favicon.ico": { body: icon } });
  const fetcher = async (url, init) => {
    if (String(url) === "https://figma.com/") return { ok: false, status: 500, url: String(url), arrayBuffer: async () => Buffer.from("nope") };
    return down.fetcher(url, init);
  };
  const found = await ask("figma.com", fetcher);
  assert.equal(found.type, "ico");
  assert.deepEqual(found.bytes, icon);
  assert.deepEqual(urlsOf(down.asked), [
    "https://figma.com/apple-touch-icon.png",
    "https://figma.com/favicon.ico",
  ]);
});

test("a local host is not asked for anything", async () => {
  const { asked, fetcher } = site({ "https://localhost/": { body: "<link rel='icon' href='/a.png'>" } });
  assert.equal(await ask("localhost", fetcher), null);
  assert.equal(await ask("127.0.0.1", fetcher), null);
  assert.equal(await ask("figma.com/path", fetcher), null);
  assert.equal(await ask("", fetcher), null);
  assert.deepEqual(asked, []);
});

test("a site that cannot be reached is not an error", async () => {
  const asked = [];
  const fetcher = async (url) => {
    asked.push(String(url));
    throw new Error("offline");
  };
  assert.equal(await ask("figma.com", fetcher), null);
  assert.deepEqual(asked, [
    "https://figma.com/",
    "https://figma.com/apple-touch-icon.png",
    "https://figma.com/favicon.ico",
  ]);
});
