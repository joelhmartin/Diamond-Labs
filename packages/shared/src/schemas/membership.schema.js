import { z } from "zod";

// Assignable roles exclude "owner" — ownership is established at account
// creation and transferred through a dedicated flow, never via role update.
// Allowing "owner" here would let an admin promote an arbitrary member to owner
// (privilege escalation). Keep this list explicit and in sync with roles.js
// minus "owner".
export const ASSIGNABLE_ROLE_SLUGS = ["admin", "manager", "member", "viewer"];

export const updateRoleSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLE_SLUGS, { errorMap: () => ({ message: "Invalid role" }) }),
});
