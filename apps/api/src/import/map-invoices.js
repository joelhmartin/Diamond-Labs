
import { toCents, LEGACY_LINE_DESCRIPTION } from "@my-app/shared";
import { createId } from "../lib/id.js";
import { dayOf, labNoon } from "./dates.js";
import { exportCents } from "./export-table.js";
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

/**
 * Seazona money → integer cents; null when blank or not an amount. A JSON
 * number is dollars, converted by the shared decimal-exact `toCents`
 * (half-up past the cent; exponent forms like 1e21 are null). Text goes
 * through the export parser's rules (exportCents): an ambiguous comma or more
 * than two decimals is refused, never guessed.
 */
export function centsOf(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    try {
      const c = toCents(String(value));
      return Number.isSafeInteger(c) ? c + 0 : null;
    } catch {
      return null;
    }
  }
  return exportCents(value);
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

function buildLines(invoiceId, items, subtotalCents) {
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

/**
 * `unowned: true` maps an invoice with no owner (a client shared by several
 * eligible doctors: clientUserId stays null until an admin decides).
 */
export function mapLegacyInvoice({ summary, detail = null, ownerUserId, unowned = false }) {
  // The summary's number is the authority; the detail's is never borrowed.
  const invoiceNumber = recordNumber(summary, INVOICE_NUMBER_FIELDS);
  if (!invoiceNumber) return { problem: "invoice_number_not_numeric" };
  if (!ownerUserId && !unowned) return { problem: "client_not_loaded" };
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
    id, invoiceNumber, kind: "legacy", clientUserId: ownerUserId ?? null, labOrderId: null,
    legacySeazonaInvoiceId: String(summary.id), legacyPatient: firstString(summary, ["patient", "patientName"]),
    status, version: 1, issuedAt, dueDate, voidedAt: status === "void" ? issuedAt : null, voidReason: null,
    subtotalCents, taxCents, shippingCents: 0, totalCents, notes: null,
  };
  const listed = detailItems(detail) ?? [];
  const items = listed.map(mapItem).filter(Boolean);
  return {
    invoice, lines: buildLines(id, items, subtotalCents), approximatedDate: approximated,
    detailed: items.length > 0, droppedItems: listed.length - items.length,
  };
}

/**
 * Every summary → rows to insert (unsealed), with counts and problems (Seazona
 * ids only). `owners` is client id → eligible owner, `unownedClients` the linked
 * clients with no eligible owner (their invoices are skipped) and
 * `ambiguousClients` those shared by several eligible users (their invoices load
 * unowned) — all from owners.js resolveOwners. `existingNumbers` is EVERY number
 * already in the table, loaded legacy rows included, so a duplicate Seazona
 * number is flagged with its id.
 */
export function planInvoices({ summaries, details, owners, existingSeazonaIds, existingNumbers, unownedClients = new Set(), ambiguousClients = new Set() }) {
  const rows = [];
  const problems = new Map();
  const flag = (kind, id) => (problems.has(kind) ? problems.get(kind).push(id) : problems.set(kind, [id]));
  const counts = { seazona: summaries.length, toInsert: 0, unowned: 0, droppedDetailItems: 0, alreadyLoaded: 0, detailed: 0, summaryOnly: 0, approximatedDates: 0, void: 0, totalCents: 0 };
  const numbers = new Set(existingNumbers);
  // Owner problems name CLIENTS (count = clients), so the id cap can't hide one;
  // the invoice totals are in counts.unowned / counts.skippedNoOwner.
  const clientKinds = new Map();
  const flagClient = (kind, clientId) => (clientKinds.has(kind) ? clientKinds.get(kind).add(clientId) : clientKinds.set(kind, new Set([clientId])));
  counts.skippedNoOwner = 0;
  for (const { seazonaId, payload } of summaries) {
    const clientId = String(payload.clientId);
    const unowned = ambiguousClients.has(clientId) && !owners.has(clientId);
    if (unowned) flagClient("client_has_multiple_owners", clientId);
    if (existingSeazonaIds.has(seazonaId)) { counts.alreadyLoaded += 1; continue; }
    // A client whose linked user is not an eligible owner (owners.js) gets its own problem kind.
    if (unownedClients.has(clientId) && !owners.has(clientId)) { flagClient("client_owner_not_approved_doctor", clientId); counts.skippedNoOwner += 1; continue; }
    const mapped = mapLegacyInvoice({ summary: payload, detail: details.get(seazonaId) ?? null, ownerUserId: owners.get(clientId), unowned });
    if (mapped.problem) { flag(mapped.problem, seazonaId); continue; }
    if (numbers.has(mapped.invoice.invoiceNumber)) { flag("invoice_number_taken", seazonaId); continue; }
    numbers.add(mapped.invoice.invoiceNumber);
    if (unowned) counts.unowned += 1;
    counts.droppedDetailItems += mapped.droppedItems;
    rows.push({ invoice: mapped.invoice, lines: mapped.lines });
    counts.toInsert += 1;
    counts[mapped.detailed ? "detailed" : "summaryOnly"] += 1;
    if (mapped.approximatedDate) counts.approximatedDates += 1;
    if (mapped.invoice.status === "void") counts.void += 1;
    else counts.totalCents += mapped.invoice.totalCents;
  }
  return { rows, counts, problems: problemList([...problems, ...[...clientKinds].map(([kind, ids]) => [kind, [...ids]])]) };
}
