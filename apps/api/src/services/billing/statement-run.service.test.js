import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("../email.service.js", () => ({ sendStatementNotice: vi.fn(async () => true) }));

const { fakeTx } = await import("../../test/fake-tx.js");
const svc = await import("./statement-run.service.js");
const source = readFileSync(fileURLToPath(new URL("./statement-run.service.js", import.meta.url)), "utf8");

/**
 * An in-memory statement_sends with the real store's contract: one row per
 * (subject, recipient, month); claim inserts "sending" or re-takes a failed /
 * no_email row, and refuses a sending / sent one. Like the real store it
 * refuses a write without a subject key.
 */
function memoryStore() {
  const rows = new Map();
  const key = (s, c, m) => `${s}|${c}|${m}`;
  const subject = (s) => { if (!/^(account|organization):.+/.test(s ?? "")) throw new Error(`bad subject ${s}`); return s; };
  let n = 0;
  return {
    rows,
    async forMonth(_db, month) { return [...rows.values()].filter((r) => r.month === month); },
    async claim(_db, { subjectKey, clientUserId, month, closingCents, byUserId, runId }) {
      const k = key(subject(subjectKey), clientUserId, month);
      const existing = rows.get(k);
      if (existing && (!["failed", "no_email"].includes(existing.status) || existing.sentAt)) return null;
      const id = existing?.id ?? `s${++n}`;
      rows.set(k, { id, subjectKey, clientUserId, month, closingCents, status: "sending", sentAt: existing?.sentAt ?? null, sentBy: byUserId, runId });
      return id;
    },
    async forceClaim(_db, args) {
      const k = key(subject(args.subjectKey), args.clientUserId, args.month);
      const existing = rows.get(k);
      const id = existing?.id ?? `s${++n}`;
      rows.set(k, { ...existing, id, ...args, status: "sending" });
      return id;
    },
    async finish(_db, id, { status, sentAt }) {
      for (const r of rows.values()) if (r.id === id) Object.assign(r, { status, ...(sentAt ? { sentAt } : {}) });
    },
    async recordNoEmail(_db, { subjectKey, clientUserId, month, closingCents, runId }) {
      const k = key(subject(subjectKey), clientUserId, month);
      if (!rows.has(k)) rows.set(k, { id: `s${++n}`, subjectKey, clientUserId, month, closingCents, status: "no_email", runId });
    },
  };
}

const MONTH = "2026-10";
const person = (id, extra = {}) => ({ userId: id, name: `Dr ${id}`, email: `${id}@x.test`, role: "doctor", approvalStatus: "approved", status: "active", ...extra });
// Practices A1 (owes from September, nothing moved in October), A2 (an invoice paid in full in
// October) and A3 (no money events at all), each with its own account number.
const ACCOUNTS = [
  { id: "A1", name: "Alpha Dental", accountNumber: "1001" },
  { id: "A2", name: "Beta Dental", accountNumber: "2002" },
  { id: "A3", name: "Gamma Dental", accountNumber: "3003" },
];
// d1 is A1's doctor, d2 is A2's; s1 is A1's office staff and d4 a pending doctor (neither gets the practice statement).
const MEMBERS = [
  { accountId: "A1", ...person("d1") }, { accountId: "A2", ...person("d2") }, { accountId: "A3", ...person("d3") },
  { accountId: "A1", ...person("s1", { role: "user" }) }, { accountId: "A1", ...person("d4", { approvalStatus: "pending" }) },
];
// G1 (A1 + A2) has the combined statement on, with admin ga; G2 (A3) has it off.
const ORGS = [
  { id: "G1", name: "Smile Group", settings: { combinedStatement: true }, accountIds: ["A1", "A2"], admins: [person("ga", { role: "user", approvalStatus: "not_required" })] },
  { id: "G2", name: "Other Group", settings: { combinedStatement: false }, accountIds: ["A3"], admins: [person("gb", { role: "user" })] },
];
const INVOICES = [
  { id: "i1", accountId: "A1", clientUserId: "d1", invoiceNumber: 1, status: "issued", totalCents: 5000, issuedAt: new Date("2026-09-10T15:00:00Z"), dueDate: "2026-10-10" },
  { id: "i2", accountId: "A2", clientUserId: "d2", invoiceNumber: 2, status: "paid", totalCents: 7000, issuedAt: new Date("2026-10-05T15:00:00Z"), dueDate: "2026-11-05" },
];
const PAYMENTS = [{ invoiceId: "i2", invoiceNumber: 2, appliedCents: 7000, source: "card", paidOn: "2026-10-20", createdAt: new Date("2026-10-20T15:00:00Z") }];
const GENERATED = new Date("2026-11-02T15:00:00Z");

