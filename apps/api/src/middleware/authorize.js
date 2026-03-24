import { hasPermission } from "@my-app/shared";
import { ERROR_CODES } from "@my-app/shared";

/**
 * Factory that returns a Fastify preHandler checking the membership's role
 * has the required permission.
 */
export function authorize(requiredPermission) {
  return async (request, reply) => {
    const membership = request.membership;
    if (!membership) {
      return reply.code(403).send({
        error: ERROR_CODES.NOT_ACCOUNT_MEMBER,
      });
    }

    if (membership.status !== "active") {
      return reply.code(403).send({
        error: { ...ERROR_CODES.FORBIDDEN, message: "Your membership is not active." },
      });
    }

    const { getRoleBySlug } = await import("@my-app/shared");
    const role = getRoleBySlug(membership.role);
    if (!role) {
      return reply.code(403).send({ error: ERROR_CODES.FORBIDDEN });
    }

    if (!hasPermission(role.permissions, requiredPermission)) {
      return reply.code(403).send({
        error: { ...ERROR_CODES.FORBIDDEN, message: `You do not have the '${requiredPermission}' permission.` },
      });
    }
  };
}
