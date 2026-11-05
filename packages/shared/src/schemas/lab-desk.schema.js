import { z } from "zod";
import { id, isoDate } from "./common.schema.js";
import { labEnclosuresSchema, labPanSchema, labDeliveryMethodSchema, labNotesSchema, labVersionSchema } from "./lab.schema.js";
import {
  LAB_ARCHES, LAB_LINE_QTY_MAX, LAB_PATIENT_NAME_MAX, ADJUSTMENT_APPLIES_TO, ADJUSTMENT_LABEL_MAX,
  LAB_MATERIALS_MAX, LAB_MATERIAL_NAME_MAX, LAB_MATERIAL_LOT_MAX, LAB_MERGE_MIN, LAB_MERGE_MAX,
} from "../lab/production-desk.js";

/**
 * Production desk requests: staff order entry (full and quick), the price
 * preview and line edits on an order. A line is a catalog variant: its name
 * and code come from the catalog on the server, never from the request.
 */

const qty = z.number().int().min(1).max(LAB_LINE_QTY_MAX);
const MAX_LINES = 50;

const labLineInput = z.object({
  variantId: id,
  qty: qty.default(1),
  arch: z.enum(LAB_ARCHES).nullable().optional(),
  // A build instruction from the catalog: on the bench and the slip, never billed.
  noteOnly: z.boolean().optional().default(false),
});

export const labOrderCreateSchema = z.object({
  clientUserId: id,
  patientName: z.string().trim().min(1, "Enter the patient's name.").max(LAB_PATIENT_NAME_MAX),
  dueDate: isoDate.optional(),
  pan: labPanSchema.nullable().optional(),
  deliveryMethod: labDeliveryMethodSchema.nullable().optional(),
  enclosures: labEnclosuresSchema.nullable().optional(),
  rush: z.boolean().optional().default(false),
  notes: labNotesSchema.nullable().optional(),
  lines: z.array(labLineInput).max(MAX_LINES).optional().default([]),
  tagIds: z.array(id).max(50).optional().default([]),
  intakeId: id.optional(),
});

export const labPricePreviewSchema = z.object({
  clientUserId: id,
  lines: z.array(labLineInput).min(1).max(MAX_LINES),
});

export const labLineEditSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("add"), variantId: id, qty: qty.default(1), arch: z.enum(LAB_ARCHES).nullable().optional(),
    noteOnly: z.boolean().optional().default(false), expectedVersion: labVersionSchema,
  }),
  z.object({ op: z.literal("update"), lineId: id, qty, expectedVersion: labVersionSchema }),
  z.object({ op: z.literal("remove"), lineId: id, expectedVersion: labVersionSchema }),
]);

// Remake/discount reasons (admin) and materials per line.
// 1-100, or null for "no default": 0% off is meaningless (a remake priced 0% off is just a full-price order).
const reasonPercent = z.number().int().min(1).max(100);
const reasonLabel = z.string().trim().min(1).max(ADJUSTMENT_LABEL_MAX);

export const adjustmentReasonCreateSchema = z.object({
  appliesTo: z.enum(ADJUSTMENT_APPLIES_TO),
  label: reasonLabel,
  discountPercent: reasonPercent.nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
});

export const adjustmentReasonUpdateSchema = z.object({
  appliesTo: z.enum(ADJUSTMENT_APPLIES_TO).optional(),
  label: reasonLabel.optional(),
  discountPercent: reasonPercent.nullable().optional(),
  position: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
}).refine((b) => Object.keys(b).length > 0, "Nothing to change.");

export const adjustmentReasonListQuerySchema = z.object({ appliesTo: z.enum(["remake", "discount"]).optional() });

export const labMaterialsPutSchema = z.object({
  materials: z.array(z.object({
    material: z.string().max(LAB_MATERIAL_NAME_MAX),
    lot: z.string().max(LAB_MATERIAL_LOT_MAX).optional().default(""),
  })).max(LAB_MATERIALS_MAX),
});

export const materialSuggestionsQuerySchema = z.object({ q: z.string().max(LAB_MATERIAL_NAME_MAX).optional() });

/**
 * Merge 2–5 open orders into a chosen primary. `versions` carries the version
 * the client saw for EVERY order (primary included); any mismatch is STALE.
 */
export const labOrderMergeSchema = z.object({
  primaryId: id,
  otherIds: z.array(id).min(LAB_MERGE_MIN - 1).max(LAB_MERGE_MAX - 1),
  versions: z.record(id, labVersionSchema),
});
