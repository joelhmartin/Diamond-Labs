/**
 * The staff practice picker (listPractices memberUserId) must offer exactly the
 * practices practiceForNewRecord would accept for that login. Replaces a regex
 * over practices.service.js source: this runs both against real rows.
 * Opt-in real Postgres (never diamond_labs):
 *   SCRATCH_DB_SERVER_URL=postgresql://bif@localhost:5432/postgres npx vitest run src/services/practices-picker.test.js
 */
import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import { createScratchDb } from "../test/scratch-db.js";
import { users, accounts, memberships } from "../db/schema/index.js";
import { listPractices } from "./practices.service.js";
import { practiceForNewRecord } from "./practice-of.js";

const scratch = createScratchDb({ prefix: "practices_picker", label: "practices-picker" });
afterAll(scratch.drop);

test.skipIf(!scratch.enabled)("memberUserId lists exactly the practices a new record could be created for", async () => {
  const { db } = await scratch.open();
  await db.insert(users).values([
    { id: "u1", email: "u1@example.test", name: "U One" },
    { id: "u2", email: "u2@example.test", name: "U Two" },
  ]);
  const acct = (id, over = {}) => ({ id, name: `Practice ${id}`, slug: `p-${id}`, ownerId: "u2", isClient: true, ...over });
  await db.insert(accounts).values([
    acct("ok"), // active client, active membership: offered
    acct("susp-member"), // membership suspended: not offered
    acct("susp-acct", { status: "suspended" }), // account suspended: not offered
    acct("not-client", { isClient: false }), // not a client account: not offered
    acct("stranger"), // no membership at all: not offered
  ]);
  const m = (accountId, status = "active") => ({ id: `m-${accountId}`, userId: "u1", accountId, status });
  await db.insert(memberships).values([m("ok"), m("susp-member", "suspended"), m("susp-acct"), m("not-client")]);

  const { rows } = await listPractices({ memberUserId: "u1" }, db);
  assert.deepEqual(rows.map((r) => r.id), ["ok"]);
  // The validator agrees: the one offered practice is the default, and every filtered-out one is refused.
  assert.equal(await practiceForNewRecord(db, { ownerUserId: "u1" }), "ok");
  for (const id of ["susp-member", "susp-acct", "not-client", "stranger"]) {
    await assert.rejects(practiceForNewRecord(db, { ownerUserId: "u1", requestedAccountId: id }), (e) => e.code === "NOT_FOUND");
  }
});
