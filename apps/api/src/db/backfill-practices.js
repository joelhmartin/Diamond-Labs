/**
 * Practice-group backfill (piece 11): turns "a doctor with a Seazona client id"
 * into a practice, i.e. an `accounts` row with `is_client`. Pure planner
 * (planPracticeBackfill) plus a writer that applies the plan on a transaction
 * (writePracticeBackfill). The CLI is backfill-practices-cli.js.
 *
 * Rules (spec "Cutover / import impact"):
 *  - Eligible doctors are the import's owners (owners.js isInvoiceOwner:
 *    approved, not deleted). Shoppers, staff and pending/rejected doctors never
 *    get a client account.
 *  - One client account per Seazona client id. An active account that already
 *    carries the key (a clients-load practice) is it; otherwise the oldest
 *    active account owned by the oldest eligible linked doctor (owners.js
 *    oldestByKey). A doctor with no account gets a new one planned.
 *  - Every other doctor sharing the id becomes an `admin` member of it.
 *  - An approved doctor with no client id gets their own oldest account marked.
 *  - A doctor's other personal accounts are deleted when empty, reported when
 *    they have other active members.
 * Idempotent: the plan for an already-backfilled database is empty.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { accounts, memberships } from "./schema/index.js";
import { oldestByKey, isInvoiceOwner } from "../import/owners.js";
import { createId } from "../lib/id.js";

const MEMBER_ROLE_FOR_SHARER = "admin";
const NAME_MAX = 100;
const trimmed = (v) => (v == null ? null : String(v).trim() || null);
const byAge = (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id));

/** The group a doctor belongs to: their Seazona client id, else themselves. */
const groupKeyOf = (u) => (trimmed(u.seazonaClientId) ? `client:${trimmed(u.seazonaClientId)}` : `user:${u.id}`);

export function planPracticeBackfill({ users, accounts: accountRows, memberships: membershipRows = [], newId = createId }) {
  const plan = {
    markClient: [], setFields: [], addMemberships: [], deleteAccounts: [], reportShared: [], createAccounts: [],
    practiceOfUser: new Map(), accountByLegacyKey: new Map(),
  };
  const doctors = users.filter(isInvoiceOwner).map((u) => ({ ...u, seazonaClientId: trimmed(u.seazonaClientId) }));
  const active = accountRows.filter((a) => a.status === "active");
  const memberOf = new Set(membershipRows.map((m) => `${m.userId}|${m.accountId}`));
  const takenNumbers = new Map(accountRows.filter((a) => a.accountNumber).map((a) => [a.accountNumber, a.id]));

  const groups = new Map();
  for (const d of doctors) groups.set(groupKeyOf(d), [...(groups.get(groupKeyOf(d)) ?? []), d]);
  const oldestOfClient = oldestByKey(doctors, "seazonaClientId");
  const canonicalAccountIds = new Set();

  for (const [groupKey, members] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const clientKey = groupKey.startsWith("client:") ? groupKey.slice(7) : null;
    const leader = clientKey ? members.find((d) => d.id === oldestOfClient.get(clientKey)) : members[0];
    const keyed = clientKey ? active.filter((a) => a.legacyClientKey === clientKey).sort(byAge)[0] : null;
    let canonical = keyed ?? active.filter((a) => a.ownerId === leader.id).sort(byAge)[0] ?? null;

    if (!canonical) {
      const accountId = newId();
      const accountNumber = trimmed(leader.seazonaAccountNumber);
      const free = accountNumber && !takenNumbers.has(accountNumber) ? accountNumber : null;
      if (free) takenNumbers.set(free, accountId);
      plan.createAccounts.push({
        accountId, ownerId: leader.id, legacyClientKey: clientKey,
        name: (trimmed(leader.companyName) ?? (clientKey ? `Practice ${clientKey}` : "Practice")).slice(0, NAME_MAX),
        accountNumber: free,
      });
      canonical = { id: accountId, ownerId: leader.id };
    } else {
      if (!canonical.isClient) plan.markClient.push(canonical.id);
      const wanted = trimmed(leader.seazonaAccountNumber);
      const number = wanted && wanted !== canonical.accountNumber && !takenNumbers.has(wanted) ? wanted : null;
      const key = clientKey && clientKey !== canonical.legacyClientKey ? clientKey : null;
      if (number) takenNumbers.set(number, canonical.id);
      if (number || key) plan.setFields.push({ accountId: canonical.id, accountNumber: number, legacyClientKey: key });
    }
    canonicalAccountIds.add(canonical.id);
    if (clientKey) plan.accountByLegacyKey.set(clientKey, canonical.id);

    for (const d of members) {
      plan.practiceOfUser.set(d.id, canonical.id);
      if (!memberOf.has(`${d.id}|${canonical.id}`)) {
        plan.addMemberships.push({ userId: d.id, accountId: canonical.id, role: d.id === canonical.ownerId ? "owner" : MEMBER_ROLE_FOR_SHARER });
      }
    }
  }

  // Duplicate personal accounts: every other active, plain account a practice doctor owns.
  const doctorIds = new Set(doctors.map((d) => d.id));
  for (const a of [...active].sort(byAge)) {
    if (!doctorIds.has(a.ownerId) || canonicalAccountIds.has(a.id) || a.isClient || a.legacyClientKey) continue;
    const others = membershipRows.some((m) => m.accountId === a.id && m.status === "active" && m.userId !== a.ownerId);
    (others ? plan.reportShared : plan.deleteAccounts).push(a.id);
  }
  return plan;
}

