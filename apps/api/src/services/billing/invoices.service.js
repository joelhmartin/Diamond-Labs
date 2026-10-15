import { asc, eq } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, SHOP_PAYMENT_SOURCE } from "@my-app/shared";
import { env } from "../../config/env.js";
import { PRICING } from "../../config/pricing.js";
import { invoices, invoiceLines, invoicePayments, labOrders, labOrderLines } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { allocateSequenceNumber } from "../sequence.service.js";
import { priceLabOrderLines } from "../pricing.service.js";
import * as auditService from "../audit.service.js";
import { sealInvoice, openInvoice, sealLine, openLine } from "./invoice-crypto.js";
import { planDraftInvoice, planShopInvoice, asRemakeLines, hasUnpriced, planIssue, planVoid } from "./invoice-rules.js";

/**
 * Invoice writes. Every function here runs inside the CALLER's transaction:
 * lab-orders.service.js creates, issues and voids invoices in the same
 * transaction as the job change that causes them, so a job and its bill
 * can't disagree. Rules live in invoice-rules.js; this file only loads, plans
 * and writes. Audit rows are written through the same transaction.
 */

// Serialises invoice-number allocation (services/sequence.service.js).
export const INVOICE_NUMBER_LOCK = 7300422;

export function allocateInvoiceNumber(tx) {
  return allocateSequenceNumber(tx, {
    lockId: INVOICE_NUMBER_LOCK, table: invoices, column: invoices.invoiceNumber, start: env.INVOICE_NUMBER_START,
  });
}

async function insertInvoice(tx, { invoice, lines }) {
  await tx.insert(invoices).values(sealInvoice(invoice));
  if (lines.length) await tx.insert(invoiceLines).values(lines.map((l) => sealLine({ ...l, id: createId() })));
}

/** An audit row in the caller's transaction: ids, numbers and amounts only — never free text. */
export function auditInvoice(tx, action, invoice, byUserId, metadata = {}) {
  return auditService.log({
    userId: byUserId ?? null, action, targetType: "invoice", targetId: invoice.id,
    metadata: { invoiceNumber: invoice.invoiceNumber, ...metadata },
  }, tx);
}

export async function loadLines(tx, invoiceId) {
  const rows = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId)).orderBy(asc(invoiceLines.position));
  return rows.map(openLine);
}

/**
 * A new lab order (Rx release or remake) → its draft invoice. `lines` are the
 * lab order's inserted lines (with ids). A remake is priced at zero.
 */
export async function createDraftForLabOrder(tx, { labOrder, lines, byUserId = null }) {
  const priced = await priceLabOrderLines(lines, labOrder.clientUserId, tx);
  const plan = planDraftInvoice({
    invoiceId: createId(),
    invoiceNumber: await allocateInvoiceNumber(tx),
    labOrder,
    pricedLines: labOrder.isRemake ? asRemakeLines(priced) : priced,
    now: new Date(),
    taxRateBps: PRICING.taxRateBps,
  });
  await insertInvoice(tx, plan);
  await auditInvoice(tx, "invoice.drafted", plan.invoice, byUserId, { labOrderId: labOrder.id, unpriced: hasUnpriced(plan.lines) });
  return { id: plan.invoice.id, invoiceNumber: plan.invoice.invoiceNumber };
}

/**
 * A paid shop order's invoice: issued, and paid in full by one ledger row
 * carrying the checkout's transaction id. A guest's invoice has no client and
 * never reaches a statement.
 */
export async function createShopInvoice(tx, { labOrderId, clientUserId = null, quote, transactionId }) {
  const now = new Date();
  const plan = planShopInvoice({
    invoiceId: createId(), invoiceNumber: await allocateInvoiceNumber(tx),
    labOrderId, clientUserId, quote, now, todayIso: isoDateIn(LAB_TIMEZONE, now),
  });
  await insertInvoice(tx, plan);
  await tx.insert(invoicePayments).values({
    id: createId(),
    userId: clientUserId ?? null,
    invoiceId: plan.invoice.id,
    invoiceNumber: String(plan.invoice.invoiceNumber),
    appliedCents: plan.invoice.totalCents,
    transactionId: String(transactionId),
    source: SHOP_PAYMENT_SOURCE,
  });
  await auditInvoice(tx, "invoice.issued", plan.invoice, null, { kind: "shop", totalCents: plan.invoice.totalCents });
  return { id: plan.invoice.id, invoiceNumber: plan.invoice.invoiceNumber };
}

async function invoiceForLabOrder(tx, labOrderId) {
  const [row] = await tx.select().from(invoices).where(eq(invoices.labOrderId, labOrderId)).for("update");
  return row ? openInvoice(row) : null;
}

/**
 * A lab order moved to shipped → issue its draft, due on the lab-local ship
 * date plus INVOICE_TERMS_DAYS. An unpriced line holds it at draft (it shows
 * under Admin › Invoices "Needs a price"). A lab order released before
 * invoicing existed is drafted first, so no shipped Rx job escapes billing.
 * Callers run this in a savepoint (lab-orders.service billingFollowUp): the
 * ship itself must commit whatever happens here.
 */
export async function issueForShippedLabOrder(tx, { labOrderId, shippedAt, byUserId = null }) {
  let invoice = await invoiceForLabOrder(tx, labOrderId);
  if (!invoice) {
    const [labOrder] = await tx.select().from(labOrders).where(eq(labOrders.id, labOrderId));
    // A shop order's invoice is written at checkout; a missing one is a
    // [LAB][SHOP_ORDER_FAILED] case for the shop-lab-orders-repair sweep, not something to invent here.
    if (!labOrder || labOrder.source === "shop_order") return { issued: false, reason: "no_invoice" };
    const lines = await tx.select().from(labOrderLines).where(eq(labOrderLines.labOrderId, labOrderId)).orderBy(asc(labOrderLines.position));
    await createDraftForLabOrder(tx, { labOrder, lines, byUserId });
    invoice = await invoiceForLabOrder(tx, labOrderId);
  }
  if (invoice.status !== "draft") return { issued: false, reason: invoice.status };
  const lines = await loadLines(tx, invoice.id);
  if (hasUnpriced(lines)) {
    await auditInvoice(tx, "invoice.issue_held", invoice, byUserId, { reason: "unpriced" });
    return { issued: false, reason: "unpriced" };
  }
  const now = new Date();
  const { patch } = planIssue(invoice, lines, {
    now, termsDays: env.INVOICE_TERMS_DAYS, issueDateIso: isoDateIn(LAB_TIMEZONE, shippedAt ?? now),
  });
  await tx.update(invoices).set(patch).where(eq(invoices.id, invoice.id));
  await auditInvoice(tx, "invoice.issued", invoice, byUserId, { via: "ship", totalCents: invoice.totalCents, dueDate: patch.dueDate });
  return { issued: true, dueDate: patch.dueDate };
}

/** A lab order was cancelled → void its draft. An issued invoice is never touched here. */
export async function voidForCancelledLabOrder(tx, { labOrderId, byUserId = null }) {
  const invoice = await invoiceForLabOrder(tx, labOrderId);
  if (!invoice || invoice.status !== "draft") return { voided: false };
  const { patch } = planVoid(invoice, { paidCents: 0, reason: "Lab order cancelled", now: new Date() });
  await tx.update(invoices).set(sealInvoice(patch)).where(eq(invoices.id, invoice.id));
  await auditInvoice(tx, "invoice.voided", invoice, byUserId, { via: "cancel" });
  return { voided: true };
}
