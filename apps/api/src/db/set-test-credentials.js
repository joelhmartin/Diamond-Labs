/**
 * One-off TEST-credential setup. Resets the admin password and ensures a doctor
 * test account linked to the Matt Rago Seazona client (#1324) so the doctor
 * invoice-payment / card-on-file flow can be exercised end-to-end.
 *
 *   TEST_PASSWORD=admin123! node --env-file=.env apps/api/src/db/set-test-credentials.js
 *
 * Idempotent. These are TESTING credentials — rotate them before real go-live.
 */
import { eq } from "drizzle-orm";
import { db, queryClient } from "../config/database.js";
import { users, accounts, memberships } from "./schema/index.js";
import { createId } from "../lib/id.js";
import { hashPassword } from "../lib/passwords.js";

// HARD STOP in production. This script writes a known password onto a real
// doctor identity wired to a real Seazona client, and it reads the same
// DATABASE_URL as everything else — pointed at prod it opens a live account
// with a password that is committed to this repository.
if (process.env.NODE_ENV === "production") {
  throw new Error(
    "set-test-credentials refuses to run with NODE_ENV=production. " +
      "It provisions a known-password test login and must never touch a production database."
  );
}

// No default. A test password that lives in version control is a credential
// anyone who can read the repo already knows.
const PASSWORD = process.env.TEST_PASSWORD;
if (!PASSWORD) {
  throw new Error("TEST_PASSWORD is required (no default — a committed password is not a secret).");
}
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@diamondlabsortho.com").toLowerCase();
const DOCTOR_EMAIL = (process.env.DOCTOR_EMAIL || "mattrago@diamondorthoticlab.com").toLowerCase();
const MATT_RAGO_CLIENT_ID = "876bad9a-0257-49eb-bfd6-bce0a999b88a";
const MATT_RAGO_ACCT = "1324";
const DIAMOND_SLUG = "diamond-orthotic-laboratory";

async function diamondAccountId(ownerId) {
  const found = await db.select().from(accounts).where(eq(accounts.slug, DIAMOND_SLUG)).limit(1);
  if (found.length) return found[0].id;
  const id = createId();
  await db.insert(accounts).values({
    id, name: "Diamond Orthotic Laboratory", slug: DIAMOND_SLUG,
    ownerId, plan: "pro", status: "active",
  });
  return id;
}

async function ensureMembership(userId, accountId, role) {
  const m = await db.select().from(memberships)
    .where(eq(memberships.userId, userId)).limit(1);
  if (m.length) return;
  await db.insert(memberships).values({
    id: createId(), userId, accountId, role, status: "active",
  });
}

async function run() {
  const passwordHash = await hashPassword(PASSWORD);

  // ── 1. Admin: ONLY when explicitly opted in (RESET_ADMIN=1). Off by default so
  //    this script never silently changes the live admin password. "Reset" here
  //    means set the password to a known value — nothing else changes. ──
  if (process.env.RESET_ADMIN === "1") {
    let admin = (await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1))[0];
    if (!admin) {
      admin = (await db.select().from(users).where(eq(users.role, "admin")).limit(1))[0];
    }
    if (admin) {
      await db.update(users)
        .set({ passwordHash, status: "active", emailVerifiedAt: new Date(), updatedAt: new Date() })
        .where(eq(users.id, admin.id));
      console.log(`[creds] admin password reset → ${admin.email} / ${PASSWORD}`);
    } else {
      console.log("[creds] WARNING: RESET_ADMIN=1 but no admin user found.");
    }
  } else {
    console.log("[creds] admin: LEFT UNTOUCHED (set RESET_ADMIN=1 only if you want to reset it).");
  }

  // ── 2. Matt Rago doctor: find by seazonaClientId, else by email, else create ──
  let doc = (await db.select().from(users).where(eq(users.seazonaClientId, MATT_RAGO_CLIENT_ID)).limit(1))[0];
  if (!doc) doc = (await db.select().from(users).where(eq(users.email, DOCTOR_EMAIL)).limit(1))[0];

  if (doc) {
    await db.update(users).set({
      passwordHash, role: "doctor", approvalStatus: "approved", status: "active",
      emailVerifiedAt: new Date(), seazonaClientId: MATT_RAGO_CLIENT_ID,
      seazonaAccountNumber: MATT_RAGO_ACCT, updatedAt: new Date(),
    }).where(eq(users.id, doc.id));
    await ensureMembership(doc.id, await diamondAccountId(doc.id), "member");
    console.log(`[creds] doctor updated → ${doc.email} / ${PASSWORD} (Matt Rago, client ${MATT_RAGO_CLIENT_ID})`);
  } else {
    const id = createId();
    await db.insert(users).values({
      id, email: DOCTOR_EMAIL, name: "Matt Rago", passwordHash,
      emailVerifiedAt: new Date(), status: "active",
      role: "doctor", approvalStatus: "approved",
      seazonaClientId: MATT_RAGO_CLIENT_ID, seazonaAccountNumber: MATT_RAGO_ACCT,
    });
    await ensureMembership(id, await diamondAccountId(id), "member");
    console.log(`[creds] doctor created → ${DOCTOR_EMAIL} / ${PASSWORD} (Matt Rago, client ${MATT_RAGO_CLIENT_ID})`);
  }

  console.log("[creds] done.");
}

run()
  .catch((err) => { console.error("[creds] FAILED:", err); process.exitCode = 1; })
  .finally(async () => { await queryClient.end({ timeout: 5 }).catch(() => {}); });
