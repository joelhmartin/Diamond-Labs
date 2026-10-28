import { and, desc, eq, gte, ilike, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { CARRIER_LABELS } from "@my-app/shared";
import { db } from "../../config/database.js";
import { shipments, shipmentEvents, labOrderEvents, labOrders } from "../../db/schema/index.js";
import { createId } from "../../lib/id.js";
import { pageOf, containsPattern, prefixPattern } from "../../lib/list-query.js";
import { carrierRegistry } from "./carrier-registry.js";
import { ShippingError, CarrierError, carrierProblem } from "./shipping-errors.js";
import { planVoided } from "./shipment-rules.js";

/**
 * Generic shipments: carrier calls and shipments-table reads/writes. Knows
 * nothing about lab orders; services/lab/lab-shipping.service.js is the glue.
 * Log lines carry carrier, ids and codes only, never bodies or addresses.
 */

// ── Carrier calls ──────────────────────────────────────────────────────────

/** Every enabled carrier's quotes, in parallel (10s each, carrier-http TIMEOUTS.rate), cheapest first. */
export async function rateAll({ shipFrom, shipTo, parcel }, { registry = carrierRegistry(), log = console } = {}) {
  const carriers = registry.enabled().filter((a) => a.id !== "manual");
  const settled = await Promise.allSettled(carriers.map((a) => a.rate({ shipFrom, shipTo, parcel })));
  const quotes = [];
  const errors = [];
  settled.forEach((s, i) => {
    if (s.status === "fulfilled") quotes.push(...s.value);
    else if (s.reason instanceof CarrierError) errors.push(carrierProblem(s.reason));
    else {
      log.error(`[SHIP][RATE_FAILED] carrier=${carriers[i].id} error=${s.reason?.name ?? "unknown"}`);
      errors.push({ carrier: carriers[i].id, code: "ERROR", message: `${carriers[i].label} rating failed.` });
    }
  });
  quotes.sort((a, b) => a.amountCents - b.amountCents);
  return { quotes, errors, disabled: registry.status().filter((s) => !s.ok) };
}

/**
 * Buy one label. A failure after which the label may exist anyway becomes
 * PURCHASE_UNCERTAIN, flagged gatewayOutcomePending so withIdempotency
 * (lib/payment-helpers.js) keeps this attempt's key locked: a retry can't buy
 * a second label. A definite refusal passes through and releases the key.
 */
export async function buyLabel(request, { registry = carrierRegistry(), log = console } = {}) {
  const adapter = registry.get(request.carrier);
  const ready = adapter.configured();
  if (!ready.ok) throw new ShippingError("CARRIER_DISABLED", ready.reason);
  try {
    return { ...(await adapter.createLabel(request)), carrier: request.carrier };
  } catch (err) {
    // A ShippingError or a CarrierError the carrier didn't flag uncertain is a definite failure:
    // nothing was bought, the key is released. Anything else (a CarrierError flagged uncertain,
    // or a non-carrier error such as a parser TypeError after a 200) may have bought a label,
    // so the key stays locked.
    const isCarrierError = err instanceof CarrierError;
    if (err instanceof ShippingError || (isCarrierError && !err.uncertain)) throw err;
    const reference = request.reference ?? null;
    log.error(
      `[SHIP][PURCHASE_UNCERTAIN] carrier=${request.carrier} reference="${reference ?? ""}"` +
        (isCarrierError ? ` code=${err.code}` : ` error=${err?.name ?? "unknown"}`),
    );
    throw new ShippingError("PURCHASE_UNCERTAIN", uncertainPurchaseMessage(request.carrier, reference), {
      gatewayOutcomePending: true, carrier: request.carrier, reference,
    });
  }
}

/** What staff do after an ambiguous purchase: nothing is saved here, so the check is at the carrier. */
export function uncertainPurchaseMessage(carrier, reference) {
  const name = CARRIER_LABELS[carrier] ?? carrier;
  const ref = reference ? ` with the reference "${reference}"` : "";
  return `${name} didn't confirm the label, so it may have been bought. Check the ${name} account for a label${ref} and void it there if it exists, before buying again.`;
}

/**
 * Buy, then persist. If persisting fails, the label is voided at the carrier
 * (best effort); if that fails too, [SHIP][LABEL_ORPHANED] is logged with ids
 * only and staff get the tracking number to void it by hand.
 */
export async function purchaseAndPersist(request, persist, { registry = carrierRegistry(), log = console } = {}) {
  const label = await buyLabel(request, { registry, log });
  try {
    return await persist(label);
  } catch (err) {
    const voided = await registry.get(label.carrier).voidLabel(label).catch(() => ({ ok: false }));
    if (!voided.ok) log.error(`[SHIP][LABEL_ORPHANED] carrier=${label.carrier} tracking=${label.trackingNumber ?? "none"}`);
    const message = voided.ok
      ? "The label was bought but couldn't be saved, so it was voided. Try again."
      : `The label was bought but couldn't be saved or voided. Tell an admin: ${CARRIER_LABELS[label.carrier]} ${label.trackingNumber ?? ""}`.trim();
    // A live label may still exist: keep the idempotency key locked (P5).
    throw new ShippingError("LABEL_NOT_SAVED", message, { cause: err, gatewayOutcomePending: !voided.ok });
  }
}

/** Void at the carrier; a refusal (already picked up, …) is shown to staff in the carrier's words. */
export async function voidAtCarrier(shipment, { registry = carrierRegistry() } = {}) {
  const out = await registry.get(shipment.carrier).voidLabel({ carrierShipmentId: shipment.carrierShipmentId, trackingNumber: shipment.trackingNumber });
  if (!out.ok) throw new ShippingError("VOID_REFUSED", `${CARRIER_LABELS[shipment.carrier]} refused the void: ${out.reason ?? "no reason given"}`);
}

// ── Writes (caller's transaction) ──────────────────────────────────────────

export async function insertShipment(tx, { shipment, event }) {
  await tx.insert(shipments).values(shipment);
  await tx.insert(shipmentEvents).values({ ...event, id: createId() });
}

/**
 * Persist a void. Conditional: only while the label is unused (shipped_at IS NULL
 * and status label_created), so a "Mark shipped" racing the void can't both win.
 * Zero rows -> VOID_REFUSED (P6); the caller has already voided at the carrier.
 */
export async function markVoided(tx, shipment, { now, log = console }) {
  const { patch, event } = planVoided(shipment, { now });
  const [hit] = await tx
    .update(shipments)
    .set(patch)
    .where(and(eq(shipments.id, shipment.id), isNull(shipments.shippedAt), eq(shipments.status, "label_created")))
    .returning({ id: shipments.id });
  if (!hit) {
    log.error(`[SHIP][VOID_RACE] shipment=${shipment.id} carrier=${shipment.carrier}`);
    throw new ShippingError("VOID_REFUSED", "This shipment changed while it was being voided, so the void wasn't saved. Check the label at the carrier.");
  }
  await tx.insert(shipmentEvents).values({ ...event, id: createId() });
}

/**
 * Claim "the box left": sets shippedAt once. Returns true only for the caller
 * that set it (so exactly one shipped email goes out). A manual shipment also
 * moves to in_transit with a staff event: nothing else ever moves it.
 */
export async function stampShipped(tx, shipment, { now }) {
  const manualHandOff = shipment.carrier === "manual" && shipment.status === "label_created";
  const [claimed] = await tx
    .update(shipments)
    .set({ shippedAt: now, updatedAt: now, ...(manualHandOff ? { status: "in_transit" } : {}) })
    .where(and(eq(shipments.id, shipment.id), isNull(shipments.shippedAt), ne(shipments.status, "voided")))
    .returning({ id: shipments.id });
  if (claimed && manualHandOff) {
    await tx.insert(shipmentEvents).values({
      id: createId(), shipmentId: shipment.id, status: "in_transit", description: "Handed off (recorded by staff)", location: null, occurredAt: now, source: "staff",
    });
  }
  return Boolean(claimed);
}

/** Write a planTrackingUpdate plan, only if the status is still the one read (a void mid-sync wins). */
export async function applyTrackingPlan(tx, shipment, { patch, event }) {
  const [hit] = await tx
    .update(shipments)
    .set(patch)
    .where(and(eq(shipments.id, shipment.id), eq(shipments.status, shipment.status)))
    .returning({ id: shipments.id });
  if (hit && event) await tx.insert(shipmentEvents).values({ ...event, id: createId() });
  return Boolean(hit);
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Every column except the label image (lists, details, the doctor view's source). */
export const SUMMARY = {
  id: shipments.id, carrier: shipments.carrier, serviceCode: shipments.serviceCode, serviceName: shipments.serviceName,
  carrierShipmentId: shipments.carrierShipmentId, trackingNumber: shipments.trackingNumber, status: shipments.status,
  chargeCents: shipments.chargeCents, currency: shipments.currency, parcel: shipments.parcel, shipTo: shipments.shipTo,
  labelFormat: shipments.labelFormat, hasLabel: sql`${shipments.labelData} is not null`.mapWith(Boolean),
  createdByUserId: shipments.createdByUserId, purchasedAt: shipments.purchasedAt, shippedAt: shipments.shippedAt,
  deliveredAt: shipments.deliveredAt, voidedAt: shipments.voidedAt, lastTrackedAt: shipments.lastTrackedAt,
  trackingError: shipments.trackingError,
};

export async function getShipment(id, database = db) {
  const [row] = await database.select(SUMMARY).from(shipments).where(eq(shipments.id, id));
  return row ?? null;
}

export async function shipmentSummaries(ids, database = db) {
  if (!ids.length) return new Map();
  const rows = await database.select(SUMMARY).from(shipments).where(inArray(shipments.id, ids));
  return new Map(rows.map((r) => [r.id, r]));
}

export const SHIPMENT_LIST_LIMIT = 500;

/**
 * The one WHERE for Admin › Shipments (rows and total). `q` matches the
 * tracking number (contains) or the number of an order the box carried
 * (prefix; from the "shipment" link events, so a voided label still matches).
 */
export function shipmentListWhere({ status, carrier, from, to, q } = {}) {
  const conds = [];
  if (status) conds.push(eq(shipments.status, status));
  if (carrier) conds.push(eq(shipments.carrier, carrier));
  if (from) conds.push(gte(shipments.purchasedAt, sql`(${from}::date)::timestamp at time zone 'America/Chicago'`));
  if (to) conds.push(lt(shipments.purchasedAt, sql`((${to}::date + 1)::timestamp) at time zone 'America/Chicago'`));
  if (q) {
    conds.push(or(
      ilike(shipments.trackingNumber, containsPattern(q)),
      sql`exists (select 1 from ${labOrderEvents} inner join ${labOrders} on ${labOrders.id} = ${labOrderEvents.labOrderId} where ${labOrderEvents.type} = 'shipment' and ${labOrderEvents.to} = ${shipments.id} and ${labOrders.orderNumber}::text like ${prefixPattern(q)})`,
    ));
  }
  return conds.length ? and(...conds) : undefined;
}

/**
 * Admin › Shipments: newest first; filters by status, carrier, lab-local
 * purchase date range and `q`. Capped at SHIPMENT_LIST_LIMIT, or one page when
 * `limit`/`offset` are given (id breaks purchase-time ties so pages don't overlap).
 */
export function listShipments(filters = {}, database = db) {
  const page = pageOf(filters);
  const query = database
    .select(SUMMARY)
    .from(shipments)
    .where(shipmentListWhere(filters))
    .orderBy(...(page ? [desc(shipments.purchasedAt), desc(shipments.id)] : [desc(shipments.purchasedAt)]));
  return page ? query.limit(page.limit).offset(page.offset) : query.limit(SHIPMENT_LIST_LIMIT);
}

/** How many shipments match the list's filters (ignores limit/offset). */
export async function countShipments(filters = {}, database = db) {
  const [{ n }] = await database.select({ n: sql`count(*)`.mapWith(Number) }).from(shipments).where(shipmentListWhere(filters));
  return n;
}

/** Labelled boxes still waiting for the hand-off ("Mark all labelled shipped"). */
export async function unshippedShipmentIds(database = db) {
  const rows = await database
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(isNull(shipments.shippedAt), eq(shipments.status, "label_created")));
  return rows.map((r) => r.id);
}

/** The stored label as bytes, or null (no such shipment, or a manual one with no label). */
export async function getLabel(id, database = db) {
  const [row] = await database
    .select({ carrier: shipments.carrier, labelFormat: shipments.labelFormat, trackingNumber: shipments.trackingNumber, labelData: shipments.labelData })
    .from(shipments)
    .where(eq(shipments.id, id));
  if (!row?.labelData || !row.labelFormat) return null;
  return { carrier: row.carrier, labelFormat: row.labelFormat, trackingNumber: row.trackingNumber, bytes: Buffer.from(row.labelData, "base64") };
}
