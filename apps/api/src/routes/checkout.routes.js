import { optionalAuthenticate } from "../middleware/authenticate.js";
import { validate } from "../middleware/validate.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import { sendOrderReceipt } from "../services/email.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { orders, orderItems } from "../db/schema/index.js";
import { createId } from "../lib/id.js";
import { createShopLabOrder } from "../services/lab/lab-orders.service.js";
import { ERROR_CODES, checkoutSchema } from "@my-app/shared";
import { withIdempotency, ChargeInProgressError, safeParse, idemResultKey } from "../lib/payment-helpers.js";
import { toDecimalString } from "../lib/money.js";
import { priceShopCart, pricingClientFor } from "../services/pricing.service.js";
import { PricingError, assertQuotedTotal } from "../lib/pricing.js";
import { pricingErrorReply } from "./catalog.routes.js";
import { CHARGE_RATE_LIMIT, chargeErrorReply } from "./payment-replies.js";

/** Best-effort split of a single "Full Name" field into first/last. */
function splitName(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

/**
 * Build Authorize.net billTo/shipTo objects from the guest checkout payload.
 * The guest form collects a single shipping address; we use it for billing too
 * (standard for guest checkout). Keys are ordered per nameAndAddressType and
 * sliced to the gateway's max field lengths. AVS scores billTo address + zip.
 */
function buildAddresses(shipping, phone) {
  const { firstName, lastName } = splitName(shipping.name);
  const address = [shipping.address1, shipping.address2]
    .filter(Boolean)
    .join(", ")
    .slice(0, 60);
  const base = {
    firstName: firstName.slice(0, 50),
    lastName: lastName.slice(0, 50),
    ...(shipping.practice ? { company: String(shipping.practice).slice(0, 50) } : {}),
    address,
    city: String(shipping.city).slice(0, 40),
    state: String(shipping.state).slice(0, 40),
    zip: String(shipping.postalCode).slice(0, 20),
    country: String(shipping.country || "US").slice(0, 60),
  };
  const billTo = { ...base, ...(phone ? { phoneNumber: String(phone).slice(0, 25) } : {}) };
  return { billTo, shipTo: { ...base } };
}

/**
 * Generate the authoritative catalog order number. Replaces the old
 * `DOL-<last8 of Date.now()>` scheme, which collided trivially (two orders in the
 * same 100ms window shared a number). Form: `DOL-` + a 12-char cuid2-derived
 * suffix (uppercased) → 16 chars, comfortably under Authorize.net's 20-char
 * `invoiceNumber` limit. cuid2 is collision-resistant by design; the unique
 * index on orders.order_number is the hard backstop.
 */
function generateOrderNumber() {
  return `DOL-${createId().slice(0, 12).toUpperCase()}`;
}

/**
 * Record a successful guest catalog charge LOCALLY (authoritative), then its lab
 * order. The lab order is created right after the paid order commits, in its own
 * transaction: a failure is logged ([LAB][SHOP_ORDER_FAILED]) and the
 * shop-lab-orders-repair job (jobs/definitions) creates what is missing from the
 * stored paid order, never a lost payment or a lost order. SOFT-FAIL only — this never throws into
 * checkout, because the card is already charged and failing the response would
 * invite a double-charge on retry. Returns `{ orderRecordFailed }` so the handler
 * can detect the idempotency-degraded case.
 */
async function recordGuestOrder({
  orderId,
  orderNumber,
  email,
  phone,
  shipping,
  quote,
  pricedForUserId,
  result,
  lines,
  log,
}) {
  try {
    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        orderNumber,
        email,
        phone: phone ? String(phone) : null,
        shipping,
        subtotal: toDecimalString(quote.subtotalCents),
        tax: toDecimalString(quote.taxCents),
        shippingCost: toDecimalString(quote.shippingCents),
        total: toDecimalString(quote.totalCents),
        transactionId: result.transactionId,
        authCode: result.authCode || null,
        status: "paid",
        pricedForUserId,
      });
      await tx.insert(orderItems).values(
        lines.map((l) => ({
          id: createId(),
          orderId,
          variantId: l.variantId,
          catalogId: l.catalogId,
          seazonaProductId: l.seazonaProductId || null,
          name: l.name,
          unitPrice: toDecimalString(l.unitCents),
          qty: l.qty,
          lineTotal: toDecimalString(l.lineCents),
          taxable: l.taxable,
          priceSource: l.priceSource,
        }))
      );
    });
  } catch (orderErr) {
    log.error(
      { orderErr, orderNumber, transactionId: result.transactionId },
      "FAILED to record catalog order after a successful charge — manual reconcile required"
    );
    return { orderRecordFailed: true };
  }

  // The job for the bench and its paid shop invoice. Deliberately OUTSIDE the paid-order transaction: the
  // card is already charged, so a DB error here must never roll back the order row.
  // No PHI or card data in the log line.
  try {
    await db.transaction((tx) =>
      createShopLabOrder(tx, { orderId, clientUserId: pricedForUserId, quote, transactionId: result.transactionId })
    );
  } catch (err) {
    log.error({ orderId }, `[LAB][SHOP_ORDER_FAILED] order=${orderId}: ${String(err?.message || err)} — the shop-lab-orders-repair sweep will create the lab order and invoice`);
  }

  log.info({ orderNumber }, "catalog order recorded");

  return { orderRecordFailed: false };
}

