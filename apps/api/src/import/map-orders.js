import { createId } from "../lib/id.js";
import { orderStatusFor, recordDate, recordNumber, firstString, ORDER_NUMBER_FIELDS } from "./seazona-records.js";
import { dayOf, labNoon } from "./dates.js";
import { problemList } from "./problems.js";

/**
 * Seazona order (+ optional detail) → one `source: legacy` lab order and its
 * lines (unsealed; load-orders.js seals legacyPatient with the live sealer).
 * History keeps its own dates: a 2019 shipment is shippedAt 2019, never
 * "now", so it stays off the board's recent-shipped window. Open orders land
 * on the board's statuses so the bench keeps working on them; they are never
 * billed again (Spec correction 9). An unknown state is a problem, not a guess.
 * `ownerUserId` may be null: the order loads unowned (like a guest shop order)
 * and its CLIENT is reported by planOrders.
 */
const ARCH = { 1: "upper", 2: "lower", 3: "both", upper: "upper", lower: "lower", both: "both" };
const instant = (v) => (dayOf(v) ? labNoon(dayOf(v)) : null);

function mapLines(labOrderId, detail) {
  const items = Array.isArray(detail?.products) ? detail.products : [];
  return items.map((p, i) => {
    const qty = Number(p?.quantity ?? p?.qty ?? 1);
    const code = firstString(p, ["code", "productCode"]);
    return {
      id: createId(), labOrderId, position: i, variantId: null,
      code: code ? code.slice(0, 60) : null,
      name: firstString(p, ["name", "productName"]) ?? (code ? `Seazona item ${code}` : "Seazona item"),
      arch: ARCH[String(p?.arch ?? "").toLowerCase()] ?? null,
      qty: Number.isSafeInteger(qty) && qty > 0 ? qty : 1,
      noteOnly: false, sourceLabel: null,
    };
  });
}

export function mapLegacyOrder({ summary, detail = null, ownerUserId = null }) {
  const orderNumber = recordNumber(summary, ORDER_NUMBER_FIELDS) ?? recordNumber(detail, ORDER_NUMBER_FIELDS);
  if (!orderNumber) return { problem: "order_number_not_numeric" };
  const mapped = orderStatusFor(summary.status);
  if (!mapped) return { problem: "unknown_status" };
  const receivedAt = instant(recordDate("order", summary));
  if (!receivedAt) return { problem: "no_date" };
  const terminalAt = instant(firstString(summary, ["shipped", "shippedDate", "completed", "lastModified"])) ?? receivedAt;
  const id = createId();
  const order = {
    id, orderNumber, source: "legacy", sourceId: String(summary.id),
    legacyPatient: firstString(summary, ["patientName", "patient"]),
    clientUserId: ownerUserId ?? null, status: mapped.status, heldFrom: mapped.heldFrom,
    departmentId: null, assigneeUserId: null, dueDate: dayOf(summary.due), rush: false, rushTier: null,
    isRemake: false, remakeOfOrderId: null, holdReason: null, labNotes: null, shipmentId: null, version: 1,
    receivedAt,
    startedAt: mapped.status === "received" ? null : receivedAt,
    shippedAt: mapped.status === "shipped" ? terminalAt : null,
    cancelledAt: mapped.status === "cancelled" ? terminalAt : null,
    createdAt: receivedAt, updatedAt: receivedAt,
  };
  return { order, lines: mapLines(id, detail) };
}

const isOpen = (status) => status !== "shipped" && status !== "cancelled";

/**
 * Owners come from owners.js (`byClient`, `rejectedClients`, `ambiguousClients`).
 * A client with no single eligible owner loads its orders UNOWNED and is
 * reported by CLIENT Seazona id (a fixed link + re-run attaches them).
 */
export function planOrders({
  summaries, details, owners, rejectedClients = new Set(), ambiguousClients = new Set(), existingSourceIds, existingNumbers = new Set(),
}) {
  const rows = [];
  const byKind = new Map();
  const flag = (kind, id) => byKind.set(kind, [...(byKind.get(kind) ?? []), id]);
  const unownedClients = new Map();
  const counts = { seazona: summaries.length, toInsert: 0, alreadyLoaded: 0, open: 0, withLines: 0, unowned: 0 };
  const numbers = new Set(existingNumbers);
  for (const { seazonaId, payload } of summaries) {
    if (existingSourceIds.has(seazonaId)) { counts.alreadyLoaded += 1; continue; }
    const clientId = payload.clientId == null || payload.clientId === "" ? null : String(payload.clientId);
    const owner = clientId ? owners.get(clientId) ?? null : null;
    const mapped = mapLegacyOrder({ summary: payload, detail: details.get(seazonaId) ?? null, ownerUserId: owner });
    if (mapped.problem) { flag(mapped.problem, seazonaId); continue; }
    if (numbers.has(mapped.order.orderNumber)) { flag("order_number_taken", seazonaId); continue; }
    numbers.add(mapped.order.orderNumber);
    if (!owner) {
      counts.unowned += 1;
      if (!clientId) flag("order_without_client", seazonaId);
      else unownedClients.set(clientId, ambiguousClients.has(clientId) ? "client_has_multiple_owners"
        : rejectedClients.has(clientId) ? "client_owner_not_approved_doctor" : "client_not_loaded");
    }
    rows.push(mapped);
    counts.toInsert += 1;
    if (isOpen(mapped.order.status)) counts.open += 1;
    if (mapped.lines.length) counts.withLines += 1;
  }
  const clientKind = (kind) => [...unownedClients].filter(([, k]) => k === kind).map(([c]) => c);
  const problems = problemList([
    ...byKind,
    ["client_has_multiple_owners", clientKind("client_has_multiple_owners")],
    ["client_owner_not_approved_doctor", clientKind("client_owner_not_approved_doctor")],
    ["client_not_loaded", clientKind("client_not_loaded")],
  ]);
  return { rows, counts, problems };
}
