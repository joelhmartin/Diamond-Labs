import { ERROR_CODES, catalogQuoteSchema } from "@my-app/shared";
import { optionalAuthenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validate.js";
import { listFamilies } from "../services/catalog.service.js";
import { presentShopFamily } from "../lib/catalog-variants.js";
import { pricingClientFor, loadClientPrices, priceShopCart } from "../services/pricing.service.js";
import { PricingError } from "../lib/pricing.js";

export function pricingErrorReply(err) {
  if (err.code === "PRICE_CHANGED") {
    return { status: 409, body: { error: { ...ERROR_CODES.PRICE_CHANGED, message: err.message } } };
  }
  return {
    status: 422,
    body: { error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message, reason: err.code, variantId: err.variantId } },
  };
}

export default async function catalogRoutes(fastify) {
  // The shop catalog. Approved doctors see their negotiated prices.
  fastify.get("/catalog", { preHandler: [optionalAuthenticate] }, async (request, reply) => {
    // Per-shopper prices: never cache, and never share across Authorization values.
    reply.header("Cache-Control", "private, no-store").header("Vary", "Authorization");
    const families = await listFamilies({ shopOnly: true });
    const prices = await loadClientPrices(
      pricingClientFor(request.user),
      families.flatMap((f) => f.variants.map((v) => v.id)),
    );
    return { data: { families: families.map((f) => presentShopFamily(f, prices)).filter(Boolean) } };
  });

  // The priced cart — the same computation checkout charges.
  fastify.post("/catalog/quote", {
    preHandler: [optionalAuthenticate, validate(catalogQuoteSchema)],
  }, async (request, reply) => {
    try {
      const quote = await priceShopCart({ lines: request.body.items, clientUserId: pricingClientFor(request.user) });
      return { data: quote };
    } catch (err) {
      if (err instanceof PricingError) {
        const r = pricingErrorReply(err);
        return reply.code(r.status).send(r.body);
      }
      throw err;
    }
  });
}
