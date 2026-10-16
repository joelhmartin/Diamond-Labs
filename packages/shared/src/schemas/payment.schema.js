import { z } from "zod";
import { cartLinesSchema, numericInput } from "./catalog.schema.js";
import { sumCents } from "../money.js";

/**
 * Shared payment validation schemas. Mirror the backend payment routes so the
 * gateway never sees a malformed allocation, amount, or charge body. Money
 * amounts are bounded (positive, ≤ $100,000) and constrained to at most two
 * decimal places — a third decimal is a tampering/format error, not a charge.
 */

// At-most-2-decimal-places guard that doesn't trip on float drift (the
// checkout's dollar `amount` is the only dollar field left on the wire).
const hasAtMost2Decimals = (n) => Number(n.toFixed(2)) === n;

/** Integer cents, positive, capped at $100,000. */
const amountCents = z.number().int().positive().max(10_000_000);

/** One slice of a payment applied to one of OUR invoices (own-the-lab piece 3). */
export const allocationSchema = z.object({
  invoiceId: z.string().min(1).max(128),
  amountCents,
});

const sumOf = (allocations) => sumCents(allocations.map((a) => a.amountCents));
const eachInvoiceOnce = (allocations) => new Set(allocations.map((a) => a.invoiceId)).size === allocations.length;
const allocations = z.array(allocationSchema).min(1)
  .refine(eachInvoiceOnce, { message: "Each invoice can appear only once." });

/** POST /payments/charge-saved (and the admin charge-on-behalf) — a saved card across invoices. */
export const chargeSavedSchema = z
  .object({ paymentProfileId: z.string().min(1), amountCents, allocations })
  .refine((d) => sumOf(d.allocations) === d.amountCents, {
    message: "Allocations must add up to the charge.",
    path: ["allocations"],
  });

/**
 * POST /payments/hosted-token — the hosted page's amount is the allocation sum,
 * computed server-side. Extra fields (iframeCommunicatorUrl, saveCard) pass through.
 */
export const hostedTokenSchema = z.object({ allocations }).passthrough();

/**
 * POST /admin/payments/refund. Omit `allocations` for a FULL reversal; give
 * slices for a PARTIAL refund (settled charges only). `invoiceId` is the ledger
 * row's invoice key (our invoice id, or the Seazona id on a Seazona-era row).
 */
export const refundAllocationSchema = z.object({ invoiceId: z.string().min(1).max(128), amountCents });

export const refundSchema = z.object({
  transactionId: z.string().min(1),
  allocations: z.array(refundAllocationSchema).min(1).optional(),
});

/** POST /payments/hosted-complete — finalize a hosted charge (bound to its token). */
export const hostedCompleteSchema = z.object({
  transId: z.string().min(1),
  refId: z.string().min(1),
  allocations,
});

/**
 * POST /payments/checkout — catalog checkout. Top-level + nested objects use
 * passthrough so the route keeps every field it reads. `amount` is the quote
 * total the shopper was shown: the server re-prices the cart and refuses
 * (409 PRICE_CHANGED) instead of charging a different number. It is never
 * itself charged.
 */
export const checkoutSchema = z
  .object({
    opaqueData: z.object({
      dataDescriptor: z.string().min(1),
      dataValue: z.string().min(1),
    }),
    // The total the shopper agreed to. Compared, never charged. min(0) so a
    // $0.00 cart reaches the route's own "contact the lab" refusal.
    amount: numericInput(
      z.number().min(0).max(100000)
        .refine(hasAtMost2Decimals, { message: "amount must have at most 2 decimal places" }),
    ),
    items: cartLinesSchema,
    email: z.string().email(),
    shipping: z
      .object({
        name: z.string().min(1),
        address1: z.string().min(1),
        city: z.string().min(1),
        state: z.string().min(1),
        postalCode: z.string().min(1),
      })
      .passthrough(),
    phone: z.string().optional(),
    idempotencyKey: z.string().optional(),
  })
  .passthrough();