const subjects = (over = {}) => ({ accounts: ACCOUNTS, members: MEMBERS, organizations: ORGS, ...over });
// previewStatementRun's selects after the subjects: invoices, payments (statement_sends comes from the store).
const activityDb = () => fakeTx({ selects: [INVOICES, PAYMENTS] });
const preview = (store, over) => svc.previewStatementRun(MONTH, activityDb(), { store, generatedAt: GENERATED, loadSubjects: async () => subjects(over) });

async function run(store, sendImpl, opts = {}) {
  const database = activityDb();
  const send = vi.fn(sendImpl ?? (async () => true));
  const out = await svc.runStatements({ month: MONTH, byUserId: "adm", runId: opts.runId ?? null, dryRun: opts.dryRun ?? false, keys: opts.keys },
    { database, store, send, generatedAt: GENERATED, loadSubjects: async () => subjects(opts.subjects) });
  return { out, send, database };
}
const sentTo = (send) => send.mock.calls.map((c) => c[0].to).sort();
const rowOf = (store, subjectKey, user) => store.rows.get(`${subjectKey}|${user}|${MONTH}`);

test("planStatementRun: already sent, no activity and no email are skipped with a reason", () => {
  const plan = svc.planStatementRun({ candidates: [
    { key: "a", email: "a@x", activityCount: 2, closingCents: 0, alreadySentAt: null },
    { key: "b", email: "b@x", activityCount: 1, closingCents: 100, alreadySentAt: "2026-11-01T00:00:00Z" },
    { key: "c", email: "c@x", activityCount: 0, closingCents: 0, alreadySentAt: null },
    { key: "d", email: null, activityCount: 0, closingCents: 500, alreadySentAt: null },
    { key: "e", email: "e@x", activityCount: 1, closingCents: 1, alreadySentAt: null, sendStatus: "sending" },
  ] });
  assert.deepEqual(plan.send, ["a"]);
  assert.deepEqual(plan.skip, [
    { id: "b", reason: "already_sent" }, { id: "c", reason: "no_activity" }, { id: "d", reason: "no_email" }, { id: "e", reason: "unconfirmed" },
  ]);
  assert.deepEqual(svc.planStatementRun({ candidates: [{ key: "a", email: "a@x", activityCount: 1, closingCents: 0 }, { key: "z", email: "z@x", activityCount: 1, closingCents: 0 }], onlyKeys: ["z"] }).send, ["z"]);
});

test("each practice keeps its own statement and account number", async () => {
  const rows = await preview(memoryStore());
  const practice = rows.filter((r) => r.subject === "account");
  assert.deepEqual(practice.map((r) => [r.subjectKey, r.recipientUserId, r.name, r.accountNumber, r.openingCents, r.closingCents, r.activityCount]).sort(), [
    ["account:A1", "d1", "Alpha Dental", "1001", 5000, 5000, 0],
    ["account:A2", "d2", "Beta Dental", "2002", 0, 0, 2],
  ]);
  // A practice's statement goes to its approved doctors only: not its office staff, not a pending doctor.
  assert.ok(!rows.some((r) => ["s1", "d4"].includes(r.recipientUserId)));
  assert.deepEqual(rows.find((r) => r.recipientUserId === "d1").key, "account:A1|d1");
});

