/**
 * ownerCouldBeMapped (the parity "records without an account" filter) run against
 * real rows. Replaces a test that matched the rendered SQL text: wording changes
 * would fail it, a wrong filter that kept the wording would not.
 * Opt-in real Postgres (never diamond_labs):
 *   SCRATCH_DB_SERVER_URL=postgresql://bif@localhost:5432/postgres npx vitest run src/import/parity-owner-mapped.test.js
 */
process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import { createScratchDb } from "../test/scratch-db.js";
import { users, accounts } from "../db/schema/index.js";

const { ownerCouldBeMapped } = await import("./parity-queries.js");

const scratch = createScratchDb({ prefix: "parity_owner", label: "parity-owner" });
afterAll(scratch.drop);

test.skipIf(!scratch.enabled)("an owner counts when an eligible doctor, or when the trimmed client id keys an active client account", async () => {
  const { db } = await scratch.open();
  const u = (id, over = {}) => ({ id, email: `${id}@example.test`, name: id, ...over });
  const doctor = { role: "doctor", approvalStatus: "approved" };
  await db.insert(users).values([
    u("doctor-ok", doctor),
    u("doctor-pending", { role: "doctor", approvalStatus: "pending" }),
    u("doctor-deleted", { ...doctor, status: "deleted" }),
    u("doctor-deleted-keyed", { ...doctor, status: "deleted", seazonaClientId: "K1" }),
    u("former-padded-key", { seazonaClientId: " K2 " }),
    u("keyed-no-account", { seazonaClientId: "K3" }),
    u("blank-key", { seazonaClientId: "   " }),
    u("key-suspended-account", { seazonaClientId: "K4" }),
    u("key-non-client-account", { seazonaClientId: "K5" }),
  ]);
  const acct = (key, over = {}) => ({ id: `a-${key}`, name: key, slug: `s-${key}`, ownerId: "doctor-ok", isClient: true, legacyClientKey: key, ...over });
  await db.insert(accounts).values([
    acct("K1"),
    acct("K2"),
    acct("K4", { status: "suspended" }),
    acct("K5", { isClient: false }),
  ]);

  const rows = await db.select({ id: users.id }).from(users).where(ownerCouldBeMapped);
  assert.deepEqual(rows.map((r) => r.id).sort(), ["doctor-deleted-keyed", "doctor-ok", "former-padded-key"]);
});
