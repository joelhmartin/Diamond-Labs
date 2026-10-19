import { carrierName, trackingUrl } from "@my-app/shared";
import { db } from "../../config/database.js";
import { env } from "../../config/env.js";
import { labIdentity } from "../../config/lab-identity.js";
import { createId } from "../../lib/id.js";
import { sendShippedNotice } from "../email.service.js";
import { addShipmentLine, removeShipmentLine } from "../billing/invoices.service.js";
import { carrierRegistry } from "../shipping/carrier-registry.js";
import { ShippingError } from "../shipping/shipping-errors.js";
import { planNewShipment, assertVoidable } from "../shipping/shipment-rules.js";
import * as shipments from "../shipping/shipments.service.js";
import { mutateIn, changeStatus, billingFollowUp } from "./lab-orders.service.js";
import { LabOrderError, assertFresh, planStatusChange, planShipmentLink, planShipmentUnlink } from "./lab-order-rules.js";
import { planShippable, shipmentReference, planShippingCharge, assertOrdersVoidable, billableOrders } from "./lab-shipping-rules.js";
import { loadOrders, ordersOnShipment, shipmentRecipient } from "./lab-shipping-queries.js";

/**
 * Lab glue: shipments (the generic layer, services/shipping/) ↔ lab orders and
 * their invoices. Orders always move through mutateIn + planStatusChange +
 * billingFollowUp, exactly like every other status change, so a shipped order's
 * invoice is issued the same way. `deps` exists for tests; production omits it.
 */
function resolve(deps = {}) {
  return {
    database: deps.database ?? db,
    registry: deps.registry ?? carrierRegistry(),
    log: deps.log ?? console,
    shipFrom: deps.shipFrom !== undefined ? deps.shipFrom : labIdentity().address,
    charge: deps.charge ?? { policy: env.SHIPPING_CHARGE_POLICY, flatCents: env.SHIPPING_FLAT_CENTS },
    emailEnabled: deps.emailEnabled ?? env.SHIPPED_EMAIL_ENABLED,
  };
}

export function rateShipment({ shipTo, parcel }, deps) {
  const d = resolve(deps);
  return shipments.rateAll({ shipFrom: d.shipFrom, shipTo, parcel }, { registry: d.registry });
}

/**
 * Buy one label for one or more orders (ship together). Checks every order
 * BEFORE the carrier is called, then saves the shipment, links each order and
 * applies the charge policy in ONE transaction. If that transaction fails, the
 * label is voided at the carrier (shipments.service purchaseAndPersist).
 * Idempotency is the route's job (withIdempotency).
 */
export async function buyForOrders({ orderIds, shipTo, parcel, carrier, serviceCode, manual, byUserId = null }, deps) {
  const d = resolve(deps);
  const ordered = planShippable(await loadOrders(orderIds, d.database), orderIds);
  const request = {
    carrier, serviceCode, manual, shipFrom: d.shipFrom, shipTo, parcel,
    reference: shipmentReference(ordered.map((o) => o.orderNumber)),
  };
  // `persist` must throw ONLY before its transaction commits: purchaseAndPersist voids the
  // label at the carrier on any throw, so a post-commit failure would void a saved label.
  // Everything after the commit therefore runs below, after purchaseAndPersist returns.
  const saved = await shipments.purchaseAndPersist(
    request,
    (label) => d.database.transaction((tx) => persistShipment(tx, { label, ordered, parcel, shipTo, byUserId, d })),
    { registry: d.registry, log: d.log },
  );
  await afterCommit(d, () => d.log.info?.(`[SHIP][BOUGHT] shipment=${saved.shipmentId} carrier=${saved.carrier} orders=${saved.orderNumbers.join(",")}`));
  return saved;
}

/**
 * Work that follows a commit (logging, notices) can never fail the operation it
 * follows: it is awaited, but nothing it throws (nor onError) escapes.
 */
async function afterCommit(d, fn, onError) {
  try {
    await fn();
  } catch (err) {
    try {
      onError?.(err);
    } catch {
      // a broken log sink must not reject after the state is saved
    }
  }
}

/** Error name/code for logs: never the message, which can carry addresses or bodies. */
const errTag = (err) => err?.code ?? err?.name ?? "unknown";

