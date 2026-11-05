import { z } from "zod";
import { isCalendarDate } from "../dates/iso-days.js";

/**
 * Zod primitives shared by the billing, lab and shipping request schemas.
 * A date must be a real day: 2026-02-30 is refused here (a 422), never handed to SQL.
 */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.").refine(isCalendarDate, "Not a real date.");
export const id = z.string().min(1).max(128);

/** Optional paging for the list endpoints: sending `limit` turns on `{ rows, total }` responses. */
export const pageQueryShape = {
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
};
/** Free-text search box value for the server-searched lists. */
export const searchText = z.string().trim().min(1).max(100);
