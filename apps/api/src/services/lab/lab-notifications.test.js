import { test, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/pg-proxy";

const shipped = [];
vi.mock("../email.service.js", () => ({
  sendShippedNotice: vi.fn(async (args, opts) => { shipped.push({ args, opts }); return { ok: true, reason: null }; }),
}));

const { clearEvents, listEvents, getEvent } = await import("../../modules/notifications/index.js");
const { registerLabNotificationEvents, resolveLabAudience, labKindOf, LAB_EVENT_KEYS } = await import("./lab-notifications.js");

beforeEach(() => {
  clearEvents();
  shipped.length = 0;
});

// A real drizzle query builder over a recording driver: the exact SQL, no database.
function recordingDb(rows = []) {
  const calls = [];
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    return { rows };
  });
  return { db, calls };
}

// Columns in the order resolveLabAudience selects them: id, email, role, status, approvalStatus, seazonaClientId.
const row = (u) => [u.id, u.email, u.role, u.status ?? "active", u.approvalStatus ?? "not_required", u.seazonaClientId ?? null];
const PEOPLE = [
  { id: "a1", email: "a1@x.test", role: "admin" },
  { id: "l1", email: "l1@x.test", role: "lab" },
  { id: "l2", email: "l2@x.test", role: "lab", status: "suspended" },
  { id: "u1", email: "u1@x.test", role: "user" },
  { id: "d1", email: "d1@x.test", role: "doctor", approvalStatus: "approved", seazonaClientId: "P1" },
  { id: "d2", email: "d2@x.test", role: "doctor", approvalStatus: "approved", seazonaClientId: "P1" },
  { id: "d3", email: "d3@x.test", role: "doctor", approvalStatus: "pending", seazonaClientId: "P1" },
  { id: "d4", email: "d4@x.test", role: "doctor", approvalStatus: "approved", seazonaClientId: "P2" },
  { id: "d5", email: "d5@x.test", role: "doctor", approvalStatus: "approved", seazonaClientId: "P1", status: "suspended" },
];

test("registers exactly the six spec events", () => {
  registerLabNotificationEvents();
  registerLabNotificationEvents(); // idempotent: a second boot (or test) does not throw
  assert.deepEqual(listEvents().map((e) => e.key), [
    "message.received", "lab.order_received", "lab.pickup_requested", "lab.pickup_scheduled", "lab.pickup_cancelled", "lab.order_shipped",
  ]);
  assert.deepEqual(LAB_EVENT_KEYS, listEvents().map((e) => e.key));
  const d = (k) => ({ kinds: getEvent(k).kinds, defaults: getEvent(k).defaults, sms: getEvent(k).sms });
  assert.deepEqual(d("message.received"), {
    kinds: ["staff", "client"], defaults: { staff: { in_app: true, email: false }, client: { in_app: true, email: true } }, sms: true,
  });
  assert.deepEqual(d("lab.order_received"), { kinds: ["staff"], defaults: { staff: { in_app: true, email: false } }, sms: true });
  assert.deepEqual(d("lab.pickup_requested"), { kinds: ["staff"], defaults: { staff: { in_app: true, email: false } }, sms: true });
  assert.deepEqual(d("lab.pickup_scheduled"), { kinds: ["client"], defaults: { client: { in_app: true, email: true } }, sms: false });
  assert.deepEqual(d("lab.pickup_cancelled"), {
    kinds: ["staff", "client"], defaults: { staff: { in_app: true, email: false }, client: { in_app: true, email: true } }, sms: false,
  });
  assert.deepEqual(d("lab.order_shipped"), { kinds: ["client"], defaults: { client: { in_app: true, email: true } }, sms: false });
});