test("combined statement only when the group setting is on", async () => {
  const rows = await preview(memoryStore());
  const groups = rows.filter((r) => r.subject === "organization");
  assert.deepEqual(groups.map((r) => [r.subjectKey, r.name, r.accountNumber]), [["organization:G1", "Smile Group", null]]);
  // The group total is the sum of its practices' statements.
  const [g] = groups;
  const parts = rows.filter((r) => r.subject === "account" && ["A1", "A2"].includes(r.subjectId));
  assert.equal(g.closingCents, parts.reduce((s, r) => s + r.closingCents, 0));
  assert.equal(g.openingCents, 5000);
  assert.equal(g.activityCount, 2);
  // Turned off: no group row at all.
  const off = await preview(memoryStore(), { organizations: [{ ...ORGS[0], settings: { combinedStatement: false } }] });
  assert.equal(off.filter((r) => r.subject === "organization").length, 0);
});

test("combined statement goes to group admins only", async () => {
  const rows = await preview(memoryStore());
  const recipients = rows.filter((r) => r.subject === "organization").map((r) => r.recipientUserId);
  assert.deepEqual(recipients, ["ga"]);
  for (const m of MEMBERS) assert.ok(!recipients.includes(m.userId), `practice member ${m.userId} is never a group recipient`);
  // A suspended admin login is not sent to either.
  const suspended = await preview(memoryStore(), { organizations: [{ ...ORGS[0], admins: [person("ga", { status: "suspended" })] }] });
  assert.equal(suspended.filter((r) => r.subject === "organization").length, 0);
  // The run emails the group admin the combined notice; practice doctors get their practice's.
  const { send } = await run(memoryStore());
  assert.deepEqual(sentTo(send), ["d1@x.test", "d2@x.test", "ga@x.test"]);
  assert.deepEqual(send.mock.calls.filter((c) => c[0].combined).map((c) => c[0].to), ["ga@x.test"]);
});

test("same month never sent twice per subject and recipient", async () => {
  const store = memoryStore();
  // d1's October practice statement went out before piece 11; the practice backfill rewrote its row to account:A1.
  store.rows.set(`account:A1|d1|${MONTH}`, { id: "s0", subjectKey: "account:A1", clientUserId: "d1", month: MONTH, closingCents: 5000, status: "sent", sentAt: new Date("2026-11-01T15:00:00Z") });
  const first = await run(store);
  assert.deepEqual(sentTo(first.send), ["d2@x.test", "ga@x.test"], "the backfilled row counts as sent");
  const rows = await preview(store);
  assert.equal(rows.find((r) => r.key === "account:A1|d1").planned, "already_sent");
  // Every row is per subject: d1 being a group admin too would be a separate subject, sent once each.
  const second = await run(store);
  assert.equal(second.send.mock.calls.length, 0);
  assert.equal([...store.rows.values()].filter((r) => r.clientUserId === "d1").length, 1, "no second row for the same subject and recipient");
  // A recipient of both a practice and a group statement gets each exactly once.
  const both = memoryStore();
  const orgs = [{ ...ORGS[0], admins: [person("d1")] }];
  const a = await run(both, null, { subjects: { organizations: orgs } });
  assert.deepEqual(sentTo(a.send), ["d1@x.test", "d1@x.test", "d2@x.test"]);
  assert.ok(rowOf(both, "account:A1", "d1") && rowOf(both, "organization:G1", "d1"));
  const b = await run(both, null, { subjects: { organizations: orgs } });
  assert.equal(b.send.mock.calls.length, 0);
  // A legacy row the backfill has not mapped yet ('') still counts for that recipient's practice row, never a group row.
  const legacy = memoryStore();
  legacy.rows.set(`|d1|${MONTH}`, { id: "s9", subjectKey: "", clientUserId: "d1", month: MONTH, status: "sent", sentAt: new Date() });
  const pre = await preview(legacy, { organizations: orgs });
  assert.deepEqual([pre.find((r) => r.key === "account:A1|d1").planned, pre.find((r) => r.key === "organization:G1|d1").planned], ["already_sent", "send"]);
});

test("a zero-balance practice with activity in the month gets a statement", async () => {
  const { out, send } = await run(memoryStore());
  const d2 = send.mock.calls.find((c) => c[0].to === "d2@x.test")[0];
  assert.deepEqual([d2.closingCents, d2.monthLabel], [0, "October 2026"]);
  assert.ok(sentTo(send).includes("d1@x.test"), "A1 had no October activity but a non-zero closing balance");
  assert.equal(out.sent, 3);
});

