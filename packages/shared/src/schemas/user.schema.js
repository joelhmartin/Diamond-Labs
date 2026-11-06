import { z } from "zod";

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatar_url: z.string().url().nullable().optional(),
});

const idList = z.string().max(4000).transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean));

/**
 * Admin > Users list query. With no params the whole list comes back (the Users screen);
 * `limit` returns one page of the filtered list plus `total` (the logins picker).
 *   q            name/email contains
 *   role/status  exact filters
 *   ids          only these users (label lookup); excludeIds drops these (already-chosen people)
 */
export const adminUsersQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(["user", "doctor", "admin", "lab"]).optional(),
  status: z.enum(["active", "suspended", "deleted"]).optional(),
  ids: idList.optional(),
  excludeIds: idList.optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
