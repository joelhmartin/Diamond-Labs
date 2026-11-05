import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../config/database.js";
import { users, doctorProfiles } from "../db/schema/index.js";
import { resolveClientPrices } from "../lib/pricing.js";
import { groupBySignature } from "../lib/same-pricing.js";
import { loadClientPriceStates } from "./pricing.service.js";

/**
 * Clients (approved doctors) grouped by identical effective prices, resolved through
 * the one rule (resolveClientPrices) from batched loads: a fixed number of queries
 * however many clients there are. Singletons are dropped unless `includeSingles`.
 * Piece 9 wraps this in a report definition.
 * -> { groups: [{ signature, size, clients: [{ id, name, accountNumber, practice }], lists: [names], overrideCount }] }
 */
export async function sameClientPricingGroups(database = db, { includeSingles = false } = {}) {
  const clientRows = await database
    .select({ id: users.id, name: users.name, email: users.email, accountNumber: users.seazonaAccountNumber, practice: doctorProfiles.companyName })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id)) // the billing surfaces' practice name
    .where(and(eq(users.role, "doctor"), eq(users.approvalStatus, "approved")))
    .orderBy(asc(sql`lower(coalesce(${users.name}, ${users.email}))`));
  if (clientRows.length === 0) return { groups: [] };
  const ids = clientRows.map((c) => c.id);

  const { states } = await loadClientPriceStates(database, ids);
  const inputs = clientRows.map((c) => {
    const s = states.get(c.id);
    return {
      id: c.id,
      effective: resolveClientPrices({ overrides: s.overrides, lists: s.liveLists }),
      listNames: s.liveLists.map((l) => l.name),
      overrideCount: s.overrides.size,
    };
  });
  const groups = groupBySignature(inputs).filter((g) => includeSingles || g.size > 1);
  if (groups.length === 0) return { groups: [] };

  const byId = new Map(clientRows.map((c) => [c.id, c]));
  return {
    groups: groups.map(({ clientIds, ...g }) => ({
      ...g,
      clients: clientIds.map((id) => {
        const c = byId.get(id);
        return { id, name: c.name || c.email, accountNumber: c.accountNumber ?? null, practice: c.practice ?? null };
      }),
    })),
  };
}
