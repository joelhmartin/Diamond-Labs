import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createNotifier } from "./notifier.js";
import { defineNotificationEvent, clearEvents } from "./registry.js";
import { createFakeStore } from "./fake-store.js";

const DB = { root: true };
const USERS = [
  { id: "s1", email: "s1@host.test", kind: "staff" },
  { id: "s2", email: "s2@host.test", kind: "staff" },
  { id: "c1", email: "c1@party.test", kind: "client", party: "p:1" },
  { id: "c2", email: "c2@party.test", kind: "client", party: "p:1" },
];

// The host app's audience resolver, reduced to the shapes the notifier passes.
async function resolveAudience(_db, a) {
  const out = [];
  for (const k of a.kinds ?? []) out.push(...USERS.filter((u) => u.kind === k));
  if (a.party) out.push(...USERS.filter((u) => u.party === a.party));
  for (const id of a.userIds ?? []) out.push(...USERS.filter((u) => u.id === id));
  return out.map(({ id, email, kind }) => ({ id, email, kind }));
}

function defineThing(over = {}) {
  defineNotificationEvent({
    key: "thing.happened",
    label: "Thing happened",
    kinds: ["staff", "client"],
    defaults: { staff: { in_app: true, email: false }, client: { in_app: true, email: true } },
    sms: true,
    title: (d) => `Thing ${d.number} happened`,
    link: (d, kind) => (kind === "staff" ? `/staff/things/${d.number}` : `/things/${d.number}`),
    email: { subject: (d) => `Thing ${d.number}` },
    ...over,
  });
}

function setup({ preferences, recipients, email, sms, random } = {}) {
  const store = createFakeStore({ preferences, recipients });
  const emails = [];
  const texts = [];
  const logs = [];
  const log = { info: (m) => logs.push(m), warn: (m) => logs.push(m), error: (m) => logs.push(m) };
  const notifier = createNotifier({
    store,
    resolveAudience,
    channels: {
      email: { send: email ?? (async (m) => { emails.push(m); return true; }) },
      sms: { send: sms ?? (async (m) => { texts.push(m); return { ok: true }; }) },
    },
    appUrl: "https://app.test",
    orgName: "Acme",
    log,
    random: random ?? (() => 0.5),
  });
  return { notifier, store, emails, texts, logs };
}

const args = (over = {}) => ({
  event: "thing.happened", recordType: "widget", recordId: "w1", audience: { kinds: ["staff"] }, data: { number: 7 }, ...over,
});

beforeEach(() => {
  clearEvents();
  defineThing();
});

test("unknown event logs [NOTIFY][UNKNOWN_EVENT] and returns zeros", async () => {
  const { notifier, store, logs } = setup();
  const r = await notifier.notify(DB, args({ event: "nope.never" }));
  assert.deepEqual(r, { inApp: 0, sent: 0, skipped: 0, failed: 0 });
  assert.ok(logs.some((l) => l.includes("[NOTIFY][UNKNOWN_EVENT] event=nope.never")));
  assert.equal(store.state.notifications.length, 0);
});

test("unsafe data logs [NOTIFY][BAD_DATA] and returns zeros without writing", async () => {
  const { notifier, store, logs } = setup();
  const r = await notifier.notify(DB, args({ data: { nested: { a: 1 } } }));
  assert.deepEqual(r, { inApp: 0, sent: 0, skipped: 0, failed: 0 });
  assert.ok(logs.some((l) => l.includes("[NOTIFY][BAD_DATA] event=thing.happened")));
  assert.equal(store.state.notifications.length, 0);
});

test("in_app row is written per resolved user with title(data) and link(data, kind)", async () => {
  const { notifier, store } = setup();
  const r = await notifier.notify(DB, args({ audience: { kinds: ["staff"], userIds: ["c1"] } }));
  assert.equal(r.inApp, 3);
  const rows = store.state.notifications;
  assert.deepEqual(rows.map((n) => n.userId).sort(), ["c1", "s1", "s2"]);
  const s1 = rows.find((n) => n.userId === "s1");
  assert.equal(s1.title, "Thing 7 happened");
  assert.equal(s1.link, "/staff/things/7");
  assert.equal(s1.event, "thing.happened");
  assert.equal(s1.recordType, "widget");
  assert.equal(s1.recordId, "w1");
  assert.equal(s1.collapseKey, "thing.happened:widget:w1");
  assert.equal(rows.find((n) => n.userId === "c1").link, "/things/7");
});

