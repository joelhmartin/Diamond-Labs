import { z } from "zod";
import { id, isoDate, pageQueryShape, searchText } from "./common.schema.js";
import { INVOICE_STATUSES, INVOICE_LINE_KINDS, MANUAL_PAYMENT_METHODS } from "../billing/billing.js";

const version = z.number().int().positive();
const cents = z.number().int().min(-10_000_000).max(10_000_000);
const positiveCents = z.number().int().positive().max(10_000_000);
const reason = z.string().trim().min(1, "Say why.").max(500);
const flag = z.enum(["true", "false"]).optional().transform((v) => v === "true");

export const invoiceListQuerySchema = z.object({
  status: z.enum(INVOICE_STATUSES).optional(),
  needsPrice: flag,
  clientUserId: id.optional(),
  accountId: id.optional(),
  number: z.coerce.number().int().positive().optional(),
  q: searchText.optional(),
  ...pageQueryShape,
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
    // A discount: a reason (its default percent applies if none is given) and/or text, then a percent OR a fixed amount.
    z.object({
      op: z.literal("discount"),
      reasonId: id.optional(),
      text: z.string().trim().max(200).optional(),
      percent: z.number().int().min(1).max(100).optional(),
      amountCents: positiveCents.optional(),
    }),
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

export const accountCreditSchema = z.object({
  amountCents: positiveCents,
  reason,
  // Omit to apply oldest-first.
  allocations: z.array(z.object({ invoiceId: id, amountCents: positiveCents })).min(1).max(200).optional(),
}).refine(
  (p) => !p.allocations || p.allocations.reduce((s, a) => s + a.amountCents, 0) === p.amountCents,
  { message: "Allocations must add up to the credit.", path: ["allocations"] },
);

export const statementQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM.") });
// A client's statement download: `account` is a practice id, "all" (only with one practice), or
// "organization:<id>" (the combined group statement, for that group's admins). The server decides access.
export const statementDownloadQuerySchema = statementQuerySchema.extend({ account: z.string().min(1).max(200).optional() });
// The monthly statement run: everyone due (omit keys), or only these preview rows ("<subject>:<id>|<recipientUserId>").
export const statementRunSchema = statementQuerySchema.extend({ keys: z.array(z.string().min(3).max(300)).min(1).max(5000).optional() });
// groupBy=organization adds the group rollup (`groups`); the rows stay one per practice either way.
export const receivablesQuerySchema = z.object({ pastDueOnly: flag, groupBy: z.enum(["account", "organization"]).default("account") });
export const clientInvoicesQuerySchema = z.object({ open: flag });
