import { z } from "zod";

/** Zod primitives shared by the billing, lab and shipping request schemas. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
export const id = z.string().min(1).max(128);