test("a practice with no activity and zero closing is not a candidate", async () => {
  const rows = await preview(memoryStore());
  assert.ok(!rows.some((r) => r.subjectId === "A3"), "A3 is not a candidate");
  const { send } = await run(memoryStore());
  assert.ok(!send.mock.calls.some((c) => c[0].to === "d3@x.test"));
});

test("a second run for the same month sends nothing new", async () => {
  const store = memoryStore();
  const first = await run(store, null, { runId: "r1" });
  assert.equal(first.out.sent, 3);
  assert.ok([...store.rows.values()].every((r) => r.status === "sent" && r.sentAt instanceof Date && r.runId === "r1"));
  const second = await run(store, null, { runId: "r2" });
  assert.equal(second.send.mock.calls.length, 0);
  assert.deepEqual([second.out.sent, second.out.skipped, second.out.failed], [0, 3, 0]);
  // Even a row named explicitly is not re-sent by the run (only the single action re-sends).
  const third = await run(store, null, { keys: ["account:A1|d1"] });
  assert.equal(third.send.mock.calls.length, 0);
});

test("a row claimed by another run between preview and send is not sent twice", async () => {
  const store = memoryStore();
  const claim = store.claim.bind(store);
  store.claim = async (d, args) => { await claim(d, args); return claim(d, args); }; // the second claim sees "sending"
  const { out, send } = await run(store);
  assert.equal(send.mock.calls.length, 0);
  assert.equal(out.skipped, 3);
});

test("no email → skip no_email and record it", async () => {
  const store = memoryStore();
  const members = [{ accountId: "A1", ...person("d1", { email: null }) }, { accountId: "A2", ...person("d2") }];
  const { out, send } = await run(store, null, { subjects: { members, organizations: [] } });
  assert.deepEqual(sentTo(send), ["d2@x.test"]);
  assert.equal(rowOf(store, "account:A1", "d1").status, "no_email");
  assert.equal(out.skippedBy.no_email, 1);
  // Once an address is on file the next run sends it.
  const again = await run(store, null, { subjects: { organizations: [] } });
  assert.deepEqual(sentTo(again.send), ["d1@x.test"]);
});

test("a send failure marks failed and the next run retries it", async () => {
  const store = memoryStore();
  const first = await run(store, async ({ to }) => to !== "d1@x.test");
  assert.deepEqual([first.out.sent, first.out.failed], [2, 1]);
  assert.equal(rowOf(store, "account:A1", "d1").status, "failed");
  const thrown = await run(store, async () => { throw new Error("smtp down"); });
  assert.deepEqual([thrown.out.sent, thrown.out.failed], [0, 1], "a throwing sender is a failure, not a crash");
  const retry = await run(store);
  assert.deepEqual(sentTo(retry.send), ["d1@x.test"]);
  assert.equal(rowOf(store, "account:A1", "d1").status, "sent");
});

test("each send is audited with ids, subject, month, closing and run id only", async () => {
  const { database } = await run(memoryStore(), null, { runId: "r9" });
  const audits = database.log.filter((l) => l.op === "insert" && l.values?.action).map((l) => l.values);
  assert.deepEqual(audits.map((a) => [a.action, a.targetId]).sort(), [["statement.emailed", "d1"], ["statement.emailed", "d2"], ["statement.emailed", "ga"]]);
  const d1 = audits.find((a) => a.targetId === "d1").metadata;
  assert.deepEqual([d1.month, d1.subjectKey, d1.closingCents, d1.runId, d1.sent], [MONTH, "account:A1", 5000, "r9", true]);
  assert.equal(audits.find((a) => a.targetId === "ga").metadata.subjectKey, "organization:G1");
  assert.ok(!JSON.stringify(audits).includes("@x.test"), "no address in the audit");
  assert.ok(!/Dental|Smile/.test(JSON.stringify(audits)), "no names in the audit");
});

