import { and, asc, eq, getTableColumns, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, HISTORY_EXCLUDED_SOURCES, sortOldestFirst } from "@my-app/shared";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../config/database.js";
import { invoices, invoicePayments, users } from "../../db/schema/index.js";
import { summarizePayments } from "../../lib/payment-summary.js";
import { deriveBalance } from "./invoice-rules.js";
import { openLedgerRow } from "./invoice-crypto.js";
import { paidCentsFor } from "./paid-cents.js";
import { labDay, startOfLabDay, afterLabDay } from "../../lib/lab-day-sql.js";

/**
 * A ledger row's day in SQL: when a manual payment was received (staff-entered
 * paid_on), else the row's lab-local created day. The same rule as the
 * statement (statement-model.js `p.paidOn ?? labDay(p.createdAt)`).
 */
export const ledgerRowDay = sql`coalesce(${invoicePayments.paidOn}, ${labDay(invoicePayments.createdAt)})`;

/**
 * THE ledger-row-day range filter: rows whose ledgerRowDay falls in the
 * inclusive lab days `from`..`to` (either bound may be left out; neither
 * means no filter, `undefined`). Selects exactly the rows
 * `ledgerRowDay between from and to` would, but written as
 *   (paid_on in range) or (paid_on is null and created_at in the lab-day range)
 * so the paid_on and created_at indexes apply; the coalesce serves no index.
 * Use ledgerRowDay itself for SELECT / GROUP BY / ORDER BY.
 */
export function ledgerRowDayBetween({ from, to } = {}) {
  if (!from && !to) return undefined;
  const both = (parts) => sql.join(parts.filter(Boolean), sql` and `);
  const paid = both([from && sql`${invoicePayments.paidOn} >= ${from}::date`, to && sql`${invoicePayments.paidOn} <= ${to}::date`]);
  const created = both([from && sql`${invoicePayments.createdAt} >= ${startOfLabDay(from)}`, to && sql`${invoicePayments.createdAt} < ${afterLabDay(to)}`]);
  return sql`((${paid}) or (${invoicePayments.paidOn} is null and ${created}))`;
}

/**
 * The invoice ledger's read side. Paid is the SUM of an invoice's
 * invoice_payments rows (payments and credits positive, refunds negative);
 * the balance comes from deriveBalance (invoice-rules.js), the one rule every
 * screen and money path uses. Every read THROWS on a DB error: invoices and
 * the ledger share one database, so there is no partial answer worth showing,
 * and a money path must fail closed.
 */

/** @returns {Promise<Map<string, number>>} invoiceId → paid cents (the db-free sum lives in paid-cents.js, which the import tools share). */
export function paidCentsByInvoice(invoiceIds, database = db) {
  return paidCentsFor(invoiceIds, database);
}

/** Invoice rows with { paidCents, balanceCents, paid } attached. */
export async function withBalances(invoiceRows, database = db) {
  const paid = await paidCentsByInvoice(invoiceRows.map((i) => i.id), database);
  return invoiceRows.map((inv) => ({ ...inv, ...deriveBalance(inv, paid.get(inv.id) ?? 0) }));
}

/**
 * Every issued client invoice that still owes, with paid/balance attached.
 * Paid is summed in SQL (a grouped subquery joined on invoice id), so nothing
 * scales with the invoice count: no id list, no fully-paid invoice loaded.
 * The balance still comes from deriveBalance; the SQL filter only drops
 * invoices deriveBalance would report as settled.
 */
export async function openReceivableInvoices(database = db) {
  const totals = database
    .select({ invoiceId: invoicePayments.invoiceId, paid: sql`coalesce(sum(${invoicePayments.appliedCents}), 0)`.as("paid") })
    .from(invoicePayments)
    .groupBy(invoicePayments.invoiceId)
    .as("paid_totals");
  const paidSql = sql`coalesce(${totals.paid}, 0)`;
  const rows = await database
    .select({
      id: invoices.id, clientUserId: invoices.clientUserId, accountId: invoices.accountId, status: invoices.status, totalCents: invoices.totalCents, dueDate: invoices.dueDate,
      paid: sql`${paidSql}`.as("paid_cents"),
    })
    .from(invoices)
    .leftJoin(totals, eq(totals.invoiceId, invoices.id))
    .where(and(eq(invoices.status, "issued"), isNotNull(invoices.accountId), sql`${invoices.totalCents} - ${paidSql} > 0`));
  return rows
    .map(({ paid, ...inv }) => ({ ...inv, ...deriveBalance(inv, Number(paid)) }))
    .filter((i) => i.balanceCents > 0);
}

