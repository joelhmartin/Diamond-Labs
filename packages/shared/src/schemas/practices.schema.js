import { z } from "zod";
import { id } from "./common.schema.js";

/** Admin > Practices list filters (and the order-entry practice lookup: `memberUserId`). */
export const listPracticesQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  organizationId: id.optional(),
  missingNumber: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  memberUserId: id.optional(),
  // Only practices that are in no group (the "add to group" picker).
  ungrouped: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Roles staff may assign on a practice; "owner" is never assignable. */
export const PRACTICE_MEMBER_ROLES = ["admin", "member", "viewer"];

export const updatePracticeSchema = z.object({
  // Empty clears the number.
  accountNumber: z.string().trim().max(100),
});

export const addPracticeMemberSchema = z.object({
  userId: id,
  role: z.enum(PRACTICE_MEMBER_ROLES).default("member"),
});

export const setPracticeMemberRoleSchema = z.object({
  role: z.enum(PRACTICE_MEMBER_ROLES),
});