/** A system note on a lab order's history (ids/text only, never PHI). Inside the caller's transaction. */
function noteOrder(tx, labOrderId, text, { byUserId, now }) {
  return mutateIn(tx, labOrderId, null, (order) => ({
    patch: { version: order.version + 1, updatedAt: now },
    event: { labOrderId: order.id, type: "note", from: null, to: null, byUserId, note: text, at: now },
  }));
}

async function persistShipment(tx, { label, ordered, parcel, shipTo, byUserId, d }) {
  const now = new Date();
  const plan = planNewShipment({ id: createId(), label, parcel, shipTo, shipFrom: d.shipFrom, createdByUserId: byUserId, now });
  await shipments.insertShipment(tx, plan);
  const linked = [];
  for (const o of ordered) {
    const { order } = await mutateIn(tx, o.id, null, (current) => planShipmentLink(current, plan.shipment, { byUserId, now }));
    linked.push(order);
  }
  const invoiceLine = await applyShippingCharge(tx, { label, orders: linked, shipmentId: plan.shipment.id, byUserId, now, charge: d.charge });
  const s = plan.shipment;
  return {
    shipmentId: s.id, carrier: s.carrier, serviceName: s.serviceName, trackingNumber: s.trackingNumber,
    chargeCents: s.chargeCents, labelFormat: s.labelFormat, hasLabel: Boolean(s.labelData),
    orderIds: linked.map((o) => o.id), orderNumbers: linked.map((o) => o.orderNumber), invoiceLine,
  };
}

/** The charge policy's line on the right draft; when it can't land, the order's history says why. */
async function applyShippingCharge(tx, { label, orders, shipmentId, byUserId, now, charge }) {
  const plan = planShippingCharge({ ...charge, label, orders });
  const noted = { byUserId, now };
  if (!plan.add) {
    if (plan.reason === "charge_unknown") {
      await noteOrder(tx, plan.labOrderId, "The carrier reported no charge for this label, so shipping was not added to the bill. Add it by hand if it applies.", noted);
    }
    return { added: false, reason: plan.reason };
  }
  const out = await addShipmentLine(tx, { labOrderId: plan.labOrderId, shipmentId, description: plan.description, unitCents: plan.unitCents, byUserId });
  if (!out.added) {
    const why = out.reason === "not_draft" ? `invoice #${out.invoiceNumber} is no longer a draft` : "it has no invoice";
    await noteOrder(tx, plan.labOrderId, `Shipping was not added to the bill: ${why}.`, noted);
  }
  return out;
}

/**
 * Void an unused label: carrier first (a refusal stops here, in the carrier's
 * words), then the shipment, every order's link and the invoice line it added,
 * in one transaction. A DB failure after the carrier voided is logged
 * [SHIP][VOID_UNRECORDED] (ids only) for staff to reconcile.
 */
export async function voidShipment(shipmentId, { byUserId = null } = {}, deps) {
  const d = resolve(deps);
  const shipment = await shipments.getShipment(shipmentId, d.database);
  if (!shipment) throw new ShippingError("NOT_FOUND", "Shipment not found.");
  const linked = await ordersOnShipment(shipmentId, d.database);
  assertVoidable(shipment);
  assertOrdersVoidable(linked);
  await shipments.voidAtCarrier(shipment, { registry: d.registry });
  try {
    return await d.database.transaction(async (tx) => {
      const now = new Date();
      // First, and conditional (P6): if the box moved meanwhile this throws VOID_REFUSED
      // before any order is unlinked or any invoice line removed.
      await shipments.markVoided(tx, shipment, { now, log: d.log });
      for (const o of linked) await mutateIn(tx, o.id, null, (current) => planShipmentUnlink(current, shipment, { byUserId, now }));
      const line = await removeShipmentLine(tx, { shipmentId, byUserId });
      if (line.skipped.length && linked[0]) {
        const nums = line.skipped.map((x) => `#${x.invoiceNumber}`).join(", ");
        await noteOrder(tx, (billableOrders(linked)[0] ?? linked[0]).id, `Label voided, but shipping on invoice ${nums} was left in place: it is no longer a draft. Correct it with a credit.`, { byUserId, now });
      }
      return {
        shipmentId, orderIds: linked.map((o) => o.id), invoiceLineRemoved: line.removed > 0,
        ...(line.skipped.length ? { invoiceLineSkipped: line.skipped } : {}),
      };
    });
  } catch (err) {
    // A VOID_REFUSED race was already logged by markVoided as [SHIP][VOID_RACE].
    if (!(err instanceof ShippingError && err.code === "VOID_REFUSED")) {
      d.log.error(`[SHIP][VOID_UNRECORDED] shipment=${shipmentId} carrier=${shipment.carrier}`);
    }
    throw err;
  }
}

