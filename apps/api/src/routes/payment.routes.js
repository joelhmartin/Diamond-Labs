import { authenticate } from "../middleware/authenticate.js";
import { requireApprovedDoctor, requireAdmin } from "../middleware/require-role.js";
import { validate } from "../middleware/validate.js";
import * as authorizenetService from "../services/authorizenet.service.js";
import * as seazonaService from "../services/seazona.service.js";
import { ensureCustomerProfile } from "../services/card.service.js";
import {
  getInvoicePortalPaidStrict,
  listPaymentsForUser,
  listAllPayments,
} from "../services/invoice-ledger.service.js";
import { sendOrderReceipt, sendPaymentReceipt, sendRefundReceipt } from "../services/email.service.js";
import { voidOrRefund } from "../lib/void-refund.js";
import * as auditService from "../services/audit.service.js";
import { db } from "../config/database.js";
import { redis } from "../config/redis.js";
import { users, invoicePayments, products, orders, orderItems, auditLog } from "../db/schema/index.js";
import { eq, and, gt, inArray, like, desc } from "drizzle-orm";
import { createId } from "../lib/id.js";
import { env } from "../config/env.js";
import {
  ERROR_CODES,
  checkoutSchema,
  chargeSavedSchema,
  hostedTokenSchema,
  hostedCompleteSchema,
  refundSchema,
} from "@my-app/shared";
import {
  withIdempotency,
  ChargeInProgressError,
  withInvoiceLocks,
  InvoiceLockedError,
  extractDeclineMessage,
  safeParse,
  idemResultKey,
} from "../lib/payment-helpers.js";

// Per-route strict rate limit for the charge-producing endpoints (M3). Layered
// ON TOP of the global limiter; the global localhost allowList still applies in
// dev so local testing isn't throttled.
const CHARGE_RATE_LIMIT = { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } };

// Hosted-payment binding record TTL (C2): a doctor has ~30 min to complete a
// hosted charge before the issued token's server-side binding expires.
const HOSTED_BINDING_TTL = 30 * 60;

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

/** Round to cents consistently (avoids FP drift like 0.1+0.2). */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Map a charge error to a user-safe reply (H2). An error carrying an
 * Authorize.net response is a gateway-level decline → 402 CARD_DECLINED with the
 * gateway's own (user-safe) decline text. Anything else (network, parse, config)
 * is a system failure → 502 PAYMENT_GATEWAY_ERROR with a generic message. We
 * never leak internals or stack traces to the client.
 */
export function chargeErrorReply(reply, err) {
  if (err?.authNetResponse) {
    const message = extractDeclineMessage(err.authNetResponse) || ERROR_CODES.CARD_DECLINED.message;
    return reply.code(402).send({ error: { ...ERROR_CODES.CARD_DECLINED, message } });
  }
  return reply.code(502).send({ error: ERROR_CODES.PAYMENT_GATEWAY_ERROR });
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
 *
 * Returns `{ seazonaPaymentId, ledgerWriteFailed }`. NEVER throws — the card is
 * already charged, so a Seazona or local-ledger write failure is logged loudly
 * (alertable) and reported back as a warning rather than surfaced as a 500
 * (which would invite a re-charge on retry).
 */
export async function recordPaymentAndAllocations({ user, amount, transactionId, allocations }) {
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
    // H3 — Seazona's payment-id field name is not firmly known. Accept the
    // plausible shapes; if the call returned a body but no id resolves, log the
    // KEYS ONLY (never values — avoid PHI) so the real field can be learned.
    seazonaPaymentId = res?.paymentId ?? res?.id ?? res?.PaymentId ?? res?.paymentID ?? null;
    if (res && !seazonaPaymentId) {
      console.error(`[Seazona][PAYMENT_ID_SHAPE] keys=${Object.keys(res).join(",")}`);
    }

    // CRITICAL: the card was already charged at Authorize.net. If the Seazona
    // write didn't land, the payment exists at the processor but NOT in the
    // billing system of record — it must be entered manually. This was silently
    // swallowed before. Log a distinct, alertable line (the `[Seazona]` token is
    // what the GCP log-based metric matches) carrying everything needed to
    // reconcile by hand. We do NOT throw — failing here can't un-charge the card.
    if (!seazonaPaymentId) {
      console.error(
        `[Seazona][PAYMENT_WRITE_FAILED] charge ${transactionId} succeeded at Authorize.net but did NOT record in Seazona — manual entry required ` +
          JSON.stringify({
            transactionId,
            clientId: user.seazonaClientId,
            accountNumber: user.seazonaAccountNumber || null,
            amount,
            invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
          })
      );
    }
  }

  // M4 — the card is already charged; a local-ledger insert failure must NOT
  // 500 (that would invite a re-charge on retry). Guard it, log an alertable
  // line carrying ONLY ids/amounts (no card or patient data), and report the
  // charge as succeeded-with-warning.
  let ledgerWriteFailed = false;
  try {
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
  } catch (ledgerErr) {
    ledgerWriteFailed = true;
    console.error(
      `[PAYMENT][LEDGER_WRITE_FAILED] charge ${transactionId} succeeded but the local invoice_payments ledger insert failed — manual reconcile required ` +
        JSON.stringify({
          transactionId,
          seazonaPaymentId,
          userId: user.id,
          amount,
          invoices: allocations.map((a) => ({ invoiceId: a.invoiceId, amount: Number(a.amount) })),
          error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
        })
    );
  }

  // Payment receipt — soft-fail, never blocks (the card already charged). Covers
  // both saved-card and hosted-card paths since both funnel through here.
  if (user.email) {
    try {
      await sendPaymentReceipt({
        to: user.email,
        amount,
        invoices: allocations.map((a) => ({
          number: a.invoiceNumber || a.invoiceId,
          amount: Number(a.amount),
        })),
        transactionId,
        date: new Date(),
      });
    } catch {
      /* send() never throws; this is belt-and-suspenders */
    }
  }

  // Durable audit trail (who paid what). Soft-fail — the card already charged.
  // Covers both saved-card and hosted paths since both funnel through here.
  await auditService.logSafe({
    userId: user.id,
    action: "payment.charge",
    targetType: "transaction",
    targetId: transactionId,
    metadata: {
      amount,
      invoices: allocations.map((a) => a.invoiceNumber || a.invoiceId),
      seazonaPaymentId: seazonaPaymentId || null,
      ledgerWriteFailed,
    },
  });

  return { seazonaPaymentId, ledgerWriteFailed };
}

