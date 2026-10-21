process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";
import { fakeLock } from "../test/fake-lock.js";

const { loadInvoices } = await import("./load-invoices.js");
const load = (n) => JSON.parse(readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url), "utf8"));
const asRecords = (list) => list.map((p) => ({ seazonaId: p.id, payload: p, lastModified: p.lastModified ?? null }));
const raw = {
  records: async (e) => ({ invoice: asRecords(load("invoices.json")), invoice_detail: asRecords(load("invoice-details.json")) })[e] ?? [],
};
const doctor = { role: "doctor", approvalStatus: "approved", status: "active", createdAt: new Date(0) };
const users = [
  { ...doctor, id: "u-1324", seazonaClientId: "c-1324", seazonaAccountNumber: "1324" },
  { ...doctor, id: "u-2001", seazonaClientId: "c-2001", seazonaAccountNumber: "2001" },
];
// Select order: seed counts (invoices, lab orders), owners, existing invoices.
const db = (existing = [], owners = users) => fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], owners, existing] });

test("dry run: counts and seeds, no writes, no PHI in the report", async () => {
  const tx = db();
  const report = await loadInvoices({ raw, db: tx, live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.toInsert, 4);
  assert.equal(report.seeds.seazonaMax.invoice, 11130);
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.ok(!JSON.stringify(report).includes("Test Patient"));
});

test("live: invoices sealed, lines sealed, each invoice's lines follow it", async () => {
  const tx = db();
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  const inserts = tx.log.filter((e) => e.op === "insert").map((e) => e.values);
  const invoiceRows = inserts.find((v) => v[0]?.kind === "legacy");
  assert.equal(invoiceRows.length, 4);
  assert.match(invoiceRows[0].legacyPatient, /^enc:v1:/);
  const lineRows = inserts.filter((v) => v[0]?.priceSource === "legacy").flat();
  assert.equal(lineRows.length, 6, "inv-a, inv-c, inv-d one line each; inv-b three");
  assert.ok(lineRows.some((l) => /^enc:v1:/.test(l.legacyDescription ?? "")));
  assert.equal(report.written.invoices, 4);
  assert.ok(!JSON.stringify(inserts).includes("Test Patient"));
});

test("a re-run inserts nothing new", async () => {
  const existing = ["inv-a", "inv-b", "inv-c", "inv-d"].map((id, i) => ({ seazonaId: id, number: 11114 + i, clientUserId: "u" }));
  const tx = db(existing);
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
  assert.equal(report.counts.alreadyLoaded, 4);
});

test("an invoice whose client is linked to a non-doctor or unapproved user loads UNOWNED and is reported", async () => {
  const stranger = { ...users[0], role: "user", approvalStatus: "not_required" };
  const pending = { ...users[1], approvalStatus: "pending" };
  const tx = db([], [stranger, pending]);
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  const rows = tx.log.filter((e) => e.op === "insert").map((e) => e.values).find((v) => v[0]?.kind === "legacy");
  assert.equal(rows.length, 4);
  assert.ok(rows.every((r) => r.clientUserId === null), "never owned by an ineligible user");
  const p = report.problems.find((x) => x.kind === "client_owner_not_approved_doctor");
  assert.deepEqual(p.seazonaIds, ["c-1324", "c-2001"], "clients, not invoices");
  assert.equal(p.count, 2);
  assert.equal(report.counts.unowned, 4);
});

test("an approved doctor who reset a password but was never email-verified owns its client's invoices (F1)", async () => {
  // The old importer created doctors unverified; resetPassword sets a password and never verifies.
  const resetDoctor = { ...users[0], emailVerifiedAt: null, hasPassword: true };
  const shell = { ...users[1], emailVerifiedAt: null, hasPassword: false, status: "suspended" };
  const report = await loadInvoices({ raw, db: db([], [resetDoctor, shell]), live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.toInsert, 4);
  assert.equal(report.counts.unowned, 0);
  assert.equal(report.problems.some((p) => p.kind === "client_owner_not_approved_doctor"), false);
});

test("a live production load is refused when the invoice start is not above Seazona's highest", async () => {
  await assert.rejects(loadInvoices({ raw, db: db(), live: true, lock: fakeLock(), target: "production", starts: { invoice: 11130 } }), /INVOICE_NUMBER_START/);
});

test("legacy rows keep Seazona's numbers (no allocator)", async () => {
  const tx = db();
  await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  const rows = tx.log.filter((e) => e.op === "insert").map((e) => e.values).find((v) => v[0]?.kind === "legacy");
  assert.deepEqual(rows.map((r) => r.invoiceNumber), [11114, 11115, 11120, 11121]);
});

test("a re-run reattaches an unowned loaded invoice once its client has exactly one eligible owner", async () => {
  const existing = ["inv-a", "inv-b", "inv-c", "inv-d"].map((id, i) => ({ seazonaId: id, number: 11114 + i, clientUserId: id === "inv-d" ? "someone" : null }));
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing], updates: [[{ id: "i1" }, { id: "i2" }], [{ id: "i3" }]] });
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  assert.equal(report.counts.reattached, 3);
  const sets = tx.log.filter((e) => e.op === "set").map((e) => e.values.clientUserId);
  assert.deepEqual(sets, ["u-1324", "u-2001"], "inv-d already has an owner and is never touched");
});

