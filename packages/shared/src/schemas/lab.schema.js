import { z } from "zod";
import { id, isoDate, pageQueryShape } from "./common.schema.js";
import { LAB_ORDER_STATUSES, LAB_ORDER_SOURCES, LAB_BOARD_TILES } from "../lab/lab-order-status.js";
import { ROLE_CHANGE_CHOICES } from "../constants/user-roles.js";
import { workflowPreviewSchema } from "../workflows/workflow.schema.js";

const version = z.number().int().positive();
const reason = z.string().trim().max(500);
const flag = z.enum(["true", "false"]).optional().transform((v) => v === "true");

export const labStatusChangeSchema = z.object({
  to: z.enum(LAB_ORDER_STATUSES),
  reason: reason.optional(),
  expectedVersion: version,
});

export const labFieldChangeSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("assign"), value: id.nullable(), expectedVersion: version }),
  z.object({ field: z.literal("department"), value: id.nullable(), expectedVersion: version }),
  z.object({ field: z.literal("due"), value: isoDate.nullable(), expectedVersion: version }),
  z.object({ field: z.literal("notes"), value: z.string().max(5000).nullable(), expectedVersion: version }),
]);

export const labRemakeSchema = z.object({ reason: reason.min(1), expectedVersion: version });

export const labDepartmentCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).max(1000).optional(),
});

export const labDepartmentUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  active: z.boolean().optional(),
}).refine((o) => Object.keys(o).length > 0, "Nothing to change.");

export const labOrderListQuerySchema = z.object({
  status: z.enum(LAB_ORDER_STATUSES).optional(),
  source: z.enum(LAB_ORDER_SOURCES).optional(),
  departmentId: id.optional(),
  assigneeUserId: id.optional(),
  rush: flag,
  dueBefore: isoDate.optional(),
  dueOn: isoDate.optional(),
  tile: z.enum(LAB_BOARD_TILES).optional(),
  q: z.string().trim().max(100).optional(),
  includeClosed: flag,
  ...pageQueryShape,
});

// ── Scheduling ─────────────────────────────────────────────────────────────

const workflowKey = workflowPreviewSchema.shape.workflowKey.unwrap(); // the workflows module's key format

/** Put an order on another workflow; keepDueDate replans in reverse from the current due date. */
export const labWorkflowChangeSchema = z.object({
  workflowKey,
  keepDueDate: z.boolean().optional().default(false),
  expectedVersion: version,
});

/** `variantIds` arrives as "a,b" or as a repeated query key. */
const idList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => [...new Set([].concat(v ?? []).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean))])
  .pipe(z.array(id).max(100));

/** A dry run of the due-date rules, for staff order entry. */
export const labSchedulePreviewQuerySchema = z.object({
  variantIds: idList,
  rush: flag,
  workflowKey: workflowKey.optional().transform((v) => v ?? null),
  requestedDueDate: isoDate.optional().transform((v) => v ?? null),
});

export const rxReleaseSchema = z.object({ confirmNotInSeazona: z.boolean().optional() }).default({});

export const userRoleChangeSchema = z.object({ role: z.enum(ROLE_CHANGE_CHOICES) });
