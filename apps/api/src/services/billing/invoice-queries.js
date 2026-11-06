import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { caseSummary } from "@my-app/shared";
import { db } from "../../config/database.js";
import { decryptField } from "../../lib/crypto.js";
import { accounts, invoices, invoiceLines, labOrders, rxCases, orders, users, doctorProfiles, auditLog } from "../../db/schema/index.js";
import { decryptRxPhi } from "../rx/phi-crypto.js";
import { initialsFor } from "../lab/lab-order-rules.js";
import { withBalances, ledgerRowsForInvoice } from "./ledger.service.js";
import { openInvoice, openLine } from "./invoice-crypto.js";
import { pageOf, containsPattern, prefixPattern } from "../../lib/list-query.js";

/**
 * Invoice reads for the doctor and admin screens. Balances always come from
 * withBalances (ledger + deriveBalance). The patient's name is decrypted for
 * the detail view and PDF only; lists carry initials. Callers must never log
 * a detail result (it carries PHI).
 */

export const INVOICE_LIST_LIMIT = 500;

const client = alias(users, "client");
const actor = alias(users, "actor");

function patientInitials(row) {
  if (!row.patientFirst && !row.patientLast) return null;
  try {
    return initialsFor(caseSummary(decryptRxPhi({ patientFirst: row.patientFirst, patientLast: row.patientLast })).patientName);
  } catch {
    return null; // an undecryptable name shows as "—", it never fails the list
  }
}

/** Initials from a sealed patient field (a legacy invoice's legacy_patient, a staff order's patient_name); null when none or unreadable. */
function sealedInitials(sealed) {
  if (!sealed) return null;
  try {
    return initialsFor(decryptField(sealed));
  } catch {
    return null;
  }
}

/** A legacy line shows its Seazona text (opened) as its description; every other line is unchanged. */
const presentLine = ({ legacyDescription, ...line }) => (legacyDescription ? { ...line, description: legacyDescription } : line);

/**
 * The one WHERE for Admin › Invoices, used by the page query and the total.
 * `q`: digits match the invoice number prefix; text matches the client's
 * practice (doctor profile company) and doctor name, both plaintext. Patient
 * names are encrypted and never searched.
 */
export function invoiceListWhere(filters = {}) {
  const conds = [];
  if (filters.status) conds.push(eq(invoices.status, filters.status));
  if (filters.clientUserId) conds.push(eq(invoices.clientUserId, filters.clientUserId));
  if (filters.number) conds.push(eq(invoices.invoiceNumber, filters.number));
  // "Needs a price or lines": a draft that shipping would hold (invoices.service issueForShippedLabOrder).
  if (filters.needsPrice) {
    conds.push(eq(invoices.status, "draft"));
    conds.push(sql`(exists (select 1 from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id} and ${invoiceLines.priceSource} = 'unpriced')
      or not exists (select 1 from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id} and ${invoiceLines.kind} = 'item'))`);
  }
  if (filters.q) {
    conds.push(/^\d+$/.test(filters.q)
      ? sql`${invoices.invoiceNumber}::text like ${prefixPattern(filters.q)}`
      : or(ilike(doctorProfiles.companyName, containsPattern(filters.q)), ilike(client.name, containsPattern(filters.q))));
  }
  return conds.length ? and(...conds) : undefined;
}

/**
 * Admin › Invoices: newest first, filtered on the server. Without `limit` the
 * list is capped (INVOICE_LIST_LIMIT, `truncated`); with `limit`/`offset` it is
 * one page plus `total` (every match).
 */
