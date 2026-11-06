import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { practiceForNewRecord, directPracticeIdsQuery } from "./practice-of.js";
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

// Rendered through the real drizzle query builder (no connection is made: toSQL never executes).
const realDb = drizzle(postgres("postgresql://x@localhost/none"));
const renderedSql = () => directPracticeIdsQuery(realDb, "u1").toSQL();

test("the lookup is limited to the owner's ACTIVE memberships in ACTIVE client accounts (each filter pinned in the rendered SQL)", () => {
  const { sql, params } = renderedSql();
  assert.match(sql, /"memberships"\."user_id" = \$1/);
  assert.match(sql, /"memberships"\."status" = \$2/);
  assert.match(sql, /"accounts"\."status" = \$3/);
  assert.match(sql, /"accounts"\."is_client" = \$4/);
  assert.deepEqual(params, ["u1", "active", "active", true]);
  assert.match(sql, /inner join "accounts" on "accounts"\."id" = "memberships"\."account_id"/);
});

test("directOnly: false is not supported yet and says so", async () => {
  await assert.rejects(practiceForNewRecord(db("a1"), { ownerUserId: "u1", directOnly: false }), /directOnly/);
});