test("a dry run reports the reattach without writing", async () => {
  const existing = [{ seazonaId: "inv-a", number: 11114, clientUserId: null }];
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing] });
  const report = await loadInvoices({ raw, db: tx, live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.reattached, 1);
  assert.equal(tx.log.some((e) => e.op === "update"), false);
});

test("an ambiguous client stays unowned (not reattached)", async () => {
  const dup = [users[0], { ...users[0], id: "u-other" }, users[1]];
  const existing = [{ seazonaId: "inv-a", number: 11114, clientUserId: null }];
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], dup, existing] });
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  assert.equal(report.counts.reattached, 0);
  assert.deepEqual(report.problems.find((p) => p.kind === "client_has_multiple_owners").seazonaIds, ["c-1324"]);
});

test("the reattach guard: rows the guarded update did not change are not counted, and only changed batches are audited", async () => {
  const existing = ["inv-a", "inv-b", "inv-c"].map((id, i) => ({ seazonaId: id, number: 11114 + i, clientUserId: null }));
  // u-1324 has inv-a and inv-b planned; the update only changes one (the other was attached meanwhile). u-2001's inv-c changes none.
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing], updates: [[{ id: "i1" }], []] });
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  assert.equal(report.counts.reattached, 1, "planned 3, changed 1");
  const audits = tx.log.filter((e) => e.op === "insert" && e.values?.action === "import.legacy_invoices_reattached").map((e) => e.values);
  assert.equal(audits.length, 1, "no audit row for a batch that changed nothing");
  assert.equal(audits[0].metadata.ownerUserId, "u-1324");
  assert.equal(audits[0].metadata.planned, 2);
  assert.equal(audits[0].metadata.changed, 1);
  assert.deepEqual(audits[0].metadata.legacyInvoiceIds, ["inv-a", "inv-b"]);
  assert.equal(audits[0].userId, null);
  const set = tx.log.find((e) => e.op === "set").values;
  assert.ok(set.version, "the version is bumped");
});

test("an unowned per-client opening invoice is attached by account number once the account has one eligible owner", async () => {
  const existing = [
    { seazonaId: "inv-a", number: 11114, clientUserId: "u" },
    { seazonaId: "opening:2001", number: 16211, clientUserId: null },
    { seazonaId: "opening:9999", number: 16212, clientUserId: null },
  ];
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing], updates: [[{ id: "o1" }]] });
  // Opening invoices mean balances ran; inserting the rest of the history then needs the explicit flag (F2).
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {}, allowAfterBalances: true });
  assert.equal(report.counts.reattached, 1, "account 9999 has no owner and stays unowned");
  assert.deepEqual(tx.log.filter((e) => e.op === "set").map((e) => e.values.clientUserId), ["u-2001"]);
});

