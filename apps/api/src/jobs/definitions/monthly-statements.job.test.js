import { test, vi } from "vitest";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// The run's reads, in order: practices, their members, groups (none, so no group-link or admin
// reads), people, invoices, payments, statement_sends. One practice owes money.
vi.mock("../../config/database.js", async () => {
  const { fakeTx } = await import("../../test/fake-tx.js");
  const issuedAt = new Date("2020-01-10T15:00:00Z");
  return {
    db: fakeTx({ selects: [
      [{ id: "A1", name: "P", accountNumber: "1" }],
      [{ accountId: "A1", userId: "d1" }],
      [],
      [{ id: "d1", name: "Dr", email: "d1@x.test", role: "doctor", approvalStatus: "approved", status: "active" }],
      [{ id: "i1", accountId: "A1", clientUserId: "d1", invoiceNumber: 1, status: "issued", totalCents: 5000, issuedAt, dueDate: "2020-02-10" }],
      [],
      [],
    ] }),
  };
});
const sendStatementNotice = vi.fn(async () => true);
vi.mock("../../services/email.service.js", () => ({ sendStatementNotice: (...a) => sendStatementNotice(...a) }));

const { db } = await import("../../config/database.js");
await import("./monthly-statements.job.js");
const { getJob } = await import("../registry.js");

test("dry-run job returns counts and sends nothing", async () => {
  const job = getJob("monthly-statements");
  assert.ok(job, "registered");
  const summary = await job.handler({ dryRun: true, log: () => {}, runId: "run1" });
  assert.equal(sendStatementNotice.mock.calls.length, 0);
  assert.deepEqual([summary.dryRun, summary.wouldSend, summary.sent], [true, 1, 0]);
  assert.equal(db.log.filter((l) => l.op === "insert" || l.op === "update").length, 0, "a dry run writes nothing");
});

test("the job is registered by the definitions index", async () => {
  const { readFileSync } = await import("node:fs");
  const index = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(index, /import "\.\/monthly-statements\.job\.js";/);
});
