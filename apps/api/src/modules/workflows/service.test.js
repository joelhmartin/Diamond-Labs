import { test } from "vitest";
import assert from "node:assert/strict";
import { fakeTx } from "../../test/fake-tx.js";
import { toCalendar } from "../business-calendar/rules.js";
import { createWorkflowsService } from "./service.js";

const calendar = toCalendar({ key: "c", timezone: "UTC", leadDays: 5, closedWeekdays: [0, 6] }, []);

const template = (over = {}) => ({
  key: "std", name: "Standard", totalDays: 4, rushWorkflowKey: null, isDefault: false, active: true,
  stages: [
    { key: "a", label: "A", milestone: "m0", dayOffset: 0 },
    { key: "b", label: "B", milestone: "m1", dayOffset: 4 },
  ],
  ...over,
});

const wfRow = (over = {}) => ({ id: "w1", key: "std", name: "Standard", totalDays: 4, rushWorkflowKey: null, isDefault: false, active: true, position: 0, ...over });
const stageRows = (workflowId = "w1") => [
  { workflowId, position: 0, key: "a", label: "A", milestone: "m0", dayOffset: 0 },
  { workflowId, position: 1, key: "b", label: "B", milestone: "m1", dayOffset: 4 },
];

test("saveWorkflow replaces stages and keeps one default", async () => {
  const tx = fakeTx({ selects: [[], [], [wfRow({ isDefault: true })], [stageRows()[0], stageRows()[1]]] });
  const saved = await createWorkflowsService(tx).saveWorkflow(template({ isDefault: true }));
  const inserts = tx.log.filter((e) => e.op === "insert");
  assert.equal(inserts[0].values.key, "std");
  assert.equal(inserts[0].values.position, 0);
  assert.equal(inserts[1].values.length, 2);
  assert.deepEqual(inserts[1].values.map((s) => s.position), [0, 1]);
  assert.equal(tx.log.filter((e) => e.op === "delete").length, 1);
  assert.ok(tx.log.some((e) => e.op === "update" && e.values?.isDefault === false), "clears the other defaults");
  assert.equal(saved.stages.length, 2);
  assert.equal(saved.isDefault, true);
});

test("saveWorkflow refuses an invalid template and a taken key without writing", async () => {
  const bad = fakeTx();
  await assert.rejects(createWorkflowsService(bad).saveWorkflow(template({ totalDays: 9 })), { code: "INVALID" });
  assert.equal(bad.log.length, 0);
  const taken = fakeTx({ selects: [[{ id: "other" }]] });
  await assert.rejects(createWorkflowsService(taken).saveWorkflow(template()), { code: "CONFLICT" });
  assert.equal(taken.log.some((e) => e.op === "insert"), false);
});

test("editing a template leaves saved plans unchanged", async () => {
  const plan = { workflowKey: "std", workflowName: "Standard", startDate: "2026-11-02", dueAt: "2026-11-06", direction: "forward", stages: [{ key: "a", label: "A", milestone: "m0", targetAt: "2026-11-02" }] };
  const planTx = fakeTx();
  await createWorkflowsService(planTx).savePlan(planTx, "order", "r1", plan);
  const snapshot = planTx.log.find((e) => e.op === "insert").values;
  assert.equal(snapshot.dueDate, "2026-11-06");

  const edit = fakeTx({ selects: [[], [{ key: "std" }], [wfRow({ totalDays: 8 })], [stageRows()[0]]] });
  await createWorkflowsService(edit).saveWorkflow(template({ totalDays: 8, stages: [{ key: "a", label: "A", milestone: "m0", dayOffset: 8 }] }), { id: "w1" });
  assert.equal(edit.log.some((e) => e.op === "insert" && e.values?.recordType), false, "an edit writes no plan rows");

  const read = fakeTx({ selects: [[{ recordType: "order", recordId: "r1", ...snapshot }]] });
  const plans = await createWorkflowsService(read).plansFor("order", ["r1"]);
  assert.deepEqual(plans.get("r1"), plan);
});

