import { z } from "zod";
import { isoDate } from "./common.schema.js";

export const INVOICE_EXPORT_DATE_FIELDS = ["ordered", "due", "issued"];
export const INVOICE_EXPORT_STATUSES = ["open", "paid", "void", "draft"];
export const INVOICE_EXPORT_MAX_DAYS = 366;

// A query string carries one value as a string and several as an array; a
// comma list is accepted too.
const asList = (v) => (typeof v === "string" ? v.split(",").filter(Boolean) : v);

const realDate = isoDate.refine((s) => new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), "Not a real date.");
const dayNumber = (s) => Date.parse(`${s}T00:00:00Z`) / 86_400_000;

/** Params of the invoice export: a date window (lab-local days) over one date field, optionally narrowed by status. */
export const invoiceExportParamsSchema = z
  .object({
    dateField: z.enum(INVOICE_EXPORT_DATE_FIELDS),
    from: realDate,
    to: realDate,
    statuses: z.preprocess(asList, z.array(z.enum(INVOICE_EXPORT_STATUSES)).optional()),
  })
  .superRefine((p, ctx) => {
    if (p.to < p.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "The end date is before the start date." });
    } else if (dayNumber(p.to) - dayNumber(p.from) > INVOICE_EXPORT_MAX_DAYS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `Pick a range of ${INVOICE_EXPORT_MAX_DAYS} days or less.` });
    }
  });