/**
 * Verify every allocated invoice belongs to the doctor's Seazona client, and
 * (optionally, C1) that no allocation exceeds the invoice's remaining balance.
 *
 * Backfills each allocation's invoiceNumber from the live invoice (Seazona's
 * report matches on number, not GUID). Returns `null` when all good, else
 * `{ kind, message }` where kind is "forbidden" (not found / not owned, → 403)
 * or "validation" (cap exceeded, → 422). Uses the SAME live invoice it already
 * fetched for ownership to compute the remaining balance — no extra fetch.
 */
export async function verifyAllocations(allocations, user, { enforceCap = false } = {}) {
  for (const a of allocations) {
    const inv = await seazonaService.getInvoice(a.invoiceId);
    if (!inv) return { kind: "forbidden", message: `Invoice ${a.invoiceNumber || a.invoiceId} not found.` };
    if (!a.invoiceNumber && inv.invoiceNumber != null) a.invoiceNumber = inv.invoiceNumber;
    if (String(inv.clientId) !== String(user.seazonaClientId)) {
      return { kind: "forbidden", message: `Invoice ${a.invoiceNumber || a.invoiceId} does not belong to your account.` };
    }
    if (enforceCap) {
      // C1 — remaining = invoice total minus what's already been applied through
      // the portal ledger for this doctor. The +0.005 tolerance absorbs cent
      // rounding; a fully-paid invoice has remaining ~0 and is therefore blocked.
      // STRICT read on purpose: a DB error here must abort the charge, not
      // silently report "paid so far = 0" and re-open the full balance.
      const paid = await getInvoicePortalPaidStrict(user.id, a.invoiceId);
      const remaining = round2(Number(inv.total || 0) - paid);
      if (Number(a.amount) > remaining + 0.005) {
        return {
          kind: "validation",
          message: `Allocation $${Number(a.amount).toFixed(2)} for invoice ${a.invoiceNumber || a.invoiceId} exceeds its remaining balance of $${remaining.toFixed(2)}.`,
        };
      }
    }
  }
  return null;
}

/**
 * Reply for a per-invoice lock contention (D1). Reuses CHARGE_IN_PROGRESS's 409
 * shape with an invoice-specific message so the client shows a clean "retry".
 */
export function sendInvoiceLockedError(reply) {
  return reply.code(409).send({
    error: {
      ...ERROR_CODES.CHARGE_IN_PROGRESS,
      message: "A payment for this invoice is already in progress — please retry in a moment.",
    },
  });
}

