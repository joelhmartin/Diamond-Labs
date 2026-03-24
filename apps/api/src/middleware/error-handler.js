import { ERROR_CODES } from "@my-app/shared";

export function errorHandler(error, request, reply) {
  request.log.error(error);

  // Fastify rate limit error
  if (error.statusCode === 429) {
    return reply.code(429).send({ error: ERROR_CODES.RATE_LIMITED });
  }

  // Zod validation errors thrown directly
  if (error.name === "ZodError") {
    return reply.code(422).send({
      error: {
        ...ERROR_CODES.VALIDATION_ERROR,
        details: error.flatten().fieldErrors,
      },
    });
  }

  // Known app errors with a status
  if (error.statusCode && error.code) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message, status: error.statusCode },
    });
  }

  // Fallback
  const status = error.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production" ? "An internal error occurred." : error.message;

  return reply.code(status).send({
    error: { code: "INTERNAL_ERROR", message, status },
  });
}
