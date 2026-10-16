import { z } from "zod";
import { INVOICE_STATUSES, INVOICE_LINE_KINDS, MANUAL_PAYMENT_METHODS } from "../billing/billing.js";

const id = z.string().min(1).max(128);
const version = z.number().int().positive();
const cents = z.number().int().min(-10_000_000).max(10_000_000);
const positiveCents = z.number().int().positive().max(10_000_000);
const reason = z.string().trim().min(1, "Say why.").max(500);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const flag = z.enum(["true", "false"]).optional().transform((v) => v === "true");

export const invoiceListQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  needsPrice: flag,
  clientUserId: id.optional(),
  number: z.coerce.number().int().positive().optional(),
});

// The rules (reason required for a price change, negatives only on an
// adjustment, nothing-to-change) live in invoice-rules.js planLineEdit.
export const invoiceEditSchema = z.object({
  expectedVersion: version,
  edit: z.discriminatedUnion("op", [
    z.object({
      op: z.literal("update"), lineId: id,
      qty: z.number().int().min(1).max(999).optional(),
      unitCents: cents.optional(),
      reason: z.string().trim().max(500).optional(),
    }),
    z.object({
      op: z.literal("add"), kind: z.enum(INVOICE_LINE_KINDS),
      description: z.string().trim().min(1).max(200),
      qty: z.number().int().min(1).max(999),
      unitCents: cents,
      taxable: z.boolean().default(false),
    }),
    z.object({ op: z.literal("remove"), lineId: id }),
    z.object({ op: z.literal("notes"), notes: z.string().max(5000).nullable() }),
  ]),
});

export const invoiceIssueSchema = z.object({ expectedVersion: version });
export const invoiceVoidSchema = z.object({ expectedVersion: version, reason });
export const invoiceCreditSchema = z.object({ amountCents: positiveCents, reason });

export const manualPaymentSchema = z.object({
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: z.string().trim().max(100).optional(),
  amountCents: positiveCents,
  paidOn: isoDate,
  // Omit to apply oldest-first.
  allocations: z.array(z.object({ invoiceId: id, amountCents: positiveCents })).min(1).max(200).optional(),
}).refine(
  (p) => !p.allocations || p.allocations.reduce((s, a) => s + a.amountCents, 0) === p.amountCents,
  { message: "Allocations must add up to the payment.", path: ["allocations"] },
);

export const statementQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.") });
export const receivablesQuerySchema = z.object({ pastDueOnly: flag });
export const clientInvoicesQuerySchema = z.object({ open: flag });
