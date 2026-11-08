import { contactMessageSchema, ERROR_CODES } from "@my-app/shared";
import { sendContactMessage } from "../services/email.service.js";

/**
 * Public marketing-site contact form. Deliberately thin: it validates and hands
 * off to email, stores nothing, so it can be swapped for dashboard forms later.
 */
export default async function contactRoutes(fastify) {
  fastify.post("/contact", {
    config: { rateLimit: { max: 5, timeWindow: "10 minutes" } },
  }, async (request, reply) => {
    const body = request.body ?? {};
    // Honeypot: humans never see this field. Look successful so bots don't adapt.
    if (body.contact_hp_check) return { ok: true };

    const parsed = contactMessageSchema.safeParse(body);
    if (!parsed.success) {
      return reply.code(ERROR_CODES.VALIDATION_ERROR.status).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: parsed.error.issues[0]?.message ?? "Check the form and try again." },
      });
    }

    // Never report success unless the message actually left: a false "sent" is
    // the exact failure this route exists to end.
    const sent = await sendContactMessage(parsed.data);
    if (!sent) {
      return reply.code(503).send({
        error: { code: "CONTACT_NOT_SENT", status: 503, message: "Your message could not be sent." },
      });
    }
    return { ok: true };
  });
}