test("a dry run plans and sends nothing", async () => {
  const store = memoryStore();
  const { out, send } = await run(store, null, { dryRun: true });
  assert.equal(send.mock.calls.length, 0);
  assert.equal(store.rows.size, 0);
  assert.deepEqual([out.dryRun, out.wouldSend, out.sent], [true, 3, 0]);
});

// sendStatementFor's selects: the practice, its invoices, their payments, then its members and their people.
const singleDb = ({ people = [{ id: "d1", name: "Dr d1", email: "d1@x.test", role: "doctor", approvalStatus: "approved", status: "active" }], members = [{ userId: "d1" }] } = {}) =>
  fakeTx({ selects: [[ACCOUNTS[0]], [INVOICES[0]], [], members, people] });

test("the single action re-sends explicitly and overwrites sent_at", async () => {
  const store = memoryStore();
  await run(store);
  const before = rowOf(store, "account:A1", "d1").sentAt;
  const send = vi.fn(async () => true);
  await new Promise((r) => setTimeout(r, 2));
  const out = await svc.sendStatementFor({ accountId: "A1" }, MONTH, { byUserId: "adm" }, { database: singleDb(), store, send });
  assert.deepEqual(out, { closingCents: 5000, results: [{ recipientUserId: "d1", status: "sent" }] });
  assert.equal(send.mock.calls.length, 1);
  const row = rowOf(store, "account:A1", "d1");
  assert.ok(row.sentAt > before);
  assert.equal(row.runId, null);
  assert.equal([...store.rows.values()].filter((r) => r.clientUserId === "d1").length, 1, "the re-send reuses the practice row");
});

test("the single action sends only to the practice's approved doctors, and is null for a non-practice", async () => {
  const people = [
    { id: "d1", name: "Dr d1", email: "d1@x.test", role: "doctor", approvalStatus: "approved", status: "active" },
    { id: "s1", name: "Staff", email: "s1@x.test", role: "user", approvalStatus: "not_required", status: "active" },
  ];
  const send = vi.fn(async () => true);
  const out = await svc.sendStatementFor({ accountId: "A1" }, MONTH, {}, { database: singleDb({ people, members: [{ userId: "d1" }, { userId: "s1" }] }), store: memoryStore(), send });
  assert.deepEqual(out.results, [{ recipientUserId: "d1", status: "sent" }]);
  assert.deepEqual(sentTo(send), ["d1@x.test"]);
  assert.equal(await svc.sendStatementFor({ accountId: "nope" }, MONTH, {}, { database: fakeTx({ selects: [[]] }), store: memoryStore(), send }), null);
});

test("a row left sending with no sent_at is planned unconfirmed and never re-taken by the bulk run", async () => {
  const store = memoryStore();
  store.rows.set(`account:A1|d1|${MONTH}`, { id: "s0", subjectKey: "account:A1", clientUserId: "d1", month: MONTH, closingCents: 5000, status: "sending", sentAt: null });
  const rows = await preview(store);
  assert.equal(rows.find((r) => r.key === "account:A1|d1").planned, "unconfirmed");
  const { out, send } = await run(store);
  assert.deepEqual(sentTo(send), ["d2@x.test", "ga@x.test"]);
  assert.equal(out.skippedBy.unconfirmed, 1);
  assert.equal(rowOf(store, "account:A1", "d1").status, "sending", "left for staff to resolve with the single send");
  // A delivered month is still "already sent" even while a re-send is in flight.
  store.rows.set(`account:A1|d1|${MONTH}`, { id: "s0", subjectKey: "account:A1", clientUserId: "d1", month: MONTH, closingCents: 5000, status: "sending", sentAt: new Date() });
  const again = await preview(store);
  assert.equal(again.find((r) => r.key === "account:A1|d1").planned, "already_sent");
});

test("openMonth: the current lab month and later are still open; earlier months are closed", () => {
  const now = new Date("2026-11-01T03:00:00Z"); // still October 31 in the lab's timezone
  assert.equal(svc.openMonth("2026-10", now), true);
  assert.equal(svc.openMonth("2026-12", now), true);
  assert.equal(svc.openMonth("2026-09", now), false);
});

