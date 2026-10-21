import { users } from "../db/schema/index.js";
import { sql } from "drizzle-orm";

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

const oldestFirst = (a, b) => new Date(a.createdAt) - new Date(b.createdAt) || String(a.id).localeCompare(String(b.id));

function index(rows, key) {
  const owners = new Map();
  const rejected = new Set();
  for (const u of [...rows].sort(oldestFirst)) {
    const k = u[key] == null ? null : String(u[key]);
    if (!k) continue;
    if (isInvoiceOwner(u)) { if (!owners.has(k)) owners.set(k, u.id); } else rejected.add(k);
  }
  for (const k of owners.keys()) rejected.delete(k);
  return { owners, rejected };
}

/**
 * Users carrying a Seazona link → { byClient, byAccount, rejectedClients,
 * rejectedAccounts }. `rejected*` are linked keys with no eligible owner.
 */
export function resolveOwners(userRows) {
  const c = index(userRows, "seazonaClientId");
  const a = index(userRows, "seazonaAccountNumber");
  return { byClient: c.owners, byAccount: a.owners, rejectedClients: c.rejected, rejectedAccounts: a.rejected };
}
