import { INVOICE_LINE_KINDS, allocateOldestFirst } from "@my-app/shared";
import { assertCents, formatCents, mulCents, pctOfCents, sumCents } from "../../lib/money.js";

/**
 * Pure invoice rules: totals, the draft → issued → void lifecycle, draft edit
 * planning and the balance rule. No DB and no clock (callers pass ids and
 * `now`), so every rule is unit-tested here and invoices.service.js only runs
 * the plans inside transactions.
 */

export class InvoiceError extends Error {
  /**
   * @param {"NOT_FOUND"|"STALE"|"LOCKED"|"INVALID"|"INVALID_TRANSITION"|"REASON_REQUIRED"|"OVERPAY"} code
   * @param {string} message  safe to show staff
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "InvoiceError";
    this.code = code;
    Object.assign(this, extra);
  }
}

const MAX_QTY = 999;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "YYYY-MM-DD" plus n calendar days (date arithmetic in UTC, so no DST drift). */
export function addDaysIso(iso, days) {
  const m = ISO.exec(iso ?? "");
  if (!m) throw new RangeError(`Not a YYYY-MM-DD date: ${iso}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

export const lineCentsOf = (l) => mulCents(l.unitCents, l.qty);

/**
 * Totals from lines: the one formula, the same one lib/pricing.js priceLines
 * uses for the shop. Tax once, on the taxable non-shipping lines; shipping is
 * the shipping lines; total = subtotal + tax + shipping.
 */
export function computeTotals(lines, { taxRateBps }) {
  const priced = lines.map((l) => ({ kind: l.kind ?? "item", taxable: Boolean(l.taxable), cents: lineCentsOf(l) }));
  const goods = priced.filter((l) => l.kind !== "shipping");
  const subtotalCents = sumCents(goods.map((l) => l.cents));
  const shippingCents = sumCents(priced.filter((l) => l.kind === "shipping").map((l) => l.cents));
  const taxCents = pctOfCents(sumCents(goods.filter((l) => l.taxable).map((l) => l.cents)), taxRateBps);
  return { subtotalCents, taxCents, shippingCents, totalCents: subtotalCents + taxCents + shippingCents };
}

export const hasUnpriced = (lines) => lines.some((l) => l.priceSource === "unpriced");

/** Remakes are free unless staff edit the draft: same lines, zero price. */
export const asRemakeLines = (pricedLines) => pricedLines.map((l) => ({ ...l, unitCents: 0, priceSource: "remake" }));

function newInvoice({ invoiceId, invoiceNumber, kind, clientUserId, labOrderId, now }) {
  return {
    id: invoiceId, invoiceNumber, kind, clientUserId: clientUserId ?? null, labOrderId: labOrderId ?? null,
    legacySeazonaInvoiceId: null, status: "draft", version: 1, issuedAt: null, dueDate: null, voidedAt: null, voidReason: null,
    subtotalCents: 0, taxCents: 0, shippingCents: 0, totalCents: 0, notes: null, createdAt: now, updatedAt: now,
  };
}

function lineRow(invoiceId, position, l) {
  return {
    invoiceId, position, kind: l.kind ?? "item", variantId: l.variantId ?? null, code: l.code ?? null,
    description: l.description, qty: l.qty, unitCents: l.unitCents, lineCents: lineCentsOf(l),
    taxable: (l.kind ?? "item") === "shipping" ? false : Boolean(l.taxable),
    priceSource: l.priceSource, priceNote: null, labOrderLineId: l.labOrderLineId ?? null, shipmentId: l.shipmentId ?? null,
  };
}

/** A lab order → its draft invoice, one line per priced lab order line. */
export function planDraftInvoice({ invoiceId, invoiceNumber, labOrder, pricedLines, now, taxRateBps }) {
  const lines = pricedLines.map((l, i) => lineRow(invoiceId, i, l));
  const invoice = {
    ...newInvoice({ invoiceId, invoiceNumber, kind: "order", clientUserId: labOrder.clientUserId, labOrderId: labOrder.id, now }),
    ...computeTotals(lines, { taxRateBps }),
  };
  return { invoice, lines };
}

/**
 * A paid shop order → its invoice: issued, and due the day it was paid. Lines
 * and totals are COPIED from the checkout quote the card was charged for,
 * never recomputed, so the invoice always equals the charge.
 */
export function planShopInvoice({ invoiceId, invoiceNumber, labOrderId, clientUserId, quote, now, todayIso }) {
  const items = quote.lines.map((l) => ({
    kind: "item", variantId: l.variantId ?? null, code: l.code ?? null, description: l.name,
    qty: l.qty, unitCents: l.unitCents, taxable: l.taxable, priceSource: l.priceSource,
  }));
  if (quote.shippingCents > 0) {
    items.push({ kind: "shipping", description: "Shipping", qty: 1, unitCents: quote.shippingCents, taxable: false, priceSource: "base" });
  }
  const invoice = {
    ...newInvoice({ invoiceId, invoiceNumber, kind: "shop", clientUserId, labOrderId, now }),
    status: "issued", issuedAt: now, dueDate: todayIso,
    subtotalCents: quote.subtotalCents, taxCents: quote.taxCents, shippingCents: quote.shippingCents, totalCents: quote.totalCents,
  };
  return { invoice, lines: items.map((l, i) => lineRow(invoiceId, i, l)) };
}

/** The editor must have seen the version it is changing (optimistic concurrency, as on lab orders). */
export function assertFreshInvoice(invoice, expectedVersion) {
  if (!Number.isInteger(expectedVersion) || expectedVersion !== invoice.version) {
    throw new InvoiceError("STALE", "This invoice changed — reload.");
  }
}

function assertDraft(invoice) {
  if (invoice.status === "draft") return;
  const why = invoice.status === "issued"
    ? "issued invoices can't change; use a credit, or void it."
    : "it can't change.";
  throw new InvoiceError("INVALID_TRANSITION", `Invoice #${invoice.invoiceNumber} is ${invoice.status} — ${why}`);
}

const trimmed = (s) => (typeof s === "string" ? s.trim() : "");
const bump = (invoice, now) => ({ version: invoice.version + 1, updatedAt: now });

function checkQty(qty) {
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) throw new InvoiceError("INVALID", `Quantity must be a whole number from 1 to ${MAX_QTY}.`);
}

function checkSign(kind, unitCents) {
  assertCents(unitCents, "unitCents");
  if (unitCents < 0 && kind !== "adjustment") throw new InvoiceError("INVALID", "Only an adjustment line can be negative.");
}

/**
 * One draft edit → the line operation, the invoice patch (totals recomputed
 * from the resulting lines, version bumped) and audit metadata. Totals are
 * never set directly. A price override needs a reason; the reason is kept on
 * the line (encrypted) and never copied into audit metadata.
 */
export function planLineEdit(invoice, lines, edit, { now, taxRateBps }) {
  assertDraft(invoice);
  if (edit.op === "notes") {
    return { op: {}, patch: { notes: trimmed(edit.notes) || null, ...bump(invoice, now) }, audit: { op: "notes" } };
  }

  let op;
  let after;
  let audit;
  if (edit.op === "add") {
    if (!INVOICE_LINE_KINDS.includes(edit.kind)) throw new InvoiceError("INVALID", `Unknown line kind: ${edit.kind}`);
    const description = trimmed(edit.description);
    if (!description) throw new InvoiceError("INVALID", "A line needs a description.");
    checkQty(edit.qty);
    checkSign(edit.kind, edit.unitCents);
    const position = lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
    const line = lineRow(invoice.id, position, {
      kind: edit.kind, description, qty: edit.qty, unitCents: edit.unitCents, taxable: edit.taxable, priceSource: "manual",
    });
    op = { insert: line };
    after = [...lines, line];
    audit = { op: "add", kind: edit.kind, qty: edit.qty, unitCents: edit.unitCents };
  } else {
    const line = lines.find((l) => l.id === edit.lineId);
    if (!line) throw new InvoiceError("NOT_FOUND", "That line isn't on this invoice.");
    if (edit.op === "remove") {
      op = { delete: line.id };
      after = lines.filter((l) => l !== line);
      audit = { op: "remove", lineId: line.id };
    } else if (edit.op === "update") {
      const values = {};
      if (edit.qty !== undefined && edit.qty !== line.qty) {
        checkQty(edit.qty);
        values.qty = edit.qty;
      }
      // An unpriced line is stored at 0, so setting 0 on it is a real change: it becomes priced (free).
      if (edit.unitCents !== undefined && (edit.unitCents !== line.unitCents || line.priceSource === "unpriced")) {
        checkSign(line.kind, edit.unitCents);
        const reason = trimmed(edit.reason);
        if (!reason) throw new InvoiceError("REASON_REQUIRED", "Say why the price is being changed.");
        Object.assign(values, { unitCents: edit.unitCents, priceSource: "manual", priceNote: reason });
      }
      if (Object.keys(values).length === 0) throw new InvoiceError("INVALID", "Nothing to change.");
      const updated = { ...line, ...values };
      values.lineCents = lineCentsOf(updated);
      updated.lineCents = values.lineCents;
      op = { update: { id: line.id, values } };
      after = lines.map((l) => (l === line ? updated : l));
      audit = {
        op: "update", lineId: line.id,
        ...(values.qty !== undefined ? { qty: values.qty } : {}),
        ...(values.unitCents !== undefined ? { unitCents: values.unitCents, priceOverride: true } : {}),
      };
    } else {
      throw new InvoiceError("INVALID", `Unknown edit: ${edit.op}`);
    }
  }
  return { op, patch: { ...computeTotals(after, { taxRateBps }), ...bump(invoice, now) }, audit };
}

/** A shipment's charge must be a known positive integer of cents; null ("charge unknown") is refused, never $0. */
export function assertShipmentCharge(unitCents) {
  if (!Number.isInteger(unitCents) || unitCents <= 0) {
    throw new InvoiceError("INVALID", "A shipping line needs a known charge of more than $0.00.");
  }
}

/**
 * A shipment's shipping line on a draft (lab-shipping.service, SHIPPING_CHARGE_POLICY).
 * Kind "shipping" (never taxed), price source "shipment", and it remembers its
 * shipment so voiding the label removes exactly this line. One per shipment.
 * An unknown (null) or non-integer/zero/negative charge is refused, never added as $0.
 */
export function planShipmentLine(invoice, lines, { shipmentId, description, unitCents, now, taxRateBps }) {
  assertDraft(invoice);
  assertShipmentCharge(unitCents);
  if (lines.some((l) => l.shipmentId === shipmentId)) throw new InvoiceError("INVALID", "This shipment's line is already on the invoice.");
  const position = lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const line = lineRow(invoice.id, position, { kind: "shipping", description, qty: 1, unitCents, taxable: false, priceSource: "shipment", shipmentId });
  return {
    op: { insert: line },
    patch: { ...computeTotals([...lines, line], { taxRateBps }), ...bump(invoice, now) },
    audit: { op: "add", kind: "shipping", unitCents, shipmentId },
  };
}

/** A voided shipment -> remove the line it added (null when there is none). Draft only. */
export function planShipmentLineRemoval(invoice, lines, shipmentId, { now, taxRateBps }) {
  const line = lines.find((l) => l.shipmentId === shipmentId);
  if (!line) return null;
  assertDraft(invoice);
  return {
    op: { delete: line.id },
    patch: { ...computeTotals(lines.filter((l) => l !== line), { taxRateBps }), ...bump(invoice, now) },
    audit: { op: "remove", lineId: line.id, shipmentId },
  };
}

/** Issue a draft: due = the lab-local issue date + net terms. An unpriced line holds it. */
export function planIssue(invoice, lines, { now, termsDays, issueDateIso }) {
  assertDraft(invoice);
  const unpriced = lines.find((l) => l.priceSource === "unpriced");
  if (unpriced) throw new InvoiceError("INVALID", `“${unpriced.description}” still needs a price.`);
  if (invoice.totalCents < 0) throw new InvoiceError("INVALID", "An invoice can't be issued for less than $0.00.");
  return { patch: { status: "issued", issuedAt: now, dueDate: addDaysIso(issueDateIso, termsDays), ...bump(invoice, now) } };
}

/**
 * An imported Seazona invoice whose client could not be matched to exactly one
 * doctor (Rulings R11b/R11c) has no owner and is hidden from AR. Staff link the
 * owner first (re-run the invoices step); acting on it before then would
 * change a balance nobody can see.
 */
function assertLegacyOwned(invoice, verb) {
  if (invoice.kind === "legacy" && !invoice.clientUserId) {
    throw new InvoiceError("INVALID_TRANSITION", `Invoice #${invoice.invoiceNumber} has no client yet, so it cannot be ${verb}. Link its owner first (an admin links the Seazona client, then the import's invoices step is re-run).`);
  }
}

/**
 * Void with a reason. A draft can always be voided (its lab order was
 * cancelled). An issued invoice only while its net paid is zero: once money
 * has been applied, the correction is a refund or a credit. A void keeps its number.
 */
export function planVoid(invoice, { paidCents, reason, now }) {
  assertLegacyOwned(invoice, "voided");
  if (invoice.status === "void") throw new InvoiceError("INVALID_TRANSITION", `Invoice #${invoice.invoiceNumber} is already void.`);
  const why = trimmed(reason);
  if (!why) throw new InvoiceError("REASON_REQUIRED", "Say why this invoice is being voided.");
  if (invoice.status === "issued" && paidCents !== 0) {
    throw new InvoiceError(
      "INVALID_TRANSITION",
      `Invoice #${invoice.invoiceNumber} has ${formatCents(paidCents)} applied. Refund or credit it instead of voiding.`,
    );
  }
  return { patch: { status: "void", voidedAt: now, voidReason: why, ...bump(invoice, now) } };
}

/**
 * THE balance rule. paidCents = the sum of the invoice's ledger rows (payments
 * and credits positive, refunds negative). A void owes nothing; "paid" means an
 * issued invoice with nothing left to pay.
 */
export function deriveBalance(invoice, paidCents = 0) {
  assertCents(paidCents, "paidCents");
  if (invoice.status === "void") return { paidCents, balanceCents: 0, paid: false };
  const balanceCents = invoice.totalCents - paidCents;
  return { paidCents, balanceCents, paid: invoice.status === "issued" && balanceCents <= 0 };
}

/**
 * THE doctor visibility and payment-rights rule. An invoice is owned by one
 * doctor (clientUserId), but every portal login of the same practice may see
 * and pay it, as they could when invoices lived in Seazona. A practice is a
 * shared, non-null seazonaClientId until piece 5 brings a real practice
 * entity. A null on either side matches the owner only. Used by every doctor
 * read (list, detail, PDF, statement), every payment (verifyAllocations) and
 * AutoPay.
 *
 * @param {{ id: string, seazonaClientId?: string|null }} user  the requester (or the doctor being charged)
 * @param {{ clientUserId: string|null }} invoice
 * @param {string|null} ownerSeazonaClientId  the owning doctor's seazonaClientId
 */
export function canActOnInvoice(user, invoice, ownerSeazonaClientId) {
  if (!user?.id || !invoice?.clientUserId) return false;
  if (invoice.clientUserId === user.id) return true;
  return Boolean(user.seazonaClientId) && Boolean(ownerSeazonaClientId) && String(user.seazonaClientId) === String(ownerSeazonaClientId);
}

/** A credit (write-off) on an issued invoice: a reason, and no more than is owed. */
export function planCredit(invoice, { amountCents, reason, balanceCents }) {
  assertLegacyOwned(invoice, "credited");
  if (invoice.status !== "issued") {
    throw new InvoiceError("INVALID_TRANSITION", `Invoice #${invoice.invoiceNumber} is ${invoice.status} — only an issued invoice can be credited.`);
  }
  const why = trimmed(reason);
  if (!why) throw new InvoiceError("REASON_REQUIRED", "Say why this credit is being given.");
  assertCents(amountCents, "amountCents");
  if (amountCents <= 0) throw new InvoiceError("INVALID", "A credit must be more than $0.00.");
  if (amountCents > balanceCents) {
    throw new InvoiceError("OVERPAY", `A credit of ${formatCents(amountCents)} is more than the ${formatCents(Math.max(0, balanceCents))} owed.`);
  }
  return { reason: why };
}

/**
 * A manual payment (check, cash, ACH, other) → its allocations. Staff-chosen
 * allocations must each be an open invoice, once, within its balance, and add
 * up to the payment; otherwise oldest-first (allocateOldestFirst, shared with
 * AutoPay and the pay screens). Overpaying is refused: there is no unapplied
 * credit in this piece. The received date may not be in the future, nor before
 * an allocated invoice was issued (the statement would show a payment against
 * an invoice that didn't exist yet).
 *
 * @param {Array<{ id, invoiceNumber, balanceCents, dueDate, issuedOn }>} openInvoices  ledger.openInvoicesForClient
 */
export function planManualPayment({ openInvoices, amountCents, allocations, paidOn, todayIso }) {
  assertCents(amountCents, "amountCents");
  if (amountCents <= 0) throw new InvoiceError("INVALID", "A payment must be more than $0.00.");
  if (!ISO.test(paidOn ?? "") || addDaysIso(paidOn, 0) !== paidOn) throw new InvoiceError("INVALID", "The payment date must be YYYY-MM-DD.");
  if (paidOn > todayIso) throw new InvoiceError("INVALID", "The payment date can't be in the future.");

  const byId = new Map(openInvoices.map((i) => [i.id, i]));
  let planned;
  if (allocations?.length) {
    const seen = new Set();
    planned = allocations.map((a) => {
      const inv = byId.get(a.invoiceId);
      if (!inv) throw new InvoiceError("INVALID", "That invoice isn't open on this client's account.");
      if (seen.has(a.invoiceId)) throw new InvoiceError("INVALID", `Invoice #${inv.invoiceNumber} appears more than once.`);
      seen.add(a.invoiceId);
      assertCents(a.amountCents, "allocation amountCents");
      if (a.amountCents <= 0) throw new InvoiceError("INVALID", "Each allocation must be more than $0.00.");
      if (a.amountCents > inv.balanceCents) {
        throw new InvoiceError("OVERPAY", `${formatCents(a.amountCents)} is more than the ${formatCents(inv.balanceCents)} owed on invoice #${inv.invoiceNumber}.`);
      }
      return { invoiceId: inv.id, invoiceNumber: String(inv.invoiceNumber), amountCents: a.amountCents };
    });
    if (sumCents(planned.map((a) => a.amountCents)) !== amountCents) throw new InvoiceError("INVALID", "Allocations must add up to the payment.");
  } else {
    const { allocations: auto, totalAllocatedCents } = allocateOldestFirst(openInvoices, amountCents);
    if (totalAllocatedCents < amountCents) {
      throw new InvoiceError("OVERPAY", `${formatCents(amountCents)} is more than this client's open balance of ${formatCents(totalAllocatedCents)}.`);
    }
    planned = auto;
  }
  for (const a of planned) {
    const inv = byId.get(a.invoiceId);
    // Defence in depth: the open list is built from the client's own invoices, so an ownerless (unlinked legacy) invoice never appears; if one ever did, it is refused like credit/void.
    if (inv.clientUserId === null) {
      throw new InvoiceError("INVALID_TRANSITION", `Invoice #${inv.invoiceNumber} has no client yet, so a payment cannot be applied to it. Link its owner first.`);
    }
    if (inv.issuedOn && paidOn < inv.issuedOn) {
      throw new InvoiceError("INVALID", `The payment date is before invoice #${inv.invoiceNumber} was issued (${inv.issuedOn}).`);
    }
  }
  return planned;
}
