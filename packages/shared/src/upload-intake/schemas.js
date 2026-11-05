import { z } from "zod";

/** File types a scanner export may contain. Anything else is refused per file. */
export const INTAKE_ACCEPTED_EXTENSIONS = [".zip", ".xml", ".html", ".htm", ".pdf", ".stl", ".ply", ".obj"];
export const INTAKE_SPLITS = ["one", "per_file"];
export const INTAKE_STATUSES = ["pending", "promoted", "discarded"];
export const INTAKE_REASON_MAX = 500;

/** Query for the paged intake list. */
export const intakeListQuerySchema = z.object({
  status: z.enum(INTAKE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const intakeDiscardSchema = z.object({
  reason: z.string().trim().max(INTAKE_REASON_MAX).optional(),
}).default({});
