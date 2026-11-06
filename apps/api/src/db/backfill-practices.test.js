import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";
import { planPracticeBackfill, writePracticeBackfill } from "./backfill-practices.js";

const day = (n) => new Date(Date.UTC(2025, 0, n));
const doctor = (id, extra = {}) => ({
  id, role: "doctor", approvalStatus: "approved", status: "active", seazonaClientId: null, seazonaAccountNumber: null,
  companyName: `Co ${id}`, createdAt: day(1), ...extra,
});
const account = (id, ownerId, extra = {}) => ({
  id, ownerId, name: `Acct ${id}`, status: "active", isClient: false, accountNumber: null, legacyClientKey: null, createdAt: day(1), ...extra,
});
const owner = (userId, accountId) => ({ userId, accountId, role: "owner", status: "active" });
let n = 0;
const newId = () => `new${++n}`;
const plan = (input) => planPracticeBackfill({ memberships: [], now: day(30), newId, ...input });

/** Applies a plan to the in-memory rows, as the writer would, so a second plan can be compared. */
function applyPlan(p, { users, accounts, memberships }) {
  const next = accounts.map((a) => ({
    ...a,
    ...(p.markClient.includes(a.id) ? { isClient: true } : {}),
    ...(p.setFields.find((f) => f.accountId === a.id) ?? {}),
    ...(p.deleteAccounts.includes(a.id) ? { status: "deleted" } : {}),
  }));
  for (const c of p.createAccounts) next.push({ id: c.accountId, ownerId: c.ownerId, name: c.name, status: "active", isClient: true, accountNumber: c.accountNumber, legacyClientKey: c.legacyClientKey, createdAt: day(30) });
  return { users, accounts: next, memberships: [...memberships, ...p.addMemberships.map((m) => ({ ...m, status: "active" }))] };
}

test("two doctors sharing a client id -> one client account, the other gets an admin membership", () => {
  const users = [doctor("u1", { seazonaClientId: "C1", createdAt: day(1) }), doctor("u2", { seazonaClientId: "C1", createdAt: day(2) })];
  const accounts = [account("a1", "u1"), account("a2", "u2")];
  const p = plan({ users, accounts, memberships: [owner("u1", "a1"), owner("u2", "a2")] });
  assert.deepEqual(p.markClient, ["a1"]);
  assert.deepEqual(p.addMemberships, [{ userId: "u2", accountId: "a1", role: "admin" }]);
  assert.equal(p.practiceOfUser.get("u1"), "a1");
  assert.equal(p.practiceOfUser.get("u2"), "a1");
  assert.equal(p.accountByLegacyKey.get("C1"), "a1");
});

test("canonical account is the oldest linked doctor's", () => {
  const users = [doctor("u1", { seazonaClientId: "C1", createdAt: day(5) }), doctor("u2", { seazonaClientId: "C1", createdAt: day(2) })];
  const accounts = [account("a1", "u1", { createdAt: day(1) }), account("a2", "u2", { createdAt: day(9) })];
  const p = plan({ users, accounts });
  assert.deepEqual(p.markClient, ["a2"], "u2 is the oldest doctor, so a2 wins even though a1 is the older account");
  assert.equal(p.practiceOfUser.get("u1"), "a2");
});

test("when the oldest doctor owns two active accounts, the oldest of them wins", () => {
  const users = [doctor("u1", { seazonaClientId: "C1" })];
  const accounts = [account("a2", "u1", { createdAt: day(9) }), account("a1", "u1", { createdAt: day(3) })];
  assert.deepEqual(plan({ users, accounts }).markClient, ["a1"]);
});

test("a doctor who owns no account gets a new one planned, named from the company", () => {
  const users = [doctor("u1", { seazonaClientId: "C1", seazonaAccountNumber: "1324", companyName: "Smile Co" })];
  const p = plan({ users, accounts: [] });
  assert.deepEqual(p.createAccounts, [{ accountId: "new1", ownerId: "u1", name: "Smile Co", accountNumber: "1324", legacyClientKey: "C1" }]);
  assert.deepEqual(p.addMemberships, [{ userId: "u1", accountId: "new1", role: "owner" }]);
  assert.equal(p.practiceOfUser.get("u1"), "new1");
});

