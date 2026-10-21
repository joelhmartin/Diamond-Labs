import { and, eq, isNull } from "drizzle-orm";
import { users, accounts, memberships, doctorProfiles } from "../db/schema/index.js";
import { planClients, existingFromRows } from "./map-clients.js";
import { problemList } from "./problems.js";

/**
 * `import:load clients`: raw-store clients → doctors. Dry run (live=false)
 * reports counts and Seazona ids only. A live run writes the plan in one
 * transaction (a few hundred rows). The load reads ALL users (any role): an
 * email already used by a shopper is linked, not duplicated. Re-runnable: linked clients are skipped,
 * a link only fills an empty seazonaClientId, profiles never overwrite.
 */
export async function loadClients({ raw, db, live, noEmail = "placeholder", now = new Date() }) {
  const clients = (await raw.records("client")).map((r) => r.payload);
  const userRows = await db
    .select({ id: users.id, email: users.email, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber, createdAt: users.createdAt })
    .from(users);
  const slugRows = await db.select({ slug: accounts.slug }).from(accounts);
  const profileRows = await db.select({ userId: doctorProfiles.userId }).from(doctorProfiles);
  const plan = planClients(clients, existingFromRows(userRows, slugRows, profileRows), { noEmail, now });

  const report = {
    step: "clients",
    live,
    counts: {
      seazonaClients: clients.length,
      create: plan.create.length,
      placeholders: plan.create.filter((c) => c.user.status === "suspended").length,
      link: plan.link.length,
      profiles: plan.profiles.length,
      alreadyLinked: plan.skipped.alreadyLinked,
    },
    problems: problemList([
      ["no_email_skipped", plan.skipped.noEmail],
      ["email_already_linked_to_another_client", plan.skipped.emailTaken],
    ]),
  };
  if (!live) return report;

  await db.transaction(async (tx) => {
    for (const c of plan.create) {
      await tx.insert(users).values(c.user);
      await tx.insert(accounts).values(c.account);
      await tx.insert(memberships).values(c.membership);
    }
    for (const l of plan.link) {
      await tx.update(users)
        .set({ seazonaClientId: l.seazonaClientId, seazonaAccountNumber: l.seazonaAccountNumber, updatedAt: now })
        .where(and(eq(users.id, l.userId), isNull(users.seazonaClientId)));
    }
    for (const p of plan.profiles) await tx.insert(doctorProfiles).values(p).onConflictDoNothing();
  });
  return report;
}
