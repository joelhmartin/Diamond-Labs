import {
  pickupRequestSchema, labPickupRequestSchema, pickupScheduleSchema, pickupCompleteSchema,
  pickupCancelSchema, pickupDoctorCancelSchema, pickupListQuerySchema, labPickupListQuerySchema, labDeliveriesQuerySchema,
  isoDateIn, LAB_TIMEZONE,
} from "@my-app/shared";
import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireClientPortal } from "../middleware/require-role.js";
import { validate, validateQuery } from "../middleware/validate.js";
import * as pickupsService from "../services/lab/pickups.service.js";
import { listStops, deliveryRange } from "../services/lab/deliveries.service.js";
import { db } from "../config/database.js";
import { STAFF } from "./lab.routes.js";
import { run, audit, labRouteErrorReply } from "./lab-route-helpers.js";
import { invoiceErrorReply } from "../services/billing/invoice-errors.js";

/**
 * Pickups (spec "API routes → Pickups and deliveries"). Clients (the client
 * portal: practice staff, group admins, doctors) list by practice scope
 * (`?account=`) and cancel; a doctor requests (the ship-to is their profile
 * address), naming the practice when they have several; staff list, enter for
 * a client (and the client's practice), schedule, complete and cancel, and
 * read the local-delivery route sheet. Another practice's pickup is 404, a
 * stale version 409, "All practices" without a practice 422.
 * Audit metadata is ids, numbers and versions only: never notes or reasons.
 */
const summary = (p) => ({ id: p.id, status: p.status, version: p.version });
// Staff entry also refuses through practice-of.js (PRACTICE_REQUIRED 422, NOT_FOUND 404).
const practiceOrLabErrorReply = (err) => labRouteErrorReply(err) ?? invoiceErrorReply(err);

export default async function pickupsRoutes(fastify) {
  // ── Client portal (by practice scope) ─────────────────────────────────────
  fastify.get("/pickups", { preHandler: [authenticate, requireClientPortal, validateQuery(pickupListQuerySchema)] }, (request, reply) =>
    run(reply, () => pickupsService.listPickups(request.user, request.query)));

  // One of the practice's pickups (a notification's ?pickup= link); another practice's is 404.
  fastify.get("/pickups/:id", { preHandler: [authenticate, requireClientPortal] }, (request, reply) =>
    run(reply, () => pickupsService.getPickup(request.params.id, request.user)));

  fastify.post("/pickups", { preHandler: [authenticate, requireApprovedDoctor, validate(pickupRequestSchema)] }, (request, reply) =>
    run(reply, async () => {
      const p = await pickupsService.requestPickup(request.user, request.body);
      audit(request, "pickup.requested", p.id, { pickupNumber: p.pickupNumber, source: p.source }, "pickup");
      return p;
    }, 201));

  fastify.post("/pickups/:id/cancel", { preHandler: [authenticate, requireClientPortal, validate(pickupDoctorCancelSchema)] }, (request, reply) =>
    run(reply, async () => {
      const p = await pickupsService.cancelPickup(request.params.id, request.body, request.user);
      audit(request, "pickup.cancelled", p.id, { pickupNumber: p.pickupNumber, version: p.version }, "pickup");
      return summary(p);
    }));

  // ── Lab staff ─────────────────────────────────────────────────────────────
  fastify.get("/lab/pickups", { preHandler: [...STAFF, validateQuery(labPickupListQuerySchema)] }, (request, reply) =>
    run(reply, () => pickupsService.listPickups(request.user, request.query)));

  fastify.get("/lab/pickups/:id", { preHandler: STAFF }, (request, reply) =>
    run(reply, () => pickupsService.getPickup(request.params.id, request.user)));

  fastify.get("/lab/pickup-clients", { preHandler: STAFF }, (request, reply) =>
    run(reply, async () => ({ clients: await pickupsService.searchPickupClients(request.query?.q) })));

  fastify.post("/lab/pickups", { preHandler: [...STAFF, validate(labPickupRequestSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { clientUserId, ...input } = request.body;
      const p = await pickupsService.requestPickup(request.user, input, { onBehalfOfClientUserId: clientUserId });
      audit(request, "pickup.requested", p.id, { pickupNumber: p.pickupNumber, source: p.source, clientUserId }, "pickup");
      return p;
    }, 201, practiceOrLabErrorReply));

  fastify.post("/lab/pickups/:id/schedule", { preHandler: [...STAFF, validate(pickupScheduleSchema)] }, (request, reply) =>
    run(reply, async () => {
      const p = await pickupsService.schedulePickup(request.params.id, request.body, request.user);
      audit(request, "pickup.scheduled", p.id, { scheduledDate: p.scheduledDate, assigneeUserId: p.assigneeUserId, version: p.version }, "pickup");
      return summary(p);
    }));

  fastify.post("/lab/pickups/:id/complete", { preHandler: [...STAFF, validate(pickupCompleteSchema)] }, (request, reply) =>
    run(reply, async () => {
      const p = await pickupsService.completePickup(request.params.id, request.body, request.user);
      audit(request, "pickup.completed", p.id, { version: p.version }, "pickup");
      return summary(p);
    }));

  // The local-delivery route sheet: stops (day × practice) for from..to (default today in CT .. +6).
  fastify.get("/lab/deliveries", { preHandler: [...STAFF, validateQuery(labDeliveriesQuerySchema)] }, (request, reply) =>
    run(reply, async () => {
      const range = deliveryRange(request.query ?? {}, isoDateIn(LAB_TIMEZONE));
      return { ...range, stops: await listStops(db, range) };
    }));

  fastify.post("/lab/pickups/:id/cancel", { preHandler: [...STAFF, validate(pickupCancelSchema)] }, (request, reply) =>
    run(reply, async () => {
      const p = await pickupsService.cancelPickup(request.params.id, request.body, request.user);
      audit(request, "pickup.cancelled", p.id, { pickupNumber: p.pickupNumber, version: p.version }, "pickup");
      return summary(p);
    }));
}
