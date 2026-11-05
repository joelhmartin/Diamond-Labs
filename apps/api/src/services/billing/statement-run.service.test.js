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
 * (client, month); claim inserts "sending" or re-takes a failed / no_email row,
 * and refuses a sending / sent one.
 */
function memoryStore() {
  const rows = new Map();
  const key = (c, m) => `${c}|${m}`;
  let n = 0;
  return {
    rows,
    async forMonth(_db, month) { return [...rows.values()].filter((r) => r.month === month); },
    async claim(_db, { clientUserId, month, closingCents, byUserId, runId }) {
      const existing = rows.get(key(clientUserId, month));
      if (existing && !["failed", "no_email"].includes(existing.status)) return null;
      const id = existing?.id ?? `s${++n}`;
      rows.set(key(clientUserId, month), { id, clientUserId, month, closingCents, status: "sending", sentAt: existing?.sentAt ?? null, sentBy: byUserId, runId });
      return id;
    },
    async forceClaim(_db, args) {
      const existing = rows.get(key(args.clientUserId, args.month));
      const id = existing?.id ?? `s${++n}`;
      rows.set(key(args.clientUserId, args.month), { ...existing, id, ...args, status: "sending" });
      return id;
    },
    async finish(_db, id, { status, sentAt }) {
      for (const r of rows.values()) if (r.id === id) Object.assign(r, { status, ...(sentAt ? { sentAt } : {}) });
    },
    async recordNoEmail(_db, { clientUserId, month, closingCents, runId }) {
      if (!rows.has(key(clientUserId, month))) rows.set(key(clientUserId, month), { id: `s${++n}`, clientUserId, month, closingCents, status: "no_email", runId });
    },
  };
}

const MONTH = "2026-10";
const doc = (id, extra = {}) => ({ id, name: `Dr ${id}`, email: `${id}@x.test`, accountNumber: id, practice: `P ${id}`, seazonaClientId: null, approvalStatus: "approved", ...extra });
// d1 owes from September and nothing moved in October; d2 had an invoice paid in full in October;
// d3 has no money events at all.
const DOCTORS = [doc("d1"), doc("d2"), doc("d3")];
const INVOICES = [
  { id: "i1", clientUserId: "d1", invoiceNumber: 1, status: "issued", totalCents: 5000, issuedAt: new Date("2026-09-10T15:00:00Z"), dueDate: "2026-10-10" },
  { id: "i2", clientUserId: "d2", invoiceNumber: 2, status: "paid", totalCents: 7000, issuedAt: new Date("2026-10-05T15:00:00Z"), dueDate: "2026-11-05" },
];
const PAYMENTS = [{ invoiceId: "i2", invoiceNumber: 2, appliedCents: 7000, source: "card", paidOn: "2026-10-20", createdAt: new Date("2026-10-20T15:00:00Z") }];

// previewStatementRun's selects, in order: doctors, invoices, payments (statement_sends comes from the store).
const previewSelects = (doctors = DOCTORS) => [doctors, INVOICES, PAYMENTS];

async function run(store, sendImpl, opts = {}) {
  const database = fakeTx({ selects: previewSelects(opts.doctors) });
  const send = vi.fn(sendImpl ?? (async () => true));
  const out = await svc.runStatements({ month: MONTH, byUserId: "adm", runId: opts.runId ?? null, dryRun: opts.dryRun ?? false, clientUserIds: opts.clientUserIds },
    { database, store, send, generatedAt: new Date("2026-11-02T15:00:00Z") });
  return { out, send, database };
}

test("planStatementRun: already sent, no activity and no email are skipped with a reason", () => {
  const plan = svc.planStatementRun({ candidates: [
    { clientUserId: "a", email: "a@x", activityCount: 2, closingCents: 0, alreadySentAt: null },
    { clientUserId: "b", email: "b@x", activityCount: 1, closingCents: 100, alreadySentAt: "2026-11-01T00:00:00Z" },
    { clientUserId: "c", email: "c@x", activityCount: 0, closingCents: 0, alreadySentAt: null },
    { clientUserId: "d", email: null, activityCount: 0, closingCents: 500, alreadySentAt: null },
    { clientUserId: "e", email: "e@x", activityCount: 1, closingCents: 1, alreadySentAt: null, sendStatus: "sending" },
  ] });
  assert.deepEqual(plan.send, ["a"]);
  assert.deepEqual(plan.skip, [
    { id: "b", reason: "already_sent" }, { id: "c", reason: "no_activity" }, { id: "d", reason: "no_email" }, { id: "e", reason: "already_sent" },
  ]);
  assert.deepEqual(svc.planStatementRun({ candidates: [{ clientUserId: "a", email: "a@x", activityCount: 1, closingCents: 0 }, { clientUserId: "z", email: "z@x", activityCount: 1, closingCents: 0 }], onlyIds: ["z"] }).send, ["z"]);
});

test("a zero-balance client with activity in the month gets a statement", async () => {
  const store = memoryStore();
  const { out, send } = await run(store);
  const to = send.mock.calls.map((c) => c[0].to);
  assert.ok(to.includes("d2@x.test"), "d2 closed at zero but had October activity");
  assert.ok(to.includes("d1@x.test"), "d1 had no October activity but a non-zero closing balance");
  const d2 = send.mock.calls.find((c) => c[0].to === "d2@x.test")[0];
  assert.deepEqual([d2.closingCents, d2.monthLabel], [0, "October 2026"]);
  assert.equal(out.sent, 2);
});