export async function listInvoices(filters = {}, database = db) {
  const page = pageOf(filters);
  const where = invoiceListWhere(filters);
  const rowsQuery = database
    .select({ invoice: invoices, clientName: client.name, practice: doctorProfiles.companyName, labOrderNumber: labOrders.orderNumber })
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .where(where)
    .orderBy(desc(invoices.invoiceNumber));
  const [rows, total] = page
    ? await Promise.all([rowsQuery.limit(page.limit).offset(page.offset), countInvoices(where, database)])
    : [await rowsQuery.limit(INVOICE_LIST_LIMIT), null];
  const ids = rows.map((r) => r.invoice.id);
  // One read of the page's item lines: which have an unpriced one, which have any at all.
  const itemRows = ids.length
    ? await database
        .selectDistinct({ id: invoiceLines.invoiceId, priceSource: invoiceLines.priceSource })
        .from(invoiceLines)
        .where(and(inArray(invoiceLines.invoiceId, ids), eq(invoiceLines.kind, "item")))
    : [];
  const unpriced = new Set(itemRows.filter((r) => r.priceSource === "unpriced").map((r) => r.id));
  const withItems = new Set(itemRows.map((r) => r.id));
  const balanced = await withBalances(rows.map((r) => r.invoice), database);
  const out = {
    invoices: balanced.map((inv, i) => ({
      id: inv.id, invoiceNumber: inv.invoiceNumber, kind: inv.kind, status: inv.status,
      clientUserId: inv.clientUserId, clientName: rows[i].clientName ?? null, practice: rows[i].practice ?? null,
      labOrderId: inv.labOrderId, labOrderNumber: rows[i].labOrderNumber ?? null,
      issuedAt: inv.issuedAt, dueDate: inv.dueDate, totalCents: inv.totalCents, paidCents: inv.paidCents, balanceCents: inv.balanceCents,
      // A draft with no item line is held at ship like an unpriced one (noLines tells the screen which).
      noLines: inv.status === "draft" && !withItems.has(inv.id),
      needsPrice: unpriced.has(inv.id) || (inv.status === "draft" && !withItems.has(inv.id)),
    })),
  };
  return page ? { ...out, total } : { ...out, truncated: rows.length >= INVOICE_LIST_LIMIT };
}

/** count(*) over the same joins and WHERE as the list (the search reads the client and profile). */
async function countInvoices(where, database) {
  const [{ n }] = await database
    .select({ n: sql`count(*)`.mapWith(Number) })
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .where(where);
  return n;
}

/**
 * A client's invoices for a set of practices (client accounts), newest first:
 * the portal list, read through the login's scope (requestedAccounts in
 * client-scope-rules.js). Each row names its practice (accountId,
 * accountName, accountNumber). Doctors get issued and void ones
 * (includeDrafts false). No accounts, no query. What a payment can be applied
 * to is ledger.openInvoicesForAccounts, not this.
 * @param {string[]} accountIds
 */
export async function listClientInvoices(accountIds, { includeDrafts = false } = {}, database = db) {
  if (!accountIds?.length) return [];
  return listInvoiceRows(inArray(invoices.accountId, accountIds), { includeDrafts }, database);
}

/** One client user's invoices, drafts included on request (Admin: the client drawer and Record payment). Staff only. */
export function listInvoicesForClientUser(clientUserId, { includeDrafts = false } = {}, database = db) {
  return listInvoiceRows(eq(invoices.clientUserId, clientUserId), { includeDrafts }, database);
}

async function listInvoiceRows(scopeWhere, { includeDrafts }, database) {
  const conds = [scopeWhere];
  if (!includeDrafts) conds.push(ne(invoices.status, "draft"));
  const rows = await database
    .select({
      invoice: invoices, labOrderNumber: labOrders.orderNumber, caseNumber: rxCases.caseNumber,
      patientFirst: rxCases.patientFirst, patientLast: rxCases.patientLast, staffPatient: labOrders.patientName,
      accountName: accounts.name, accountNumber: accounts.accountNumber,
    })
    .from(invoices)
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .leftJoin(rxCases, and(eq(labOrders.source, "rx_case"), eq(rxCases.id, labOrders.sourceId)))
    .leftJoin(accounts, eq(accounts.id, invoices.accountId))
    .where(and(...conds))
    .orderBy(desc(invoices.invoiceNumber));
  const balanced = await withBalances(rows.map((r) => r.invoice), database);
  return balanced.map((inv, i) => ({
    id: inv.id, invoiceNumber: inv.invoiceNumber, kind: inv.kind, status: inv.status,
    accountId: inv.accountId ?? null, accountName: rows[i].accountName ?? null, accountNumber: rows[i].accountNumber ?? null,
    labOrderNumber: rows[i].labOrderNumber ?? null, caseNumber: rows[i].caseNumber ?? null,
    patientInitials: patientInitials(rows[i]) ?? sealedInitials(rows[i].staffPatient) ?? sealedInitials(rows[i].invoice.legacyPatient),
    issuedAt: inv.issuedAt, dueDate: inv.dueDate,
    totalCents: inv.totalCents, paidCents: inv.paidCents, balanceCents: inv.balanceCents,
  }));
}

