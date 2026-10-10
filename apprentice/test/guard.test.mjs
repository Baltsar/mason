import test from "node:test";
import assert from "node:assert/strict";
import { fromHere, holdsKey, KEY_HEADER, makeKey, needsKey, usableKey } from "../src/guard.mjs";

test("the island, an agent and a terminal are not taken for a page: they name this Mac and no page", () => {
  assert.equal(fromHere({ host: "127.0.0.1:4317" }), true);
  assert.equal(fromHere({ host: "localhost:4317" }), true);
  assert.equal(fromHere({ host: "[::1]:4317" }), true);
});

test("Mason's own window is answered, typed into the address bar or asking from its own page", () => {
  assert.equal(fromHere({ host: "127.0.0.1:4317", "sec-fetch-site": "none" }), true);
  assert.equal(fromHere({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317", "sec-fetch-site": "same-origin" }), true);
  assert.equal(fromHere({ host: "localhost:4317", origin: "http://LOCALHOST:4317" }), true);
});

test("a page somewhere else is not answered, whatever it sends", () => {
  // A page on the web asking this Mac.
  assert.equal(fromHere({ host: "127.0.0.1:4317", origin: "https://example.com" }), false);
  assert.equal(fromHere({ host: "127.0.0.1:4317", "sec-fetch-site": "cross-site" }), false);
  // Another server on this Mac is another page too.
  assert.equal(fromHere({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4401", "sec-fetch-site": "same-site" }), false);
  assert.equal(fromHere({ host: "127.0.0.1:4317", origin: "http://localhost:4317" }), false);
  // A file opened in a browser, or a frame with no address of its own.
  assert.equal(fromHere({ host: "127.0.0.1:4317", origin: "null" }), false);
  assert.equal(fromHere({ host: "127.0.0.1:4317", origin: "" }), false);
});

test("a name that was pointed at this Mac is not this Mac", () => {
  assert.equal(fromHere({ host: "mason.example.com:4317" }), false);
  assert.equal(fromHere({ host: "127.0.0.1.example.com" }), false);
  assert.equal(fromHere({ host: "127.0.0.1:4317@example.com" }), false);
  assert.equal(fromHere({}), false);
  assert.equal(fromHere({ host: "" }), false);
});

test("a key is made anew each time and is long enough not to be guessed", () => {
  const [one, other] = [makeKey(), makeKey()];
  assert.notEqual(one, other);
  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(usableKey(one), true);
  assert.equal(usableKey("short"), false);
  assert.equal(usableKey(""), false);
  assert.equal(usableKey(undefined), false);
  assert.equal(usableKey(`${one}"; alert(1); "`), false);
});

test("a page and its files are read without the key, and nothing else is", () => {
  for (const pathname of ["/", "/overview", "/app.js", "/key.js", "/styles.css", "/brand/mason-mark.png"]) assert.equal(needsKey("GET", pathname), false, pathname);
  for (const pathname of ["/api/state", "/api/island", "/api/stream", "/api/settings", "/api/flow", "/icons/site-a.png", "/mcp", "/API/state", "/api"]) assert.equal(needsKey("GET", pathname), true, pathname);
  // Whatever changes something needs it, also at an address that has no name here.
  for (const pathname of ["/api/suggestions", "/api/access", "/api/settings", "/mcp", "/", "/app.js"]) assert.equal(needsKey("POST", pathname), true, pathname);
  assert.equal(needsKey("PUT", "/app.js"), true);
  assert.equal(needsKey("DELETE", "/"), true);
});

test("who has the key is answered: in its header, as a bearer token, or in the address where that is allowed", () => {
  const key = makeKey();
  assert.equal(holdsKey(key, { [KEY_HEADER]: key }), true);
  assert.equal(holdsKey(key, { authorization: `Bearer ${key}` }), true);
  assert.equal(holdsKey(key, {}, key), true);
  // The address counts only where the caller says it may.
  assert.equal(holdsKey(key, {}), false);
  assert.equal(holdsKey(key, {}, null), false);
});

test("another program on this Mac, which names no page and has no key, is not answered", () => {
  const key = makeKey();
  const curl = { host: "127.0.0.1:4317", "user-agent": "curl/8.7.1", accept: "*/*" };
  assert.equal(fromHere(curl), true);
  assert.equal(holdsKey(key, curl), false);
  assert.equal(holdsKey(key, { ...curl, [KEY_HEADER]: makeKey() }), false);
  assert.equal(holdsKey(key, { ...curl, [KEY_HEADER]: "" }), false);
  assert.equal(holdsKey(key, { ...curl, [KEY_HEADER]: key.slice(0, -1) }), false);
  assert.equal(holdsKey(key, { ...curl, [KEY_HEADER]: `${key}0` }), false);
  assert.equal(holdsKey(key, { ...curl, authorization: key }), false);
  assert.equal(holdsKey(key, { ...curl, authorization: "Bearer" }), false);
  assert.equal(holdsKey(key, { ...curl, [KEY_HEADER]: [key, key] }), false);
  assert.equal(holdsKey(key, curl, "undefined"), false);
});

test("a server without a key answers nobody, not everybody", () => {
  for (const key of ["", undefined, null, "short"]) {
    assert.equal(holdsKey(key, { [KEY_HEADER]: String(key) }), false);
    assert.equal(holdsKey(key, {}, String(key)), false);
    assert.equal(holdsKey(key, {}), false);
  }
});