const owner = alias(users, "owner");

/**
 * What a payment can be applied to, for a set of practices (client accounts,
 * normally a login's payable scope: payableAccountIds in client-scope-rules.js):
 * their issued invoices that still owe, oldest due first (undated last), each
 * with its lab-local issue date and its account. No accounts, no query.
 * Rows are re-filtered by account in JS so the answer can never be wider than
 * the ids asked for (a null-account invoice never matches); verifyAllocations
 * enforces the same rule on the way in.
 * @param {string[]} accountIds
 */
export async function openInvoicesForAccounts(accountIds, database = db) {
  const wanted = new Set((accountIds ?? []).filter(Boolean));
  if (!wanted.size) return [];
  const rows = await database
    .select({
      id: invoices.id, clientUserId: invoices.clientUserId, accountId: invoices.accountId, ownerName: owner.name,
      invoiceNumber: invoices.invoiceNumber, status: invoices.status,
      totalCents: invoices.totalCents, dueDate: invoices.dueDate, issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .leftJoin(owner, eq(owner.id, invoices.clientUserId))
    .where(and(inArray(invoices.accountId, [...wanted]), eq(invoices.status, "issued")));
  const balanced = await withBalances(rows.filter((r) => r.accountId != null && wanted.has(r.accountId)), database);
  return sortOldestFirst(
    balanced
      .filter((i) => i.balanceCents > 0)
      .map((i) => ({
        id: i.id, clientUserId: i.clientUserId, accountId: i.accountId, ownerName: i.ownerName ?? null, invoiceNumber: i.invoiceNumber,
        balanceCents: i.balanceCents, dueDate: i.dueDate ?? null, issuedOn: isoDateIn(LAB_TIMEZONE, new Date(i.issuedAt)),
      }))
  );
}

/** An invoice's ledger rows, oldest first, with credit reasons decrypted. */
export async function ledgerRowsForInvoice(invoiceId, database = db) {
  const rows = await database
    .select()
    .from(invoicePayments)
    .where(eq(invoicePayments.invoiceId, invoiceId))
    .orderBy(asc(invoicePayments.createdAt));
  return rows.map(openLedgerRow);
}

// A shop checkout pays an order, not a bill someone chose to pay, and a
// Seazona settlement (piece 5) is bookkeeping: both stay out of payment
// history (and so out of the refund screen).
const IN_HISTORY = or(isNull(invoicePayments.source), notInArray(invoicePayments.source, HISTORY_EXCLUDED_SOURCES));

/**
 * The WHERE of a client's payment history: ledger rows whose invoice is in
 * `accountIds` (the requested practices of the scope), plus, with `includeOwn`,
 * the login's own payments wherever they went (a payer keeps seeing what their
 * card paid, even after leaving the practice). Matches nothing when neither applies.
 */
export function paymentHistoryWhere({ accountIds = [], userId, includeOwn = false }) {
  const parts = [];
  if (accountIds.length) parts.push(inArray(invoices.accountId, accountIds));
  if (includeOwn && userId) parts.push(eq(invoicePayments.userId, userId));
  return and(parts.length ? or(...parts) : sql`false`, IN_HISTORY);
}

/** A client's transaction-level payment history over their scope (paymentHistoryWhere). */
export async function listPaymentHistory({ accountIds, userId, includeOwn }, database = db) {
  const rows = await database
    .select(getTableColumns(invoicePayments))
    .from(invoicePayments)
    .leftJoin(invoices, eq(invoices.id, invoicePayments.invoiceId))
    .where(paymentHistoryWhere({ accountIds, userId, includeOwn }));
  return summarizePayments(rows);
}

/** Every doctor's payment history (admin), optionally for one user. */
export async function listAllPayments({ userId } = {}, database = db) {
  const where = userId ? and(eq(invoicePayments.userId, userId), IN_HISTORY) : IN_HISTORY;
  return summarizePayments(await database.select().from(invoicePayments).where(where));
}