test("titles contain only numbers/dates from data", () => {
  registerLabNotificationEvents();
  // A stray free-text field never reaches a title.
  const extra = { patientName: "Jane Roe", notes: "sore jaw" };
  const t = (k, data) => getEvent(k).title({ ...data, ...extra });
  assert.equal(t("lab.order_received", { caseNumber: "R-1042", caseId: "c1" }), "New case R-1042");
  assert.equal(t("lab.order_received", { orderNumber: 100245, labOrderId: "lo1" }), "New shop order #100245");
  assert.equal(t("lab.pickup_requested", { pickupNumber: 17, pickupId: "p1" }), "Pickup #17 requested");
  assert.equal(t("lab.pickup_scheduled", { pickupNumber: 17, pickupId: "p1", date: "2026-11-09" }), "Pickup #17 scheduled for 2026-11-09");
  assert.equal(t("lab.pickup_cancelled", { pickupNumber: 17, pickupId: "p1" }), "Pickup #17 cancelled");
  assert.equal(t("lab.order_shipped", { orderNumbers: [100245] }), "Order #100245 shipped");
  assert.equal(t("lab.order_shipped", { orderNumbers: [100245, 100246] }), "Orders #100245, #100246 shipped");
  assert.equal(t("message.received", { threadId: "t1", recordLabel: "Case R-1042" }), "New message about Case R-1042");
  for (const e of listEvents()) {
    const title = e.title({ ...extra });
    assert.ok(!/Jane|jaw|undefined|null/.test(title), `${e.key}: ${title}`);
  }
  // Links are app paths built from ids in data, per side.
  assert.equal(getEvent("lab.order_received").link({ caseId: "c1" }, "staff"), "/admin/rx-cases/c1");
  assert.equal(getEvent("lab.order_received").link({ labOrderId: "lo1" }, "staff"), "/lab/orders/lo1");
  assert.equal(getEvent("message.received").link({ threadId: "t1" }, "client"), "/doctor/messages/t1");
  assert.equal(getEvent("message.received").link({ threadId: "t1" }, "staff"), "/lab/messages/t1");
});

test("resolveLabAudience: staff kind returns admin+lab active users only; practice party returns approved doctors of that practice only", async () => {
  const everyone = PEOPLE.map(row);
  const staff = recordingDb(everyone);
  const s = await resolveLabAudience(staff.db, { kinds: ["staff"] });
  assert.deepEqual(s, [{ id: "a1", email: "a1@x.test", kind: "staff" }, { id: "l1", email: "l1@x.test", kind: "staff" }]);
  assert.match(staff.calls[0].sql, /"status" = \$\d/);
  assert.match(staff.calls[0].sql, /"role" in \(/);

  const party = recordingDb(everyone);
  const p = await resolveLabAudience(party.db, { party: "practice:P1" });
  assert.deepEqual(p.map((u) => u.id), ["d1", "d2"]);
  assert.ok(p.every((u) => u.kind === "client"));
  assert.ok(party.calls[0].params.includes("P1"));
  assert.match(party.calls[0].sql, /"approval_status" = \$\d/);

  const one = recordingDb(everyone);
  assert.deepEqual((await resolveLabAudience(one.db, { party: "user:d4" })).map((u) => u.id), ["d4"]);

  const ids = recordingDb(everyone);
  assert.deepEqual(await resolveLabAudience(ids.db, { userIds: ["d1", "a1", "l2"] }), [
    { id: "a1", email: "a1@x.test", kind: "staff" },
    { id: "d1", email: "d1@x.test", kind: "client" },
  ]);

  const none = recordingDb(everyone);
  assert.deepEqual(await resolveLabAudience(none.db, { kinds: ["client"] }), []);
  assert.deepEqual(await resolveLabAudience(none.db, { party: "bogus" }), []);
  assert.equal(none.calls.length, 0, "nothing to resolve: no query");

  assert.equal(labKindOf({ role: "lab" }), "staff");
  assert.equal(labKindOf({ role: "admin" }), "staff");
  assert.equal(labKindOf({ role: "doctor" }), "client");
});

test("order_shipped email.send calls sendShippedNotice with orderNumbers and tracking", async () => {
  registerLabNotificationEvents();
  const send = getEvent("lab.order_shipped").email.send;
  const data = { orderNumbers: [100245, 100246], shopOrderNumber: null, carrier: "UPS", trackingNumber: "1Z1", trackingUrl: "https://ups.test/1Z1" };
  const r = await send({ id: "d1", email: "dr@x.com", kind: "client" }, data);
  assert.deepEqual(r, { ok: true, reason: null }, "the detailed result passes through");
  assert.deepEqual(shipped[0], {
    args: { to: "dr@x.com", orderNumbers: [100245, 100246], carrier: "UPS", trackingNumber: "1Z1", trackingUrl: "https://ups.test/1Z1" },
    opts: { detailed: true },
  });
  await send({ id: null, email: "guest@x.com", kind: null }, { ...data, orderNumbers: [100300], shopOrderNumber: "DOL-12345678" });
  assert.equal(shipped[1].args.shopOrderNumber, "DOL-12345678");
  assert.equal(shipped[1].args.to, "guest@x.com");

  // SHIPPED_EMAIL_ENABLED=false switches the email off (a skipped delivery), not the in-app alert.
  clearEvents();
  registerLabNotificationEvents({ shippedEmailEnabled: () => false });
  assert.deepEqual(await getEvent("lab.order_shipped").email.send({ email: "dr@x.com" }, data), { ok: false, reason: "unconfigured" });
  assert.equal(shipped.length, 2);
});