test("a template's key cannot change on edit", async () => {
  const tx = fakeTx({ selects: [[], [{ key: "old" }]] });
  await assert.rejects(createWorkflowsService(tx).saveWorkflow(template(), { id: "w1" }), { code: "INVALID" });
});

test("deactivated workflows still resolve by key for existing plans", async () => {
  const inactive = wfRow({ active: false });
  const svc = (selects) => createWorkflowsService(fakeTx({ selects }));
  assert.equal((await svc([[inactive], stageRows()]).getWorkflow("std")).active, false);
  const plan = await svc([[inactive], stageRows()]).planFor({ workflowKey: "std", startAt: new Date("2026-11-02T12:00:00Z") }, calendar);
  assert.equal(plan.workflowKey, "std");
  assert.equal(plan.dueAt, "2026-11-06");
  assert.deepEqual(await svc([[]]).listWorkflows(), []);
});

test("planFor without a workflow plans by lead days and reads no templates", async () => {
  const tx = fakeTx();
  const plan = await createWorkflowsService(tx).planFor({ workflowKey: null, startAt: new Date("2026-11-02T12:00:00Z") }, calendar);
  assert.equal(plan.dueAt, "2026-11-09");
  assert.equal(tx.log.length, 0);
});

test("workflowForSubjects uses the first tier with assignments, then the default", async () => {
  const rows = [wfRow({ id: "w1", key: "a", totalDays: 4 }), wfRow({ id: "w2", key: "b", totalDays: 9 }), wfRow({ id: "w3", key: "dflt", isDefault: true, totalDays: 1 })];
  const stages = [...stageRows("w1"), ...stageRows("w2"), ...stageRows("w3")];
  const tiers = [[{ type: "variant", id: "v1" }], [{ type: "family", id: "f1" }]];

  const first = fakeTx({ selects: [rows, stages, [{ workflowKey: "a" }]] });
  assert.equal((await createWorkflowsService(first).workflowForSubjects(tiers)).key, "a");
  assert.equal(first.log.filter((e) => e.op === "select").length, 3, "stops at the first tier with assignments");

  const second = fakeTx({ selects: [rows, stages, [], [{ workflowKey: "a" }, { workflowKey: "b" }]] });
  assert.equal((await createWorkflowsService(second).workflowForSubjects(tiers)).key, "b");

  const none = fakeTx({ selects: [rows, stages, [], []] });
  assert.equal((await createWorkflowsService(none).workflowForSubjects(tiers)).key, "dflt");

  const empty = fakeTx({ selects: [[]] });
  assert.equal(await createWorkflowsService(empty).workflowForSubjects(tiers), null);
});

test("assignments: null clears, a key must exist, a bulk set upserts", async () => {
  const clear = fakeTx();
  assert.equal(await createWorkflowsService(clear).setAssignments("t", ["x", "y"], null), 0);
  assert.equal(clear.log.filter((e) => e.op === "delete").length, 1);

  const unknown = fakeTx({ selects: [[]] });
  await assert.rejects(createWorkflowsService(unknown).setAssignments("t", ["x"], "nope"), { code: "NOT_FOUND" });

  const set = fakeTx({ selects: [[wfRow()], stageRows()] });
  assert.equal(await createWorkflowsService(set).setAssignments("t", ["x", "y", "x"], "std"), 2);
  const rows = set.log.find((e) => e.op === "insert").values;
  assert.deepEqual(rows.map((r) => r.subjectId), ["x", "y"]);

  const map = await createWorkflowsService(fakeTx({ selects: [[{ subjectId: "x", workflowKey: "std" }]] })).assignmentsFor("t");
  assert.equal(map.get("x"), "std");
  const noQuery = fakeTx();
  assert.equal((await createWorkflowsService(noQuery).assignmentsFor("t", [])).size, 0);
  assert.equal(noQuery.log.length, 0);
});

test("plansFor with no ids makes no query", async () => {
  const tx = fakeTx();
  const plans = await createWorkflowsService(tx).plansFor("order", []);
  assert.equal(plans.size, 0);
  assert.equal(tx.log.length, 0);
});
