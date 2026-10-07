import { z } from "zod";

export const CATALOG_CHANNELS = ["shop", "rx", "both"];

/**
 * Accept a number or a numeric string ("2", "43.60"), then validate `inner`.
 * z.coerce.number() would also turn null/""/false/true/[3] into numbers.
 */
export const numericInput = (inner) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), inner);

const cents = z.number().int().min(0).max(10_000_000);
const slug = z.string().trim().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Lowercase letters, numbers and dashes only.");
const nonEmpty = (o) => Object.keys(o).length > 0;

export const familyCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug,
  category: z.string().trim().max(100).nullish(),
  description: z.string().max(5000).nullish(),
  imageUrl: z.string().trim().max(2000).nullish(),
  channel: z.enum(CATALOG_CHANNELS).default("shop"),
});

export const familyUpdateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  slug: slug.optional(),
  category: z.string().trim().max(100).nullish(),
  description: z.string().max(5000).nullish(),
  imageUrl: z.string().trim().max(2000).nullish(),
  channel: z.enum(CATALOG_CHANNELS).optional(),
  active: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
}).refine(nonEmpty, "Nothing to update.");

export const optionCreateSchema = z.object({
  name: z.string().trim().min(1).max(60),
  values: z.array(z.string().trim().min(1).max(120)).min(1).max(50),
}).refine((o) => new Set(o.values.map((v) => v.toLowerCase())).size === o.values.length, {
  message: "Option values must be unique.", path: ["values"],
});

export const optionValueCreateSchema = z.object({ value: z.string().trim().min(1).max(120) });

export const optionRenameSchema = z.object({ name: z.string().trim().min(1).max(60) });
export const optionValueRenameSchema = optionValueCreateSchema;

export const variantUpdateSchema = z.object({
  code: z.string().trim().min(1).max(60).nullable().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  basePriceCents: cents.nullable().optional(),
  taxable: z.boolean().optional(),
  active: z.boolean().optional(),
  catalogId: z.string().trim().min(1).max(100).nullable().optional(),
}).refine(nonEmpty, "Nothing to update.");

export const familyMergeSchema = z.object({
  sourceFamilyId: z.string().min(1).max(128),
  optionValueIds: z.array(z.string().min(1).max(128)).max(10),
});

export const clientPriceUpsertSchema = z.object({
  priceCents: cents,
  note: z.string().max(500).nullish(),
});

export const clientPriceReviewSchema = z.object({
  variantIds: z.array(z.string().min(1).max(128)).min(1).max(1000),
});

export const cartLinesSchema = z.array(z.object({
  variantId: z.string().min(1).max(128),
  qty: numericInput(z.number().int().positive()),
})).min(1).max(100);

export const catalogQuoteSchema = z.object({ items: cartLinesSchema });