test("audience may be a kind string ('staff' means { kinds: ['staff'] })", async () => {
  const { notifier, store } = setup();
  const r = await notifier.notify(DB, args({ audience: "staff" }));
  assert.equal(r.inApp, 2);
  assert.deepEqual(store.state.notifications.map((n) => n.userId).sort(), ["s1", "s2"]);
});

test("excludeUserIds and duplicates are dropped", async () => {
  const { notifier, store } = setup();
  await notifier.notify(DB, args({ audience: { kinds: ["staff"], userIds: ["s1", "s2"], excludeUserIds: ["s2"] } }));
  assert.deepEqual(store.state.notifications.map((n) => n.userId), ["s1"]);
});

test("preference row false suppresses that channel; missing row uses defaults[kind]", async () => {
  const { notifier, store, emails } = setup({
    preferences: [
      { userId: "s1", event: "thing.happened", channel: "in_app", enabled: false },
      { userId: "s2", event: "thing.happened", channel: "email", enabled: true },
      { userId: "c2", event: "thing.happened", channel: "email", enabled: false },
    ],
  });
  await notifier.notify(DB, args({ audience: { kinds: ["staff"], party: "p:1" } }));
  // s1 opted out of in-app; everyone else gets the default (in-app on for both kinds).
  assert.deepEqual(store.state.notifications.map((n) => n.userId).sort(), ["c1", "c2", "s2"]);
  // staff email defaults off (s2 opted in); client email defaults on (c2 opted out).
  assert.deepEqual(emails.map((e) => e.to).sort(), ["c1@party.test", "s2@host.test"]);
});

test("an unread collapse_key bumps count and skips email", async () => {
  const { notifier, store, emails } = setup();
  const first = await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  const second = await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.equal(store.state.notifications.length, 1);
  assert.equal(store.state.notifications[0].count, 2);
  assert.equal(emails.length, 1);
  assert.equal(first.sent, 1);
  assert.equal(second.sent, 0);
  assert.equal(second.skipped, 1);
  const skipped = store.state.deliveries.filter((d) => d.status === "skipped");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].reason, "collapsed");
});

test("after markRead the next notify creates a fresh row and emails again", async () => {
  const { notifier, store, emails } = setup();
  await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.equal(await notifier.markRead(DB, "c1", { all: true }), 1);
  await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.equal(store.state.notifications.length, 2);
  assert.equal(emails.length, 2);
  assert.equal(await notifier.unreadCount(DB, "c1"), 1);
});

test("the email carries subject, heading from title and a button to appUrl + link", async () => {
  const { notifier, emails } = setup();
  await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.equal(emails.length, 1);
  const m = emails[0];
  assert.equal(m.to, "c1@party.test");
  assert.equal(m.subject, "Thing 7");
  assert.equal(m.heading, "Thing 7 happened");
  assert.equal(m.actionUrl, "https://app.test/things/7");
  assert.equal(typeof m.line, "string");
});

test("addresses.email are emailed without an in-app row", async () => {
  const { notifier, store, emails } = setup();
  const r = await notifier.notify(DB, args({ audience: { addresses: { email: ["guest@else.test"] } } }));
  assert.equal(store.state.notifications.length, 0);
  assert.deepEqual(emails.map((e) => e.to), ["guest@else.test"]);
  assert.equal(r.sent, 1);
  assert.equal(r.inApp, 0);
});

