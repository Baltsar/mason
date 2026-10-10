import test from "node:test";
import assert from "node:assert/strict";
import { fromHere } from "../src/guard.mjs";

test("the island, an agent and a terminal are answered: they name this Mac and no page", () => {
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
