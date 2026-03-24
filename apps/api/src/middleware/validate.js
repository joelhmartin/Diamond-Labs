import { ERROR_CODES } from "@my-app/shared";

/**
 * Factory that returns a Fastify preHandler to validate request body with a Zod schema.
 */
export function validate(schema) {
  return async (request, reply) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          details: result.error.flatten().fieldErrors,
        },
      });
    }
    request.body = result.data;
  };
}

/**
 * Validate query parameters.
 */
export function validateQuery(schema) {
  return async (request, reply) => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          details: result.error.flatten().fieldErrors,
        },
      });
    }
    request.query = result.data;
  };
}
