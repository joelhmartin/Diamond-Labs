import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../test/fake-tx.js";

const holder = { db: null };
vi.mock("../config/database.js", () => ({
  get db() { return holder.db; },
}));

const { requireAccount } = await import("./require-account.js");

const reply = () => ({ statusCode: null, body: null, code(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; } });
const account = { id: "a1", status: "active" };

async function run(membership) {
  holder.db = fakeTx({ selects: [[account], membership ? [membership] : []] });
  const request = { params: { accountId: "a1" }, headers: {}, user: { id: "u1" } };
  const r = reply();
  await requireAccount(request, r);
  return { request, r };
}

test("require-account refuses a removed membership with 403", async () => {
  for (const status of ["removed", "suspended"]) {
    const { request, r } = await run({ id: "m1", userId: "u1", accountId: "a1", role: "owner", status });
    assert.equal(r.statusCode, 403, status);
    assert.equal(r.body.error.code, "NOT_ACCOUNT_MEMBER");
    assert.equal(request.membership, undefined, `${status}: nothing attached`);
  }
});

test("an active membership passes and is attached; none at all is 403", async () => {
  const ok = await run({ id: "m1", userId: "u1", accountId: "a1", role: "member", status: "active" });
  assert.equal(ok.r.statusCode, null);
  assert.equal(ok.request.membership.id, "m1");
  assert.equal(ok.request.account.id, "a1");
  const none = await run(null);
  assert.equal(none.r.statusCode, 403);
});
