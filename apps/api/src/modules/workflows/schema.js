import { pgTable, varchar, integer, boolean, date, jsonb, timestamp, primaryKey, index, uniqueIndex } from "drizzle-orm/pg-core";

// workflows tables. GENERIC: nothing here knows what the host plans.
// No DB foreign keys (repo convention): stages point at workflows by id, the rest by key.

export const workflows = pgTable("workflows", {
  id: varchar("id", { length: 128 }).primaryKey(),
  key: varchar("key", { length: 60 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  totalDays: integer("total_days").notNull().default(0),
  rushWorkflowKey: varchar("rush_workflow_key", { length: 60 }),
  isDefault: boolean("is_default").notNull().default(false),
  active: boolean("active").notNull().default(true),
  position: integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("workflows_key_idx").on(t.key),
]);

export const workflowStages = pgTable("workflow_stages", {
  id: varchar("id", { length: 128 }).primaryKey(),
  workflowId: varchar("workflow_id", { length: 128 }).notNull(),
  position: integer("position").notNull(),
  key: varchar("key", { length: 60 }).notNull(),
  label: varchar("label", { length: 120 }).notNull(),
  dayOffset: integer("day_offset").notNull(),
  milestone: varchar("milestone", { length: 60 }).notNull(),
}, (t) => [
  index("workflow_stages_workflow_idx").on(t.workflowId),
]);

export const workflowAssignments = pgTable("workflow_assignments", {
  subjectType: varchar("subject_type", { length: 40 }).notNull(),
  subjectId: varchar("subject_id", { length: 128 }).notNull(),
  workflowKey: varchar("workflow_key", { length: 60 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.subjectType, t.subjectId] }),
]);

export const workflowPlans = pgTable("workflow_plans", {
  recordType: varchar("record_type", { length: 40 }).notNull(),
  recordId: varchar("record_id", { length: 128 }).notNull(),
  workflowKey: varchar("workflow_key", { length: 60 }),
  workflowName: varchar("workflow_name", { length: 120 }),
  startDate: date("start_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  // forward | reverse
  direction: varchar("direction", { length: 10 }).notNull().default("forward"),
  // [{ key, label, milestone, targetAt }] snapshot taken when the plan was made.
  stages: jsonb("stages").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.recordType, t.recordId] }),
  index("workflow_plans_type_due_idx").on(t.recordType, t.dueDate),
]);
