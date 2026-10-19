import { and, eq, inArray, ne } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE } from "@my-app/shared";
import { db } from "../../config/database.js";
import { invoices, invoicePayments, labOrders, users, doctorProfiles } from "../../db/schema/index.js";
import { openReceivableInvoices } from "./ledger.service.js";
import { buildReceivables } from "./aging.js";
import { buildStatementModel } from "./statement-model.js";
import { renderStatementPdf } from "./billing-pdf.js";

/**
 * Statements and accounts receivable. A "client" is a doctor user; guest shop
 * invoices (no client) never reach a statement or the AR page.
 */

/** The doctor's bill-to and ship-to block (statements, invoices, the Ship form), or null when the user isn't a doctor. */
export async function loadClient(clientUserId, database = db) {
  const [row] = await database
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, accountNumber: users.seazonaAccountNumber, profile: doctorProfiles })
    .from(users)
    .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
    .where(eq(users.id, clientUserId));
  if (!row || row.role !== "doctor") return null;
  const p = row.profile;
  return {
    id: row.id, name: row.name, email: row.email, accountNumber: row.accountNumber ?? null,
    practice: p?.companyName ?? null, address1: p?.address1 ?? null, address2: p?.address2 ?? null,
    city: p?.city ?? null, state: p?.state ?? null, zip: p?.zip ?? null,
    phone: p?.phone ?? null, deliveryMethod: p?.deliveryMethod ?? null, deliveryNotes: p?.deliveryNotes ?? null,
  };
}

/** Every money event on these clients' invoices (statement-model's `activity`). Drafts carry none. */
export async function loadStatementActivity(clientUserIds, database = db) {
  const invs = await database
    .select({
      id: invoices.id, invoiceNumber: invoices.invoiceNumber, status: invoices.status, totalCents: invoices.totalCents,
      issuedAt: invoices.issuedAt, voidedAt: invoices.voidedAt, dueDate: invoices.dueDate, labOrderNumber: labOrders.orderNumber,
    })
    .from(invoices)
    .leftJoin(labOrders, eq(labOrders.id, invoices.labOrderId))
    .where(and(inArray(invoices.clientUserId, clientUserIds), ne(invoices.status, "draft")));
  const ids = invs.map((i) => i.id);
  const payments = ids.length
    ? await database
        .select({
          invoiceId: invoicePayments.invoiceId, invoiceNumber: invoicePayments.invoiceNumber, appliedCents: invoicePayments.appliedCents,
          source: invoicePayments.source, paidOn: invoicePayments.paidOn, createdAt: invoicePayments.createdAt,
        })
        .from(invoicePayments)
        .where(inArray(invoicePayments.invoiceId, ids))
    : [];
  return { invoices: invs, payments };
}

/**
 * A statement for a month, billed to `clientUserId`, covering `clientUserIds`:
 * just that doctor (admin), or their whole practice (a doctor's own download;
 * Spec correction 6). Null when the user isn't a doctor.
 */
export async function statementFor(clientUserId, month, { generatedAt = new Date(), clientUserIds = [clientUserId] } = {}, database = db) {
  const client = await loadClient(clientUserId, database);
  if (!client) return null;
  const model = buildStatementModel(client, await loadStatementActivity(clientUserIds, database), { month }, { generatedAt });
  return { client, model };
}

/** The statement PDF (built on request, never stored), or null when the user isn't a doctor. */
export async function statementPdfFor(clientUserId, month, { clientUserIds } = {}, database = db) {
  const out = await statementFor(clientUserId, month, { clientUserIds }, database);
  return out ? { model: out.model, pdf: await renderStatementPdf(out.model) } : null;
}

/**
 * Admin › Accounts receivable as of the lab's today: every issued client
 * invoice, its balance from the ledger's one paid-sum and balance rule
 * (deriveBalance, summed in SQL by openReceivableInvoices), aged and grouped per client (clientUserId). Grouping by
 * practice where seazonaClientId is shared is deferred to piece 5's practice
 * entity: every row action (invoice filter, statement PDF, statement email)
 * is per user today. Spec correction 6.
 */
export async function listReceivables({ pastDueOnly = false } = {}, database = db) {
  const open = await openReceivableInvoices(database);
  const ids = [...new Set(open.map((i) => i.clientUserId))];
  const clients = ids.length
    ? await database
        .select({ id: users.id, name: users.name, accountNumber: users.seazonaAccountNumber, practice: doctorProfiles.companyName })
        .from(users)
        .leftJoin(doctorProfiles, eq(doctorProfiles.userId, users.id))
        .where(inArray(users.id, ids))
    : [];
  return buildReceivables(open, new Map(clients.map((c) => [c.id, c])), isoDateIn(LAB_TIMEZONE, new Date()), { pastDueOnly });
}