test("approved doctor without a client id -> own account marked client", () => {
  const p = plan({ users: [doctor("u1")], accounts: [account("a1", "u1")] });
  assert.deepEqual(p.markClient, ["a1"]);
  assert.deepEqual(p.setFields, [], "no key and no number, nothing to copy");
  assert.equal(p.practiceOfUser.get("u1"), "a1");
});

test("shopper accounts are never marked client", () => {
  const shopper = { id: "s1", role: "user", approvalStatus: "not_required", status: "active", seazonaClientId: null, createdAt: day(1) };
  const pending = doctor("u9", { approvalStatus: "pending" });
  const rejectedWithLink = doctor("u8", { approvalStatus: "rejected", seazonaClientId: "C8" });
  const p = plan({ users: [shopper, pending, rejectedWithLink], accounts: [account("a1", "s1"), account("a9", "u9"), account("a8", "u8")] });
  assert.deepEqual(p.markClient, []);
  assert.deepEqual(p.createAccounts, []);
  assert.equal(p.practiceOfUser.size, 0);
});

test("empty duplicate personal account is deleted; one with other active members is reported, not deleted", () => {
  const users = [doctor("u1", { seazonaClientId: "C1", createdAt: day(1) }), doctor("u2", { seazonaClientId: "C1", createdAt: day(2) }), doctor("u3", { seazonaClientId: "C1", createdAt: day(3) })];
  const accounts = [account("a1", "u1"), account("a2", "u2"), account("a3", "u3")];
  const memberships = [owner("u1", "a1"), owner("u2", "a2"), owner("u3", "a3"), { userId: "x9", accountId: "a3", role: "member", status: "active" }];
  const p = plan({ users, accounts, memberships });
  assert.deepEqual(p.deleteAccounts, ["a2"]);
  assert.deepEqual(p.reportShared, ["a3"]);
});

test("account number copied from the owner's seazona account number, and the client key set", () => {
  const users = [doctor("u1", { seazonaClientId: "C1", seazonaAccountNumber: " 1324 " })];
  const p = plan({ users, accounts: [account("a1", "u1")] });
  assert.deepEqual(p.setFields, [{ accountId: "a1", accountNumber: "1324", legacyClientKey: "C1" }]);
});

test("an account number already held by another account is not copied (unique index)", () => {
  const users = [doctor("u1", { seazonaClientId: "C1", seazonaAccountNumber: "1324" })];
  const accounts = [account("a1", "u1"), account("a7", "u7", { accountNumber: "1324" })];
  assert.deepEqual(plan({ users, accounts }).setFields, [{ accountId: "a1", accountNumber: null, legacyClientKey: "C1" }]);
});

test("re-running on the planned result plans nothing", () => {
  const users = [
    doctor("u1", { seazonaClientId: "C1", seazonaAccountNumber: "1", createdAt: day(1) }), doctor("u2", { seazonaClientId: "C1", createdAt: day(2) }),
    doctor("u3", { seazonaClientId: "C2", seazonaAccountNumber: "2" }), doctor("u4"),
    doctor("u5", { seazonaClientId: "C1", createdAt: day(3) }),
  ];
  const accounts = [account("a1", "u1"), account("a2", "u2"), account("a4", "u4"), account("a5", "u5")];
  const memberships = [owner("u1", "a1"), owner("u2", "a2"), owner("u4", "a4"), owner("u5", "a5"), { userId: "x", accountId: "a5", role: "member", status: "active" }];
  const first = plan({ users, accounts, memberships });
  assert.ok(first.markClient.length && first.addMemberships.length && first.deleteAccounts.length && first.createAccounts.length);
  const again = plan(applyPlan(first, { users, accounts, memberships }));
  for (const key of ["markClient", "setFields", "addMemberships", "deleteAccounts", "createAccounts"]) assert.deepEqual(again[key], [], key);
  assert.deepEqual([...again.practiceOfUser], [...first.practiceOfUser]);
});

// ---- writer ----

const sqlText = (q) => (q?.queryChunks ?? []).map((c) => (typeof c === "string" ? c : c?.value ? c.value.join("") : c?.queryChunks ? sqlText(c) : "")).join("");
const emptyPlan = () => ({
  markClient: [], setFields: [], addMemberships: [], deleteAccounts: [], reportShared: [], createAccounts: [],
  practiceOfUser: new Map(), accountByLegacyKey: new Map(), stampOfUser: new Map(), conflicts: [], blockedKeys: [],
});
const executed = (tx) => tx.log.filter((e) => e.op === "execute");

