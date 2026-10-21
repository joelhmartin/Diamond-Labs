import { and, eq, isNull, sql } from "drizzle-orm";
import { users, accounts, memberships, doctorProfiles } from "../db/schema/index.js";
import { planClients, existingFromRows } from "./map-clients.js";
import { problemList } from "./problems.js";
import { withLoadLock } from "./load-lock.js";

/**
 * `import:load clients`: raw-store clients → doctors. Dry run (live=false)
 * reports counts and Seazona ids only. A live run writes the plan in one
 * transaction (a few hundred rows). The plan is read BEFORE the transaction, so
 * run this step inside the write freeze (runbook, T16). The load reads ALL users (any role): an
 * email already used by a shopper is linked, not duplicated. Re-runnable: linked clients are skipped,
 * a link only fills an empty seazonaClientId, profiles never overwrite. A live run holds the
 * target's load lock (`lock`, load-lock.js) like every other live load step.
 */
export async function loadClients({ raw, db, live, noEmail = "placeholder", now = new Date(), lock = null }) {
  return withLoadLock({ lock, live, step: "clients" }, (guard) => run({ raw, db, live, noEmail, now, guard }));
}

async function run({ raw, db, live, noEmail, now, guard }) {
  const clients = (await raw.records("client")).map((r) => r.payload);
  const userRows = await db
    .select({ id: users.id, email: users.email, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber, role: users.role, approvalStatus: users.approvalStatus, emailVerifiedAt: users.emailVerifiedAt, status: users.status, createdAt: users.createdAt })
    .from(users);
  const slugRows = await db.select({ slug: accounts.slug }).from(accounts);
  const profileRows = await db.select({ userId: doctorProfiles.userId }).from(doctorProfiles);
  const plan = planClients(clients, existingFromRows(userRows, slugRows, profileRows), { noEmail, now });

  const counts = {
    seazonaClients: clients.length,
    create: plan.create.length,
    placeholders: plan.create.filter((c) => c.user.status === "suspended").length,
    link: plan.link.length,
    profiles: plan.profiles.length,
    alreadyLinked: plan.skipped.alreadyLinked,
    placeholderNowHasEmail: plan.skipped.placeholderNowHasEmail.length,
  };
  const skipped = plan.skipped;
  const problemsFor = (linkSkipped) => problemList([
    ["no_email_skipped", skipped.noEmail],
    ["email_already_linked_to_another_client", skipped.emailTaken],
    ["email_matches_unverified_or_non_doctor_user", skipped.emailNotLinkable],
    ["email_differs_only_by_case_between_users", skipped.emailCaseAmbiguous],
    ["account_number_mismatch_kept_existing", skipped.accountMismatch],
    ["placeholder_login_client_now_has_email", skipped.placeholderNowHasEmail],
    ["link_skipped_already_linked", linkSkipped],
  ]);
  if (!live) return { step: "clients", live, counts, problems: problemsFor([]) };

  guard();
  const linkSkipped = [];
  const notLinked = new Set();
  let profilesToWrite = [];
  let profilesInserted = 0;
  await db.transaction(async (tx) => {
    for (const c of plan.create) {
      await tx.insert(users).values(c.user);
      await tx.insert(accounts).values(c.account);
      await tx.insert(memberships).values(c.membership);
    }
    for (const l of plan.link) {
      // Guarded: only an unlinked user, and an existing account number is kept.
      const rows = await tx.update(users)
        .set({
          seazonaClientId: l.seazonaClientId,
          seazonaAccountNumber: sql`coalesce(${users.seazonaAccountNumber}, ${l.seazonaAccountNumber})`,
          updatedAt: now,
        })
        .where(and(eq(users.id, l.userId), isNull(users.seazonaClientId)))
        .returning({ id: users.id });
      if (rows.length === 0) { linkSkipped.push(l.seazonaClientId); notLinked.add(l.userId); }
    }
    profilesToWrite = plan.profiles.filter((x) => !notLinked.has(x.userId));
    for (const p of profilesToWrite) {
      const res = await tx.insert(doctorProfiles).values(p).onConflictDoNothing().returning({ id: doctorProfiles.id });
      profilesInserted += res.length;
    }
  });
  // Counts reflect what happened, not what was planned.
  counts.link = plan.link.length - linkSkipped.length;
  counts.profiles = profilesInserted;
  return { step: "clients", live, counts, problems: problemsFor(linkSkipped) };
}