/** Send the appropriate reply for a verifyAllocations result. */
export function sendAllocationError(reply, v) {
  if (v.kind === "validation") {
    return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: v.message } });
  }
  return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: v.message } });
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
  fastify.post("/payments/checkout", { ...CHARGE_RATE_LIMIT, preHandler: [validate(checkoutSchema)] }, async (request, reply) => {
    // `amount` from the client is accepted for back-compat/logging ONLY — it is
    // NEVER used to charge. The charged total is recomputed server-side from the
    // products table. This closes a price-tampering hole (pay $0.01 for $450).
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

          // Record the order LOCALLY (authoritative) + attempt the gated Seazona
          // push. Never throws (the card is already charged).
          const orderId = createId();
          const rec = await recordGuestOrder({
            orderId, orderNumber, email, phone, shipping,
            subtotal, tax, shippingCost, total, result, lines, log: fastify.log,
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

  // List saved cards, flagging the doctor's default (if still present).
  fastify.get("/payments/saved-cards", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const cards = await authorizenetService.listPaymentProfiles(
      request.user.authorizeNetCustomerProfileId
    );
    const defaultId = request.user.defaultPaymentProfileId;
    return {
      data: cards.map((c) => ({ ...c, isDefault: c.paymentProfileId === defaultId })),
    };
  });

  // Mark a saved card as the doctor's default (pre-selected when paying). The
  // profile must belong to this doctor's CIM profile.
  //
  // Profiles live at the gateway (no local FK to enforce), so there's an
  // inherent TOCTOU: a card deleted right after this ownership check could be
  // written here as the default. That's harmless by design — the column is
  // advisory UI state and the read path is self-healing: GET /payments/saved-cards
  // flags `isDefault` only for a profile that still exists in the LIVE gateway
  // list, and the pay modal falls back to the first card when nothing is flagged.
  // So a dangling default never resolves to (or mischarges) a real card.
  fastify.put("/payments/saved-cards/:profileId/default", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request, reply) => {
    const { profileId } = request.params;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;
    if (!customerProfileId) {
      return reply.code(404).send({ error: ERROR_CODES.NOT_FOUND });
    }

    const profiles = await authorizenetService.listPaymentProfiles(customerProfileId);
    if (!profiles.some((p) => p.paymentProfileId === profileId)) {
      return reply.code(404).send({
        error: { ...ERROR_CODES.NOT_FOUND, message: "Payment profile not found or does not belong to your account." },
      });
    }

    await db
      .update(users)
      .set({ defaultPaymentProfileId: profileId, updatedAt: new Date() })
      .where(eq(users.id, request.user.id));

    await auditService.logSafe({
      userId: request.user.id,
      action: "payment.card.set_default",
      targetType: "payment_profile",
      targetId: profileId,
      ipAddress: request.ip,
    });

    return { data: { defaultPaymentProfileId: profileId } };
  });

  // NOTE: the Accept.js-nonce add-card path (POST /payments/saved-cards) was
  // removed (L3) — adding a card goes through the SAQ-A hosted flow below
  // (/payments/saved-cards/hosted-token), so card data never touches our DOM.

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

    // Atomically clear the preference if THIS card is the current default.
    // Conditioning the WHERE on the live column value (not the auth-time
    // `request.user` snapshot) avoids a race with a concurrent "set default"
    // from another tab — a no-op when it isn't the default.
    await db
      .update(users)
      .set({ defaultPaymentProfileId: null, updatedAt: new Date() })
      .where(
        and(
          eq(users.id, request.user.id),
          eq(users.defaultPaymentProfileId, request.params.profileId)
        )
      );

    await auditService.logSafe({
      userId: request.user.id,
      action: "payment.card.delete",
      targetType: "payment_profile",
      targetId: request.params.profileId,
      ipAddress: request.ip,
    });

    return { data: { message: "Card removed." } };
  });

  // Charge a saved card, allocated across invoices. Requires an Idempotency-Key
  // header (H1/L5) — the frontend mints a crypto.randomUUID() per submit.
  fastify.post("/payments/charge-saved", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(chargeSavedSchema)],
  }, async (request, reply) => {
    const { paymentProfileId, amount, allocations } = request.body;
    const customerProfileId = request.user.authorizeNetCustomerProfileId;

    const idempotencyKey = request.headers["idempotency-key"] || null;
    if (!idempotencyKey) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "An Idempotency-Key header is required." } });
    }
    if (!customerProfileId) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "No saved-card profile on file for this account." } });
    }
    // Same ownership guard as the hosted path — never charge a saved card
    // against an invoice that isn't this doctor's.
    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }
    // Ownership (NO cap) runs OUTSIDE the idempotency replay path: every request —
    // including one that replays a cached success — must first prove the submitted
    // invoices belong to the caller. Combined with the user-scoped idempotency key
    // below, this prevents reusing/guessing another doctor's key to replay their
    // result. Only the remaining-balance CAP is deferred to first execution.
    const own = await verifyAllocations(allocations, request.user);
    if (own) return sendAllocationError(reply, own);

    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        `charge-saved:${request.user.id}:${idempotencyKey}`,
        async () =>
          // D1 — per-invoice mutex around the verify-cap → charge → record window.
          // The idempotency-key lock only serializes retries of the SAME key; two
          // DIFFERENT keys hitting the same invoice could both read paid=0, both
          // pass the cap, and both charge. Lock every allocated invoice (sorted,
          // deadlock-free) for the duration of this critical section.
          withInvoiceLocks(
            redis,
            allocations.map((a) => a.invoiceId),
            async () => {
              // C1 over-allocation cap runs INSIDE the idempotent block so a retry of
              // the same Idempotency-Key replays the cached success rather than
              // re-failing the cap on an invoice the first attempt already paid.
              const capErr = await verifyAllocations(allocations, request.user, { enforceCap: true });
              if (capErr) throw Object.assign(new Error("allocation_error"), { allocationError: capErr });

              const result = await authorizenetService.chargeCustomerProfile({
                customerProfileId,
                paymentProfileId,
                amount,
                invoiceNumber: allocations[0]?.invoiceNumber || allocations[0]?.invoiceId || undefined,
              });
              const { seazonaPaymentId, ledgerWriteFailed } = await recordPaymentAndAllocations({
                user: request.user,
                amount,
                transactionId: result.transactionId,
                allocations,
              });
              return { ...result, seazonaPaymentId, ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}) };
            },
            { log: fastify.log }
          ),
        // Migration dual-read: results cached under the pre-user-scoping key
        // (`charge-saved:<key>`, 24h TTL) still replay across this deploy so a
        // retry that spans it can't double-charge.
        { log: fastify.log, legacyKeys: [`charge-saved:${idempotencyKey}`] }
      );
    } catch (err) {
      if (err?.allocationError) return sendAllocationError(reply, err.allocationError);
      if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
      if (err instanceof ChargeInProgressError) {
        return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      }
      fastify.log.warn({ userId: request.user.id, err: String(err?.message || err) }, "charge-saved failed");
      return chargeErrorReply(reply, err);
    }

    return { data: outcome.result };
  });

  // ───────────────────────────────────────────────────────────────
  // REAL invoice payment via Accept Hosted (SAQ A). New-card path: card is
  // entered on Authorize.net's hosted iframe (never our DOM). The amount is the
  // allocation sum, baked into the token server-side. Mode resolves from
  // AUTHORIZE_NET_ENV (sandbox locally, production once deployed) — clients
  // cannot pick the mode, so a payment record always reflects a real charge.
  // ───────────────────────────────────────────────────────────────
  fastify.post("/payments/hosted-token", {
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(hostedTokenSchema)],
  }, async (request, reply) => {
    const { allocations, iframeCommunicatorUrl, saveCard } = request.body || {};

    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }
    const amount = Math.round(
      (allocations.reduce((s, a) => s + Number(a.amount || 0), 0) + Number.EPSILON) * 100
    ) / 100;
    if (iframeCommunicatorUrl && !/^https?:\/\//.test(iframeCommunicatorUrl)) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: "iframeCommunicatorUrl must be an http(s) URL." } });
    }

    const v = await verifyAllocations(allocations, request.user);
    if (v) return sendAllocationError(reply, v);

    // When the frontend requests save-card, lazily create the CIM profile so
    // Authorize.net has a customer to attach the saved card to. The profile ID
    // is baked into the hosted-page token; the gateway enforces ownership.
    let customerProfileId;
    if (saveCard) {
      customerProfileId = await ensureCustomerProfile(request.user);
    }

    // C2 — bind the transaction to THIS doctor + THIS issued token. A short,
    // unique refId (≤20 chars, cuid2-derived) is passed to Authorize.net AND
    // stored server-side keyed by refId. hosted-complete will only record a
    // transaction whose Authorize.net `refId` matches a stored record owned by
    // the caller. This stops a doctor from claiming another doctor's transId.
    const refId = `H${createId().slice(0, 14)}`;
    await redis.set(
      `rxpay:hosted:${refId}`,
      JSON.stringify({ userId: request.user.id, allocations, amount }),
      "EX",
      HOSTED_BINDING_TTL
    );

    const result = await authorizenetService.getHostedPaymentPageToken({
      amount,
      // Bind via order.invoiceNumber = refId. Unlike the transaction-level refId
      // (which Authorize.net does NOT reliably echo back in getTransactionDetails),
      // order.invoiceNumber DOES round-trip — so hosted-complete can match it.
      // Human-readable invoice context goes in the description.
      invoiceNumber: refId,
      description: `Diamond Labs — invoice(s): ${allocations.map((a) => a.invoiceNumber || a.invoiceId).join(", ")}`.slice(0, 255),
      refId,
      iframeCommunicatorUrl,
      customerProfileId,
      allowSaveCard: Boolean(saveCard),
    });

    if (!result?.token) {
      // Roll back the binding record so a stale refId doesn't linger.
      await redis.del(`rxpay:hosted:${refId}`).catch(() => {});
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
    ...CHARGE_RATE_LIMIT,
    preHandler: [authenticate, requireApprovedDoctor, validate(hostedCompleteSchema)],
  }, async (request, reply) => {
    const { transId, refId, allocations } = request.body;

    // L2 — same early guard the other doctor endpoints have.
    if (!request.user.seazonaClientId) {
      return reply.code(400).send({ error: ERROR_CODES.SEAZONA_CLIENT_NOT_LINKED });
    }

    // Global dedup — a double postMessage / retry must never double-record.
    const existing = await db
      .select()
      .from(invoicePayments)
      .where(eq(invoicePayments.transactionId, String(transId)));
    if (existing.length) {
      return { data: { transId, alreadyRecorded: true, rows: existing.length } };
    }

    // C2 (a) — a binding record must exist for this refId AND be owned by the
    // caller. This is the doctor↔transaction binding: only the doctor the token
    // was issued to can complete it.
    const bindingRaw = await redis.get(`rxpay:hosted:${refId}`);
    const binding = safeParse(bindingRaw);
    if (!binding || String(binding.userId) !== String(request.user.id)) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Payment session not found or does not belong to your account." } });
    }
    // Record the allocations bound at token time — NOT the caller-supplied ones.
    // Otherwise a doctor could complete a captured charge against a different
    // (equal-amount) invoice than the one the token was issued for.
    const boundAllocations = Array.isArray(binding.allocations) && binding.allocations.length
      ? binding.allocations
      : allocations;

    // Anchor of trust: whatever we record must equal what Authorize.net captured.
    const details = await authorizenetService.getTransactionDetails(transId);
    if (!details) {
      return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: "Transaction not found." } });
    }

    // C2 (b) — the captured transaction must carry our binding token. We set it as
    // order.invoiceNumber (which round-trips reliably); the transaction-level refId
    // is accepted only as a fallback. Reject if neither matches the issued refId.
    if (String(details.orderInvoiceNumber) !== String(refId) && String(details.refId) !== String(refId)) {
      return reply.code(403).send({ error: { ...ERROR_CODES.FORBIDDEN, message: "Transaction does not match the issued payment session." } });
    }

    // C2 (c) / M2 — only an APPROVED, captured/settled (or pending-settlement)
    // transaction may be recorded. Reject declined / voided / held / auth-only.
    const SETTLED_OR_PENDING = new Set(["capturedPendingSettlement", "settledSuccessfully"]);
    if (String(details.responseCode) !== "1" || !SETTLED_OR_PENDING.has(String(details.transactionStatus))) {
      return reply.code(422).send({
        error: {
          ...ERROR_CODES.VALIDATION_ERROR,
          message: `Transaction is not in a recordable state (status: ${details.transactionStatus || "unknown"}).`,
        },
      });
    }

    // C2 (d) — captured amount must equal the BOUND allocation sum.
    const allocSum = Math.round(
      (boundAllocations.reduce((s, a) => s + Number(a.amount || 0), 0) + Number.EPSILON) * 100
    ) / 100;
    if (Math.abs(details.amount - allocSum) > 0.01) {
      return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Allocation total ($${allocSum.toFixed(2)}) does not match the captured amount ($${details.amount.toFixed(2)}).` } });
    }

    // D1 — per-invoice mutex around the cap check + ledger record. The hosted
    // charge is already captured at the gateway; without this, two concurrent
    // completes for the same invoice could both pass the cap and both record,
    // over-applying the invoice in the local ledger. Lock every bound invoice
    // (sorted, deadlock-free) across verify-cap → record, releasing after the
    // ledger write (recordPaymentAndAllocations is soft-fail and never throws).
    let recorded;
    try {
      recorded = await withInvoiceLocks(
        redis,
        boundAllocations.map((a) => a.invoiceId),
        async () => {
          // C2 (e) + (f) — every BOUND allocation invoice belongs to the caller AND the
          // C1 over-allocation cap (no allocation exceeds the invoice's remaining balance).
          const v = await verifyAllocations(boundAllocations, request.user, { enforceCap: true });
          if (v) return { allocationError: v };
          return {
            result: await recordPaymentAndAllocations({
              user: request.user,
              amount: details.amount,
              transactionId: String(transId),
              allocations: boundAllocations,
            }),
          };
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err instanceof InvoiceLockedError) return sendInvoiceLockedError(reply);
      throw err;
    }
    if (recorded.allocationError) return sendAllocationError(reply, recorded.allocationError);
    const { seazonaPaymentId, ledgerWriteFailed } = recorded.result;

    // One-time use — delete the binding so the same token/refId can't be replayed.
    await redis.del(`rxpay:hosted:${refId}`).catch(() => {});

    return {
      data: {
        transId,
        amount: details.amount,
        status: details.status,
        seazonaPaymentId,
        recorded: true,
        ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
      },
    };
  });

  // ───────────────────────────────────────────────────────────────
  // ADMIN REFUND / VOID — reverse a payment recorded through the portal.
  //
  // Voids an unsettled charge or refunds a settled one at Authorize.net, then
  // reverses the LOCAL ledger (one negative invoice_payments row per original
  // row) so the affected invoices un-pay. Money-critical: the gateway call is
  // the only thing that may fail loudly; everything after it (ledger reversal,
  // Seazona credit, receipt) is best-effort — once the money is back at the
  // gateway we must not 500 and invite a re-attempt.
  //
  // Supports FULL or PARTIAL-by-invoice reversal (see refundSchema):
  //   • no `allocations` → full reversal of every original row;
  //   • `allocations` → reverse specific invoice slices, each capped at what it
  //     was charged. Partial is settled-only (Authorize.net can't partially VOID
  //     an unsettled charge — the gateway helper rejects that as a 422).
  // ONE reversal per charge either way: the double-refund guard rejects a second
  // refund on a charge that already has any reversal row (so a charge is refunded
  // once, fully or partially — incremental top-ups are a future enhancement).
  //
  // Concurrency: the double-refund guard + gateway reversal + ledger insert +
  // Seazona credit + receipt all run inside withIdempotency keyed on the
  // charge's transaction id, so two concurrent refunds of the same charge
  // serialize on the lock (the loser gets 409 CHARGE_IN_PROGRESS, or replays the
  // cached result instead of double-refunding). Nothing after the voidOrRefund
  // gateway call may throw out of the locked fn (ledger insert is soft-failed,
  // Seazona + receipt never throw), so a successful reversal is always cached,
  // never followed by a lock release that could permit a re-refund.
  // ───────────────────────────────────────────────────────────────
  fastify.post("/admin/payments/refund", {
    preHandler: [authenticate, requireAdmin, validate(refundSchema)],
  }, async (request, reply) => {
    const { transactionId, allocations } = request.body;
    const txid = String(transactionId);

    // 1. Find the ORIGINAL charge's ledger rows (positive applied only — never
    // match a prior refund's negative rows). We only refund payments we recorded.
    const originalRows = await db
      .select()
      .from(invoicePayments)
      .where(and(eq(invoicePayments.transactionId, txid), gt(invoicePayments.appliedAmount, "0")));
    if (!originalRows.length) {
      return reply.code(404).send({
        error: { ...ERROR_CODES.NOT_FOUND, message: "No portal payment found for that transaction id." },
      });
    }

    // 2. Reversal plan.
    //   • No `allocations` → FULL reversal: negate every original row.
    //   • `allocations` → PARTIAL: reverse only the specified invoice slices,
    //     each capped at what that invoice was charged. Validated here (read-only,
    //     no money moves) before the lock. Settled-only is enforced by the gateway
    //     helper (Authorize.net can't partially void an unsettled charge).
    let partialPlan = null; // null ⇒ full reversal
    if (allocations) {
      const appliedByInvoice = new Map();
      const numberByInvoice = new Map();
      for (const r of originalRows) {
        const prev = appliedByInvoice.get(r.seazonaInvoiceId) || 0;
        appliedByInvoice.set(r.seazonaInvoiceId, round2(prev + Number(r.appliedAmount)));
        if (r.invoiceNumber && !numberByInvoice.has(r.seazonaInvoiceId)) {
          numberByInvoice.set(r.seazonaInvoiceId, r.invoiceNumber);
        }
      }
      const seen = new Set();
      for (const a of allocations) {
        const invId = String(a.invoiceId);
        if (!appliedByInvoice.has(invId)) {
          return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Invoice ${invId} is not part of this charge.` } });
        }
        if (seen.has(invId)) {
          return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Invoice ${invId} appears more than once.` } });
        }
        seen.add(invId);
        if (round2(Number(a.amount)) > appliedByInvoice.get(invId) + 0.005) {
          return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: `Refund for invoice ${invId} exceeds the $${appliedByInvoice.get(invId).toFixed(2)} charged to it.` } });
        }
      }
      partialPlan = {
        total: round2(allocations.reduce((s, a) => s + Number(a.amount), 0)),
        rows: allocations.map((a) => ({
          seazonaInvoiceId: String(a.invoiceId),
          invoiceNumber: numberByInvoice.get(String(a.invoiceId)) || null,
          appliedAmount: (-round2(Number(a.amount))).toFixed(2),
        })),
      };
    }

    // 3. Critical section under an idempotency lock keyed on the charge txn id.
    // Concurrent refunds serialize here; the double-refund guard lives INSIDE the
    // lock so check-then-act can't race, and everything after the gateway call is
    // soft-fail so a successful reversal is cached rather than lock-released.
    let outcome;
    try {
      outcome = await withIdempotency(
        redis,
        `refund:${txid}`,
        async () => {
          // 3a. Double-refund guard — a reversal row linked to this charge already
          // exists. Throw a tagged error → 409 ALREADY_REFUNDED. Throwing here
          // releases the lock, which is safe: no money has moved.
          const existingRefund = await db
            .select({ id: invoicePayments.id })
            .from(invoicePayments)
            .where(eq(invoicePayments.refundsTransactionId, txid));
          if (existingRefund.length) {
            throw Object.assign(new Error("already_refunded"), { alreadyRefunded: true });
          }

          // 3b. Look up the doctor BEFORE the gateway call so a DB hiccup throws
          // while it's still safe (no money moved → lock releases → retryable).
          const refundUser = (await db.select().from(users).where(eq(users.id, originalRows[0].userId)))[0] || null;

          // 3c. WRITE-AHEAD guard: persist a durable double-refund marker BEFORE
          // touching the gateway. If the process dies between the gateway reversal
          // and the ledger write, this row still blocks a re-refund on retry (the
          // idempotency cache wouldn't survive a crash). It's rolled back only if
          // the gateway call itself fails (no money moved → safe to retry).
          const guardRowId = createId();
          await db.insert(invoicePayments).values({
            id: guardRowId,
            userId: originalRows[0].userId,
            seazonaClientId: originalRows[0].seazonaClientId || null,
            seazonaInvoiceId: originalRows[0].seazonaInvoiceId,
            invoiceNumber: originalRows[0].invoiceNumber || null,
            appliedAmount: "0.00",
            transactionId: `REFUND-PENDING-${txid}`,
            refundsTransactionId: txid,
            seazonaPaymentId: null,
          });

          // 3d. Reverse at the gateway (void if unsettled, refund if settled).
          // FULL when no plan; PARTIAL passes the requested total (settled-only —
          // voidOrRefund rejects a partial amount on an unsettled charge).
          //
          // On failure, only roll back the write-ahead guard when we have
          // DEFINITIVE proof no money moved:
          //   • a pre-gateway validation/not-found error (refundErrorKind), or
          //   • a gateway response that explicitly REJECTED the reversal
          //     (authNetResponse present → the credit/void was never created).
          // For an UNCERTAIN failure — socket reset / timeout / unparseable body
          // after the request reached Authorize.net — the charge MAY already be
          // reversed, so we KEEP the guard row to block a retry from issuing a
          // second reversal, and surface a reconcile-manually error instead.
          let result;
          try {
            result = await voidOrRefund(txid, partialPlan ? partialPlan.total : undefined);
          } catch (gwErr) {
            const definitivelyNoMoneyMoved = !!gwErr.refundErrorKind || !!gwErr.authNetResponse;
            if (definitivelyNoMoneyMoved) {
              await db.delete(invoicePayments).where(eq(invoicePayments.id, guardRowId)).catch(() => {});
              throw gwErr;
            }
            console.error(
              `[PAYMENT][REFUND_UNCERTAIN] reversal of charge ${txid} failed without a definitive gateway response — the charge MAY already be reversed; guard row ${guardRowId} kept to block a retry, manual reconcile required ` +
                JSON.stringify({ transactionId: txid, error: String(gwErr?.message || gwErr).slice(0, 300) })
            );
            throw Object.assign(gwErr, { refundUncertain: true });
          }

          // The money is now reversed at Authorize.net. Everything below is
          // best-effort and MUST NOT throw — otherwise the lock would release and
          // permit a re-refund.
          const refundTxnId = result.transactionId || `REFUND-${txid}`;
          const refundedAmount = round2(Number(result.amount));

          // 4. Reverse the LOCAL ledger. FULL → negate every original row.
          // PARTIAL → one negative row per requested invoice slice (validated
          // above to not exceed what each invoice was charged). Either way the
          // rows sum to exactly what was reversed at the gateway, so per-invoice
          // totals stay consistent.
          const reversalRows = partialPlan
            ? partialPlan.rows.map((r) => ({
                id: createId(),
                userId: originalRows[0].userId,
                seazonaClientId: originalRows[0].seazonaClientId || null,
                seazonaInvoiceId: r.seazonaInvoiceId,
                invoiceNumber: r.invoiceNumber,
                appliedAmount: r.appliedAmount,
                transactionId: refundTxnId,
                refundsTransactionId: txid,
                seazonaPaymentId: null,
              }))
            : originalRows.map((r) => ({
                id: createId(),
                userId: r.userId,
                seazonaClientId: r.seazonaClientId || null,
                seazonaInvoiceId: r.seazonaInvoiceId,
                invoiceNumber: r.invoiceNumber || null,
                appliedAmount: (-Number(r.appliedAmount)).toFixed(2),
                transactionId: refundTxnId,
                refundsTransactionId: txid,
                seazonaPaymentId: null,
              }));

          let ledgerWriteFailed = false;
          try {
            await db.insert(invoicePayments).values(reversalRows);
          } catch (ledgerErr) {
            ledgerWriteFailed = true;
            console.error(
              `[PAYMENT][REFUND_LEDGER_WRITE_FAILED] refund/void ${refundTxnId} for charge ${txid} succeeded at Authorize.net but the ledger reversal insert failed — manual reconcile required ` +
                JSON.stringify({
                  transactionId: txid,
                  refundTransactionId: refundTxnId,
                  action: result.action,
                  amount: refundedAmount,
                  invoices: reversalRows.map((r) => r.invoiceNumber || r.seazonaInvoiceId),
                  error: String(ledgerErr?.message || ledgerErr).slice(0, 300),
                })
            );
            // No extra guard needed here — the write-ahead guard row (3c, inserted
            // BEFORE the gateway call) already blocks a re-refund of this charge.
          }

          // 5. Seazona credit (best-effort, never throws). Mirrors the
          // production-only gating of recordPaymentAndAllocations — no sandbox.
          if (originalRows[0].seazonaClientId && env.AUTHORIZE_NET_ENV === "production") {
            try {
              const invNums = [...new Set(reversalRows.map((r) => r.invoiceNumber).filter(Boolean))];
              const res = await seazonaService.createPayment({
                clientId: originalRows[0].seazonaClientId,
                accountNumber: refundUser?.seazonaAccountNumber || null,
                // Same "Invoices <num>" token the original payment used — Seazona's
                // report attributes by that, so the negative credit lands on the
                // right invoices. The refund context lives in notes.
                referenceNumber: invNums.length ? `Invoices ${invNums.join(", ")}` : `Refund ${txid}`,
                notes: `[REFUND] txn ${txid}`,
                amount: -refundedAmount,
              });
              const seazonaPaymentId = res?.paymentId ?? res?.id ?? res?.PaymentId ?? res?.paymentID ?? null;
              if (!seazonaPaymentId) {
                console.error(
                  `[Seazona][REFUND_WRITE_FAILED] refund ${refundTxnId} for charge ${txid} reversed at Authorize.net but did NOT record a Seazona credit — manual entry required ` +
                    JSON.stringify({
                      transactionId: txid,
                      clientId: originalRows[0].seazonaClientId,
                      accountNumber: refundUser?.seazonaAccountNumber || null,
                      amount: -refundedAmount,
                      invoices: invNums,
                    })
                );
              }
            } catch (seazonaErr) {
              console.error(
                `[Seazona][REFUND_WRITE_FAILED] refund ${refundTxnId} for charge ${txid} reversed at Authorize.net but the Seazona credit threw — manual entry required ` +
                  JSON.stringify({
                    transactionId: txid,
                    clientId: originalRows[0].seazonaClientId,
                    amount: -refundedAmount,
                    error: String(seazonaErr?.message || seazonaErr).slice(0, 300),
                  })
              );
            }
          }

          // 6. Refund receipt to the doctor — soft-fail.
          if (refundUser?.email) {
            try {
              await sendRefundReceipt({
                to: refundUser.email,
                amount: refundedAmount,
                invoices: reversalRows.map((r) => ({
                  number: r.invoiceNumber || r.seazonaInvoiceId,
                  amount: Math.abs(Number(r.appliedAmount)),
                })),
                transactionId: txid,
                date: new Date(),
              });
            } catch {
              /* send() never throws; belt-and-suspenders */
            }
          }

          // 7. Audit log (ids/amounts only — no card or patient data). A
          // console line for log-based alerting PLUS a durable audit_log row
          // (who refunded what) for the admin payments view. Inside the
          // idempotent block so a replay doesn't double-record; soft-fail.
          const refundAudit = {
            admin: request.user.id,
            transactionId: txid,
            action: result.action,
            amount: refundedAmount,
            invoices: reversalRows.map((r) => r.invoiceNumber || r.seazonaInvoiceId),
          };
          console.log("[PAYMENT][REFUND] " + JSON.stringify(refundAudit));
          await auditService.logSafe({
            userId: request.user.id,
            action: "payment.refund",
            targetType: "transaction",
            targetId: txid,
            metadata: {
              kind: result.action, // "void" | "refund"
              partial: !!partialPlan,
              amount: refundedAmount,
              refundTransactionId: refundTxnId,
              invoices: refundAudit.invoices,
              ledgerWriteFailed,
            },
            ipAddress: request.ip,
          });

          return {
            action: result.action,
            refundTransactionId: refundTxnId,
            amount: result.amount,
            ...(ledgerWriteFailed ? { ledgerWriteFailed: true } : {}),
          };
        },
        { log: fastify.log }
      );
    } catch (err) {
      if (err?.alreadyRefunded) {
        return reply.code(409).send({ error: ERROR_CODES.ALREADY_REFUNDED });
      }
      if (err instanceof ChargeInProgressError) {
        return reply.code(409).send({ error: ERROR_CODES.CHARGE_IN_PROGRESS });
      }
      if (err?.refundErrorKind === "not_found") {
        return reply.code(404).send({ error: { ...ERROR_CODES.NOT_FOUND, message: err.message } });
      }
      if (err?.refundErrorKind === "validation") {
        return reply.code(422).send({ error: { ...ERROR_CODES.VALIDATION_ERROR, message: err.message } });
      }
      // Outcome unknown — the reversal may already have gone through. Tell the
      // admin NOT to retry and to reconcile manually (the guard row stays).
      if (err?.refundUncertain) {
        return reply.code(ERROR_CODES.REFUND_UNCERTAIN.status).send({ error: ERROR_CODES.REFUND_UNCERTAIN });
      }
      fastify.log.warn({ transactionId: txid, err: String(err?.message || err) }, "refund gateway call failed");
      // A refund/void gateway error is NOT a card decline — never map it to
      // CARD_DECLINED. Surface the gateway's own rejection text when present,
      // otherwise a generic REFUND_FAILED.
      if (err?.authNetResponse) {
        const message = extractDeclineMessage(err.authNetResponse) || ERROR_CODES.REFUND_FAILED.message;
        return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: { ...ERROR_CODES.REFUND_FAILED, message } });
      }
      return reply.code(ERROR_CODES.REFUND_FAILED.status).send({ error: ERROR_CODES.REFUND_FAILED });
    }

    return { data: outcome.result };
  });

  // ───────────────────────────────────────────────────────────────
  // PAYMENT HISTORY (read-only)
  // ───────────────────────────────────────────────────────────────

  // Doctor — their OWN transaction-level payment history (charges + reversals
  // collapsed per charge). Drives the in-portal "Payments" view.
  fastify.get("/payments/history", {
    preHandler: [authenticate, requireApprovedDoctor],
  }, async (request) => {
    const payments = await listPaymentsForUser(request.user.id);
    return { data: { payments } };
  });

  // Admin — payment history across all doctors, enriched with the doctor's
  // name/email + a `refundable` flag so the UI can launch the refund modal on a
  // specific transaction. Optional `userId` scope and `q` free-text filter;
  // capped to `limit` (default 200, max 500) with a `truncated` flag so the UI
  // never silently hides rows.
  fastify.get("/admin/payments", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const { userId, q, limit } = request.query || {};
    let payments = await listAllPayments({ userId: userId || undefined });

    const ids = [...new Set(payments.map((p) => p.userId).filter(Boolean))];
    const userMap = {};
    if (ids.length) {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          seazonaAccountNumber: users.seazonaAccountNumber,
        })
        .from(users)
        .where(inArray(users.id, ids));
      for (const u of rows) userMap[u.id] = u;
    }

    payments = payments.map((p) => {
      const u = userMap[p.userId];
      return {
        ...p,
        doctorName: u?.name || null,
        doctorEmail: u?.email || null,
        accountNumber: u?.seazonaAccountNumber || null,
      };
    });

    if (q) {
      const needle = String(q).toLowerCase();
      payments = payments.filter(
        (p) =>
          String(p.transactionId).toLowerCase().includes(needle) ||
          (p.doctorName || "").toLowerCase().includes(needle) ||
          (p.doctorEmail || "").toLowerCase().includes(needle) ||
          (p.seazonaClientId || "").toLowerCase().includes(needle) ||
          p.invoices.some((inv) => String(inv.invoiceNumber || "").toLowerCase().includes(needle))
      );
    }

    const total = payments.length;
    const max = Math.min(Number(limit) > 0 ? Number(limit) : 200, 500);
    const sliced = payments.slice(0, max);
    return { data: { payments: sliced, total, truncated: total > sliced.length } };
  });

  // Admin — payment-action audit trail (who did what: charges, refunds/voids,
  // card changes). Optional `transactionId` scopes to one charge; newest first,
  // enriched with the actor's name/email. Read-only.
  fastify.get("/admin/payments/audit", {
    preHandler: [authenticate, requireAdmin],
  }, async (request) => {
    const { transactionId, limit } = request.query || {};
    const max = Math.min(Number(limit) > 0 ? Number(limit) : 100, 500);

    const conds = [like(auditLog.action, "payment.%")];
    if (transactionId) conds.push(eq(auditLog.targetId, String(transactionId)));

    const rows = await db
      .select()
      .from(auditLog)
      .where(and(...conds))
      .orderBy(desc(auditLog.createdAt))
      .limit(max);

    const ids = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
    const userMap = {};
    if (ids.length) {
      const us = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, ids));
      for (const u of us) userMap[u.id] = u;
    }

    const entries = rows.map((r) => ({
      id: r.id,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      metadata: r.metadata || {},
      createdAt: r.createdAt,
      actorId: r.userId,
      actorName: r.userId ? userMap[r.userId]?.name || null : null,
      actorEmail: r.userId ? userMap[r.userId]?.email || null : null,
    }));

    return { data: { entries } };
  });

  // ───────────────────────────────────────────────────────────────
  // TEST — Accept Hosted (SAQ A) end-to-end check. Card data is entered on
  // Authorize.net's hosted iframe, never our DOM. These endpoints intentionally
  // do NOT write to Seazona or the invoice_payments ledger — they only exercise
  // the Authorize.net pipeline. `mode` defaults to sandbox; production is allowed
  // for a small real-charge smoke test (void it in the Authorize.net dashboard).
  // ───────────────────────────────────────────────────────────────
  // ADMIN-ONLY. These mint real production hosted-payment tokens for up to
  // $100,000 and read arbitrary transaction details, so `authenticate` alone is
  // not a guard — it would let any registered user (role "user") charge against
  // the live merchant account and enumerate other people's transactions.
  fastify.post("/payments/test/hosted-token", {
    preHandler: [authenticate, requireAdmin],
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

  // ADMIN-ONLY — see the note on /payments/test/hosted-token. There is no
  // ownership check on `transId`, so without this guard any authenticated user
  // could read production transaction details (amount, card last-4, expiry) for
  // an arbitrary transaction id.
  fastify.post("/payments/test/hosted-complete", {
    preHandler: [authenticate, requireAdmin],
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
