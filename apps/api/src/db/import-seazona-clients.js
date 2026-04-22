/**
 * Bulk-import Seazona clients as doctor accounts in our DB.
 *
 *   pnpm db:import-seazona
 *   DRY_RUN=1 pnpm db:import-seazona        # preview only, no writes
 *
 * For every Seazona client with a valid email address, creates:
 *   - A user (role=doctor, approvalStatus=approved, passwordHash=null,
 *     emailVerifiedAt=null) linked to the Seazona client + account number
 *   - An account (the practice) owned by that user
 *   - An owner membership binding them together
 *
 * Idempotent: existing emails and existing seazonaClientId links are skipped.
 *
 * NO EMAILS are sent. Users won't be able to log in until they complete a
 * password reset (triggered later via the admin users page).
 */
import { eq } from "drizzle-orm";
import { db, queryClient } from "../config/database.js";
import { users, accounts, memberships } from "./schema/index.js";
import { createId } from "../lib/id.js";
import { slugify } from "@my-app/shared";
import * as seazonaService from "../services/seazona.service.js";

const DRY_RUN = process.env.DRY_RUN === "1";

function extractEmail(raw) {
  if (!raw) return null;
  const first = String(raw).split(/[,;]/)[0].trim().toLowerCase();
  if (!first || !first.includes("@")) return null;
  // Cheap sanity check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first)) return null;
  return first;
}

async function uniqueSlug(base) {
  const MAX = 50; // accounts.slug is varchar(50)
  const root = (base || `account-${createId().slice(0, 8)}`).slice(0, MAX);
  let slug = root;
  let n = 0;
  while (true) {
    const hit = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.slug, slug))
      .limit(1);
    if (hit.length === 0) return slug;
    n++;
    const suffix = `-${n}`;
    slug = `${root.slice(0, MAX - suffix.length)}${suffix}`;
    if (n > 50) {
      const fallback = `-${createId().slice(0, 6)}`;
      return `${root.slice(0, MAX - fallback.length)}${fallback}`;
    }
  }
}

async function run() {
  console.log(DRY_RUN ? "DRY RUN — no writes will occur" : "Importing Seazona clients…");

  const clients = await seazonaService.listClients();
  console.log(`Fetched ${clients.length} clients from Seazona`);

  let created = 0;
  let linked = 0;          // existing user matched by email; backfilled Seazona link
  let skippedNoEmail = 0;
  let skippedAlreadyLinked = 0;
  let errors = [];

  for (const client of clients) {
    const email = extractEmail(client.email);
    if (!email) {
      skippedNoEmail++;
      continue;
    }

    try {
      // 1) Existing user by Seazona client ID → already linked, skip
      const [byLink] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.seazonaClientId, client.id))
        .limit(1);
      if (byLink) {
        skippedAlreadyLinked++;
        continue;
      }

      // 2) Existing user by email → backfill the Seazona link
      const [byEmail] = await db
        .select({ id: users.id, seazonaClientId: users.seazonaClientId })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      if (byEmail) {
        if (!byEmail.seazonaClientId) {
          if (!DRY_RUN) {
            await db
              .update(users)
              .set({
                seazonaClientId: client.id,
                seazonaAccountNumber: client.accountNumber || null,
                updatedAt: new Date(),
              })
              .where(eq(users.id, byEmail.id));
          }
          linked++;
        } else {
          skippedAlreadyLinked++;
        }
        continue;
      }

      // 3) New user
      if (DRY_RUN) {
        created++;
        continue;
      }

      const userId = createId();
      const accountId = createId();
      const displayName = client.fullName?.trim() || client.company?.trim() || email;
      const practiceName = client.company?.trim() || client.fullName?.trim() || email;
      const slug = await uniqueSlug(slugify(practiceName));

      await db.insert(users).values({
        id: userId,
        email,
        name: displayName,
        passwordHash: null,
        emailVerifiedAt: null,
        status: "active",
        role: "doctor",
        approvalStatus: "approved",
        seazonaClientId: client.id,
        seazonaAccountNumber: client.accountNumber || null,
      });

      await db.insert(accounts).values({
        id: accountId,
        name: practiceName,
        slug,
        ownerId: userId,
        plan: "pro",
        status: "active",
      });

      await db.insert(memberships).values({
        id: createId(),
        userId,
        accountId,
        role: "owner",
        status: "active",
      });

      created++;
    } catch (err) {
      errors.push({ email, clientId: client.id, message: err.message });
    }
  }

  console.log("");
  console.log(DRY_RUN ? "Would have:" : "Done.");
  console.log(`  Created:               ${created}`);
  console.log(`  Linked (existing email): ${linked}`);
  console.log(`  Skipped (no email):    ${skippedNoEmail}`);
  console.log(`  Skipped (already linked): ${skippedAlreadyLinked}`);
  if (errors.length) {
    console.log(`  Errors:                ${errors.length}`);
    for (const e of errors.slice(0, 10)) {
      console.log(`    - ${e.email} (${e.clientId}): ${e.message}`);
    }
    if (errors.length > 10) console.log(`    … and ${errors.length - 10} more`);
  }

  await queryClient.end();
}

run().catch(async (err) => {
  console.error("Seazona import failed:", err);
  try { await queryClient.end(); } catch {}
  process.exit(1);
});
