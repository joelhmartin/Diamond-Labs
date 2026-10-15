import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { caseSummary } from "@my-app/shared";
import { db } from "../../config/database.js";
import { invoices, invoiceLines, labOrders, rxCases, orders, users, doctorProfiles, auditLog } from "../../db/schema/index.js";
import { decryptRxPhi } from "../rx/phi-crypto.js";
import { initialsFor } from "../lab/lab-order-rules.js";
import { withBalances, ledgerRowsForInvoice } from "./ledger.service.js";
import { openInvoice, openLine } from "./invoice-crypto.js";

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

/** Admin › Invoices: newest first, filtered on the server (the list is capped). */
export async function listInvoices(filters = {}, database = db) {
  const conds = [];
  if (filters.status) conds.push(eq(invoices.status, filters.status));
  if (filters.clientUserId) conds.push(eq(invoices.clientUserId, filters.clientUserId));
  if (filters.number) conds.push(eq(invoices.invoiceNumber, filters.number));
  if (filters.needsPrice) {
    conds.push(eq(invoices.status, "draft"));
    conds.push(sql`exists (select 1 from ${invoiceLines} where ${invoiceLines.invoiceId} = ${invoices.id} and ${invoiceLines.priceSource} = 'unpriced')`);
  }
  const rows = await database
    .select({ invoice: invoices, clientName: client.name, practice: doctorProfiles.companyName, labOrderNumber: labOrders.orderNumber })
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(invoices.invoiceNumber))
    .limit(INVOICE_LIST_LIMIT);
  const ids = rows.map((r) => r.invoice.id);
  const unpriced = new Set(
    ids.length
      ? (await database
          .selectDistinct({ id: invoiceLines.invoiceId })
          .from(invoiceLines)
          .where(and(inArray(invoiceLines.invoiceId, ids), eq(invoiceLines.priceSource, "unpriced")))).map((r) => r.id)
      : []
  );
  const balanced = await withBalances(rows.map((r) => r.invoice), database);
  return {
    invoices: balanced.map((inv, i) => ({
      id: inv.id, invoiceNumber: inv.invoiceNumber, kind: inv.kind, status: inv.status,
      clientUserId: inv.clientUserId, clientName: rows[i].clientName ?? null, practice: rows[i].practice ?? null,
      labOrderId: inv.labOrderId, labOrderNumber: rows[i].labOrderNumber ?? null,
      issuedAt: inv.issuedAt, dueDate: inv.dueDate, totalCents: inv.totalCents, paidCents: inv.paidCents, balanceCents: inv.balanceCents,
      needsPrice: unpriced.has(inv.id),
    })),
    truncated: rows.length >= INVOICE_LIST_LIMIT,
  };
}

/**
 * The invoices of a set of clients, newest first: one doctor (admin), or a
 * doctor's whole practice (practiceUserIds; Spec correction 6). Doctors get
 * issued and void ones (includeDrafts false). What a payment can be applied to
 * is ledger.openInvoicesForClient, not this.
 */
export async function listClientInvoices(clientUserIds, { includeDrafts = false } = {}, database = db) {
  const conds = [inArray(invoices.clientUserId, clientUserIds)];
  if (!includeDrafts) conds.push(ne(invoices.status, "draft"));
  const rows = await database
    .select({
      invoice: invoices, labOrderNumber: labOrders.orderNumber, caseNumber: rxCases.caseNumber,
      patientFirst: rxCases.patientFirst, patientLast: rxCases.patientLast,
    })
    .from(invoices)
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .leftJoin(rxCases, and(eq(labOrders.source, "rx_case"), eq(rxCases.id, labOrders.sourceId)))
    .where(and(...conds))
    .orderBy(desc(invoices.invoiceNumber));
  const balanced = await withBalances(rows.map((r) => r.invoice), database);
  const out = balanced.map((inv, i) => ({
    id: inv.id, invoiceNumber: inv.invoiceNumber, kind: inv.kind, status: inv.status,
    labOrderNumber: rows[i].labOrderNumber ?? null, caseNumber: rows[i].caseNumber ?? null,
    patientInitials: patientInitials(rows[i]),
    issuedAt: inv.issuedAt, dueDate: inv.dueDate,
    totalCents: inv.totalCents, paidCents: inv.paidCents, balanceCents: inv.balanceCents,
  }));
  return out;
}

async function labOrderBlock(labOrderId, database) {
  const [lo] = await database
    .select({
      id: labOrders.id, orderNumber: labOrders.orderNumber, source: labOrders.source, sourceId: labOrders.sourceId,
      status: labOrders.status, isRemake: labOrders.isRemake,
    })
    .from(labOrders)
    .where(eq(labOrders.id, labOrderId));
  if (!lo) return null;
  const { sourceId, ...rest } = lo;
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
 */
export async function getInvoiceDetail(id, { withActivity = false } = {}, database = db) {
  const [row] = await database
    .select({
      invoice: invoices, clientName: client.name, clientEmail: client.email,
      accountNumber: client.seazonaAccountNumber, clientSeazonaClientId: client.seazonaClientId, profile: doctorProfiles,
    })
    .from(invoices)
    .leftJoin(client, eq(client.id, invoices.clientUserId))
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, invoices.clientUserId))
    .where(eq(invoices.id, id));
  if (!row) return null;
  const [invoice] = await withBalances([openInvoice(row.invoice)], database);
  const lines = (await database.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position))).map(openLine);
  const payments = await ledgerRowsForInvoice(id, database);
  const labOrder = invoice.labOrderId ? await labOrderBlock(invoice.labOrderId, database) : null;
  const p = row.profile;
  const clientBlock = invoice.clientUserId
    ? {
        id: invoice.clientUserId, name: row.clientName ?? null, email: row.clientEmail ?? null, accountNumber: row.accountNumber ?? null,
        // The practice key, for canActOnInvoice. Never part of a doctor-facing view.
        seazonaClientId: row.clientSeazonaClientId ?? null,
        practice: p?.companyName ?? null, address1: p?.address1 ?? null, address2: p?.address2 ?? null,
        city: p?.city ?? null, state: p?.state ?? null, zip: p?.zip ?? null,
      }
    : null;
  return {
    invoice, lines, payments, labOrder, client: clientBlock,
    ...(withActivity ? { activity: await invoiceActivity(id, database) } : {}),
  };
}
