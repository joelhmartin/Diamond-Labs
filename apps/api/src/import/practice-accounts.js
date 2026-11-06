import { and, eq, isNotNull } from "drizzle-orm";
import { accounts } from "../db/schema/index.js";

/**
 * Seazona client id (accounts.legacy_client_key) -> the practice account that
 * carries it. THE lookup every load step uses to stamp `account_id`, so
 * invoices, orders, reattach and opening balances agree. Active accounts only
 * (the key is unique among all accounts, so there is at most one). A client
 * with no entry here has no practice yet: its records load with a null
 * account_id and parity (records_without_account) reports them.
 */
export async function loadAccountsByClientKey(db) {
  const rows = await db
    .select({ id: accounts.id, key: accounts.legacyClientKey })
    .from(accounts)
    .where(and(isNotNull(accounts.legacyClientKey), eq(accounts.status, "active")));
  return new Map(rows.map((r) => [String(r.key), r.id]));
}

/** Owner user id -> the practice account of their Seazona client id (owners with none are absent). `ownerRows` is loadOwners().rows. */
export function accountByOwner(ownerRows, accountByKey) {
  const out = new Map();
  for (const u of ownerRows ?? []) {
    const account = u.seazonaClientId == null ? null : accountByKey.get(String(u.seazonaClientId));
    if (account) out.set(u.id, account);
  }
  return out;
}
