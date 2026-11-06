import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";
import { setAccountNumber, addMember, setMemberRole, removeMember, listMembers } from "./practices.service.js";

const PRACTICE = { id: "a1", ownerId: "owner1" };
const audits = () => { const log = []; return { log, audit: (e) => log.push(e) }; };
const ops = (tx, op) => tx.log.filter((e) => e.op === op);

test("add member re-activates a removed membership", async () => {
  const tx = fakeTx({ selects: [[PRACTICE], [{ id: "u9" }], [{ id: "m1", userId: "u9", role: "member", status: "removed" }]] });
  const { log, audit } = audits();
  await addMember("a1", { userId: "u9", role: "viewer" }, "admin1", tx, audit);
  assert.equal(ops(tx, "insert").length, 0, "no second row");
  assert.deepEqual({ role: ops(tx, "update")[0].values.role, status: ops(tx, "update")[0].values.status }, { role: "viewer", status: "active" });
  assert.equal(log[0].action, "practice.member_added");
});

test("a new login gets a membership row", async () => {
  const tx = fakeTx({ selects: [[PRACTICE], [{ id: "u9" }], []] });
  await addMember("a1", { userId: "u9", role: "member" }, "admin1", tx, () => {});
  assert.equal(ops(tx, "insert")[0].values.role, "member");
});

test("cannot assign owner", async () => {
  const tx = fakeTx();
  await assert.rejects(() => addMember("a1", { userId: "u9", role: "owner" }, "admin1", tx, () => {}), { statusCode: 422, code: "INVALID_ROLE" });
  await assert.rejects(() => setMemberRole("a1", "u9", "owner", "admin1", tx, () => {}), { code: "INVALID_ROLE" });
  assert.equal(ops(tx, "update").length + ops(tx, "insert").length, 0);
});

test("cannot remove the owner, by role or as the account's recorded owner", async () => {
  for (const row of [{ id: "m1", userId: "u2", role: "owner" }, { id: "m2", userId: "owner1", role: "admin" }]) {
    const tx = fakeTx({ selects: [[PRACTICE], [row]] });
    await assert.rejects(() => removeMember("a1", row.userId, "admin1", tx, () => {}), { statusCode: 422, code: "OWNER_PROTECTED" });
    assert.equal(ops(tx, "update").length, 0);
  }
  const tx = fakeTx({ selects: [[PRACTICE], [{ id: "m1", userId: "u2", role: "owner" }]] });
  await assert.rejects(() => setMemberRole("a1", "u2", "viewer", "admin1", tx, () => {}), { code: "OWNER_PROTECTED" });
});

test("remove sets status removed and role change updates the role", async () => {
  const tx = fakeTx({ selects: [[PRACTICE], [{ id: "m1", userId: "u2", role: "member" }], [PRACTICE], [{ id: "m1", userId: "u2", role: "member" }]] });
  await removeMember("a1", "u2", "admin1", tx, () => {});
  await setMemberRole("a1", "u2", "admin", "admin1", tx, () => {});
  const [first, second] = ops(tx, "update");
  assert.equal(first.values.status, "removed");
  assert.equal(second.values.role, "admin");
});

test("account number clash is a 409", async () => {
  const tx = fakeTx({ selects: [[PRACTICE], [{ id: "a2" }]] });
  await assert.rejects(() => setAccountNumber("a1", " 100 ", "admin1", tx, () => {}), { statusCode: 409, code: "ACCOUNT_NUMBER_TAKEN" });
  assert.equal(ops(tx, "update").length, 0);
});

test("a unique-index race on the number is also a 409", async () => {
  const tx = fakeTx({ selects: [[PRACTICE], []] });
  tx.update = () => { throw Object.assign(new Error("dup"), { code: "23505" }); };
  await assert.rejects(() => setAccountNumber("a1", "100", "admin1", tx, () => {}), { code: "ACCOUNT_NUMBER_TAKEN" });
});

test("setting the number trims it, an empty value clears it", async () => {
  const tx = fakeTx({ selects: [[PRACTICE], [], [PRACTICE]] });
  assert.deepEqual(await setAccountNumber("a1", " 100 ", "admin1", tx, () => {}), { id: "a1", accountNumber: "100" });
  assert.deepEqual(await setAccountNumber("a1", "  ", "admin1", tx, () => {}), { id: "a1", accountNumber: null });
});

test("a missing or non-client practice is a 404", async () => {
  const tx = fakeTx({ selects: [[]] });
  await assert.rejects(() => listMembers("nope", tx), { statusCode: 404 });
});

test("audit metadata ids only", async () => {
  const { log, audit } = audits();
  const tx = fakeTx({ selects: [[PRACTICE], [], [PRACTICE], [{ id: "m1", userId: "u2", role: "member" }], [PRACTICE], [{ id: "m1", userId: "u2", role: "admin" }], [PRACTICE], [{ id: "u2" }], []] });
  await setAccountNumber("a1", "5551234", "admin1", tx, audit);
  await setMemberRole("a1", "u2", "admin", "admin1", tx, audit);
  await removeMember("a1", "u2", "admin1", tx, audit);
  await addMember("a1", { userId: "u2", role: "member" }, "admin1", tx, audit);
  assert.deepEqual(log.map((e) => e.action), ["practice.account_number_set", "practice.member_role_changed", "practice.member_removed", "practice.member_added"]);
  const allowed = new Set(["accountId", "userId", "role"]);
  for (const e of log) {
    assert.equal(e.userId, "admin1");
    for (const k of Object.keys(e.metadata)) assert.ok(allowed.has(k), `${e.action} leaks ${k}`);
    assert.ok(!JSON.stringify(e).includes("5551234"), "the number itself is not logged");
  }
});

test("list members labels the owner", async () => {
  const tx = fakeTx({ selects: [[PRACTICE], [{ userId: "owner1", role: "admin", name: "O", email: "o@x" }, { userId: "u2", role: "viewer", name: null, email: "v@x" }]] });
  const rows = await listMembers("a1", tx);
  assert.deepEqual(rows.map((r) => r.isOwner), [true, false]);
});