/**
 * Quote lines → the line shape orders and receipts use.
 * Dollars for the receipt; cents + priceSource for the order record.
 */
export function checkoutLinesFromQuote(quote) {
  return quote.lines.map((l) => ({
    variantId: l.variantId,
    code: l.code ?? null,
    catalogId: l.catalogId,
    seazonaProductId: l.legacySeazonaProductId,
    name: l.name,
    unitPrice: l.unitCents / 100,
    unitCents: l.unitCents,
    qty: l.qty,
    lineTotal: l.lineCents / 100,
    lineCents: l.lineCents,
    taxable: l.taxable,
    priceSource: l.priceSource,
  }));
}

export default async function checkoutRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // PUBLIC CHECKOUT — unauthenticated card charge for catalog orders.
  // Guest shoppers pay for purchasable SKUs (accessories, supplies, samples).
  // Required: opaqueData (Accept.js nonce), amount, items[], email, shipping{}.
  // Intentionally does NOT store a CIM profile (guest checkout).
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/checkout", { ...CHARGE_RATE_LIMIT, preHandler: [optionalAuthenticate, validate(checkoutSchema)] }, async (request, reply) => {
    // `amount` from the client is the quote total the shopper saw. It is NEVER
    // charged: the total is recomputed server-side from the pricing service, and
    // a mismatch is refused before the charge (assertQuotedTotal).
    const { opaqueData, amount: clientAmount, items, email, shipping, phone, idempotencyKey: bodyKey } =
      request.body || {};
    const idempotencyKey = request.headers["idempotency-key"] || bodyKey || null;

    // H1/L5 — the idempotency key is now REQUIRED. The frontend mints a fresh
    // crypto.randomUUID() per submit; without one a duplicate submit could
    // double-charge with no way to de-dupe, so refuse rather than warn-and-proceed.
    if (!idempotencyKey) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." },
      });
    }

    // ── Idempotency fast-path: a completed result for this key replays verbatim
    // without charging again. (Done before pricing so a replay is cheap and so a
    // legitimate retry still succeeds even if a SKU later went non-purchasable.)
    const idemKey = `checkout:${idempotencyKey}`;
    const replay = safeParse(await redis.get(idemResultKey(idemKey)));
    if (replay) {
      fastify.log.info({ idempotencyKey }, "checkout idempotent replay — returning cached result, no charge");
      return { data: replay };
    }

    // ── Server-side price authority: the same pricing service the cart quote
    // uses (client price for approved doctors, else base). Client-sent prices
    // are ignored; the client amount is only compared, never charged.
    const pricedForUserId = pricingClientFor(request.user);
    let quote;
    try {
      quote = await priceShopCart({ lines: items, clientUserId: pricedForUserId });
      // Refuse (409 PRICE_CHANGED) rather than charge a total the shopper wasn't shown.
      assertQuotedTotal(clientAmount, quote);
    } catch (err) {
      if (err instanceof PricingError) {
        if (err.code === "PRICE_CHANGED") {
          fastify.log.warn(
            { idempotencyKey, clientAmount, serverTotalCents: quote?.totalCents },
            "checkout refused — client total differs from the server quote; nothing charged"
          );
        }
        const r = pricingErrorReply(err);
        return reply.code(r.status).send(r.body);
      }
      throw err;
    }
    const lines = checkoutLinesFromQuote(quote);
    const subtotal = quote.subtotalCents / 100;
    const tax = quote.taxCents / 100;
    const shippingCost = quote.shippingCents / 100;
    const total = quote.totalCents / 100;

    if (!(total > 0)) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: "This order totals $0.00 and cannot be processed online. Please contact the lab.",
        },
      });
    }

    // ── Charge + record under an idempotency lock (H1/L5). withIdempotency:
    //   • replays a cached success verbatim (no charge);
    //   • rejects a concurrent duplicate with ChargeInProgressError (→ 409);
    //   • releases the lock and rethrows if the charge throws (legit retry can proceed);
    //   • caches fn's resolved value (incl. emailSent) so a replay is faithful.
    // ONE identifier end-to-end: generated before the charge, sent to the gateway
    // as the transaction invoiceNumber, then persisted as orders.orderNumber.
    const orderNumber = generateOrderNumber();
    const description = `Diamond Orthotic Catalog — ${items.length} item(s)`;
    const { billTo, shipTo } = buildAddresses(shipping, phone);

    let orderRecordFailed = false;
    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        idemKey,
        async () => {
          // The ONLY throw in here is the charge call — withIdempotency releases
          // the lock and rethrows it, and the outer catch maps it to a card/gateway
          // error. Everything after the charge is soft-fail (the card is charged).
          const result = await authorizenetService.chargeWithNonce({
            amount: total, // SERVER-computed — never the client amount
            opaqueData,
            description,
            invoiceNumber: orderNumber,
            billTo,
            shipTo,
          });

          const responseData = {
            transactionId: result.transactionId,
            // orderNumber is the new authoritative identifier; invoiceNumber mirrors
            // it (same value) for frontend back-compat.
            orderNumber,
            invoiceNumber: orderNumber,
            amount: total,
            subtotal,
            tax,
            // `shippingCost` (not `shipping`) — `shipping` elsewhere is the address
            // object; this is the numeric shipping charge.
            shippingCost,
            email,
          };

          // Record the order and its lab order LOCALLY (authoritative).
          // Never throws (the card is already charged).
          const orderId = createId();
          const rec = await recordGuestOrder({
            orderId, orderNumber, email, phone, shipping,
            quote, pricedForUserId, result, lines, log: fastify.log,
          });
          orderRecordFailed = rec.orderRecordFailed;

          // Order receipt email (SOFT-FAIL). Only when the order genuinely recorded.
          let emailSent = false;
          if (!orderRecordFailed) {
            try {
              emailSent = Boolean(
                await sendOrderReceipt({
                  to: email, orderNumber, items: lines,
                  subtotal, tax, shippingCost, total, shipping,
                  transactionId: result.transactionId,
                })
              );
            } catch (emailErr) {
              fastify.log.warn(
                { emailErr, orderNumber },
                "order receipt email failed — charge and order already recorded, no customer impact"
              );
            }
          }
          responseData.emailSent = emailSent;
          return responseData;
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err instanceof ChargeInProgressError) {
        return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      }
      // Charge failed (declined / gateway error). H2 — never leak internals.
      fastify.log.warn({ orderNumber, err: String(err?.message || err) }, "checkout charge failed");
      return chargeErrorReply(reply, err);
    }

    const responseData = outcome.result;

    // Idempotency-degraded alarm: if BOTH the local order insert AND the result-cache
    // write failed in the same request, there's no record of the sale on either side
    // and a retry after the lock TTL could double-charge. Flag it loudly. (Skip on a
    // replay — the order was recorded by the original request.)
    if (!outcome.replayed && orderRecordFailed && outcome.cacheWriteFailed) {
      fastify.log.error(
        { orderNumber, transactionId: responseData.transactionId },
        "idempotency degraded — order insert AND result-cache write BOTH failed for a charged order; a retry could double-charge. Needs BOTH charge-and-record reconciliation"
      );
    }

    fastify.log.info(
      { orderNumber, transactionId: responseData.transactionId, email, itemCount: items.length, total },
      "public catalog checkout succeeded"
    );

    return { data: responseData };
  });
}