test("an account resolves to the same owner in the invoices reattach and the balances step", async () => {
  const { loadBalances } = await import("./load-balances.js");
  const set = [{ ...doctor, id: "u-acct", seazonaClientId: null, seazonaAccountNumber: " Ab7 " }];
  const lock = { tryLock: async () => true, assertHeld() {}, close: async () => {} };
  const inv = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], set, [{ seazonaId: "opening:ab7", number: 16211, clientUserId: null }]], updates: [[{ id: "o" }]] });
  await loadInvoices({ raw, db: inv, live: true, lock: fakeLock(), target: "rehearsal", starts: {}, allowAfterBalances: true });
  const bal = fakeTx({ selects: [[], [], set, [{ n: 0 }], [{ n: 0 }]] });
  const report = await loadBalances({
    raw: { records: async () => [] }, db: bal, live: false, target: "rehearsal", mode: "per-client", paidCents: async () => new Map(),
    parsed: { rows: [{ key: "AB7", cents: 500 }], problems: [] }, lock,
  });
  assert.deepEqual(inv.log.filter((e) => e.op === "set").map((e) => e.values.clientUserId), ["u-acct"]);
  assert.equal(report.reconciliation.loadedOpenCents, 500, "owned, not unowned");
});

test("a re-run still reports clients whose loaded invoices remain unowned", async () => {
  const all = load("invoices.json");
  const existing = [{ seazonaId: all[0].id, number: 1, clientUserId: null }];
  const tx = db(existing, [users[1]]);
  const report = await loadInvoices({ raw, db: tx, live: false, target: "rehearsal", starts: {} });
  assert.equal(report.counts.loadedStillUnowned, 1);
  assert.deepEqual(report.problems.find((p) => p.kind === "loaded_invoices_still_unowned_client").seazonaIds, [String(all[0].clientId)]);
});

test("coupling: a production load with only --invoice-start is refused for the missing --order-start (the seed check guards both sequences)", async () => {
  const withOrders = { records: async (e) => (e === "order" ? asRecords(load("orders.json")) : raw.records(e)) };
  await assert.rejects(
    loadInvoices({ raw: withOrders, db: db(), live: true, lock: fakeLock(), target: "production", starts: { invoice: 99999 } }),
    /--order-start is required for a production load/,
  );
});

// F2: history inserted after balances would be unsettled (its full total owed).
test("after balances ran (settlement rows exist), a live insert is refused without --allow-after-balances", async () => {
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, [], [{ id: "settlement-1" }]] });
  await assert.rejects(
    loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} }),
    (err) => err.name === "ImportRefusal" && /--allow-after-balances/.test(err.message) && /balances/.test(err.message),
  );
  assert.equal(tx.log.some((e) => e.op === "insert"), false);
});

test("after balances ran (an opening invoice exists), a dry run reports it and an allowed live run tells the operator to re-run balances", async () => {
  const existing = [{ seazonaId: "opening:1324", number: 20001, clientUserId: "u-1324" }];
  const dry = await loadInvoices({ raw, db: fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing] }), live: false, target: "rehearsal", starts: {} });
  assert.equal(dry.problems.find((p) => p.kind === "invoices_inserted_after_balances").count, 4);
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing] });
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {}, allowAfterBalances: true });
  assert.equal(report.written.invoices, 4);
  assert.match(report.next, /re-run `import:load balances` with the same --balances mode and --file-id/i);
});

test("a re-run that inserts nothing never checks or refuses on balances", async () => {
  const existing = ["inv-a", "inv-b", "inv-c", "inv-d"].map((id, i) => ({ seazonaId: id, number: 11114 + i, clientUserId: "u" }));
  const tx = fakeTx({ selects: [[{ n: 0 }], [{ n: 0 }], users, existing, [{ id: "settlement-1" }]] });
  const report = await loadInvoices({ raw, db: tx, live: true, lock: fakeLock(), target: "rehearsal", starts: {} });
  assert.equal(report.next, undefined);
  assert.equal(report.problems.some((p) => p.kind === "invoices_inserted_after_balances"), false);
});
