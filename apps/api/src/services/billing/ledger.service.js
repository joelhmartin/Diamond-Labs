import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, SHOP_PAYMENT_SOURCE, sortOldestFirst } from "@my-app/shared";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../config/database.js";
import { invoices, invoicePayments, users } from "../../db/schema/index.js";
import { summarizePayments } from "../../lib/payment-summary.js";
import { deriveBalance, canActOnInvoice } from "./invoice-rules.js";
import { openLedgerRow } from "./invoice-crypto.js";

/**
 * The invoice ledger's read side. Paid is the SUM of an invoice's
 * invoice_payments rows (payments and credits positive, refunds negative);
 * the balance comes from deriveBalance (invoice-rules.js), the one rule every
 * screen and money path uses. Every read THROWS on a DB error: invoices and
 * the ledger share one database, so there is no partial answer worth showing,
 * and a money path must fail closed.
 */

/** @returns {Promise<Map<string, number>>} invoiceId → paid cents */
export async function paidCentsByInvoice(invoiceIds, database = db) {
  const ids = [...new Set(invoiceIds.map(String))];
  if (ids.length === 0) return new Map();
  const rows = await database
    .select({ invoiceId: invoicePayments.invoiceId, paid: sql`coalesce(sum(${invoicePayments.appliedCents}), 0)` })
    .from(invoicePayments)
    .where(inArray(invoicePayments.invoiceId, ids))
    .groupBy(invoicePayments.invoiceId);
  return new Map(rows.map((r) => [r.invoiceId, Number(r.paid)]));
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
      id: invoices.id, clientUserId: invoices.clientUserId, status: invoices.status, totalCents: invoices.totalCents, dueDate: invoices.dueDate,
      paid: sql`${paidSql}`.as("paid_cents"),
    })
    .from(invoices)
    .leftJoin(totals, eq(totals.invoiceId, invoices.id))
    .where(and(eq(invoices.status, "issued"), isNotNull(invoices.clientUserId), sql`${invoices.totalCents} - ${paidSql} > 0`));
  return rows
    .map(({ paid, ...inv }) => ({ ...inv, ...deriveBalance(inv, Number(paid)) }))
    .filter((i) => i.balanceCents > 0);
}

const owner = alias(users, "owner");

/**
 * The doctors whose invoices `user` may see and pay: everyone sharing the
 * user's non-null seazonaClientId (one practice), else just the user. Always
 * includes the user. See canActOnInvoice (Spec correction 6).
 */
export async function practiceUserIds(user, database = db) {
  if (!user?.seazonaClientId) return [user.id];
  const rows = await database
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.seazonaClientId, String(user.seazonaClientId)), eq(users.role, "doctor")));
  return [...new Set([...rows.map((r) => r.id), user.id])];
}

/**
 * What a payment by (or for) `client` can be applied to: the practice's
 * issued invoices that still owe, oldest due first (undated last), each with
 * its lab-local issue date. Filtered through canActOnInvoice, the same rule
 * verifyAllocations enforces.
 * @param {{ id: string, seazonaClientId?: string|null }} client
 */
export async function openInvoicesForClient(client, database = db) {
  if (!client?.id) throw new Error("invoice ledger: a client is required");
  const ids = await practiceUserIds(client, database);
  const rows = await database
    .select({
      id: invoices.id, clientUserId: invoices.clientUserId, ownerSeazonaClientId: owner.seazonaClientId, ownerName: owner.name,
      invoiceNumber: invoices.invoiceNumber, status: invoices.status,
      totalCents: invoices.totalCents, dueDate: invoices.dueDate, issuedAt: invoices.issuedAt,
    })
    .from(invoices)
    .leftJoin(owner, eq(owner.id, invoices.clientUserId))
    .where(and(inArray(invoices.clientUserId, ids), eq(invoices.status, "issued")));
  const balanced = await withBalances(rows.filter((r) => canActOnInvoice(client, r, r.ownerSeazonaClientId)), database);
  return sortOldestFirst(
    balanced
      .filter((i) => i.balanceCents > 0)
      .map((i) => ({
        id: i.id, clientUserId: i.clientUserId, ownerName: i.ownerName ?? null, invoiceNumber: i.invoiceNumber, balanceCents: i.balanceCents, dueDate: i.dueDate ?? null,
        issuedOn: isoDateIn(LAB_TIMEZONE, new Date(i.issuedAt)),
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

// A shop checkout pays an order, not a bill someone chose to pay: it stays out
// of payment history (and so out of the refund screen).
const NOT_SHOP = or(isNull(invoicePayments.source), notInArray(invoicePayments.source, [SHOP_PAYMENT_SOURCE]));

/** A doctor's own transaction-level payment history. */
export async function listPaymentsForUser(userId, database = db) {
  const rows = await database.select().from(invoicePayments).where(and(eq(invoicePayments.userId, userId), NOT_SHOP));
  return summarizePayments(rows);
}

/** Every doctor's payment history (admin), optionally for one user. */
export async function listAllPayments({ userId } = {}, database = db) {
  const where = userId ? and(eq(invoicePayments.userId, userId), NOT_SHOP) : NOT_SHOP;
  return summarizePayments(await database.select().from(invoicePayments).where(where));
}
