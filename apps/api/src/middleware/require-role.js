import { ERROR_CODES } from "@my-app/shared";

/**
 * Generic role guard — accepts one or more allowed user roles.
 */
export function requireRole(...roles) {
  return async (request, reply) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return reply.code(403).send({
        error: { ...ERROR_CODES.FORBIDDEN, message: "Insufficient role." },
      });
    }
  };
}

/**
 * Requires an approved doctor account.
 */
export async function requireApprovedDoctor(request, reply) {
  if (!request.user || request.user.role !== "doctor" || request.user.approvalStatus !== "approved") {
    return reply.code(403).send({
      error: { ...ERROR_CODES.FORBIDDEN, message: "Approved doctor account required." },
    });
  }
}

/**
 * Requires an admin account.
 */
export async function requireAdmin(request, reply) {
  if (!request.user || request.user.role !== "admin") {
    return reply.code(403).send({
      error: { ...ERROR_CODES.FORBIDDEN, message: "Admin access required." },
    });
  }
}
