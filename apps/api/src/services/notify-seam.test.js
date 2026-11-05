import { test, afterEach } from "vitest";
import assert from "node:assert/strict";
import { notify } from "./notify-seam.js";
import { configureNotifications } from "../modules/notifications/index.js";

const ZERO = { inApp: 0, sent: 0, skipped: 0, failed: 0 };

afterEach(() => configureNotifications(null));

test("with no notifier configured, notify resolves to zeros", async () => {
  assert.deepEqual(await notify({}, { event: "x.y", audience: "staff", data: {} }), ZERO);
});

test("it delegates to the configured notifier with the root db and the same arguments", async () => {
  const seen = [];
  configureNotifications({ notify: async (db, a) => { seen.push({ db, a }); return { inApp: 2, sent: 1, skipped: 0, failed: 0 }; } });
  const db = { root: true };
  const a = { event: "x.y", recordType: "widget", recordId: "w1", audience: { kinds: ["staff"] }, data: { n: 1 } };
  assert.deepEqual(await notify(db, a), { inApp: 2, sent: 1, skipped: 0, failed: 0 });
  assert.equal(seen[0].db, db);
  assert.deepEqual(seen[0].a, a);
});

test("it never throws, even when the notifier does", async () => {
  configureNotifications({ notify: async () => { throw new Error("boom"); } });
  assert.deepEqual(await notify({}, { event: "x.y", audience: "staff", data: {} }), ZERO);
});
