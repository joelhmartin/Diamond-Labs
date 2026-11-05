import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../config/database.js";
import { users, memberships, accounts } from "../db/schema/index.js";
import { resolveClientPrices } from "../lib/pricing.js";
import { groupBySignature } from "../lib/same-pricing.js";
import { loadStates } from "./price-copy.service.js";

/**
 * Clients (approved doctors) grouped by identical effective prices, resolved through
 * the one rule (resolveClientPrices) from batched loads: a fixed number of queries
 * however many clients there are. Singletons are dropped unless `includeSingles`.
 * Piece 9 wraps this in a report definition.
 * -> { groups: [{ signature, size, clients: [{ id, name, accountNumber, practice }], lists: [names], overrideCount }] }
 */
export async function sameClientPricingGroups(database = db, { includeSingles = false } = {}) {
  const clientRows = await database
    .select({ id: users.id, name: users.name, email: users.email, accountNumber: users.seazonaAccountNumber })
    .from(users)
    .where(and(eq(users.role, "doctor"), eq(users.approvalStatus, "approved")))
    .orderBy(asc(sql`lower(coalesce(${users.name}, ${users.email}))`));
  if (clientRows.length === 0) return { groups: [] };
  const ids = clientRows.map((c) => c.id);

  const { states, lists } = await loadStates(database, ids);
  const inputs = clientRows.map((c) => {
    const s = states.get(c.id);
    const live = s.listIds.filter((id) => !s.archivedListIds.has(id)).map((id) => lists.get(id));
    return {
      id: c.id,
      effective: resolveClientPrices({ overrides: s.overrides, lists: live }),
      listNames: live.map((l) => l.name),
      overrideCount: s.overrides.size,
    };
  });
  const groups = groupBySignature(inputs).filter((g) => includeSingles || g.size > 1);
  if (groups.length === 0) return { groups: [] };

  const wanted = new Set(groups.flatMap((g) => g.clientIds));
  const practiceRows = await database
    .select({ userId: memberships.userId, practice: accounts.name })
    .from(memberships)
    .innerJoin(accounts, eq(accounts.id, memberships.accountId))
    .where(and(inArray(memberships.userId, [...wanted]), eq(memberships.status, "active")));
  const practice = new Map();
  for (const p of practiceRows) if (!practice.has(p.userId)) practice.set(p.userId, p.practice);

  const byId = new Map(clientRows.map((c) => [c.id, c]));
  return {
    groups: groups.map(({ clientIds, ...g }) => ({
      ...g,
      clients: clientIds.map((id) => {
        const c = byId.get(id);
        return { id, name: c.name || c.email, accountNumber: c.accountNumber ?? null, practice: practice.get(id) ?? null };
      }),
    })),
  };
}
