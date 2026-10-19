import {
  ERROR_CODES, LABEL_CONTENT_TYPES, shipmentRatesSchema, shipmentBuySchema, shipmentListQuerySchema,
} from "@my-app/shared";
import { redis } from "../config/redis.js";
import { validate, validateQuery } from "../middleware/validate.js";
import { withIdempotency, ChargeInProgressError } from "../lib/payment-helpers.js";
import * as labShipping from "../services/lab/lab-shipping.service.js";
import { shipContext, listShipmentsForLab } from "../services/lab/lab-shipping-queries.js";
import { getLabel } from "../services/shipping/shipments.service.js";
import { carrierRegistry } from "../services/shipping/carrier-registry.js";
import { LabOrderError } from "../services/lab/lab-order-rules.js";
import { STAFF } from "./lab.routes.js";
import { run as runRoute, audit as auditRoute, labRouteErrorReply } from "./lab-route-helpers.js";

/**
 * Shipping labels (own-the-lab piece 4). Lab staff and admins rate, buy,
 * print, void and mark shipped. Every purchase, void, mark-shipped and label
 * view is audited with ids only. Carrier errors reach staff in the carrier's
 * own words; credentials never leave the server.
 */

const IN_PROGRESS = "This label purchase is already in progress, or its result is uncertain. Check Admin › Shipments before retrying.";

/** A shipping or lab error → its reply; a lab conflict behind LABEL_NOT_SAVED reads as one sentence. */
export function shippingReply(err) {
  const r = labRouteErrorReply(err);
  if (r && err?.code === "LABEL_NOT_SAVED" && err.cause instanceof LabOrderError) {
    r.body.error.message = `${err.cause.message} ${err.message}`;
  }
  return r;
}

const audit = (request, action, targetId, metadata) => auditRoute(request, action, targetId, metadata, "shipment");
const run = (reply, fn, status) => runRoute(reply, fn, status, shippingReply);

/**
 * Buy: one Idempotency-Key per attempt (web useAttemptKey). A retry of the
 * same attempt replays the cached result; a key held by an uncertain purchase
 * stays locked (gatewayOutcomePending, see withIdempotency) and answers 409
 * instead of buying again.
 */
async function buyHandler(request, reply) {
  const key = request.headers["idempotency-key"];
  if (!key) {
    return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." } });
  }
  const scope = [...request.body.orderIds].sort()[0];
  try {
    const outcome = await withIdempotency(
      redis,
      `ship-buy:${scope}:${key}`,
      () => labShipping.buyForOrders({ ...request.body, byUserId: request.user.id }, { log: request.log }),
      { log: request.log },
    );
    if (!outcome.replayed) audit(request, "shipment.purchased", outcome.result.shipmentId, {
      carrier: outcome.result.carrier, orderIds: outcome.result.orderIds, chargeCents: outcome.result.chargeCents,
    });
    return reply.code(201).send({ data: outcome.result });
  } catch (err) {
    if (err instanceof ChargeInProgressError) return reply.code(409).send({ error: { code: "IN_PROGRESS", status: 409, message: IN_PROGRESS } });
    const r = shippingReply(err);
    if (r) return reply.code(r.status).send(r.body);
    throw err;
  }
}

async function labelHandler(request, reply) {
  const label = await getLabel(request.params.id);
  if (!label) return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "This shipment has no label." } });
  audit(request, "shipment.label_viewed", request.params.id, { carrier: label.carrier, format: label.labelFormat });
  const safe = String(label.trackingNumber ?? request.params.id).replace(/[^A-Za-z0-9]/g, "");
  const disposition = label.labelFormat === "zpl" ? "attachment" : "inline";
  return reply
    .header("Cache-Control", "no-store")
    .header("Content-Type", LABEL_CONTENT_TYPES[label.labelFormat])
    .header("Content-Disposition", `${disposition}; filename="label-${safe}.${label.labelFormat}"`)
    .send(label.bytes);
}

export default async function shippingRoutes(fastify) {
  fastify.get("/lab/orders/:id/ship", { preHandler: STAFF }, async (request, reply) => {
    const context = await shipContext(request.params.id);
    if (!context) return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    return { data: context };
  });

  fastify.get("/lab/carriers", { preHandler: STAFF }, async () => ({ data: { carriers: carrierRegistry().status() } }));

  fastify.post("/lab/shipments/rates", { preHandler: [...STAFF, validate(shipmentRatesSchema)] }, (request, reply) =>
    run(reply, () => labShipping.rateShipment(request.body)));

  fastify.post("/lab/shipments", { preHandler: [...STAFF, validate(shipmentBuySchema)] }, buyHandler);

  fastify.get("/lab/shipments", { preHandler: [...STAFF, validateQuery(shipmentListQuerySchema)] }, async (request) => ({
    data: await listShipmentsForLab(request.query),
  }));

  fastify.get("/lab/shipments/:id/label", { preHandler: STAFF }, labelHandler);

  fastify.post("/lab/shipments/:id/void", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => {
      const out = await labShipping.voidShipment(request.params.id, { byUserId: request.user.id }, { log: request.log });
      audit(request, "shipment.voided", request.params.id, { orderIds: out.orderIds, invoiceLineRemoved: out.invoiceLineRemoved });
      return out;
    }));

  fastify.post("/lab/shipments/:id/mark-shipped", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => {
      const out = await labShipping.markShipmentShipped(request.params.id, { byUserId: request.user.id }, { log: request.log });
      audit(request, "shipment.marked_shipped", request.params.id, { ordersShipped: out.ordersShipped, alreadyShipped: out.alreadyShipped });
      return out;
    }));

  fastify.post("/lab/shipments/mark-all-shipped", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => {
      const out = await labShipping.markAllLabelledShipped({ byUserId: request.user.id }, { log: request.log });
      audit(request, "shipment.marked_all_shipped", null, out);
      return out;
    }));
}
