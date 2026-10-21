import { test } from "vitest";
import assert from "node:assert/strict";
import { isInvoiceOwner, resolveOwners } from "./owners.js";

const base = { id: "u1", role: "doctor", approvalStatus: "approved", status: "active", emailVerifiedAt: new Date(1), hasPassword: true, createdAt: new Date(1), seazonaClientId: "c1", seazonaAccountNumber: "1" };

test("only an approved doctor that is verified, or a passwordless import shell, may own", () => {
  assert.equal(isInvoiceOwner(base), true);
  assert.equal(isInvoiceOwner({ ...base, status: "suspended", emailVerifiedAt: null, hasPassword: false }), true, "placeholder shell");
  assert.equal(isInvoiceOwner({ ...base, emailVerifiedAt: null }), false, "unverified registrant with a password");
  assert.equal(isInvoiceOwner({ ...base, approvalStatus: "pending" }), false);
  assert.equal(isInvoiceOwner({ ...base, approvalStatus: "rejected" }), false);
  assert.equal(isInvoiceOwner({ ...base, role: "user" }), false);
  assert.equal(isInvoiceOwner({ ...base, role: "admin" }), false);
  assert.equal(isInvoiceOwner({ ...base, status: "deleted" }), false);
});

test("an eligible user wins over an older ineligible one sharing the client; unowned clients are listed", () => {
  const r = resolveOwners([
    { ...base, id: "old", createdAt: new Date(0), role: "user" },
    { ...base, id: "new", createdAt: new Date(5) },
    { ...base, id: "x", seazonaClientId: "c2", seazonaAccountNumber: "2", approvalStatus: "pending" },
  ]);
  assert.equal(r.byClient.get("c1"), "new");
  assert.equal(r.byAccount.get("1"), "new");
  assert.deepEqual([...r.rejectedClients], ["c2"]);
  assert.deepEqual([...r.rejectedAccounts], ["2"]);
});

test("two eligible users sharing a client id fail closed: no owner, reported as ambiguous", () => {
  const r = resolveOwners([
    { ...base, id: "a" },
    { ...base, id: "b", createdAt: new Date(9) },
    { ...base, id: "c", seazonaClientId: "c3", seazonaAccountNumber: "3" },
  ]);
  assert.equal(r.byClient.has("c1"), false);
  assert.equal(r.byAccount.has("1"), false);
  assert.deepEqual([...r.ambiguousClients], ["c1"]);
  assert.deepEqual([...r.ambiguousAccounts], ["1"]);
  assert.equal(r.byClient.get("c3"), "c");
  assert.equal(r.rejectedClients.size, 0);
});
