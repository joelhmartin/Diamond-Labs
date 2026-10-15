import { test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

vi.mock("../config/database.js", () => ({
  db: { insert: () => { throw new Error("the global db must not be used when a transaction is passed"); } },
}));

const { log } = await import("./audit.service.js");

test("log writes through the transaction it is given, so the row commits or rolls back with the change", async () => {
  const rows = [];
  const tx = { insert: () => ({ values: async (v) => { rows.push(v); } }) };
  await log({ userId: "u1", action: "invoice.issued", targetType: "invoice", targetId: "inv1", metadata: { invoiceNumber: 500001 } }, tx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].action, "invoice.issued");
  assert.deepEqual(rows[0].metadata, { invoiceNumber: 500001 });
});
