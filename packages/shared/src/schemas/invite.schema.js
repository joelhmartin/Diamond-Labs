import { z } from "zod";
import { ROLE_SLUGS } from "../constants/roles.js";

export const createInviteSchema = z.object({
  email: z.string().email("Invalid email address").transform((e) => e.toLowerCase().trim()),
  role: z.enum(ROLE_SLUGS, { errorMap: () => ({ message: "Invalid role" }) }),
});