/**
 * The box left. Every order on the shipment still at ready_to_ship moves to
 * shipped (each invoice is issued by billingFollowUp, in a savepoint), and
 * shippedAt is claimed once. After commit, ONLY the caller that claimed it sends
 * the one shipped email. Safe to call twice (staff and the tracking sync racing).
 */
export async function markShipmentShipped(shipmentId, { byUserId = null } = {}, deps) {
  const d = resolve(deps);
  const result = await d.database.transaction(async (tx) => {
    const shipment = await shipments.getShipment(shipmentId, tx);
    if (!shipment) throw new ShippingError("NOT_FOUND", "Shipment not found.");
    if (shipment.status === "voided") throw new ShippingError("INVALID", "This label was voided.");
    const now = new Date();
    const claimed = await shipments.stampShipped(tx, shipment, { now });
    const moved = [];
    for (const o of await ordersOnShipment(shipmentId, tx)) {
      if (o.status !== "ready_to_ship") continue;
      const { order } = await mutateIn(tx, o.id, null, (current) => ({
        ...planStatusChange(current, "shipped", { byUserId, now }),
        after: billingFollowUp("shipped", byUserId),
      }));
      moved.push(order.orderNumber);
    }
    return { shipment, claimed, moved };
  });
  if (result.claimed) {
    await afterCommit(d, () => notifyShipped(result.shipment, d), (err) =>
      d.log.error(`[SHIP][EMAIL_FAILED] shipment=${shipmentId} error=${errTag(err)}`));
  }
  return { shipmentId, ordersShipped: result.moved, alreadyShipped: !result.claimed };
}

async function notifyShipped(shipment, d) {
  if (!d.emailEnabled || !shipment.trackingNumber) return false;
  const boxed = await ordersOnShipment(shipment.id, d.database);
  const to = await shipmentRecipient(boxed, d.database);
  if (!to) return false;
  return sendShippedNotice({
    to, orderNumbers: boxed.map((o) => o.orderNumber), carrier: carrierName(shipment),
    trackingNumber: shipment.trackingNumber, trackingUrl: trackingUrl(shipment.carrier, shipment.trackingNumber),
  });
}

/**
 * "→ Shipped" on one order (the order page, a board card). An unlabelled order
 * (a pick-up, a hand delivery) takes the normal status path; a labelled one
 * ships its whole box.
 */
export async function markOrderShipped(labOrderId, { expectedVersion, byUserId = null }, deps) {
  const d = resolve(deps);
  const [order] = await loadOrders([labOrderId], d.database);
  if (!order) throw new LabOrderError("NOT_FOUND", "Lab order not found.");
  if (!order.shipmentId) return changeStatus(labOrderId, { to: "shipped", expectedVersion, byUserId });
  // Freshness is checked here, outside the box's transaction, and the move runs with expectedVersion
  // null; the conditional UPDATE in mutateIn still prevents a lost write.
  assertFresh(order, expectedVersion);
  const out = await markShipmentShipped(order.shipmentId, { byUserId }, deps);
  const [after] = await loadOrders([labOrderId], d.database);
  // false when this order was skipped (it wasn't at ready_to_ship) or the box had already shipped
  return { order: after, changed: out.ordersShipped.includes(order.orderNumber) };
}

/** End-of-day hand-off: every labelled, unshipped box. One failure is logged and the rest still ship. */
export async function markAllLabelledShipped({ byUserId = null } = {}, deps) {
  const d = resolve(deps);
  let shipped = 0;
  let failed = 0;
  for (const id of await shipments.unshippedShipmentIds(d.database)) {
    try {
      await markShipmentShipped(id, { byUserId }, deps);
      shipped += 1;
    } catch (err) {
      failed += 1;
      d.log.error(`[SHIP][MARK_SHIPPED_FAILED] shipment=${id} error=${errTag(err)}`);
    }
  }
  return { shipped, failed };
}
