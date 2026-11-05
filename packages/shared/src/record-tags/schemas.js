import { z } from "zod";

/** Palette keys a tag may use; the web maps each to theme colors. */
export const TAG_COLORS = ["slate", "red", "orange", "amber", "green", "teal", "blue", "purple"];
export const TAG_APPLY_MAX_IDS = 500;
export const TAG_LABEL_MAX = 40;

const label = z.string().trim().min(1, "Label is required.").max(TAG_LABEL_MAX);
const color = z.enum(TAG_COLORS);

export const tagDefinitionCreateSchema = z.object({ label, color: color.default("slate") });

export const tagDefinitionUpdateSchema = z
  .object({ label: label.optional(), color: color.optional(), position: z.number().int().min(0).optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export const tagApplySchema = z
  .object({
    ids: z.array(z.string().min(1).max(128)).min(1).max(TAG_APPLY_MAX_IDS),
    add: z.array(z.string().min(1).max(128)).max(100).default([]),
    remove: z.array(z.string().min(1).max(128)).max(100).default([]),
  })
  .refine((v) => v.add.length + v.remove.length > 0, "Choose a tag to add or remove.");
