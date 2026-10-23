import { and, asc, eq } from "drizzle-orm";
import { isoDateIn, LAB_TIMEZONE, SHOP_PAYMENT_SOURCE } from "@my-app/shared";
import { env } from "../../config/env.js";
import { PRICING } from "../../config/pricing.js";
import { invoices, invoiceLines, invoicePayments, labOrders, labOrderLines } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { allocateSequenceNumber, INVOICE_NUMBER_LOCK } from "../sequence.service.js";
import { priceLabOrderLines } from "../pricing.service.js";
import * as auditService from "../audit.service.js";
import { sealInvoice, openInvoice, sealLine, openLine } from "./invoice-crypto.js";
import { planDraftInvoice, planShopInvoice, asRemakeLines, hasUnpriced, planIssue, planVoid, InvoiceError, assertShipmentCharge, planShipmentLine, planShipmentLineRemoval } from "./invoice-rules.js";

/**
 * Invoice writes. Every function here runs inside the CALLER's transaction:
 * lab-orders.service.js creates, issues and voids invoices in the same
 * transaction as the job change that causes them, so a job and its bill
 * can't disagree. Rules live in invoice-rules.js; this file only loads, plans
 * and writes. Audit rows are written through the same transaction.
 */

// Serialises invoice-number allocation (the id lives in services/sequence.service.js).
export { INVOICE_NUMBER_LOCK };

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
    // An order imported at cutover (piece 5) was billed by the old system; that
    // bill is its imported legacy invoice. Never draft a second one.
    if (labOrder.source === "legacy") return { issued: false, reason: "legacy" };
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

/** Apply a patch to an invoice only if its version is still the one read (else 409 STALE). */
export async function commitPatch(tx, invoice, patch) {
  const [updated] = await tx
    .update(invoices)
    .set(sealInvoice(patch))
    .where(and(eq(invoices.id, invoice.id), eq(invoices.version, invoice.version)))
    .returning();
  if (!updated) throw new InvoiceError("STALE", "This invoice changed — reload.");
  return openInvoice(updated);
}

/**
 * Write one planned line change on a locked draft: the line operation, the
 * recomputed totals (only if the version is still the one read, else 409
 * STALE) and the audit row. THE tail every line edit shares: staff edits
 * (invoice-actions editDraft) and shipment lines below.
 */
export async function applyLinePlan(tx, invoice, plan, byUserId) {
  if (plan.op.insert) await tx.insert(invoiceLines).values(sealLine({ ...plan.op.insert, id: createId() }));
  if (plan.op.update) await tx.update(invoiceLines).set(sealLine(plan.op.update.values)).where(eq(invoiceLines.id, plan.op.update.id));
  if (plan.op.delete) await tx.delete(invoiceLines).where(eq(invoiceLines.id, plan.op.delete));
  const updated = await commitPatch(tx, invoice, plan.patch);
  await auditInvoice(tx, "invoice.edited", invoice, byUserId, plan.audit);
  return updated;
}

/**
 * A new shipment's shipping line on its order's draft, in the CALLER's
 * transaction (lab-shipping.service persistShipment). No invoice, or one that
 * is no longer a draft, adds nothing and says why; the caller notes it for staff.
 * A null/invalid charge ("charge unknown") throws INVALID before touching the DB.
 */
export async function addShipmentLine(tx, { labOrderId, shipmentId, description, unitCents, byUserId = null }) {
  assertShipmentCharge(unitCents);
  const invoice = await invoiceForLabOrder(tx, labOrderId);
  if (!invoice) return { added: false, reason: "no_invoice" };
  if (invoice.status !== "draft") return { added: false, reason: "not_draft", invoiceNumber: invoice.invoiceNumber };
  const plan = planShipmentLine(invoice, await loadLines(tx, invoice.id), {
    shipmentId, description, unitCents, now: new Date(), taxRateBps: PRICING.taxRateBps,
  });
  await applyLinePlan(tx, invoice, plan, byUserId);
  return { added: true, invoiceNumber: invoice.invoiceNumber };
}

/**
 * A voided shipment -> remove the line(s) it added, from every invoice that is
 * still a draft. By design only ONE invoice per shipment gets a shipping line
 * (lab-shipping picks the lowest-numbered non-remake order), but removal does
 * not rely on that: each draft is planned, version-checked, totalled and audited
 * on its own; non-drafts are skipped and reported.
 * Returns { removed: <count>, invoiceNumbers, skipped: [{ invoiceNumber, reason }], reason? }.
 */
export async function removeShipmentLine(tx, { shipmentId, byUserId = null }) {
  const rows = await tx.select({ invoiceId: invoiceLines.invoiceId }).from(invoiceLines).where(eq(invoiceLines.shipmentId, shipmentId));
  if (!rows.length) return { removed: 0, invoiceNumbers: [], skipped: [], reason: "no_line" };
  const invoiceNumbers = [];
  const skipped = [];
  for (const invoiceId of new Set(rows.map((r) => r.invoiceId))) {
    const [row] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    const invoice = openInvoice(row);
    if (invoice.status !== "draft") {
      skipped.push({ invoiceNumber: invoice.invoiceNumber, reason: "not_draft" });
      continue;
    }
    const plan = planShipmentLineRemoval(invoice, await loadLines(tx, invoice.id), shipmentId, { now: new Date(), taxRateBps: PRICING.taxRateBps });
    await applyLinePlan(tx, invoice, plan, byUserId); // plan is non-null: a line with this shipmentId exists on it
    invoiceNumbers.push(invoice.invoiceNumber);
  }
  return { removed: invoiceNumbers.length, invoiceNumbers, skipped, ...(invoiceNumbers.length ? {} : { reason: "not_draft" }) };
}