// ---- writer ----

const affected = (res) => Number(res?.count ?? res?.rowCount ?? 0);
const pairs = (entries) => sql.join(entries.map(([a, b]) => sql`(${a}, ${b})`), sql`, `);

/**
 * Applies a plan on `tx` (the caller owns the transaction). Returns counts
 * only. Record updates touch only rows still to be mapped: `account_id` where
 * null, party keys equal to the legacy `practice:<client id>`, and
 * statement_sends whose subject_key is still ''.
 */
export async function writePracticeBackfill(plan, tx) {
  const counts = {
    createdAccounts: 0, markedClient: 0, fieldsSet: 0, membershipsAdded: 0, accountsDeleted: 0, sharedReported: plan.reportShared.length,
    rxCases: 0, labOrders: 0, invoices: 0, pickups: 0, messageThreads: 0, statementSends: 0,
  };
  if (plan.createAccounts.length) {
    await tx.insert(accounts).values(plan.createAccounts.map((c) => ({
      id: c.accountId, name: c.name, slug: `practice-${c.accountId}`, ownerId: c.ownerId, isClient: true,
      accountNumber: c.accountNumber, legacyClientKey: c.legacyClientKey,
    })));
    counts.createdAccounts = plan.createAccounts.length;
  }
  if (plan.addMemberships.length) {
    await tx.insert(memberships).values(plan.addMemberships.map((m) => ({ id: createId(), ...m, status: "active" }))).onConflictDoNothing();
    counts.membershipsAdded = plan.addMemberships.length;
  }
  for (const f of plan.setFields) {
    const set = { updatedAt: new Date(), ...(f.accountNumber ? { accountNumber: f.accountNumber } : {}), ...(f.legacyClientKey ? { legacyClientKey: f.legacyClientKey } : {}) };
    await tx.update(accounts).set(set).where(eq(accounts.id, f.accountId));
    counts.fieldsSet += 1;
  }
  if (plan.markClient.length) {
    await tx.update(accounts).set({ isClient: true, updatedAt: new Date() }).where(inArray(accounts.id, plan.markClient));
    counts.markedClient = plan.markClient.length;
  }
  if (plan.deleteAccounts.length) {
    await tx.update(accounts).set({ status: "deleted", updatedAt: new Date() }).where(and(inArray(accounts.id, plan.deleteAccounts), eq(accounts.status, "active")));
    counts.accountsDeleted = plan.deleteAccounts.length;
  }

  const users = [...plan.practiceOfUser];
  if (users.length) {
    const map = pairs(users);
    counts.rxCases = affected(await tx.execute(sql`update rx_cases t set account_id = m.account_id from (values ${map}) as m(user_id, account_id) where t.user_id = m.user_id and t.account_id is null`));
    counts.labOrders = affected(await tx.execute(sql`update lab_orders t set account_id = m.account_id from (values ${map}) as m(user_id, account_id) where t.client_user_id = m.user_id and t.account_id is null`));
    counts.invoices = affected(await tx.execute(sql`update invoices t set account_id = m.account_id from (values ${map}) as m(user_id, account_id) where t.client_user_id = m.user_id and t.account_id is null`));
    counts.statementSends = affected(await tx.execute(sql`update statement_sends t set subject_key = 'account:' || m.account_id from (values ${map}) as m(user_id, account_id) where t.client_user_id = m.user_id and t.subject_key = ''`));
  }
  const keys = [...plan.accountByLegacyKey].map(([legacy, id]) => [`practice:${legacy}`, `practice:${id}`]);
  if (keys.length) {
    const map = pairs(keys);
    counts.pickups = affected(await tx.execute(sql`update pickups t set party_key = m.new_key from (values ${map}) as m(old_key, new_key) where t.party_key = m.old_key`));
    counts.messageThreads = affected(await tx.execute(sql`update message_threads t set party_key = m.new_key from (values ${map}) as m(old_key, new_key) where t.party_key = m.old_key`));
  }
  return counts;
}