test("active static sms recipients receive one text per notify; inactive do not", async () => {
  const { notifier, texts, store } = setup({
    recipients: [
      { id: "r1", event: "thing.happened", channel: "sms", address: "+15125550001", label: "Front desk", active: true },
      { id: "r2", event: "thing.happened", channel: "sms", address: "+15125550002", label: "Old", active: false },
      { id: "r3", event: "other.thing", channel: "sms", address: "+15125550003", label: "Other", active: true },
    ],
  });
  await notifier.notify(DB, args());
  await notifier.notify(DB, args());
  assert.deepEqual(texts.map((t) => t.to), ["+15125550001", "+15125550001"]);
  assert.match(texts[0].body, /^Acme: Thing 7 happened https:\/\/app\.test\/staff\/things\/7$/);
  const sent = store.state.deliveries.filter((d) => d.channel === "sms");
  assert.equal(sent.length, 2);
  assert.equal(sent[0].targetMasked, "•••0001");
  assert.equal(sent[0].status, "sent");
});

test("an event without sms does not text its static list", async () => {
  clearEvents();
  defineThing({ sms: false });
  const { notifier, texts } = setup({
    recipients: [{ id: "r1", event: "thing.happened", channel: "sms", address: "+15125550001", label: "x", active: true }],
  });
  await notifier.notify(DB, args());
  assert.equal(texts.length, 0);
});

test("sms body is capped at 160 chars", async () => {
  clearEvents();
  defineThing({ smsText: (d) => `Long ${d.number} ${"z".repeat(300)}` });
  const { notifier, texts } = setup({
    recipients: [{ id: "r1", event: "thing.happened", channel: "sms", address: "+15125550001", label: "x", active: true }],
  });
  await notifier.notify(DB, args());
  assert.equal(texts.length, 1);
  assert.equal(texts[0].body.length, 160);
  assert.ok(texts[0].body.startsWith("Long 7 "));
});

test("active static email recipients get the email path with no in-app row", async () => {
  const { notifier, emails, store } = setup({
    recipients: [{ id: "r1", event: "thing.happened", channel: "email", address: "desk@host.test", label: "Desk", active: true }],
  });
  await notifier.notify(DB, args({ audience: { userIds: [] } }));
  assert.deepEqual(emails.map((e) => e.to), ["desk@host.test"]);
  assert.equal(store.state.notifications.length, 0);
});

test("a throwing channel is logged and notify resolves", async () => {
  const { notifier, store, logs } = setup({
    email: async () => { throw new Error("mailgun down for c1@party.test"); },
    sms: async () => { throw new Error("twilio 500"); },
    recipients: [{ id: "r1", event: "thing.happened", channel: "sms", address: "+15125551234", label: "x", active: true }],
  });
  const r = await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.equal(r.failed, 2);
  assert.equal(r.inApp, 1);
  const failed = store.state.deliveries.filter((d) => d.status === "failed");
  assert.deepEqual(failed.map((d) => d.channel).sort(), ["email", "sms"]);
  assert.deepEqual(failed.map((d) => d.targetMasked).sort(), ["c•••@party.test", "•••1234"]);
  const lines = logs.filter((l) => l.includes("[NOTIFY][SEND_FAILED]"));
  assert.equal(lines.length, 2);
  assert.ok(lines.some((l) => /event=thing\.happened channel=email reason=/.test(l)));
  for (const l of [...lines, ...failed.map((d) => d.reason)]) {
    assert.ok(!l.includes("c1@party.test"), `raw address leaked: ${l}`);
    assert.ok(!l.includes("+15125551234"), `raw phone leaked: ${l}`);
  }
});

test("a channel that reports failure is a failed delivery; a missing sms channel is skipped", async () => {
  const store = createFakeStore({
    recipients: [{ id: "r1", event: "thing.happened", channel: "sms", address: "+15125551234", label: "x", active: true }],
  });
  const logs = [];
  const notifier = createNotifier({
    store, resolveAudience,
    channels: { email: { send: async () => false } },
    appUrl: "https://app.test", orgName: "Acme",
    log: { info: () => {}, warn: (m) => logs.push(m), error: (m) => logs.push(m) },
    random: () => 0.5,
  });
  const r = await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.equal(r.failed, 1);
  assert.equal(r.skipped, 1);
  assert.deepEqual(store.state.deliveries.map((d) => `${d.channel}:${d.status}`).sort(), ["email:failed", "sms:skipped"]);
});

