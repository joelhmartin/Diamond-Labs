import { z } from "zod";
import { ROLE_SLUGS } from "../constants/roles.js";

export const updateRoleSchema = z.object({
  role: z.enum(ROLE_SLUGS, { errorMap: () => ({ message: "Invalid role" }) }),
});
