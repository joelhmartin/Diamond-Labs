import { mulCents, pctOfCents, sumCents, toCents } from "./money.js";

// The one place a price is decided. Pure: callers load variants and client
// prices (services/pricing.service.js) and pass them in.

export class PricingError extends Error {
  constructor(code, message, variantId = null) {
    super(message);
    this.code = code;
    this.variantId = variantId;
  }
}

/** A client's negotiated price wins over base. null = nothing to charge from. */
export function unitPriceFor(variant, clientPriceCents) {
  if (clientPriceCents != null) return { cents: clientPriceCents, source: "client" };
  if (variant.basePriceCents == null) return null;
  return { cents: variant.basePriceCents, source: "base" };
}

export function priceLines({ lines, variants, clientPrices = new Map(), config }) {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new PricingError("EMPTY", "There is nothing to price.");
  }
  // Merge repeats so the quantity cap can't be dodged by splitting a line.
  const merged = new Map();
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) {
      throw new PricingError("BAD_QTY", "Each item needs a whole-number quantity.", l.variantId);
    }
    merged.set(l.variantId, (merged.get(l.variantId) ?? 0) + l.qty);
  }

  const out = [];
  for (const [variantId, qty] of merged) {
    if (qty > config.maxQty) {
      throw new PricingError(
        "QTY_LIMIT",
        `Quantity exceeds the maximum of ${config.maxQty} per order. Contact the lab for bulk orders.`,
        variantId,
      );
    }
    const variant = variants.get(variantId);
    if (!variant || !variant.active) {
      throw new PricingError("UNAVAILABLE", "Item not available for online order. Contact the lab to place this order.", variantId);
    }
    const price = unitPriceFor(variant, clientPrices.get(variantId));
    if (!price) {
      throw new PricingError("UNPRICED", "Item has no price yet. Contact the lab to place this order.", variantId);
    }
    out.push({
      variantId,
      code: variant.code ?? null,
      name: variant.name,
      catalogId: variant.catalogId ?? null,
      legacySeazonaProductId: variant.legacySeazonaProductId ?? null,
      qty,
      unitCents: price.cents,
      priceSource: price.source,
      lineCents: mulCents(price.cents, qty),
      taxable: Boolean(variant.taxable),
    });
  }

  const subtotalCents = sumCents(out.map((l) => l.lineCents));
  const taxCents = pctOfCents(sumCents(out.filter((l) => l.taxable).map((l) => l.lineCents)), config.taxRateBps);
  const shippingCents = subtotalCents > 0 ? config.shippingFlatCents : 0;
  return { lines: out, subtotalCents, taxCents, shippingCents, totalCents: subtotalCents + taxCents + shippingCents };
}

/**
 * Checkout charges only the total the shopper was shown. `clientAmount` is the
 * quote total the browser sent (dollars); any difference — a client price that
 * arrived or vanished with the session, an admin price change — is refused
 * before the card is touched, never charged silently.
 */
export function assertQuotedTotal(clientAmount, quote) {
  let cents;
  try { cents = toCents(clientAmount); } catch { cents = null; }
  if (cents !== quote.totalCents) {
    throw new PricingError("PRICE_CHANGED", "Prices changed — please review your order.");
  }
}

/**
 * Lab order lines -> invoice lines. Unlike priceLines (the shop), nothing is
 * refused: the job is already on the bench. A line with no variant, or a
 * variant with no price, becomes unitCents 0 / priceSource "unpriced", which
 * holds its invoice at draft for staff. Inactive and rx-channel variants price
 * normally. Note-only lines (build instructions) are not billed.
 */
export function priceLabLines({ lines, variants, clientPrices = new Map() }) {
  return lines.filter((l) => !l.noteOnly).map((l) => {
    const variant = l.variantId ? variants.get(l.variantId) : null;
    const price = variant ? unitPriceFor(variant, clientPrices.get(l.variantId)) : null;
    return {
      labOrderLineId: l.id ?? null,
      variantId: l.variantId ?? null,
      code: l.code ?? null,
      description: l.name,
      qty: Number.isInteger(l.qty) && l.qty > 0 ? l.qty : 1,
      unitCents: price ? price.cents : 0,
      priceSource: price ? price.source : "unpriced",
      taxable: Boolean(variant?.taxable),
    };
  });
}