test("a throwing audience resolver or store never escapes notify", async () => {
  const store = createFakeStore();
  store.upsertInApp = async () => { throw new Error("db gone"); };
  const logs = [];
  const notifier = createNotifier({
    store,
    resolveAudience: async () => USERS.slice(0, 1).map(({ id, email, kind }) => ({ id, email, kind })),
    channels: {}, appUrl: "https://app.test", orgName: "Acme",
    log: { info: () => {}, warn: (m) => logs.push(m), error: (m) => logs.push(m) },
  });
  const r = await notifier.notify(DB, args());
  assert.equal(typeof r.inApp, "number");
  assert.ok(logs.some((l) => l.includes("[NOTIFY]")));

  const broken = createNotifier({
    store: createFakeStore(),
    resolveAudience: async () => { throw new Error("nope"); },
    channels: {}, appUrl: "https://app.test", log: { info() {}, warn() {}, error() {} },
  });
  assert.deepEqual(await broken.notify(DB, args()), { inApp: 0, sent: 0, skipped: 0, failed: 0 });
});

test("event.email.send overrides the generic sender", async () => {
  clearEvents();
  const custom = [];
  defineThing({ email: { send: async (recipient, data) => { custom.push({ recipient, data }); return true; } } });
  const { notifier, emails } = setup();
  const r = await notifier.notify(DB, args({ audience: { userIds: ["c1"], addresses: { email: ["guest@else.test"] } } }));
  assert.equal(emails.length, 0);
  assert.deepEqual(custom.map((c) => c.recipient), [
    { id: "c1", email: "c1@party.test", kind: "client" },
    { id: null, email: "guest@else.test", kind: null },
  ]);
  assert.deepEqual(custom[0].data, { number: 7 });
  assert.equal(r.sent, 2);
});

test("deliveries are pruned to 90 days about once per hundred writes", async () => {
  const quiet = setup({ random: () => 0.5 });
  await quiet.notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.deepEqual(quiet.store.state.prunes, []);
  const lucky = setup({ random: () => 0.001 });
  await lucky.notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  assert.deepEqual(lucky.store.state.prunes, [90]);
});

test("in-app list, markUnread, dismiss", async () => {
  const { notifier } = setup();
  await notifier.notify(DB, args({ audience: { userIds: ["c1"] } }));
  await notifier.notify(DB, args({ recordId: "w2", audience: { userIds: ["c1"] } }));
  const list = await notifier.listForUser(DB, "c1", {});
  assert.equal(list.length, 2);
  await notifier.markRead(DB, "c1", { ids: [list[0].id] });
  assert.equal(await notifier.unreadCount(DB, "c1"), 1);
  assert.equal(await notifier.markUnread(DB, "c1", list[0].id), true);
  assert.equal(await notifier.unreadCount(DB, "c1"), 2);
  assert.equal(await notifier.dismiss(DB, "c1", list[1].id), true);
  assert.equal((await notifier.listForUser(DB, "c1", {})).length, 1);
  assert.equal(await notifier.dismiss(DB, "s1", list[0].id), false, "another user's row is not theirs to dismiss");
});

test("getPreferences lists the kind's events with effective values; setPreference validates", async () => {
  const { notifier } = setup();
  const user = { id: "c1", kind: "client" };
  let prefs = await notifier.getPreferences(DB, user);
  assert.deepEqual(prefs, [{ event: "thing.happened", label: "Thing happened", channels: { in_app: true, email: true } }]);
  await notifier.setPreference(DB, user, { event: "thing.happened", channel: "email", enabled: false });
  prefs = await notifier.getPreferences(DB, user);
  assert.equal(prefs[0].channels.email, false);
  await assert.rejects(notifier.setPreference(DB, user, { event: "nope", channel: "email", enabled: true }), /event/);
  await assert.rejects(notifier.setPreference(DB, user, { event: "thing.happened", channel: "sms", enabled: true }), /channel/);
  await assert.rejects(notifier.setPreference(DB, { id: "x", kind: "visitor" }, { event: "thing.happened", channel: "email", enabled: true }), /kind/);
});