async function labOrderBlock(labOrderId, database) {
  const [lo] = await database
    .select({
      id: labOrders.id, orderNumber: labOrders.orderNumber, source: labOrders.source, sourceId: labOrders.sourceId,
      status: labOrders.status, isRemake: labOrders.isRemake, patientName: labOrders.patientName,
    })
    .from(labOrders)
    .where(eq(labOrders.id, labOrderId));
  if (!lo) return null;
  const { sourceId, patientName: sealedPatient, ...rest } = lo;
  if (lo.source === "staff") {
    // A staff-entered order carries its own patient (sealed patient_name); there is no case or shop order.
    return { ...rest, caseNumber: null, patientName: sealedPatient ? decryptField(sealedPatient) : null, shopOrderNumber: null };
  }
  if (lo.source === "rx_case") {
    const [c] = await database
      .select({ caseNumber: rxCases.caseNumber, patientFirst: rxCases.patientFirst, patientLast: rxCases.patientLast })
      .from(rxCases)
      .where(eq(rxCases.id, sourceId));
    return { ...rest, caseNumber: c?.caseNumber ?? null, patientName: c ? caseSummary(decryptRxPhi(c)).patientName : null, shopOrderNumber: null };
  }
  const [o] = await database.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.id, sourceId));
  return { ...rest, caseNumber: null, patientName: null, shopOrderNumber: o?.orderNumber ?? null };
}

async function invoiceActivity(invoiceId, database) {
  const rows = await database
    .select({ id: auditLog.id, action: auditLog.action, metadata: auditLog.metadata, createdAt: auditLog.createdAt, actorName: actor.name })
    .from(auditLog)
    .leftJoin(actor, eq(actor.id, auditLog.userId))
    .where(and(eq(auditLog.targetType, "invoice"), eq(auditLog.targetId, invoiceId), ne(auditLog.action, "invoice.read")))
    .orderBy(asc(auditLog.createdAt));
  return rows.map((r) => ({ ...r, actorName: r.actorName ?? null, metadata: r.metadata ?? {} }));
}

/**
 * Everything the detail page and the invoice PDF need, decrypted. Throws on
 * a decrypt failure; routes turn that into a generic 500 and never echo it.
 * `invoice.accountId` is the practice the client scope checks (canActOnInvoice).
 */
export async function getInvoiceDetail(id, { withActivity = false } = {}, database = db) {
  const [row] = await database
    .select({
      invoice: invoices, clientName: client.name, clientEmail: client.email,
      accountNumber: client.seazonaAccountNumber, profile: doctorProfiles,
    })
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .where(eq(invoices.id, id));
  if (!row) return null;
  const [invoice] = await withBalances([openInvoice(row.invoice)], database);
  const lines = (await database.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position))).map(openLine).map(presentLine);
  const payments = await ledgerRowsForInvoice(id, database);
  const labOrder = invoice.labOrderId ? await labOrderBlock(invoice.labOrderId, database) : null;
  const p = row.profile;
  const clientBlock = invoice.clientUserId
    ? {
        id: invoice.clientUserId, name: row.clientName ?? null, email: row.clientEmail ?? null, accountNumber: row.accountNumber ?? null,
        practice: p?.companyName ?? null, address1: p?.address1 ?? null, address2: p?.address2 ?? null,
        city: p?.city ?? null, state: p?.state ?? null, zip: p?.zip ?? null,
      }
    : null;
  return {
    invoice, lines, payments, labOrder, client: clientBlock,
    ...(withActivity ? { activity: await invoiceActivity(id, database) } : {}),
  };
}