test("party keys rewritten only for practice:<legacy key> rows", async () => {
  const tx = fakeTx();
  await writePracticeBackfill({ ...emptyPlan(), accountByLegacyKey: new Map([["C1", "a1"]]) }, tx);
  const texts = executed(tx).map((e) => sqlText(e.q));
  const pickups = texts.find((t) => /update pickups/i.test(t));
  const threads = texts.find((t) => /update message_threads/i.test(t));
  assert.match(pickups, /where[\s\S]*party_key = /i);
  assert.match(threads, /where[\s\S]*party_key = /i);
  const values = JSON.stringify(executed(tx).map((e) => e.q.queryChunks));
  assert.ok(values.includes("practice:C1") && values.includes("practice:a1"));
  assert.ok(!/user:/.test(values), "no user: key is touched without a practiceOfUser entry");
});

test("a practice doctor's own user:<id> keys move to their practice; nobody else's user: key is touched", async () => {
  const tx = fakeTx({ executes: [[], [], [], [], { count: 2 }, { count: 3 }] });
  const p = { ...emptyPlan(), practiceOfUser: new Map([["u1", "a1"], ["u2", "a1"]]), stampOfUser: new Map([["u9", "a1"]]) };
  const counts = await writePracticeBackfill(p, tx);
  const rewrites = executed(tx).filter((e) => /update (pickups|message_threads)/i.test(sqlText(e.q)));
  assert.equal(rewrites.length, 2, "one statement per table, in the same transaction");
  for (const e of rewrites) {
    assert.match(sqlText(e.q), /where t\.party_key = m\.old_key/i, "exact key match only");
    const values = JSON.stringify(e.q.queryChunks);
    assert.ok(values.includes("user:u1") && values.includes("user:u2") && values.includes("practice:a1"));
    assert.ok(!values.includes("user:u9"), "a stamped former doctor has no practice of their own: their key stays");
  }
  assert.equal(counts.userKeyPickups, 2);
  assert.equal(counts.userKeyMessageThreads, 3);
  assert.equal(counts.pickups, 0, "legacy practice: keys counted apart");
  // Idempotent: a re-run matches no row (the keys are gone), and an empty practiceOfUser runs no rewrite at all.
  const again = await writePracticeBackfill(p, fakeTx({ executes: [[], [], [], [], { count: 0 }, { count: 0 }] }));
  assert.equal(again.userKeyPickups + again.userKeyMessageThreads, 0);
  const none = fakeTx();
  await writePracticeBackfill({ ...emptyPlan(), stampOfUser: new Map([["u9", "a1"]]) }, none);
  assert.ok(!executed(none).some((e) => /party_key/i.test(sqlText(e.q))));
});

test("account_id filled only where null", async () => {
  const tx = fakeTx();
  await writePracticeBackfill({ ...emptyPlan(), practiceOfUser: new Map([["u1", "a1"]]) }, tx);
  const texts = executed(tx).map((e) => sqlText(e.q));
  for (const table of ["rx_cases", "lab_orders", "invoices"]) {
    const stmt = texts.find((t) => new RegExp(`update ${table}\\b`, "i").test(t));
    assert.match(stmt, /account_id is null/i, table);
  }
  assert.match(texts.find((t) => /update rx_cases/i.test(t)), /user_id/);
  assert.match(texts.find((t) => /update invoices/i.test(t)), /client_user_id/);
  assert.match(texts.find((t) => /update statement_sends/i.test(t)), /subject_key = ''/);
});

test("the writer applies the plan's rows and returns counts", async () => {
  const tx = fakeTx();
  const counts = await writePracticeBackfill({
    ...emptyPlan(), markClient: ["a1"], setFields: [{ accountId: "a1", accountNumber: "1", legacyClientKey: "C1" }],
    addMemberships: [{ userId: "u2", accountId: "a1", role: "admin" }], deleteAccounts: ["a2"], reportShared: ["a3"],
    createAccounts: [{ accountId: "n1", ownerId: "u9", name: "Co", accountNumber: null, legacyClientKey: "C9" }],
  }, tx);
  assert.equal(tx.log.filter((e) => e.op === "insert").length, 2, "new account + memberships");
  assert.deepEqual(counts, { createdAccounts: 1, markedClient: 1, fieldsSet: 1, membershipsAdded: 1, accountsDeleted: 1, sharedReported: 1, conflicts: 0, blockedKeys: 0, rxCases: 0, labOrders: 0, invoices: 0, pickups: 0, messageThreads: 0, userKeyPickups: 0, userKeyMessageThreads: 0, statementSends: 0 });
});

