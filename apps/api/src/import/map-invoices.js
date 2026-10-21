
import { toCents, LEGACY_LINE_DESCRIPTION } from "@my-app/shared";
import { createId } from "../lib/id.js";
import { dayOf, labNoon } from "./dates.js";
import { problemList } from "./problems.js";
import { invoiceStatusFor, recordDate, recordNumber, firstString, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";

/**
 * Seazona invoice (summary + optional detail) → one `kind: legacy` invoice and
 * its lines, unsealed (load-invoices.js seals with sealInvoice/sealLine).
 * Seazona's total is kept to the cent; lines add up to total − tax (Spec
 * correction 6). A record we can't map becomes { problem } — never a guess.
 */
export const SUMMARY_LINE_DESCRIPTION = "Seazona invoice — see archive";
const ADJUSTMENT_DESCRIPTION = "Seazona adjustment (discounts, services, rounding)";
const ITEM_LISTS = ["productServiceItems", "items", "lines", "products"];

export function centsOf(value) {
  if (value == null || value === "") return null;
  try {
    const c = toCents(String(value).replace(/[$,\s]/g, ""));
    return Number.isSafeInteger(c) ? c : null;
  } catch {
    return null;
  }
}

/**
 * The day a legacy invoice was issued: its own date (detail first, then the
 * summary), else its due date (`approximated`). The parity report uses the
 * same rule, so both sides count an invoice in the same year.
 */
export function legacyIssueDay(summary, detail = null) {
  const own = recordDate("invoice", { ...(detail ?? {}), due: undefined }) ?? recordDate("invoice", { ...summary, due: undefined });
  return { day: own ?? dayOf(summary?.due), approximated: !own };
}

const detailItems = (detail) => ITEM_LISTS.map((k) => detail?.[k]).find(Array.isArray) ?? null;

function mapItem(item) {
  const quantity = Number(item?.quantity ?? item?.qty ?? 1);
  let qty = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
  let unitCents = centsOf(item?.price ?? item?.unitPrice ?? item?.rate);
  let lineCents = centsOf(item?.total ?? item?.amount ?? item?.lineTotal);
  if (lineCents == null && unitCents != null) lineCents = unitCents * qty;
  if (lineCents == null) return null;
  if (unitCents == null || unitCents * qty !== lineCents) {
    qty = 1;
    unitCents = lineCents;
  }
  const code = firstString(item, ["code", "productCode"]);
  return {
    kind: lineCents < 0 ? "adjustment" : "item",
    code: code ? code.slice(0, 60) : null,
    description: LEGACY_LINE_DESCRIPTION,
    legacyDescription: firstString(item, ["name", "description", "productName"]),
    qty, unitCents, lineCents,
  };
}

const line = (invoiceId, position, l) => ({
  id: createId(), invoiceId, position, variantId: null, taxable: false, priceSource: "legacy",
  priceNote: null, labOrderLineId: null, shipmentId: null, legacyDescription: null, ...l,
});

function buildLines(invoiceId, detail, subtotalCents) {
  const items = (detailItems(detail) ?? []).map(mapItem).filter(Boolean);
  if (items.length === 0) {
    return [line(invoiceId, 0, {
      kind: subtotalCents < 0 ? "adjustment" : "item", code: null, description: SUMMARY_LINE_DESCRIPTION,
      qty: 1, unitCents: subtotalCents, lineCents: subtotalCents,
    })];
  }
  const out = items.map((it, i) => line(invoiceId, i, it));
  const diff = subtotalCents - out.reduce((s, l) => s + l.lineCents, 0);
  if (diff !== 0) out.push(line(invoiceId, out.length, { kind: "adjustment", code: null, description: ADJUSTMENT_DESCRIPTION, qty: 1, unitCents: diff, lineCents: diff }));
  return out;
}

export function mapLegacyInvoice({ summary, detail = null, ownerUserId }) {
  const invoiceNumber = recordNumber(summary, INVOICE_NUMBER_FIELDS) ?? recordNumber(detail, INVOICE_NUMBER_FIELDS);
  if (!invoiceNumber) return { problem: "invoice_number_not_numeric" };
  if (!ownerUserId) return { problem: "client_not_loaded" };
  const totalCents = centsOf(summary.total);
  if (totalCents == null) return { problem: "total_not_money" };
  if (totalCents < 0) return { problem: "negative_total" };
  const taxCents = centsOf(summary.tax) ?? 0;
  const dueDate = dayOf(summary.due);
  const { day: issuedDay, approximated } = legacyIssueDay(summary, detail);
  if (!issuedDay) return { problem: "no_date" };

  const id = createId();
  const status = invoiceStatusFor(summary.status);
  const issuedAt = labNoon(issuedDay);
  const subtotalCents = totalCents - taxCents;
  const invoice = {
    id, invoiceNumber, kind: "legacy", clientUserId: ownerUserId, labOrderId: null,
    legacySeazonaInvoiceId: String(summary.id), legacyPatient: firstString(summary, ["patient", "patientName"]),
    status, version: 1, issuedAt, dueDate, voidedAt: status === "void" ? issuedAt : null, voidReason: null,
    subtotalCents, taxCents, shippingCents: 0, totalCents, notes: null,
  };
  return { invoice, lines: buildLines(id, detail, subtotalCents), approximatedDate: approximated, detailed: Boolean(detailItems(detail)) };
}

/**
 * Every summary → rows to insert (unsealed), with counts and problems (Seazona
 * ids only). `owners` is client id → eligible owner and `unownedClients` the
 * linked clients with no eligible owner (both from owners.js resolveOwners).
 */
export function planInvoices({ summaries, details, owners, existingSeazonaIds, existingNumbers, unownedClients = new Set() }) {
  const rows = [];
  const problems = new Map();
  const flag = (kind, id) => problems.set(kind, [...(problems.get(kind) ?? []), id]);
  const counts = { seazona: summaries.length, toInsert: 0, alreadyLoaded: 0, detailed: 0, summaryOnly: 0, approximatedDates: 0, void: 0, totalCents: 0 };
  const numbers = new Set(existingNumbers);
  for (const { seazonaId, payload } of summaries) {
    if (existingSeazonaIds.has(seazonaId)) { counts.alreadyLoaded += 1; continue; }
    const clientId = String(payload.clientId);
    // A client whose linked user is not an eligible owner (owners.js) gets its own problem kind.
    if (unownedClients.has(clientId) && !owners.has(clientId)) { flag("client_owner_not_approved_doctor", seazonaId); continue; }
    const mapped = mapLegacyInvoice({ summary: payload, detail: details.get(seazonaId) ?? null, ownerUserId: owners.get(clientId) });
    if (mapped.problem) { flag(mapped.problem, seazonaId); continue; }
    if (numbers.has(mapped.invoice.invoiceNumber)) { flag("invoice_number_taken", seazonaId); continue; }
    numbers.add(mapped.invoice.invoiceNumber);
    rows.push({ invoice: mapped.invoice, lines: mapped.lines });
    counts.toInsert += 1;
    counts[mapped.detailed ? "detailed" : "summaryOnly"] += 1;
    if (mapped.approximatedDate) counts.approximatedDates += 1;
    if (mapped.invoice.status === "void") counts.void += 1;
    else counts.totalCents += mapped.invoice.totalCents;
  }
  return { rows, counts, problems: problemList([...problems]) };
}
