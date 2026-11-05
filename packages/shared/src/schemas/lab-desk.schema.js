import { z } from "zod";
import { id, isoDate } from "./common.schema.js";
import { labEnclosuresSchema, labPanSchema, labDeliveryMethodSchema, labNotesSchema, labVersionSchema } from "./lab.schema.js";
import { LAB_ARCHES, LAB_LINE_QTY_MAX, LAB_PATIENT_NAME_MAX } from "../lab/production-desk.js";

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
