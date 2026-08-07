import { z } from "zod";

/**
 * AutoPay enrollment. `enabled` is optional and NOT implied by submitting this
 * form — the service layer defaults new enrollments to disabled regardless of
 * what the client sends unless it explicitly passes `enabled: true`.
 */
export const autopayEnrollSchema = z.object({
  amount: z.number().positive("Amount must be greater than zero.").max(100000),
  dayOfMonth: z.number().int().min(1, "Day must be 1–31.").max(31, "Day must be 1–31."),
  paymentProfileId: z.string().min(1, "Choose a card on file."),
  enabled: z.boolean().optional(),
});

// Admin may additionally set a per-doctor floor override.
export const autopayAdminEnrollSchema = autopayEnrollSchema.extend({
  minAmountOverride: z.number().positive().max(100000).nullable().optional(),
});
