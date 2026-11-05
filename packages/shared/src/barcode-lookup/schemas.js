import { z } from "zod";

export const LOOKUP_CODE_MAX = 64;

/** A scanned or typed code: trimmed, 1-64 printable ASCII characters. */
export const lookupQuerySchema = z.object({
  code: z.string().trim().min(1, "Enter a code.").max(LOOKUP_CODE_MAX).regex(/^[\x20-\x7E]+$/, "Invalid code."),
});
