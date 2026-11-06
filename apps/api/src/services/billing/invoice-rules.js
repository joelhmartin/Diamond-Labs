import { INVOICE_LINE_KINDS, addIsoDays, allocateOldestFirst, isCalendarDate } from "@my-app/shared";
import { assertCents, formatCents, mulCents, pctOfCents, sumCents } from "../../lib/money.js";

/**
 * Pure invoice rules: totals, the draft → issued → void lifecycle, draft edit
 * planning and the balance rule. No DB and no clock (callers pass ids and
 * `now`), so every rule is unit-tested here and invoices.service.js only runs
 * the plans inside transactions.
 */

export class InvoiceError extends Error {
  /**
   * @param {"NOT_FOUND"|"PRACTICE_REQUIRED"|"STALE"|"LOCKED"|"INVALID"|"INVALID_TRANSITION"|"REASON_REQUIRED"|"OVERPAY"} code
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

/** No billable item line at all (a quick-entry order shipped with no lines): issuing it would bill $0 for good. */
export const hasNoItems = (lines) => !lines.some((l) => (l.kind ?? "item") === "item");

/**
 * What discounts come off: the item lines plus the discount credits (negative
 * adjustments), overall and on the taxable side. Raw sums (may be negative).
 * THE formula planDiscountLine sizes a discount by and assertDiscountCovered
 * re-checks after every item edit, so the two cannot disagree.
 */
function discountBase(lines) {
  const credits = lines.filter((l) => l.kind === "adjustment" && lineCentsOf(l) < 0);
  const items = lines.filter((l) => (l.kind ?? "item") === "item");
  return {
    credits,
    netCents: sumCents(items.map(lineCentsOf)) + sumCents(credits.map(lineCentsOf)),
    taxableNetCents: sumCents(items.filter((l) => l.taxable).map(lineCentsOf)) + sumCents(credits.filter((l) => l.taxable).map(lineCentsOf)),
  };
}

/**
 * After an item edit (qty, price, remove — staff or bench), a discount already
 * on the draft must still be covered: items + credits ≥ 0 overall and on the
 * taxable side. Otherwise refuse; staff take the discount off first.
 */
export function assertDiscountCovered(linesAfter) {
  const { credits, netCents, taxableNetCents } = discountBase(linesAfter);
  if (credits.length && (netCents < 0 || taxableNetCents < 0)) throw new InvoiceError("INVALID", "Remove the discount first.");
}

/**
 * A remake's price: the reason's default percent off (100 = free, the default; null means 100).
 * Integer cents, rounded. Staff can still edit the draft.
 */
export const asRemakeLines = (pricedLines, percent = 100) => {
  const off = percent ?? 100;
  return pricedLines.map((l) => ({ ...l, unitCents: Math.round((l.unitCents * (100 - off)) / 100), priceSource: "remake" }));
};

function newInvoice({ invoiceId, invoiceNumber, kind, clientUserId, accountId, labOrderId, now }) {
  return {
    id: invoiceId, invoiceNumber, kind, clientUserId: clientUserId ?? null, accountId: accountId ?? null, labOrderId: labOrderId ?? null,
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
    ...newInvoice({ invoiceId, invoiceNumber, kind: "order", clientUserId: labOrder.clientUserId, accountId: labOrder.accountId, labOrderId: labOrder.id, now }),
    ...computeTotals(lines, { taxRateBps }),
  };
  return { invoice, lines };
}

/**
 * A paid shop order → its invoice: issued, and due the day it was paid. Lines
 * and totals are COPIED from the checkout quote the card was charged for,
 * never recomputed, so the invoice always equals the charge.
 */
export function planShopInvoice({ invoiceId, invoiceNumber, labOrderId, clientUserId, accountId = null, quote, now, todayIso }) {
  const items = quote.lines.map((l) => ({
    kind: "item", variantId: l.variantId ?? null, code: l.code ?? null, description: l.name,
    qty: l.qty, unitCents: l.unitCents, taxable: l.taxable, priceSource: l.priceSource,
  }));
  if (quote.shippingCents > 0) {
    items.push({ kind: "shipping", description: "Shipping", qty: 1, unitCents: quote.shippingCents, taxable: false, priceSource: "base" });
  }
  const invoice = {
    ...newInvoice({ invoiceId, invoiceNumber, kind: "shop", clientUserId, accountId, labOrderId, now }),
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
    assertDiscountCovered(after);
  }
  return { op, patch: { ...computeTotals(after, { taxRateBps }), ...bump(invoice, now) }, audit };
}

/**
 * A discount on a draft: negative "adjustment" line(s). Give a percent OR an amountCents, never
 * both; needs a reason label or text. It comes off the NET remaining item amount (items plus
 * earlier negative adjustments, floored at 0), so stacked discounts can't push the invoice
 * below zero, and a percent is of that net, rounded to whole cents. Tax follows the discount:
 * it is split pro-rata into a taxable line and a non-taxable line that sum exactly to it.
 */
export function planDiscountLine(invoice, lines, { label, text, percent, amountCents }, { now, taxRateBps }) {
  assertDraft(invoice);
  const description = [trimmed(label), trimmed(text)].filter(Boolean).join(" — ");
  if (!description) throw new InvoiceError("REASON_REQUIRED", "Say why this discount is being given.");
  const hasPercent = percent !== undefined && percent !== null;
  const hasAmount = amountCents !== undefined && amountCents !== null;
  if (hasPercent === hasAmount) throw new InvoiceError("INVALID", "Give either a percent or an amount for the discount.");
  const base = discountBase(lines);
  const net = Math.max(0, base.netCents);
  const taxableNet = Math.min(net, Math.max(0, base.taxableNetCents));
  let cents;
  if (hasPercent) {
    if (!Number.isInteger(percent) || percent < 1 || percent > 100) throw new InvoiceError("INVALID", "A discount percent is a whole number from 1 to 100.");
    cents = Math.round((net * percent) / 100);
  } else {
    assertCents(amountCents, "amountCents");
    cents = amountCents;
  }
  if (cents <= 0) throw new InvoiceError("INVALID", "A discount must be more than $0.00.");
  if (cents > net) throw new InvoiceError("INVALID", "A discount can't be more than what is left on the items.");
  // Tax follows the discount: the taxable share of the net is discounted as a taxable line.
  const taxablePart = Math.round((cents * taxableNet) / net);
  let position = lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const inserts = [[taxablePart, true], [cents - taxablePart, false]]
    .filter(([c]) => c > 0)
    .map(([c, taxable]) => lineRow(invoice.id, position++, { kind: "adjustment", description, qty: 1, unitCents: -c, taxable, priceSource: "manual" }));
  return {
    op: { inserts },
    patch: { ...computeTotals([...lines, ...inserts], { taxRateBps }), ...bump(invoice, now) },
    audit: { op: "discount", unitCents: -cents, ...(hasPercent ? { percent } : {}) },
  };
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

// ── Lines linked to lab order lines ─────────────────────────────────────────
// A bench line edit (lab-order-lines.service) is mirrored onto the order's
// draft through invoice_lines.labOrderLineId, in the same transaction, so the
// bench and the bill never disagree. Once the invoice is issued the edit is
// refused (the caller's transaction rolls the bench change back).

export function assertLinkedDraft(invoice) {
  if (invoice.status === "issued") throw new InvoiceError("INVALID_TRANSITION", "Invoice already issued — edit it with a credit.");
  assertDraft(invoice);
}

const linkedPlan = (invoice, op, after, audit, { now, taxRateBps }) =>
  ({ op, patch: { ...computeTotals(after, { taxRateBps }), ...bump(invoice, now) }, audit });

/** A bench qty change or removal: refused (and the bench edit rolled back) when it would leave a discount uncovered. */
function linkedEditPlan(invoice, op, after, audit, opts) {
  assertDiscountCovered(after);
  return linkedPlan(invoice, op, after, audit, opts);
}

/** A new bench line → its priced invoice line (priceLabLines output, remake pricing already applied). */
export function planLinkedLineAdd(invoice, lines, pricedLine, opts) {
  assertLinkedDraft(invoice);
  const position = lines.reduce((m, l) => Math.max(m, l.position), -1) + 1;
  const line = lineRow(invoice.id, position, pricedLine);
  const audit = { op: "add", labOrderLineId: line.labOrderLineId, qty: line.qty, unitCents: line.unitCents };
  return linkedPlan(invoice, { insert: line }, [...lines, line], audit, opts);
}

/** A bench qty change → the linked line's qty (its price stays). Null when no line is linked. */
export function planLinkedLineQty(invoice, lines, labOrderLineId, qty, opts) {
  assertLinkedDraft(invoice);
  const line = lines.find((l) => l.labOrderLineId === labOrderLineId);
  if (!line) return null;
  checkQty(qty);
  const updated = { ...line, qty, lineCents: lineCentsOf({ ...line, qty }) };
  const audit = { op: "update", lineId: line.id, labOrderLineId, qty };
  return linkedEditPlan(invoice, { update: { id: line.id, values: { qty, lineCents: updated.lineCents } } }, lines.map((l) => (l === line ? updated : l)), audit, opts);
}

/** A bench line removed → delete the invoice line linked to it. Null when no line is linked. */
export function planLinkedLineRemove(invoice, lines, labOrderLineId, opts) {
  assertLinkedDraft(invoice);
  const line = lines.find((l) => l.labOrderLineId === labOrderLineId);
  if (!line) return null;
  return linkedEditPlan(invoice, { delete: line.id }, lines.filter((l) => l !== line), { op: "remove", lineId: line.id, labOrderLineId }, opts);
}

/** Issue a draft: due = the lab-local issue date + net terms. An unpriced line holds it. */
export function planIssue(invoice, lines, { now, termsDays, issueDateIso }) {
  assertDraft(invoice);
  const unpriced = lines.find((l) => l.priceSource === "unpriced");
  if (unpriced) throw new InvoiceError("INVALID", `“${unpriced.description}” still needs a price.`);
  if (invoice.totalCents < 0) throw new InvoiceError("INVALID", "An invoice can't be issued for less than $0.00.");
  return { patch: { status: "issued", issuedAt: now, dueDate: addIsoDays(issueDateIso, termsDays), ...bump(invoice, now) } };
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
  if (!isCalendarDate(paidOn)) throw new InvoiceError("INVALID", "The payment date must be YYYY-MM-DD.");
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

/**
 * An account-level credit (a write-off not tied to one invoice) → its
 * allocations. It is a manual payment's allocation (oldest-first or the
 * invoices staff chose) dated today, with a required reason. A credit larger
 * than the open balance is OVERPAY: there is no unapplied-credit model.
 */
export function planAccountCredit({ openInvoices, amountCents, allocations, reason, todayIso }) {
  const why = trimmed(reason);
  if (!why) throw new InvoiceError("REASON_REQUIRED", "Say why this credit is being given.");
  const planned = planManualPayment({ openInvoices, amountCents, allocations, paidOn: todayIso, todayIso });
  return { allocations: planned, reason: why };
}