test("a client with no activity and zero closing is skipped as no_activity", async () => {
  const rows = await svc.previewStatementRun(MONTH, fakeTx({ selects: previewSelects() }), { store: memoryStore() });
  assert.deepEqual(rows.map((r) => r.clientUserId).sort(), ["d1", "d2"], "d3 is not a candidate");
  const d1 = rows.find((r) => r.clientUserId === "d1");
  assert.deepEqual([d1.openingCents, d1.closingCents, d1.activityCount, d1.email, d1.alreadySentAt], [5000, 5000, 0, "d1@x.test", null]);
  const { send } = await run(memoryStore());
  assert.ok(!send.mock.calls.some((c) => c[0].to === "d3@x.test"));
});

test("a second run for the same month sends nothing new", async () => {
  const store = memoryStore();
  const first = await run(store, null, { runId: "r1" });
  assert.equal(first.out.sent, 2);
  assert.ok([...store.rows.values()].every((r) => r.status === "sent" && r.sentAt instanceof Date && r.runId === "r1"));
  const second = await run(store, null, { runId: "r2" });
  assert.equal(second.send.mock.calls.length, 0);
  assert.deepEqual([second.out.sent, second.out.skipped, second.out.failed], [0, 2, 0]);
  // Even a client named explicitly is not re-sent by the run (only the single action re-sends).
  const third = await run(store, null, { clientUserIds: ["d1"] });
  assert.equal(third.send.mock.calls.length, 0);
});

test("a row claimed by another run between preview and send is not sent twice", async () => {
  const store = memoryStore();
  const claim = store.claim.bind(store);
  store.claim = async (d, args) => { await claim(d, args); return claim(d, args); }; // the second claim sees "sending"
  const { out, send } = await run(store);
  assert.equal(send.mock.calls.length, 0);
  assert.equal(out.skipped, 2);
});

test("no email → skip no_email and record it", async () => {
  const store = memoryStore();
  const { out, send } = await run(store, null, { doctors: [doc("d1", { email: null }), doc("d2")] });
  assert.deepEqual(send.mock.calls.map((c) => c[0].to), ["d2@x.test"]);
  assert.equal(store.rows.get(`d1|${MONTH}`).status, "no_email");
  assert.equal(out.skippedBy.no_email, 1);
  // Once an address is on file the next run sends it.
  const again = await run(store);
  assert.deepEqual(again.send.mock.calls.map((c) => c[0].to), ["d1@x.test"]);
});

test("a send failure marks failed and the next run retries it", async () => {
  const store = memoryStore();
  const first = await run(store, async ({ to }) => to !== "d1@x.test");
  assert.deepEqual([first.out.sent, first.out.failed], [1, 1]);
  assert.equal(store.rows.get(`d1|${MONTH}`).status, "failed");
  const thrown = await run(store, async () => { throw new Error("smtp down"); });
  assert.deepEqual([thrown.out.sent, thrown.out.failed], [0, 1], "a throwing sender is a failure, not a crash");
  const retry = await run(store);
  assert.deepEqual(retry.send.mock.calls.map((c) => c[0].to), ["d1@x.test"]);
  assert.equal(store.rows.get(`d1|${MONTH}`).status, "sent");
});

test("each send is audited with ids, month, closing and run id only", async () => {
  const { database } = await run(memoryStore(), null, { runId: "r9" });
  const audits = database.log.filter((l) => l.op === "insert" && l.values?.action).map((l) => l.values);
  assert.deepEqual(audits.map((a) => [a.action, a.targetId]).sort(), [["statement.emailed", "d1"], ["statement.emailed", "d2"]]);
  const d1 = audits.find((a) => a.targetId === "d1").metadata;
  assert.deepEqual([d1.month, d1.closingCents, d1.runId, d1.sent], [MONTH, 5000, "r9", true]);
  assert.ok(!JSON.stringify(audits).includes("@x.test"), "no address in the audit");
});

test("a dry run plans and sends nothing", async () => {
  const store = memoryStore();
  const { out, send } = await run(store, null, { dryRun: true });
  assert.equal(send.mock.calls.length, 0);
  assert.equal(store.rows.size, 0);
  assert.deepEqual([out.dryRun, out.wouldSend, out.sent], [true, 2, 0]);
});

test("the single action re-sends explicitly and overwrites sent_at", async () => {
  const store = memoryStore();
  await run(store);
  const before = store.rows.get(`d1|${MONTH}`).sentAt;
  const database = fakeTx({ selects: [[{ id: "d1", seazonaClientId: null }], [{ id: "d1", name: "Dr d1", email: "d1@x.test", role: "doctor", accountNumber: "d1", profile: null }], [INVOICES[0]], []] });
  const send = vi.fn(async () => true);
  await new Promise((r) => setTimeout(r, 2));
  const out = await svc.sendStatementFor("d1", MONTH, { byUserId: "adm" }, { database, store, send });
  assert.equal(out.status, "sent");
  assert.equal(send.mock.calls.length, 1);
  const row = store.rows.get(`d1|${MONTH}`);
  assert.ok(row.sentAt > before);
  assert.equal(row.runId, null);
});

test("previousLabMonth is the lab-local month before", () => {
  assert.equal(svc.previousLabMonth(new Date("2026-11-01T03:00:00Z")), "2026-09", "still October 31 in the lab's timezone");
  assert.equal(svc.previousLabMonth(new Date("2026-01-15T15:00:00Z")), "2025-12");
});

test("the real store claims with ON CONFLICT DO NOTHING and re-takes only failed or no_email rows", () => {
  assert.match(source, /onConflictDoNothing\(/);
  assert.match(source, /RETRYABLE = \["failed", "no_email"\]/);
  assert.match(source, /inArray\(statementSends\.status, RETRYABLE\)/);
  assert.doesNotMatch(source, /seazona\.service/);
});