test("recipients: add validates the address, list masks nothing for admins, sendTest texts and logs", async () => {
  const { notifier, texts, store } = setup();
  await assert.rejects(notifier.recipients.add(DB, { event: "thing.happened", channel: "sms", address: "555-1234", label: "x" }), /address/);
  await assert.rejects(notifier.recipients.add(DB, { event: "nope", channel: "sms", address: "+15125550001", label: "x" }), /event/);
  await assert.rejects(notifier.recipients.add(DB, { event: "thing.happened", channel: "in_app", address: "+15125550001", label: "x" }), /channel/);
  const r = await notifier.recipients.add(DB, { event: "thing.happened", channel: "sms", address: "+15125550001", label: "Desk", createdByUserId: "s1" });
  assert.equal(r.address, "+15125550001");
  assert.equal(r.active, true);
  await assert.rejects(notifier.recipients.add(DB, { event: "thing.happened", channel: "sms", address: "+15125550001", label: "Again" }), /already/);
  assert.equal((await notifier.recipients.list(DB, {})).length, 1);
  const ok = await notifier.recipients.sendTest(DB, r.id);
  assert.equal(ok.ok, true);
  assert.equal(texts.length, 1);
  assert.match(texts[0].body, /test/i);
  assert.equal(store.state.deliveries.at(-1).status, "sent");
  await notifier.recipients.setActive(DB, r.id, false);
  assert.equal((await notifier.recipients.list(DB, {}))[0].active, false);
  assert.equal(await notifier.recipients.remove(DB, r.id), true);
  const delivered = await notifier.deliveries.list(DB, {});
  assert.deepEqual(delivered.rows, store.state.deliveries.slice().reverse());
  assert.equal(delivered.total, store.state.deliveries.length);
  assert.equal((await notifier.deliveries.list(DB, { limit: 1 })).rows.length, 1);
  assert.equal((await notifier.deliveries.list(DB, { limit: 1 })).total, store.state.deliveries.length);
});

test("a suppressed or unconfigured email is recorded as such, not as a failure", async () => {
  const results = [{ ok: false, reason: "suppressed" }, { ok: false, reason: "unconfigured" }, { ok: false, reason: "undeliverable" }];
  const { notifier, store, logs } = setup({ email: async () => results.shift() });
  const r = await notifier.notify(DB, args({ audience: { userIds: ["c1"], addresses: { email: ["a@else.test", "b@else.test"] } } }));
  assert.deepEqual(r, { inApp: 1, sent: 0, skipped: 3, failed: 0 });
  assert.deepEqual(store.state.deliveries.map((d) => `${d.status}:${d.reason}`), ["suppressed:suppressed", "skipped:unconfigured", "skipped:undeliverable"]);
  assert.equal(logs.filter((l) => l.includes("[NOTIFY][SEND_FAILED]")).length, 0);
});

test("a rejected or erroring detailed email result is a failure; ok:true is sent", async () => {
  const results = [{ ok: false, reason: "rejected" }, { ok: false, reason: "error" }, { ok: true, reason: null }];
  const { notifier, store, logs } = setup({ email: async () => results.shift() });
  const r = await notifier.notify(DB, args({ audience: { addresses: { email: ["a@else.test", "b@else.test", "c@else.test"] } } }));
  assert.deepEqual(r, { inApp: 0, sent: 1, skipped: 0, failed: 2 });
  assert.deepEqual(store.state.deliveries.map((d) => `${d.status}:${d.reason}`), ["failed:rejected", "failed:error", "sent:null"]);
  assert.equal(logs.filter((l) => l.includes("[NOTIFY][SEND_FAILED]")).length, 2);
});

test("notify with null or missing args resolves to zeros", async () => {
  const { notifier } = setup();
  assert.deepEqual(await notifier.notify(DB, null), { inApp: 0, sent: 0, skipped: 0, failed: 0 });
  assert.deepEqual(await notifier.notify(DB), { inApp: 0, sent: 0, skipped: 0, failed: 0 });
});
