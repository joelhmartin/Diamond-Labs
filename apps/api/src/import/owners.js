import { users } from "../db/schema/index.js";
import { isNotNull, or, sql } from "drizzle-orm";

/**
 * Who may own imported money records (invoices, opening balances, orders).
 * One rule for every load step. A Seazona client's records go to the doctor
 * linked to it ONLY when that user is:
 *  - a doctor, APPROVED, not deleted, and
 *  - either email-verified, or an import shell: no password and never
 *    verified (what the clients step creates, placeholders included — a
 *    suspended `.invalid` doctor exists for exactly this and cannot log in).
 * A self-registered account always has a password, so an unverified
 * registrant, a shopper, an admin, a lab user or a pending/rejected doctor
 * that carries a legacy link never receives a practice's PHI-bearing history:
 * those clients are reported (Seazona ids only) and their records get no owner.
 */
export const isInvoiceOwner = (u) =>
  u.role === "doctor" && u.approvalStatus === "approved" && u.status !== "deleted" &&
  (Boolean(u.emailVerifiedAt) || !u.hasPassword);

/** Columns resolveOwners needs. The password hash itself is never selected. */
export const OWNER_COLUMNS = {
  id: users.id, seazonaClientId: users.seazonaClientId, seazonaAccountNumber: users.seazonaAccountNumber,
  role: users.role, approvalStatus: users.approvalStatus, status: users.status,
  emailVerifiedAt: users.emailVerifiedAt, hasPassword: sql`${users.passwordHash} is not null`, createdAt: users.createdAt,
};

export const oldestFirst = (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id));

/**
 * The oldest user per value of `key` (a Seazona client id or account number),
 * among the users `include` accepts. Generic and rule-free: the owner rule is
 * resolveOwners below.
 */
export function oldestByKey(rows, key, include = () => true) {
  const out = new Map();
  for (const u of [...rows].sort(oldestFirst)) {
    const k = u[key] == null ? null : String(u[key]);
    if (k && include(u) && !out.has(k)) out.set(k, u.id);
  }
  return out;
}

/** Account numbers compare trimmed and case-insensitive on every side (export, users, opening-invoice keys). */
export const normAccount = (v) => (v == null ? null : String(v).trim().toLowerCase() || null);

function index(rows, key, norm = (v) => (v == null ? null : String(v))) {
  const eligible = new Map();
  const linked = new Set();
  for (const u of rows) {
    const k = norm(u[key]);
    if (!k) continue;
    linked.add(k);
    if (isInvoiceOwner(u)) eligible.set(k, [...(eligible.get(k) ?? []), u.id]);
  }
  const owners = new Map();
  const ambiguous = new Set();
  for (const [k, ids] of eligible) {
    if (new Set(ids).size === 1) owners.set(k, ids[0]);
    else ambiguous.add(k);
  }
  const rejected = new Set([...linked].filter((k) => !eligible.has(k)));
  return { owners, rejected, ambiguous };
}

/**
 * Users carrying a Seazona link → { byClient, byAccount, rejectedClients,
 * rejectedAccounts, ambiguousClients, ambiguousAccounts }. `rejected*` are
 * linked keys with no eligible owner; `ambiguous*` are keys shared by MORE
 * THAN ONE eligible user, which fail closed (no owner) until an admin decides.
 */
export function resolveOwners(userRows) {
  const c = index(userRows, "seazonaClientId");
  const a = index(userRows, "seazonaAccountNumber", normAccount);
  return {
    byClient: c.owners, byAccount: a.owners, rejectedClients: c.rejected, rejectedAccounts: a.rejected,
    ambiguousClients: c.ambiguous, ambiguousAccounts: a.ambiguous,
  };
}

/**
 * THE owner query for every load step that attaches money to a doctor
 * (invoices, balances, reattach): every user with a Seazona client id OR
 * account number, resolved by resolveOwners. `byAccount` keys are normAccount.
 */
export async function loadOwners(db) {
  const rows = await db.select(OWNER_COLUMNS).from(users).where(or(isNotNull(users.seazonaClientId), isNotNull(users.seazonaAccountNumber)));
  return { rows, ...resolveOwners(rows) };
}
