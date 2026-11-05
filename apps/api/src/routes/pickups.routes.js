import {
  pickupRequestSchema, labPickupRequestSchema, pickupScheduleSchema, pickupCompleteSchema,
  pickupCancelSchema, pickupDoctorCancelSchema, pickupListQuerySchema, labPickupListQuerySchema,
} from "@my-app/shared";
import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import { validate, validateQuery } from "../middleware/validate.js";
import * as pickupsService from "../services/lab/pickups.service.js";
import { STAFF } from "./lab.routes.js";
import { run, audit } from "./lab-route-helpers.js";

/**
 * Pickups (spec "API routes → Pickups and deliveries"). Doctors request, list
 * (practice-wide) and cancel; staff list, enter for a client, schedule,
 * complete and cancel. Another practice's pickup is 404, a stale version 409.
 * Audit metadata is ids, numbers and versions only: never notes or reasons.
 */
const summary = (p) => ({ id: p.id, status: p.status, version: p.version });

export default async function pickupsRoutes(fastify) {
  // ── Doctor (practice-wide) ────────────────────────────────────────────────
  fastify.get("/pickups", { preHandler: [authenticate, requireApprovedDoctor, validateQuery(pickupListQuerySchema)] }, (request, reply) =>
    run(reply, () => pickupsService.listPickups(request.user, request.query)));

  fastify.post("/pickups", { preHandler: [authenticate, requireApprovedDoctor, validate(pickupRequestSchema)] }, (request, reply) =>
    run(reply, async () => {
      const p = await pickupsService.requestPickup(request.user, request.body);
      audit(request, "pickup.requested", p.id, { pickupNumber: p.pickupNumber, source: p.source }, "pickup");
      return p;
    }, 201));

  fastify.post("/pickups/:id/cancel", { preHandler: [authenticate, requireApprovedDoctor, validate(pickupDoctorCancelSchema)] }, (request, reply) =>
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
    }, 201));

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

  fastify.post("/lab/pickups/:id/cancel", { preHandler: [...STAFF, validate(pickupCancelSchema)] }, (request, reply) =>
    run(reply, async () => {
      const p = await pickupsService.cancelPickup(request.params.id, request.body, request.user);
      audit(request, "pickup.cancelled", p.id, { pickupNumber: p.pickupNumber, version: p.version }, "pickup");
      return summary(p);
    }));
}
