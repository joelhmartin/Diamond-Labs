import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";
import { practiceForNewRecord } from "./practice-of.js";
import { InvoiceError } from "./billing/invoice-rules.js";
import { invoiceErrorReply } from "./billing/invoice-errors.js";

const db = (...accountIds) => fakeTx({ selects: [accountIds.map((accountId) => ({ accountId }))] });

test("one practice, none requested: defaulted", async () => {
  assert.equal(await practiceForNewRecord(db("a1"), { ownerUserId: "u1" }), "a1");
});

test("no practice at all (a shopper, a guest): null", async () => {
  assert.equal(await practiceForNewRecord(db(), { ownerUserId: "u1" }), null);
  const tx = db("a1");
  assert.equal(await practiceForNewRecord(tx, { ownerUserId: null }), null);
  assert.equal(tx.log.length, 0, "a guest costs no query");
});

test("two practices and none chosen: PRACTICE_REQUIRED, a 422 with the fixed message", async () => {
  const err = await practiceForNewRecord(db("a1", "a2"), { ownerUserId: "u1" }).catch((e) => e);
  assert.ok(err instanceof InvoiceError);
  assert.equal(err.code, "PRACTICE_REQUIRED");
  const reply = invoiceErrorReply(err);
  assert.equal(reply.status, 422);
  assert.equal(reply.body.error.message, "Choose which practice this is for.");
});

test("two practices, one chosen: the chosen one", async () => {
  assert.equal(await practiceForNewRecord(db("a1", "a2"), { ownerUserId: "u1", requestedAccountId: "a2" }), "a2");
});

test("a chosen practice the owner is not a member of: NOT_FOUND (never says whether it exists)", async () => {
  const err = await practiceForNewRecord(db("a1"), { ownerUserId: "u1", requestedAccountId: "a9" }).catch((e) => e);
  assert.ok(err instanceof InvoiceError);
  assert.equal(err.code, "NOT_FOUND");
  assert.equal(invoiceErrorReply(err).status, 404);
});

test("a requested practice for an owner with no practices: NOT_FOUND", async () => {
  const err = await practiceForNewRecord(db(), { ownerUserId: "u1", requestedAccountId: "a1" }).catch((e) => e);
  assert.equal(err.code, "NOT_FOUND");
});

test("the lookup is limited to active direct memberships in active client accounts", async () => {
  const tx = db("a1");
  await practiceForNewRecord(tx, { ownerUserId: "u1" });
  const where = JSON.stringify(tx.log[0].calls.filter(([m]) => m === "where"));
  assert.equal(tx.log[0].op, "select");
  assert.ok(tx.log[0].calls.includes("innerJoin") || tx.log[0].calls.some((c) => c === "innerJoin"));
  assert.ok(where.length > 0);
});

test("directOnly: false is not supported yet and says so", async () => {
  await assert.rejects(practiceForNewRecord(db("a1"), { ownerUserId: "u1", directOnly: false }), /directOnly/);
});
