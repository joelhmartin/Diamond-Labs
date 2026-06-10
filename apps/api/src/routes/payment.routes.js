import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor } from "../middleware/require-role.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import * as seazonaService from "../services/seazona.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, invoicePayments, products, orders, orderItems } from "../db/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import { ERROR_CODES } from "@my-app/shared";

// ─── Guest-checkout pricing constants ───────────────────────────────────────
// INTERIM flat values — tax/shipping are not yet modeled per-jurisdiction or
// per-weight. These live server-side so the charged total cannot be tampered
// with from the browser. The client display in Checkout.jsx mirrors these exact
// constants for now; a future server quote endpoint should replace both.
// NOTE: keep in sync with apps/web/src/pages/marketing/Checkout.jsx.
const TAX_RATE = 0.08; // applied only to products.taxable line items
const SHIPPING_FLAT = 12; // flat per-order, charged when subtotal > 0
const MAX_QTY = 999; // per-line quantity ceiling — guards against an absurd qty
// inflating the total past anything real and reaching the gateway as a 500.

// Idempotency TTLs for /payments/checkout (kv-store / Redis shim).
const IDEMPOTENCY_RESULT_TTL = 24 * 60 * 60; // 24h — cached completed response
const IDEMPOTENCY_LOCK_TTL = 120; // 2 min — in-flight lock window for one charge

/** Round to cents consistently (avoids FP drift like 0.1+0.2). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

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
 * Validate a payment allocation: a list of {invoiceId, invoiceNumber?, amount}
 * slices whose amounts must sum to the total charge (within a cent).
 */
function validateAllocations(allocations, amount) {
  if (!Array.isArray(allocations) || allocations.length === 0) {
    return "allocations[] is required.";
  }
  for (const a of allocations) {
    if (!a.invoiceId) return "Each allocation needs an invoiceId.";
    if (!(Number(a.amount) > 0)) return "Each allocation amount must be greater than zero.";
  }
  const sum = allocations.reduce((s, a) => s + Number(a.amount), 0);
  if (Math.abs(sum - Number(amount)) > 0.01) {
    return `Allocations ($${sum.toFixed(2)}) must sum to the charge amount ($${Number(amount).toFixed(2)}).`;
  }
  return null;
}

function buildAllocationNotes(allocations, transactionId) {
  const parts = allocations.map(
    (a) => `${a.invoiceNumber || a.invoiceId} $${Number(a.amount).toFixed(2)}`
  );
  return `DOL portal txn ${transactionId} — ${parts.join("; ")}`.slice(0, 500);
}

/**
 * Seazona's "Invoices & Payments" report attributes an account-level payment to
 * specific invoices by parsing the literal token `Invoices <num>, <num>` out of
 * the payment's `referenceNumber` field (verified live 2026-06-10 — it matches
 * on referenceNumber, NOT notes, and by invoice NUMBER, not GUID). Build exactly
 * that token; returns null if no allocation carries an invoice number.
 */
function buildInvoiceReference(allocations) {
  const numbers = allocations.map((a) => a.invoiceNumber).filter(Boolean);
  return numbers.length ? `Invoices ${numbers.join(", ")}` : null;
}

/**
 * After a successful charge: record ONE account-level payment in Seazona (their
 * payment API has no invoice-level granularity) with notes describing the split,
 * then write one local invoice_payments row per allocated invoice.
 */
async function recordPaymentAndAllocations({ user, amount, transactionId, allocations }) {
  let seazonaPaymentId = null;

  // Seazona has no sandbox — createPayment writes to the live system. Only do it
  // for real (production) charges; in sandbox we still write the local ledger so
  // the flow is fully testable without polluting Seazona's production data.
  if (user.seazonaClientId && env.AUTHORIZE_NET_ENV === "production") {
    const res = await seazonaService.createPayment({
      clientId: user.seazonaClientId,
      accountNumber: user.seazonaAccountNumber,
      // `Invoices <num>` token is what Seazona's report matches on to attribute
      // this payment to the invoice(s); the gateway txn id lives in notes. Fall
      // back to the txn id only if no allocation carried an invoice number.
      referenceNumber: buildInvoiceReference(allocations) || transactionId,
      notes: buildAllocationNotes(allocations, transactionId),
      amount,
    });
    seazonaPaymentId = res?.paymentId || null;
  }

  await db.insert(invoicePayments).values(
    allocations.map((a) => ({
      id: createId(),
      userId: user.id,
      seazonaClientId: user.seazonaClientId || null,
      seazonaInvoiceId: String(a.invoiceId),
      invoiceNumber: a.invoiceNumber ? String(a.invoiceNumber) : null,
      appliedAmount: Number(a.amount).toFixed(2),
      transactionId,
      seazonaPaymentId,
    }))
  );

  return seazonaPaymentId;
}

