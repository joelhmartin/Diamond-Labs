import { z } from "zod";
import { id } from "./common.schema.js";

/** Admin > Practices list filters (and the order-entry practice lookup: `memberUserId`). */
export const listPracticesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  organizationId: id.optional(),
  missingNumber: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  memberUserId: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
