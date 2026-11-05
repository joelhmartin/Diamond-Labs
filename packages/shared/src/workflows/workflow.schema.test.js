import { test } from "vitest";
import assert from "node:assert/strict";
import { workflowTemplateSchema, workflowAssignmentsSchema, workflowPreviewSchema } from "./workflow.schema.js";

const ok = {
  key: "standard", name: "Standard", totalDays: 10, rushWorkflowKey: null, isDefault: false, active: true,
  stages: [{ key: "start", label: "Start", milestone: "m0", dayOffset: 0 }],
};

test("rejects a key with spaces", () => {
  assert.equal(workflowTemplateSchema.safeParse(ok).success, true);
  assert.equal(workflowTemplateSchema.safeParse({ ...ok, key: "has space" }).success, false);
  assert.equal(workflowTemplateSchema.safeParse({ ...ok, stages: [] }).success, false);
});

test("assignments and preview shapes", () => {
  assert.equal(workflowAssignmentsSchema.safeParse({ subjectType: "t", subjectIds: ["a"], workflowKey: null }).success, true);
  assert.equal(workflowAssignmentsSchema.safeParse({ subjectType: "t", subjectIds: [], workflowKey: "x" }).success, false);
  assert.equal(workflowPreviewSchema.safeParse({ workflowKey: null, startAt: "2026-11-02T10:00:00Z" }).success, true);
  assert.equal(workflowPreviewSchema.safeParse({ workflowKey: "x", dueAt: "soon" }).success, false);
});
