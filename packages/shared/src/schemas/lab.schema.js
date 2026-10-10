import { z } from "zod";
import { LAB_ORDER_STATUSES } from "../lab/lab-order-status.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const version = z.number().int().positive();
const reason = z.string().trim().max(500);
const id = z.string().min(1).max(128);
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
  source: z.enum(["rx_case", "shop_order"]).optional(),
  departmentId: id.optional(),
  assigneeUserId: id.optional(),
  rush: flag,
  dueBefore: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  includeClosed: flag,
});

export const rxReleaseSchema = z.object({ confirmNotInSeazona: z.boolean().optional() }).default({});

export const userRoleChangeSchema = z.object({ role: z.enum(["lab", "user"]) });