test("previousLabMonth is the lab-local month before", () => {
  assert.equal(svc.previousLabMonth(new Date("2026-11-01T03:00:00Z")), "2026-09", "still October 31 in the lab's timezone");
  assert.equal(svc.previousLabMonth(new Date("2026-01-15T15:00:00Z")), "2025-12");
});

test("the real store claims with ON CONFLICT DO NOTHING and re-takes only failed or no_email rows, always per subject", () => {
  assert.match(source, /onConflictDoNothing\(/);
  assert.match(source, /RETRYABLE = \["failed", "no_email"\]/);
  assert.match(source, /eq\(statementSends\.subjectKey, subjectKey\), eq\(statementSends\.clientUserId, clientUserId\), eq\(statementSends\.month, month\),\s*inArray\(statementSends\.status, RETRYABLE\), isNull\(statementSends\.sentAt\)/);
  assert.doesNotMatch(source, /seazona/i);
  // Every insert names the subject, and every write checks it first.
  const store = source.slice(source.indexOf("export const statementSendsStore"), source.indexOf("/** The lab-local month before"));
  assert.equal((store.match(/\.values\(\{ id: createId\(\), subjectKey,/g) ?? []).length, 3);
  assert.equal((store.match(/assertSubjectKey\(subjectKey\);/g) ?? []).length, 3);
});

test("the real store refuses a write without a subject (never another '' row)", async () => {
  const database = fakeTx();
  for (const subjectKey of [undefined, "", "user:1", "account:"]) {
    await assert.rejects(svc.statementSendsStore.claim(database, { subjectKey, clientUserId: "d1", month: MONTH, closingCents: 0 }), /subject key/);
    await assert.rejects(svc.statementSendsStore.forceClaim(database, { subjectKey, clientUserId: "d1", month: MONTH, closingCents: 0 }), /subject key/);
    await assert.rejects(svc.statementSendsStore.recordNoEmail(database, { subjectKey, clientUserId: "d1", month: MONTH, closingCents: 0 }), /subject key/);
  }
  assert.equal(database.log.length, 0);
  await svc.statementSendsStore.recordNoEmail(database, { subjectKey: "organization:G1", clientUserId: "ga", month: MONTH, closingCents: 0 });
  assert.equal(database.log.find((l) => l.op === "insert").values.subjectKey, "organization:G1");
});

test("send → forced re-send fails → bulk run sends nothing to that recipient", async () => {
  const store = memoryStore();
  await run(store);
  const out = await svc.sendStatementFor({ accountId: "A1" }, MONTH, { byUserId: "adm" }, { database: singleDb(), store, send: async () => false });
  assert.deepEqual(out.results, [{ recipientUserId: "d1", status: "failed" }]);
  assert.equal(rowOf(store, "account:A1", "d1").status, "failed");
  const rows = await preview(store);
  assert.equal(rows.find((r) => r.key === "account:A1|d1").planned, "already_sent");
  const again = await run(store);
  assert.equal(again.send.mock.calls.length, 0);
});

test("a row that cannot be settled after a send does not stop the batch", async () => {
  const store = memoryStore();
  store.finish = async () => { throw new Error("db blip"); };
  const { out, send } = await run(store);
  assert.equal(send.mock.calls.length, 3);
  assert.equal(out.sent, 3);
  assert.ok([...store.rows.values()].every((r) => r.status === "sending"), "left sending: never re-taken");
});

test("the per-client send to a named non-recipient sends nothing", async () => {
  const send = vi.fn(async () => true);
  const store = memoryStore();
  const database = fakeTx({ selects: [[ACCOUNTS[0]], [INVOICES[0]], [], [{ id: "d1", name: "Dr d1", email: "d1@x.test", role: "doctor", approvalStatus: "approved", status: "suspended" }]] });
  const out = await svc.sendStatementFor({ accountId: "A1", recipientUserIds: ["d1"] }, MONTH, {}, { database, store, send });
  assert.deepEqual(out.results, []);
  assert.equal(send.mock.calls.length, 0);
  assert.equal(store.rows.size, 0);
});
