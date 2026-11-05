import { z } from "zod";
import { isoDate } from "../schemas/common.schema.js";

const slug = z.string().regex(/^[a-z0-9-]{1,60}$/, "Use lowercase letters, digits and dashes.");

export const workflowStageSchema = z.object({
  key: slug,
  label: z.string().trim().min(1).max(120),
  milestone: z.string().trim().min(1).max(60),
  dayOffset: z.number().int().min(0).max(120),
});

export const workflowTemplateSchema = z.object({
  key: slug,
  name: z.string().trim().min(1).max(120),
  totalDays: z.number().int().min(0).max(120),
  rushWorkflowKey: slug.nullable().optional().default(null),
  isDefault: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
  stages: z.array(workflowStageSchema).min(1).max(30),
});

export const workflowActiveSchema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(200),
  active: z.boolean(),
});

export const workflowAssignmentsSchema = z.object({
  subjectType: z.string().trim().min(1).max(40),
  subjectIds: z.array(z.string().min(1).max(128)).min(1).max(500),
  workflowKey: slug.nullable(),
});

export const workflowAssignmentsQuerySchema = z.object({
  subjectType: z.string().trim().min(1).max(40),
});

export const workflowPreviewSchema = z.object({
  workflowKey: slug.nullable(),
  startAt: z.string().datetime({ offset: true }).optional(),
  rush: z.boolean().optional().default(false),
  dueAt: isoDate.nullable().optional(),
});
