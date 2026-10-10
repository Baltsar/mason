import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The store fixes its folder the first time it is loaded, and this file writes.
process.env.APPRENTICE_DATA = await mkdtemp(path.join(os.tmpdir(), "mason-welcome-"));
const { endWelcome, welcomePayload } = await import("../src/welcome.mjs");

const days = { "2026-10-01": { MASON: { minutes: 90, prompts: 12 }, KIOSK: { minutes: 45, prompts: 3 } }, "2026-10-02": { MASON: { minutes: 30, prompts: 5 } } };

test("a first start is welcomed with what was already read, before anything is asked of macOS", async () => {
  // Before the logs were read once there is nothing to say of them yet.
  assert.deepEqual(await welcomePayload({ permission: "unknown" }), { show: true, access: "needed", read: false, days: 0, hours: 0 });
  assert.deepEqual(await welcomePayload({ permission: "needed", days, through: 1 }), { show: true, access: "needed", read: true, days: 2, hours: 3 });
  // Someone with no agent logs at all is welcomed too, and told so.
  assert.deepEqual(await welcomePayload({ permission: "needed", days: {}, through: 1 }), { show: true, access: "needed", read: true, days: 0, hours: 0 });
});

test("someone who gave the leave, or said not now, is not welcomed again", async () => {
  assert.equal((await welcomePayload({ permission: "granted", days, through: 1 })).show, false);
  assert.equal((await welcomePayload({ permission: "granted" })).access, "on");
  await endWelcome();
  assert.equal((await welcomePayload({ permission: "needed", days, through: 1 })).show, false);
  assert.equal((await welcomePayload({ permission: "unknown" })).show, false);
});