test("the CLI dry run writes nothing and prints counts only", async () => {
  const { main } = await import("./backfill-practices-cli.js");
  const out = [];
  let transacted = false;
  const rows = [
    [{ id: "u1", seazonaClientId: "C1", seazonaAccountNumber: "9", role: "doctor", approvalStatus: "approved", status: "active", createdAt: day(1), companyName: "Secret Dental" }],
    [], [],
  ];
  const db = { ...fakeTx({ selects: rows }), transaction: async () => { transacted = true; } };
  assert.equal(await main([], { db, print: (l) => out.push(l) }), 0);
  assert.equal(transacted, false);
  assert.ok(out.join("\n").includes('"accountsToCreate":1'));
  assert.ok(!out.join("\n").includes("Secret Dental") && !out.join("\n").includes("u1"));
});

test("a deleted doctor with a client id still has their records stamped with the practice; a pending doctor without one does not", async () => {
  const gone = doctor("u2", { seazonaClientId: "C1", status: "deleted", createdAt: day(2) });
  const pendingNoKey = doctor("u3", { approvalStatus: "pending" });
  const p = plan({ users: [doctor("u1", { seazonaClientId: "C1" }), gone, pendingNoKey], accounts: [account("a1", "u1")] });
  assert.equal(p.stampOfUser.get("u2"), "a1");
  assert.equal(p.stampOfUser.has("u3"), false);
  assert.equal(p.practiceOfUser.has("u2"), false, "no membership or practiceOfUser entry for an ineligible doctor");
  assert.deepEqual(p.addMemberships.filter((m) => m.userId === "u2"), []);
  const tx = fakeTx();
  await writePracticeBackfill(p, tx);
  const values = JSON.stringify(tx.log.filter((e) => e.op === "execute").map((e) => e.q.queryChunks));
  assert.ok(values.includes('"u2"'), "u2's records are stamped");
  assert.ok(!values.includes('"u3"'));
});

test("an existing different account number or client key is never overwritten; it is reported", () => {
  const users = [doctor("u1", { seazonaClientId: "C1", seazonaAccountNumber: "NEW" })];
  const p = plan({ users, accounts: [account("a1", "u1", { accountNumber: "OLD", legacyClientKey: "OTHER" })] });
  assert.deepEqual(p.setFields, []);
  assert.deepEqual(p.conflicts.map((c) => c.field).sort(), ["account_number", "legacy_client_key"]);
  assert.equal(p.accountByLegacyKey.has("C1"), false, "party keys are not rewritten onto a mismatched account");
});

test("a non-active account holding the client id blocks the key: skipped and reported, no collision", () => {
  const users = [doctor("u1", { seazonaClientId: "C1" }), doctor("u2", { seazonaClientId: "C2" })];
  const accounts = [account("a1", "u1"), account("dead", "u9", { status: "deleted", legacyClientKey: "C1" })];
  const p = plan({ users, accounts });
  assert.deepEqual(p.blockedKeys, ["C1"]);
  assert.deepEqual(p.setFields, []);
  assert.deepEqual(p.createAccounts.map((c) => [c.ownerId, c.legacyClientKey]), [["u2", "C2"]]);
  const blockedCreate = plan({ users: [doctor("u5", { seazonaClientId: "C1" })], accounts: [accounts[1]] });
  assert.equal(blockedCreate.createAccounts[0].legacyClientKey, null);
});

test("an orphaned former doctor (no eligible doctor shares the client id) is neither stamped nor given a practice", () => {
  const orphan = doctor("u9", { seazonaClientId: "C9", status: "deleted" });
  const blank = doctor("u8", { seazonaClientId: "  ", approvalStatus: "pending" });
  const p = plan({ users: [doctor("u1", { seazonaClientId: "C1" }), orphan, blank], accounts: [account("a1", "u1")] });
  assert.equal(p.stampOfUser.has("u9"), false);
  assert.equal(p.stampOfUser.has("u8"), false);
  assert.equal(p.accountByLegacyKey.has("C9"), false);
});