/**
 * Verify every allocated invoice belongs to the doctor's Seazona client.
 * Returns an error string, or null if all good.
 */
async function verifyInvoiceOwnership(allocations, seazonaClientId) {
  for (const a of allocations) {
    const inv = await seazonaService.getInvoice(a.invoiceId);
    if (!inv) return `Invoice ${a.invoiceNumber || a.invoiceId} not found.`;
    // Backfill the invoice NUMBER — Seazona's report matches on number, not GUID,
    // so buildInvoiceReference needs it even if the client didn't send it.
    if (!a.invoiceNumber && inv.invoiceNumber != null) a.invoiceNumber = inv.invoiceNumber;
    if (String(inv.clientId) !== String(seazonaClientId)) {
      return `Invoice ${a.invoiceNumber || a.invoiceId} does not belong to your account.`;
    }
  }
  return null;
}

/**
 * Lazily create an Authorize.net CIM customer profile for `user` if they don't
 * have one yet. Persists the new ID to the DB row and reflects it on the
 * in-flight user object so subsequent reads within the same request don't need
 * an extra DB round-trip. Returns the customerProfileId (existing or new).
 */
async function ensureCustomerProfile(user) {
  let customerProfileId = user.authorizeNetCustomerProfileId;
  if (!customerProfileId) {
    customerProfileId = await authorizenetService.createCustomerProfile({
      email: user.email,
      description: `Doctor: ${user.name}`,
    });
    await db
      .update(users)
      .set({ authorizeNetCustomerProfileId: customerProfileId, updatedAt: new Date() })
      .where(eq(users.id, user.id));
    user.authorizeNetCustomerProfileId = customerProfileId;
  }
  return customerProfileId;
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
 * Decide whether a recorded catalog order may be pushed to Seazona via
 * createOrder, and if not, why. Gated behind the SAME production condition the
 * rest of the payment code uses (env.AUTHORIZE_NET_ENV === "production") PLUS a
 * configured lab-staff userId. A guest order with no Seazona clientId cannot be
 * pushed at all — Seazona's createOrder requires a clientId.
 *
 * Returns a `seazonaPushStatus` value; "pending" means "eligible — go ahead".
 * For the current public guest checkout `seazonaClientId` is always null, so this
 * never returns "pending" there (it resolves to a skip/not-applicable status and
 * Seazona is never called). The "pending"→push path is built correct-by-
 * construction for a future order that carries a Seazona clientId.
 */
function resolveOrderPushStatus({ seazonaClientId }) {
  if (env.AUTHORIZE_NET_ENV !== "production") return "skipped_not_production";
  if (!env.SEAZONA_ORDER_USER_ID) return "skipped_no_user";
  if (!seazonaClientId) return "not_applicable_guest";
  return "pending";
}

/**
 * Push a recorded order to Seazona via createOrder. The caller must have already
 * confirmed eligibility (resolveOrderPushStatus === "pending"). NEVER throws —
 * the customer is already charged, so a push failure is captured and reported,
 * never surfaced. Returns { status, seazonaOrderId, error }.
 */
async function pushOrderToSeazona({ order, lines, shipping, log }) {
  // Every line must carry a Seazona product id to be pushable.
  const unmapped = lines.filter((l) => !l.seazonaProductId);
  if (unmapped.length) {
    const msg = `Order has ${unmapped.length} line(s) with no mapped Seazona product id.`;
    log.warn(
      { orderNumber: order.orderNumber, unmapped: unmapped.map((l) => l.catalogId) },
      `catalog order Seazona push skipped — ${msg}`
    );
    return { status: "failed", seazonaOrderId: null, error: msg };
  }
  try {
    const res = await seazonaService.createOrder({
      clientId: order.seazonaClientId,
      patientName: shipping.name || order.email,
      due: null,
      // Physical catalog goods (accessories/supplies) — no upper/lower arch.
      items: lines.map((l) => ({ id: l.seazonaProductId, arch: null })),
      notes: `DOL catalog order ${order.orderNumber} — ship to ${shipping.name}, ${shipping.address1}, ${shipping.city} ${shipping.state} ${shipping.postalCode}`.slice(0, 500),
      userId: env.SEAZONA_ORDER_USER_ID,
    });
    // createOrder returns null on any non-2xx (see seazona.service.js).
    const seazonaOrderId = res?.orderId != null ? String(res.orderId) : null;
    if (!seazonaOrderId) {
      return { status: "failed", seazonaOrderId: null, error: "Seazona createOrder returned no orderId." };
    }
    return { status: "pushed", seazonaOrderId, error: null };
  } catch (err) {
    return { status: "failed", seazonaOrderId: null, error: String(err?.message || err).slice(0, 1000) };
  }
}

/**
 * Record a successful guest catalog charge LOCALLY (authoritative) and attempt the
 * gated Seazona createOrder push. Mirrors `recordPaymentAndAllocations` on the doctor
 * path: SOFT-FAIL only — this never throws into checkout, because the card is already
 * charged and failing the response would invite a double-charge on retry.
 *
 * The order insert (db.transaction) and the push + push-status update each get their
 * OWN try/catch so their failures log DISTINCT messages: the order can be recorded
 * even if the downstream push leg fails, and the two must not be conflated.
 *
 * Returns `{ orderRecordFailed }` so the handler can detect the idempotency-degraded
 * case (order insert AND result-cache write both failing in the same request).
 */
async function recordGuestOrder({
  orderId,
  orderNumber,
  email,
  phone,
  shipping,
  subtotal,
  tax,
  shippingCost,
  total,
  result,
  lines,
  log,
}) {
  // Single source of truth for this order's Seazona client. Guest catalog checkout
  // has no Seazona client (createOrder requires one), so this is null and the push
  // resolves to `not_applicable_guest`. A future client-linked flow changes ONLY
  // this assignment — it is then COUPLED through to resolveOrderPushStatus, the
  // persisted orders.seazonaClientId column, AND pushOrderToSeazona, all of which
  // read this one value. Don't reintroduce hardcoded nulls downstream.
  const seazonaClientId = null; // guest catalog checkout has no Seazona client; see Phase 3c finding
  const pushStatus = resolveOrderPushStatus({ seazonaClientId });

  try {
    await db.transaction(async (tx) => {
      await tx.insert(orders).values({
        id: orderId,
        orderNumber,
        email,
        phone: phone ? String(phone) : null,
        shipping,
        subtotal: subtotal.toFixed(2),
        tax: tax.toFixed(2),
        shippingCost: shippingCost.toFixed(2),
        total: total.toFixed(2),
        transactionId: result.transactionId,
        authCode: result.authCode || null,
        status: "paid",
        seazonaClientId,
        seazonaPushStatus: pushStatus,
      });
      await tx.insert(orderItems).values(
        lines.map((l) => ({
          id: createId(),
          orderId,
          catalogId: l.catalogId,
          seazonaProductId: l.seazonaProductId || null,
          name: l.name,
          unitPrice: l.unitPrice.toFixed(2),
          qty: l.qty,
          lineTotal: l.lineTotal.toFixed(2),
          taxable: l.taxable,
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

  // Gated live write. Unreachable for pure guest checkout (pushStatus is never
  // "pending" when seazonaClientId is null) — built for a future client-linked
  // order. Never executed in dev (skipped_not_production). The order is ALREADY
  // recorded above, so the push + push-status update get their OWN nested try/catch:
  // a failure here means "order persisted, push state needs reconcile", which is a
  // DIFFERENT condition from "failed to record the order".
  if (pushStatus === "pending") {
    let push;
    try {
      push = await pushOrderToSeazona({
        order: { orderNumber, email, seazonaClientId },
        lines,
        shipping,
        log,
      });
      await db
        .update(orders)
        .set({
          seazonaOrderId: push.seazonaOrderId,
          seazonaPushStatus: push.status,
          seazonaPushError: push.error,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, orderId));
      if (push.status === "pushed") {
        log.info({ orderNumber, seazonaOrderId: push.seazonaOrderId }, "catalog order pushed to Seazona");
      } else {
        log.error({ orderNumber, error: push.error }, "catalog order Seazona push failed — order recorded locally, needs manual reconcile");
      }
    } catch (pushErr) {
      log.error(
        { pushErr, orderNumber, transactionId: result.transactionId, seazonaOrderId: push?.seazonaOrderId || null },
        "Seazona push or push-status update failed after order was recorded — order persisted; reconcile push state"
      );
    }
  } else {
    log.info({ orderNumber, pushStatus }, "catalog order recorded — Seazona push not attempted");
  }

  return { orderRecordFailed: false };
}

export default async function paymentRoutes(fastify) {
  // ───────────────────────────────────────────────────────────────
  // PUBLIC CHECKOUT — unauthenticated card charge for catalog orders.
  // Guest shoppers pay for purchasable SKUs (accessories, supplies, samples).
  // Required: opaqueData (Accept.js nonce), amount, items[], email, shipping{}.
  // Intentionally does NOT store a CIM profile (guest checkout).
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/checkout", async (request, reply) => {
    // `amount` from the client is accepted for back-compat/logging ONLY — it is
    // NEVER used to charge. The charged total is recomputed server-side from the
    // products table. This closes a price-tampering hole (pay $0.01 for $450).
    const { opaqueData, amount: clientAmount, items, email, shipping, phone, idempotencyKey: bodyKey } =
      request.body || {};
    const idempotencyKey = request.headers["idempotency-key"] || bodyKey || null;

    if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Payment nonce (opaqueData) is required." },
      });
    }
    if (!email || !email.includes("@")) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Valid email is required." },
      });
    }
    if (!shipping?.name || !shipping?.address1 || !shipping?.city || !shipping?.state || !shipping?.postalCode) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Complete shipping address is required." },
      });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return reply.code(422).send({
        error: { ...ERROR_CODES.VALIDATION_ERROR, message: "At least one item is required." },
      });
    }

    // ── Idempotency fast-path: a completed result for this key replays verbatim
    // without charging again. (Done before pricing so a replay is cheap.)
    const resultKey = idempotencyKey ? `checkout:result:${idempotencyKey}` : null;
    const lockKey = idempotencyKey ? `checkout:lock:${idempotencyKey}` : null;
    if (resultKey) {
      const cached = safeParse(await redis.get(resultKey));
      if (cached) {
        fastify.log.info({ idempotencyKey }, "checkout idempotent replay — returning cached result, no charge");
        return { data: cached };
      }
    } else {
      fastify.log.warn("checkout called without an Idempotency-Key — duplicate submits cannot be de-duplicated");
    }

    // ── Server-side price authority: recompute every line from the products
    // mirror. Unmapped / non-purchasable SKUs are refused (fail-safe — never
    // guess a price). Client-sent price/amount are ignored entirely.
    let subtotal = 0;
    let taxableBase = 0;
    // Resolved, price-authoritative lines — reused after the charge to build the
    // immutable order_items snapshot and the (gated) Seazona push. Carries the
    // mapped seazonaProductId so neither needs to re-query the catalog.
    const lines = [];
    for (const item of items) {
      if (item?.id == null || item.id === "") {
        return reply.code(422).send({
          error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Each item requires an id." },
        });
      }
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty <= 0) {
        return reply.code(422).send({
          error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Invalid quantity for item ${item.id}.` },
        });
      }
      if (qty > MAX_QTY) {
        return reply.code(422).send({
          error: {
            ...ERROR_CODES.VALIDATION_ERROR,
            message: `Quantity for item ${item.id} exceeds the maximum of ${MAX_QTY} per order. Contact the lab for bulk orders.`,
          },
        });
      }
      const rows = await db
        .select()
        .from(products)
        .where(and(eq(products.catalogId, String(item.id)), eq(products.purchasable, true)));
      const product = rows[0];
      if (!product || product.price == null) {
        return reply.code(422).send({
          error: {
            ...ERROR_CODES.VALIDATION_ERROR,
            message: `Item not available for online order (${item.id}). Contact the lab to place this order.`,
          },
        });
      }
      const line = round2(Number(product.price) * qty);
      subtotal = round2(subtotal + line);
      if (product.taxable) taxableBase = round2(taxableBase + line);
      lines.push({
        catalogId: String(item.id),
        seazonaProductId: product.seazonaProductId,
        name: product.name,
        unitPrice: round2(Number(product.price)),
        qty,
        lineTotal: line,
        taxable: Boolean(product.taxable),
      });
    }

    const tax = round2(taxableBase * TAX_RATE);
    const shippingCost = subtotal > 0 ? SHIPPING_FLAT : 0;
    const total = round2(subtotal + tax + shippingCost);

    if (!(total > 0)) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: "This order totals $0.00 and cannot be processed online. Please contact the lab.",
        },
      });
    }
    if (clientAmount != null && Math.abs(Number(clientAmount) - total) > 0.01) {
      // Signal only — the server total is authoritative regardless.
      fastify.log.warn(
        { idempotencyKey, clientAmount: Number(clientAmount), serverTotal: total },
        "checkout client amount differs from server-computed total — charging server total"
      );
    }

    // ── Acquire an in-flight lock right before charging. A single atomic
    // SET key "1" EX <ttl> NX both creates the lock and stamps its TTL in one
    // round-trip — no crash window can strand a never-expiring lock (the old
    // incr + separate expire was non-atomic). The first caller gets "OK"; a
    // concurrent duplicate for the same key gets null and is rejected 409 (or
    // replays the cached result if the first one already finished).
    if (lockKey) {
      const acquired = await redis.set(lockKey, "1", "EX", IDEMPOTENCY_LOCK_TTL, "NX");
      if (!acquired) {
        const cached = safeParse(await redis.get(resultKey));
        if (cached) return { data: cached };
        return reply.code(409).send({
          error: {
            code: "CHARGE_IN_PROGRESS",
            status: 409,
            message: "A charge for this request is already being processed. Please wait.",
          },
        });
      }
    }

    // ONE identifier end-to-end: generated before the charge, sent to the gateway
    // as the transaction invoiceNumber, then persisted as orders.orderNumber.
    const orderNumber = generateOrderNumber();
    const description = `Diamond Orthotic Catalog — ${items.length} item(s)`;
    const { billTo, shipTo } = buildAddresses(shipping, phone);

    let result;
    try {
      result = await authorizenetService.chargeWithNonce({
        amount: total, // SERVER-computed — never the client amount
        opaqueData,
        description,
        invoiceNumber: orderNumber,
        billTo,
        shipTo,
      });
    } catch (err) {
      // Release the lock (best-effort) so the shopper can legitimately retry the
      // same submit. A kv-store failure here must NOT mask the real charge error
      // — log it and rethrow the original. (A stranded lock self-expires via TTL.)
      if (lockKey) {
        await redis
          .del(lockKey)
          .catch((delErr) => fastify.log.warn({ delErr }, "checkout lock release failed"));
      }
      throw err;
    }

    const responseData = {
      transactionId: result.transactionId,
      // orderNumber is the new authoritative identifier; invoiceNumber mirrors it
      // (same value) for frontend back-compat.
      orderNumber,
      invoiceNumber: orderNumber,
      amount: total,
      subtotal,
      tax,
      // `shippingCost` (not `shipping`) — `shipping` elsewhere is the address object;
      // this is the numeric shipping charge. Renamed to avoid that collision.
      shippingCost,
      email,
    };

    // ── Record the order LOCALLY (authoritative) + attempt the gated Seazona push.
    // The card is already charged, so NONE of this may throw to the customer:
    //   • A DB failure here is logged loudly but the successful charge response
    //     still returns (failing it would invite a double-charge on the retry).
    //   • A Seazona push failure/skip never fails checkout — the local order
    //     stands and the push outcome is recorded for later reconcile.
    // For guest checkout there is no Seazona clientId, so resolveOrderPushStatus
    // resolves to a skip/not-applicable status and Seazona is never called.
    const orderId = createId();
    const { orderRecordFailed } = await recordGuestOrder({
      orderId,
      orderNumber,
      email,
      phone,
      shipping,
      subtotal,
      tax,
      shippingCost,
      total,
      result,
      lines,
      log: fastify.log,
    });

    // Cache the completed result so a repeat with the same key replays it. The
    // card is ALREADY charged at this point — a kv-store write failure here must
    // never surface as a 500 to the shopper, so guard it and proceed regardless
    // (worst case: an exact-same-key retry re-charges, but the frontend mints a
    // fresh idempotency key per submit, so that path isn't reachable in practice).
    let cacheWriteFailed = false;
    if (resultKey) {
      try {
        await redis.set(resultKey, JSON.stringify(responseData), "EX", IDEMPOTENCY_RESULT_TTL);
      } catch (cacheErr) {
        cacheWriteFailed = true;
        fastify.log.warn({ cacheErr, orderNumber }, "checkout result cache write failed — charge already succeeded");
      }
    }

    // Idempotency-degraded alarm: if BOTH the local order insert AND the result-cache
    // write failed in this same request, there is no record of the sale on either
    // side, and a retry after the lock TTL could double-charge with no operator
    // signal. Flag it loudly — this charge needs BOTH charge-and-record reconcile.
    if (orderRecordFailed && cacheWriteFailed) {
      fastify.log.error(
        { orderNumber, transactionId: result.transactionId },
        "idempotency degraded — order insert AND result-cache write BOTH failed for a charged order; a retry could double-charge. Needs BOTH charge-and-record reconciliation"
      );
    }

    fastify.log.info(
      { orderNumber, transactionId: result.transactionId, email, itemCount: items.length, total },
      "public catalog checkout succeeded"
    );

    // TODO (Task 10): send order confirmation / receipt email.

    return { data: responseData };
  });

  // Charge with an Accept.js nonce (one-time card payment), allocated across invoices
  fastify.post("/payments/charge", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { opaqueData, amount, allocations, description } = request.body;

    if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue || !amount) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "opaqueData and amount are required." } });
    }
    const allocErr = validateAllocations(allocations, amount);
    if (allocErr) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: allocErr } });
    }
    // Every allocated invoice must belong to this doctor's Seazona client —
    // otherwise the recorded payment could be attributed to someone else's invoice.
    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }
    const ownErr = await verifyInvoiceOwnership(allocations, request.user.seazonaClientId);
    if (ownErr) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: ownErr } });
    }

    const result = await authorizenetService.chargeWithNonce({
      amount,
      opaqueData,
      description: description || "Diamond Labs Invoice Payment",
      invoiceNumber: allocations[0]?.invoiceNumber || allocations[0]?.invoiceId || undefined,
    });

    const seazonaPaymentId = await recordPaymentAndAllocations({
      user: request.user,
      amount,
      transactionId: result.transactionId,
      allocations,
    });

    return { data: { ...result, seazonaPaymentId } };
  });

  // List saved cards
  fastify.get("/payments/saved-cards", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const cards = await authorizenetService.listPaymentProfiles(
      request.user.authorizeNetCustomerProfileId
    );
    return { data: cards };
  });

  // Add a saved card via Accept.js nonce
  fastify.post("/payments/saved-cards", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { opaqueData } = request.body;

    if (!opaqueData?.dataDescriptor || !opaqueData?.dataValue) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "opaqueData is required." } });
    }

    const customerProfileId = await ensureCustomerProfile(request.user);

    const paymentProfileId = await authorizenetService.addPaymentProfileFromNonce({
      customerProfileId,
      opaqueData,
    });

    return { data: { paymentProfileId } };
  });

  // Get a hosted add-card token (SAQ A). The iframe is pointed at addCardUrl;
  // the token is submitted as a form-POST body to authenticate the hosted session —
  // card data is entered entirely on Authorize.net's domain. On success, Authorize.net
  // stores the new payment profile under the doctor's CIM profile (created lazily here
  // if needed). The new customerPaymentProfileId lives at the gateway and is retrieved
  // live via GET /payments/saved-cards — no local table needed.
  fastify.post("/payments/saved-cards/hosted-token", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { iframeCommunicatorUrl } = request.body || {};

    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }

    const customerProfileId = await ensureCustomerProfile(request.user);

    const result = await authorizenetService.getHostedAddCardToken({ customerProfileId, iframeCommunicatorUrl });

    if (!result?.token) {
      return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Could not get an add-card form token." } });
    }

    return { data: { token: result.token, addCardUrl: result.addCardUrl } };
  });

  // Update a saved card (e.g., renew expiration date). Looks up the payment
  // profile to confirm ownership (gateway-scoped to this doctor's customerProfileId)
  // and to retrieve the masked cardNumber required for the update request.
  fastify.put("/payments/saved-cards/:profileId", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { expirationDate, billTo } = request.body || {};
    const { profileId } = request.params;

    if (!expirationDate || !/^\d{4}-\d{2}$/.test(expirationDate)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "expirationDate is required (format: YYYY-MM)." } });
    }
    if (billTo !== undefined && (billTo === null || typeof billTo !== "object" || Array.isArray(billTo))) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "billTo must be a plain object." } });
    }
    const BILL_TO_ALLOWED_KEYS = ["firstName", "lastName", "company", "address", "city", "state", "zip", "country", "phoneNumber"];
    const sanitizedBillTo = billTo
      ? Object.fromEntries(Object.entries(billTo).filter(([k]) => BILL_TO_ALLOWED_KEYS.includes(k)))
      : undefined;

    const customerProfileId = request.user.authorizeNetCustomerProfileId;
    if (!customerProfileId) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const profiles = await authorizenetService.listPaymentProfiles(customerProfileId);
    const profile = profiles.find((p) => p.paymentProfileId === profileId);
    if (!profile) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Payment profile not found or does not belong to your account." } });
    }

    await authorizenetService.updateCustomerPaymentProfile({
      customerProfileId,
      paymentProfileId: profileId,
      cardNumber: profile.cardNumber,
      expirationDate,
      billTo: sanitizedBillTo,
    });

    return { data: { paymentProfileId: profileId, expirationDate } };
  });

  // Delete a saved card
  fastify.delete("/payments/saved-cards/:profileId", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const customerProfileId = request.user.authorizeNetCustomerProfileId;
    if (!customerProfileId) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    await authorizenetService.deletePaymentProfile({
      customerProfileId,
      paymentProfileId: request.params.profileId,
    });

    return { data: { message: "Card removed." } };
  });

  // Charge a saved card, allocated across invoices
  fastify.post("/payments/charge-saved", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { paymentProfileId, amount, allocations } = request.body;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;

    if (!customerProfileId || !paymentProfileId || !amount) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "paymentProfileId and amount are required." } });
    }
    const allocErr = validateAllocations(allocations, amount);
    if (allocErr) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: allocErr } });
    }
    // Same ownership guard as the nonce/hosted paths — never charge a saved card
    // against an invoice that isn't this doctor's.
    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }
    const ownErr = await verifyInvoiceOwnership(allocations, request.user.seazonaClientId);
    if (ownErr) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: ownErr } });
    }

    const result = await authorizenetService.chargeCustomerProfile({
      customerProfileId,
      paymentProfileId,
      amount,
      invoiceNumber: allocations[0]?.invoiceNumber || allocations[0]?.invoiceId || undefined,
    });

    const seazonaPaymentId = await recordPaymentAndAllocations({
      user: request.user,
      amount,
      transactionId: result.transactionId,
      allocations,
    });

    return { data: { ...result, seazonaPaymentId } };
  });

  // ───────────────────────────────────────────────────────────────
  // REAL invoice payment via Accept Hosted (SAQ A). New-card path: card is
  // entered on Authorize.net's hosted iframe (never our DOM). The amount is the
  // allocation sum, baked into the token server-side. Mode resolves from
  // AUTHORIZE_NET_ENV (sandbox locally, production once deployed) — clients
  // cannot pick the mode, so a payment record always reflects a real charge.
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/hosted-token", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { allocations, iframeCommunicatorUrl, saveCard } = request.body || {};

    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }
    const amount = Math.round(
      ((allocations || []).reduce((s, a) => s + Number(a.amount || 0), 0) + Number.EPSILON) * 100
    ) / 100;
    const allocErr = validateAllocations(allocations, amount);
    if (allocErr) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: allocErr } });
    }
    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }

    const ownErr = await verifyInvoiceOwnership(allocations, request.user.seazonaClientId);
    if (ownErr) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: ownErr } });
    }

    // When the frontend requests save-card, lazily create the CIM profile so
    // Authorize.net has a customer to attach the saved card to. The profile ID
    // is baked into the hosted-page token; the gateway enforces ownership.
    let customerProfileId;
    if (saveCard) {
      customerProfileId = await ensureCustomerProfile(request.user);
    }

    const refId = `INV-${Date.now().toString().slice(-10)}`;
    const result = await authorizenetService.getHostedPaymentPageToken({
      amount,
      invoiceNumber: allocations[0]?.invoiceNumber || refId,
      description: `Diamond Labs — ${allocations.length} invoice(s)`,
      refId,
      iframeCommunicatorUrl,
      customerProfileId,
      allowSaveCard: Boolean(saveCard),
    });

    if (!result?.token) {
      return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "Could not get a payment form token." } });
    }
    return { data: { token: result.token, formUrl: result.formUrl, refId, amount } };
  });

  // Finalize a hosted invoice payment: verify the captured amount server-side,
  // then record one Seazona payment + the local allocation ledger. Idempotent
  // on transId so a double postMessage / retry can't double-record.
  //
  // Save-card persistence note: when the doctor checked "save card" on the hosted
  // form, Authorize.net stores the new payment profile under their CIM customer
  // profile autonomously — we don't need to do anything here. The customerProfileId
  // was set on users.authorizeNetCustomerProfileId before the token was issued
  // (ensureCustomerProfile in /payments/hosted-token), and individual payment profile
  // IDs live at the gateway and are listed live via GET /payments/saved-cards.
  // No additional DB write is required; no new table is needed.
  fastify.post("/payments/hosted-complete", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { transId, allocations } = request.body || {};

    if (!transId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "transId is required." } });
    }
    if (!Array.isArray(allocations) || !allocations.length) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "allocations[] is required." } });
    }

    // Idempotency — already recorded?
    const existing = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.transactionId, String(transId)));
    if (existing.length) {
      return { data: { transId, alreadyRecorded: true, rows: existing.length } };
    }

    // Anchor of trust: whatever we record must equal what Authorize.net captured.
    const details = await authorizenetService.getTransactionDetails(transId);
    if (!details) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });
    }
    const allocSum = Math.round(
      (allocations.reduce((s, a) => s + Number(a.amount || 0), 0) + Number.EPSILON) * 100
    ) / 100;
    if (Math.abs(details.amount - allocSum) > 0.01) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Allocation total ($${allocSum.toFixed(2)}) does not match the captured amount ($${details.amount.toFixed(2)}).` } });
    }

    const ownErr = await verifyInvoiceOwnership(allocations, request.user.seazonaClientId);
    if (ownErr) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: ownErr } });
    }

    const seazonaPaymentId = await recordPaymentAndAllocations({
      user: request.user,
      amount: details.amount,
      transactionId: String(transId),
      allocations,
    });

    return { data: { transId, amount: details.amount, status: details.status, seazonaPaymentId, recorded: true } };
  });

  // ───────────────────────────────────────────────────────────────
  // TEST — Accept Hosted (SAQ A) end-to-end check. Card data is entered on
  // Authorize.net's hosted iframe, never our DOM. These endpoints intentionally
  // do NOT write to Seazona or the invoice_payments ledger — they only exercise
  // the Authorize.net pipeline. `mode` defaults to sandbox; production is allowed
  // for a small real-charge smoke test (void it in the Authorize.net dashboard).
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/test/hosted-token", {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { amount, mode = "sandbox", iframeCommunicatorUrl } = request.body || {};

    if (!(Number(amount) > 0) || Number(amount) > 100000) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "amount must be between 0 and 100000." } });
    }
    if (mode !== "sandbox" && mode !== "production") {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "mode must be 'sandbox' or 'production'." } });
    }
    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }

    const refId = `TEST-${Date.now().toString().slice(-10)}`;
    const result = await authorizenetService.getHostedPaymentPageToken({
      amount: Number(amount),
      invoiceNumber: refId,
      description: "Diamond Labs test payment",
      refId,
      iframeCommunicatorUrl,
    }, mode);

    if (!result?.token) {
      return reply.code(502).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Could not get a ${mode} form token — check Authorize.net ${mode} credentials.` } });
    }

    return { data: { token: result.token, formUrl: result.formUrl, refId, mode } };
  });

  fastify.post("/payments/test/hosted-complete", {
    preHandler: [authenticate],
  }, async (request, reply) => {
    const { transId, mode = "sandbox" } = request.body || {};

    if (!transId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "transId is required." } });
    }
    if (mode !== "sandbox" && mode !== "production") {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "mode must be 'sandbox' or 'production'." } });
    }

    const details = await authorizenetService.getTransactionDetails(transId, mode);
    if (!details) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });
    }

    return { data: details };
  });
}
