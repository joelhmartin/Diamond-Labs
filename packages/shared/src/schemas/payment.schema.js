import { z } from "zod";

/**
 * Shared payment validation schemas. Mirror the backend payment routes so the
 * gateway never sees a malformed allocation, amount, or charge body. Money
 * amounts are bounded (positive, ≤ $100,000) and constrained to at most two
 * decimal places — a third decimal is a tampering/format error, not a charge.
 */

// At-most-2-decimal-places guard that doesn't trip on float drift.
const hasAtMost2Decimals = (n) => Number(n.toFixed(2)) === n;

// A money amount: positive, capped, and cent-precise.
const amount = z
  .number()
  .positive()
  .max(100000)
  .refine(hasAtMost2Decimals, { message: "amount must have at most 2 decimal places" });

/**
 * One slice of a charge applied to a single Seazona invoice. `invoiceNumber` is
 * optional on input — the server backfills it from the live invoice when absent.
 */
export const allocationSchema = z.object({
  invoiceId: z.string().min(1),
  invoiceNumber: z.string().optional(),
  amount,
});

/** Helper: does the allocation set sum (within a cent) to `total`? */
function allocationsSumTo(allocations, total) {
  const sum = allocations.reduce((s, a) => s + Number(a.amount), 0);
  return Math.abs(sum - Number(total)) <= 0.01;
}

/** POST /payments/charge-saved — charge a saved card across invoices. */
export const chargeSavedSchema = z
  .object({
    paymentProfileId: z.string().min(1),
    amount,
    allocations: z.array(allocationSchema).min(1),
  })
  .refine((d) => allocationsSumTo(d.allocations, d.amount), {
    message: "Allocations must sum to the charge amount.",
    path: ["allocations"],
  });

/**
 * POST /payments/hosted-token — issue a hosted-payment-page token. The charge
 * amount is derived server-side from the allocation sum, so only allocations
 * are required. Extra route-specific fields (iframeCommunicatorUrl, saveCard)
 * are allowed through.
 */
export const hostedTokenSchema = z
  .object({
    allocations: z.array(allocationSchema).min(1),
  })
  .passthrough();

/** POST /payments/hosted-complete — finalize a hosted charge (C2-bound). */
export const hostedCompleteSchema = z.object({
  transId: z.string().min(1),
  refId: z.string().min(1),
  allocations: z.array(allocationSchema).min(1),
});

/**
 * POST /payments/checkout — guest catalog checkout. Top-level + nested objects
 * use passthrough so the route keeps every field it reads (it recomputes the
 * authoritative price from the products table). `amount` is accepted for
 * display/back-compat only; it is never charged.
 */
export const checkoutSchema = z
  .object({
    opaqueData: z.object({
      dataDescriptor: z.string().min(1),
      dataValue: z.string().min(1),
    }),
    // Display/back-compat only — never charged; coerced to match the route's
    // historical leniency (it ran Number(clientAmount) for a warning compare).
    amount: z.coerce.number().positive().max(100000).optional(),
    items: z
      .array(
        z
          .object({
            id: z.union([z.string().min(1), z.number()]),
            // Coerce so a stringy "2" from a quantity input still validates —
            // matching the route's prior Number(item.qty) handling.
            qty: z.coerce.number().int().positive(),
          })
          .passthrough()
      )
      .min(1),
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
