/**
 * Practice backfill CLI (piece 11). Dry run by default; --live writes in ONE
 * transaction. Idempotent. Run after `import:load clients`, before
 * `invoices` / `orders`.
 *
 *   pnpm --filter @my-app/api db:backfill-practices            # dry run
 *   pnpm --filter @my-app/api db:backfill-practices -- --live
 *
 * Prints counts only: never a name, email or any identifying value.
 */
import { eq } from "drizzle-orm";
import { parseArgs } from "../import/cli-args.js";
import { users, accounts, memberships, doctorProfiles } from "./schema/index.js";
import { planPracticeBackfill, writePracticeBackfill } from "./backfill-practices.js";

/** Rows the planner reads. Column lists are explicit so no identifying column is even loaded. */
export async function loadBackfillInputs(db) {
  const userRows = await db
    .select({
      id: users.id, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber,
      role: users.role, approvalStatus: users.approvalStatus, status: users.status, createdAt: users.createdAt,
      companyName: doctorProfiles.companyName,
    })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id));
  const accountRows = await db
    .select({
      id: accounts.id, ownerId: accounts.ownerId, name: accounts.name, status: accounts.status, isClient: accounts.isClient,
      accountNumber: accounts.accountNumber, legacyClientKey: accounts.legacyClientKey, createdAt: accounts.createdAt,
    })
    .from(accounts);
  const membershipRows = await db
    .select({ userId: memberships.userId, accountId: memberships.accountId, role: memberships.role, status: memberships.status })
    .from(memberships);
  return { users: userRows, accounts: accountRows, memberships: membershipRows };
}

/** The plan as counts, for the dry run. */
export const planCounts = (plan) => ({
  accountsToCreate: plan.createAccounts.length,
  accountsToMarkClient: plan.markClient.length,
  accountsToSetFields: plan.setFields.length,
  membershipsToAdd: plan.addMemberships.length,
  duplicateAccountsToDelete: plan.deleteAccounts.length,
  duplicateAccountsSharedReported: plan.reportShared.length,
  doctorsWithPractice: plan.practiceOfUser.size,
  formerDoctorsStamped: plan.stampOfUser.size,
  numberOrKeyConflicts: plan.conflicts.length,
  clientIdsBlockedByInactiveAccount: plan.blockedKeys.length,
});

export async function main(argv, deps = {}) {
  const { flags } = parseArgs(argv, { allowed: ["live"], booleans: ["live"] });
  const print = deps.print ?? ((line) => console.log(line));
  const database = deps.db ?? (await import("../config/database.js")).db;
  const plan = planPracticeBackfill(await loadBackfillInputs(database));
  print(`${flags.live ? "[live]" : "[dry run]"} plan: ${JSON.stringify(planCounts(plan))}`);
  if (!flags.live) {
    print("Nothing written. Re-run with --live to apply.");
    return 0;
  }
  const written = await database.transaction((tx) => writePracticeBackfill(plan, tx));
  print(`written: ${JSON.stringify(written)}`);
  print(`own user: keys moved to the doctor's practice: pickups ${written.userKeyPickups}, message threads ${written.userKeyMessageThreads}`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { queryClient } = await import("../config/database.js");
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`backfill-practices failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await queryClient.end();
  }
}
