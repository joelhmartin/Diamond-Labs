import { labErrorReply } from "../services/lab/lab-errors.js";
import { shippingErrorReply } from "../services/shipping/shipping-errors.js";
import * as auditService from "../services/audit.service.js";

/**
 * Route helpers shared by every /lab route module (lab.routes.js, shipping.routes.js):
 * one error → reply mapping and one audit call, so the two can't drift.
 */

/** A lab or shipping error → its reply ({ status, body }); anything else is not ours (null). */
export function labRouteErrorReply(err) {
  return labErrorReply(err) ?? shippingErrorReply(err);
}

/** Run `fn`, send `{ data }`; a known lab/shipping error becomes its mapped reply, anything else rethrows. */
export async function run(reply, fn, status = 200, mapError = labRouteErrorReply) {
  try {
    const data = await fn();
    return reply.code(status).send({ data });
  } catch (err) {
    const r = mapError(err);
    if (r) return reply.code(r.status).send(r.body);
    throw err;
  }
}

/** Audit metadata is ids/fields/versions only — never decrypted free text or patient data. */
export const audit = (request, action, targetId, metadata, targetType = "lab_order") =>
  auditService.logSafe({ userId: request.user.id, action, targetType, targetId, metadata, ipAddress: request.ip });
