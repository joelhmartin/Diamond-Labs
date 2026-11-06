import { test } from "vitest";
import assert from "node:assert/strict";

const { fakeTx } = await import("../../test/fake-tx.js");
const svc = await import("./statement-subjects.js");

test("subject keys are account:<id> or organization:<id>; anything else is refused", () => {
  assert.equal(svc.subjectKeyOf("account", "A1"), "account:A1");
  assert.equal(svc.subjectKeyOf("organization", "G1"), "organization:G1");
  for (const bad of ["", undefined, "user:1", "account:", "A1"]) assert.throws(() => svc.assertSubjectKey(bad), /subject key/, String(bad));
});

test("a practice statement recipient is an active, approved doctor", () => {
  const p = (over) => ({ role: "doctor", approvalStatus: "approved", status: "active", ...over });
  assert.equal(svc.isPracticeStatementRecipient(p()), true);
  assert.equal(svc.isPracticeStatementRecipient(p({ role: "user" })), false, "office staff");
  assert.equal(svc.isPracticeStatementRecipient(p({ approvalStatus: "pending" })), false);
  assert.equal(svc.isPracticeStatementRecipient(p({ status: "suspended" })), false);
});

test("the admin's per-client statement is the client's one practice: none 404, several 422", async () => {
  assert.equal(await svc.singlePracticeOf("d1", fakeTx({ selects: [[{ accountId: "A1" }]] })), "A1");
  await assert.rejects(svc.singlePracticeOf("d1", fakeTx({ selects: [[]] })), (e) => e.statusCode === 404 && e.code === "NOT_FOUND");
  await assert.rejects(svc.singlePracticeOf("d1", fakeTx({ selects: [[{ accountId: "A1" }, { accountId: "A2" }]] })), (e) => e.statusCode === 422 && e.code === "PRACTICE_REQUIRED");
});

test("the run's subjects load in six queries: practices, members, groups, their practices and admins, people", async () => {
  const people = [
    { id: "d1", name: "Dr 1", email: "d1@x", role: "doctor", approvalStatus: "approved", status: "active" },
    { id: "ga", name: "Admin", email: "ga@x", role: "user", approvalStatus: "not_required", status: "active" },
  ];
  const database = fakeTx({ selects: [
    [{ id: "A1", name: "Alpha", accountNumber: null }],
    [{ accountId: "A1", userId: "d1" }, { accountId: "A1", userId: "ghost" }],
    [{ id: "G1", name: "Group", settings: { combinedStatement: true } }],
    [{ organizationId: "G1", accountId: "A1" }],
    [{ organizationId: "G1", userId: "ga" }],
    people,
  ] });
  const out = await svc.loadStatementSubjects(database);
  assert.equal(database.log.filter((l) => l.op === "select").length, 6);
  assert.deepEqual(out.accounts, [{ id: "A1", name: "Alpha", accountNumber: null }]);
  assert.deepEqual(out.members.map((m) => [m.accountId, m.userId, m.email]), [["A1", "d1", "d1@x"]], "a membership with no user row is left out");
  assert.deepEqual(out.organizations, [{ id: "G1", name: "Group", settings: { combinedStatement: true }, accountIds: ["A1"],
    admins: [{ userId: "ga", name: "Admin", email: "ga@x", role: "user", approvalStatus: "not_required", status: "active" }] }]);
});
