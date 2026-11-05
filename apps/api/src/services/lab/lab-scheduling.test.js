import { test } from "vitest";
import assert from "node:assert/strict";
import { LabOrderError } from "./lab-order-rules.js";
import { fakeTx } from "../../test/fake-tx.js";
import { toCalendar } from "../../modules/business-calendar/index.js";
import {
  defaultDueAt, saveSchedule, scheduleFlags, presentSchedule, labRank, LAB_MILESTONES, AT_RISK_BUSINESS_DAYS,
} from "./lab-scheduling.js";

// Monday 2026-11-02, 9am in Chicago. Lab calendar as seeded: 13 lead days, Sat/Sun closed.
const START = new Date("2026-11-02T15:00:00Z");
const CAL_ROW = { key: "default", timezone: "America/Chicago", leadDays: 13, closedWeekdays: [0, 6], capacityBasis: "none", capacityByWeekday: {} };
const calendar = toCalendar(CAL_ROW, []);

const stagesFor = (workflowId, n) => {
  const production = n <= 3 ? 0 : 1;
  const qc = Math.max(production, n - 2);
  const pack = Math.max(qc, n - 1);
  return [
    ["check-in", "Check in", "received", 0], ["production", "Production", "in_production", production],
    ["qc", "Quality check", "quality_check", qc], ["pack", "Pack", "ready_to_ship", pack], ["ship", "Ship", "shipped", n],
  ].map(([key, label, milestone, dayOffset], position) => ({ workflowId, position, key, label, milestone, dayOffset }));
};
const wf = (key, totalDays, over = {}) => ({
  id: `w-${key}`, key, name: key, totalDays, rushWorkflowKey: null, isDefault: false, active: true, position: 0, ...over,
});
/** The selects a template load pops: the workflow rows, then all their stages. */
const templates = (...rows) => (rows.length ? [rows, rows.flatMap((r) => stagesFor(r.id, r.totalDays))] : [[]]);
const calendarSelects = [[CAL_ROW], []];

test("defaultDueAt uses the longest workflow among the variants", async () => {
  const w10 = wf("10d-printed", 10);
  const w7 = wf("7d-1-device", 7);
  const tx = fakeTx({
    selects: [
      ...calendarSelects,
      [{ familyId: "f1" }, { familyId: "f2" }],
      ...templates(w10, w7),
      [{ subjectType: "variant", subjectId: "v1", workflowKey: "7d-1-device" }, { subjectType: "variant", subjectId: "v2", workflowKey: "10d-printed" }],
      ...templates(w10, w7),
    ],
  });
  const { dueDate, plan } = await defaultDueAt(tx, { variantIds: ["v1", "v2"], startAt: START });
  assert.equal(plan.workflowKey, "10d-printed");
  assert.equal(plan.direction, "forward");
  assert.equal(plan.startDate, "2026-11-02");
  assert.equal(dueDate, "2026-11-16");
  assert.equal(plan.dueAt, dueDate);
  assert.deepEqual(plan.stages.map((s) => s.targetAt), ["2026-11-02", "2026-11-03", "2026-11-12", "2026-11-13", "2026-11-16"]);
});

test("defaultDueAt falls back to family assignments, then the default workflow, then lead days", async () => {
  const w7 = wf("7d-1-device", 7);
  const byFamily = fakeTx({
    selects: [
      ...calendarSelects, [{ familyId: "f1" }], ...templates(w7),
      [], // no variant assignment
      [{ subjectType: "family", subjectId: "f1", workflowKey: "7d-1-device" }],
      ...templates(w7),
    ],
  });
  const family = await defaultDueAt(byFamily, { variantIds: ["v1"], startAt: START });
  assert.equal(family.plan.workflowKey, "7d-1-device");
  assert.equal(family.dueDate, "2026-11-11");

  const def = wf("15d-printed", 15, { isDefault: true });
  const byDefault = fakeTx({ selects: [...calendarSelects, [{ familyId: "f1" }], ...templates(w7, def), [], [], ...templates(w7, def)] });
  const fallback = await defaultDueAt(byDefault, { variantIds: ["v1"], startAt: START });
  assert.equal(fallback.plan.workflowKey, "15d-printed");
  assert.equal(fallback.dueDate, "2026-11-23");

  const none = fakeTx({ selects: [...calendarSelects, [], [], []] });
  const lead = await defaultDueAt(none, { variantIds: ["v1"], startAt: START });
  assert.equal(lead.plan.workflowKey, null);
  assert.deepEqual(lead.plan.stages, []);
  assert.equal(lead.dueDate, "2026-11-19", "13 business days from Monday 11/02");
});

test("no workflow, no lead time and no requested date keeps the old behaviour: no due date, no plan", async () => {
  const tx = fakeTx({ selects: [[], [], []] }); // no calendar row (built-in defaults), no holidays, no templates
  assert.deepEqual(await defaultDueAt(tx, { startAt: START }), { dueDate: null, plan: null });
});

test("requested date before plan keeps the date and is at risk", async () => {
  const requested = "2026-11-03";
  const tx = fakeTx({ selects: [...calendarSelects, ...templates(wf("10d-printed", 10))] });
  const { dueDate, plan } = await defaultDueAt(tx, { workflowKey: "10d-printed", requestedDueDate: requested, startAt: START });
  assert.equal(dueDate, requested);
  assert.equal(plan.direction, "reverse");
  assert.equal(plan.stages.at(-1).targetAt, requested);
  const order = { status: "received", heldFrom: null, dueDate };
  assert.equal(scheduleFlags(order, plan, "2026-11-02", calendar).atRisk, true);
});

test("an invalid requested date is ignored and the plan runs forward", async () => {
  const tx = fakeTx({ selects: [...calendarSelects, ...templates(wf("10d-printed", 10))] });
  const { dueDate, plan } = await defaultDueAt(tx, { workflowKey: "10d-printed", requestedDueDate: "2026-02-30", startAt: START });
  assert.equal(plan.direction, "forward");
  assert.equal(dueDate, "2026-11-16");
});

test("rush picks the linked rush workflow", async () => {
  const w10 = wf("10d-standard-rush", 10, { rushWorkflowKey: "3d-max-rush" });
  const w3 = wf("3d-max-rush", 3);
  const tx = fakeTx({ selects: [...calendarSelects, ...templates(w10, w3)] });
  const { dueDate, plan } = await defaultDueAt(tx, { workflowKey: "10d-standard-rush", rush: true, startAt: START });
  assert.equal(plan.workflowKey, "3d-max-rush");
  assert.equal(dueDate, "2026-11-05");
  const plain = fakeTx({ selects: [...calendarSelects, ...templates(w10, w3)] });
  assert.equal((await defaultDueAt(plain, { workflowKey: "10d-standard-rush", startAt: START })).plan.workflowKey, "10d-standard-rush");
});

test("saveSchedule upserts the plan as a lab_order record and does nothing without a plan", async () => {
  const tx = fakeTx();
  await saveSchedule(tx, "lo-1", null);
  assert.equal(tx.log.length, 0);
  const plan = { workflowKey: "k", workflowName: "K", startDate: "2026-11-02", dueAt: "2026-11-05", direction: "forward", stages: [] };
  await saveSchedule(tx, "lo-1", plan);
  const ins = tx.log.find((e) => e.op === "insert").values;
  assert.equal(ins.recordType, "lab_order");
  assert.equal(ins.recordId, "lo-1");
  assert.equal(ins.dueDate, "2026-11-05");
});

test("lab milestones follow the board's order, labelled from the shared status labels", () => {
  assert.deepEqual(LAB_MILESTONES.map((m) => m.value), ["received", "in_production", "quality_check", "ready_to_ship", "shipped"]);
  assert.deepEqual(LAB_MILESTONES[0], { value: "received", label: "Received" });
  assert.deepEqual(LAB_MILESTONES.at(-1), { value: "shipped", label: "Shipped" });
  assert.equal(AT_RISK_BUSINESS_DAYS, 2);
});

test("on_hold ranks at heldFrom", () => {
  assert.equal(labRank("received"), 0);
  assert.equal(labRank("shipped"), 4);
  assert.equal(labRank("on_hold", "quality_check"), 2);
  assert.equal(labRank("on_hold", null), 0);
});

const planOf = (stages, dueAt) => ({ workflowKey: "k", workflowName: "K", startDate: "2026-10-26", dueAt, direction: "forward", stages });

test("atRisk: due within 2 business days and not yet in QC; quality_check due tomorrow is not at risk", () => {
  const today = "2026-11-02"; // Monday
  const flags = (status, dueDate) => scheduleFlags({ status, heldFrom: null, dueDate }, null, today, calendar);
  assert.equal(flags("received", "2026-11-04").atRisk, true, "two business days out");
  assert.equal(flags("in_production", "2026-10-30").atRisk, true, "past due counts");
  assert.equal(flags("received", "2026-11-05").atRisk, false, "three business days out");
  assert.equal(flags("quality_check", "2026-11-03").atRisk, false);
  assert.equal(flags("received", null).atRisk, false, "no due date, no plan");
  // Friday: due Tuesday is two business days away across the weekend.
  assert.equal(scheduleFlags({ status: "received", dueDate: "2026-11-10" }, null, "2026-11-06", calendar).atRisk, true);
});

test("behind: a passed stage target the order has not reached; behind is also at risk", () => {
  const stages = [
    { key: "check-in", label: "Check in", milestone: "received", targetAt: "2026-10-26" },
    { key: "production", label: "Production", milestone: "in_production", targetAt: "2026-10-27" },
    { key: "ship", label: "Ship", milestone: "shipped", targetAt: "2026-11-20" },
  ];
  const plan = planOf(stages, "2026-11-20");
  const late = scheduleFlags({ status: "received", dueDate: "2026-11-20" }, plan, "2026-11-02", calendar);
  assert.deepEqual(late, { behind: true, lateStage: "production", atRisk: true });
  const fine = scheduleFlags({ status: "on_hold", heldFrom: "in_production", dueDate: "2026-11-20" }, plan, "2026-11-02", calendar);
  assert.deepEqual(fine, { behind: false, lateStage: null, atRisk: false });
});

test("terminal orders are never behind or at risk", () => {
  const stages = [{ key: "production", label: "Production", milestone: "in_production", targetAt: "2026-10-01" }];
  for (const status of ["shipped", "cancelled"]) {
    assert.deepEqual(
      scheduleFlags({ status, dueDate: "2026-10-01" }, planOf(stages, "2026-10-01"), "2026-11-02", calendar),
      { behind: false, lateStage: null, atRisk: false },
      status,
    );
  }
});

test("presentSchedule marks reached milestones and late stages; no plan is null", () => {
  assert.equal(presentSchedule(null, { status: "received" }, "2026-11-02", calendar), null);
  const stages = [
    { key: "check-in", label: "Check in", milestone: "received", targetAt: "2026-10-26" },
    { key: "production", label: "Production", milestone: "in_production", targetAt: "2026-10-27" },
    { key: "qc", label: "Quality check", milestone: "quality_check", targetAt: "2026-10-28" },
    { key: "ship", label: "Ship", milestone: "shipped", targetAt: "2026-11-20" },
  ];
  const out = presentSchedule(planOf(stages, "2026-11-20"), { status: "in_production", dueDate: "2026-11-20" }, "2026-11-02", calendar);
  assert.equal(out.workflowKey, "k");
  assert.equal(out.workflowName, "K");
  assert.equal(out.direction, "forward");
  assert.deepEqual(out.stages.map((s) => [s.key, s.targetAt, s.reached, s.late]), [
    ["check-in", "2026-10-26", true, false],
    ["production", "2026-10-27", true, false],
    ["qc", "2026-10-28", false, true],
    ["ship", "2026-11-20", false, false],
  ]);
  assert.equal(out.behind, true);
  assert.equal(out.atRisk, true);
  const shipped = presentSchedule(planOf(stages, "2026-11-20"), { status: "shipped", dueDate: "2026-11-20" }, "2026-11-25", calendar);
  assert.ok(shipped.stages.every((s) => s.reached && !s.late));
});

test("atRisk: a 3-year-past-due open order is at risk; a 9999-12-31 due date does not throw or flag", () => {
  const today = "2026-11-02";
  const flags = (dueDate) => scheduleFlags({ status: "received", heldFrom: null, dueDate }, null, today, calendar);
  assert.equal(flags("2023-11-02").atRisk, true);
  assert.equal(flags("9999-12-31").atRisk, false);
});

test("atRisk: a due date on a closed day uses the same window as an open one (window counts open days only)", () => {
  const today = "2026-11-02"; // Mon; open days after: Tue 3, Wed 4, Thu 5
  const flags = (dueDate) => scheduleFlags({ status: "received", heldFrom: null, dueDate }, null, today, calendar);
  assert.equal(flags("2026-11-04").atRisk, true, "2nd open day");
  assert.equal(flags("2026-11-05").atRisk, false, "3rd open day");
  // Friday today: Sat/Sun are closed and count for nothing; Mon 9, Tue 10 are the 1st and 2nd open days.
  const fri = (dueDate) => scheduleFlags({ status: "received", heldFrom: null, dueDate }, null, "2026-11-06", calendar);
  assert.equal(fri("2026-11-08").atRisk, true, "Sunday: still 0 open days away");
  assert.equal(fri("2026-11-10").atRisk, true, "2nd open day");
  assert.equal(fri("2026-11-11").atRisk, false, "3rd open day");
});

test("defaultDueAt with an unknown explicit workflow key is INVALID, not a raw WorkflowError", async () => {
  const tx = fakeTx({ selects: [...calendarSelects, ...templates(wf("std", 5))] });
  await assert.rejects(
    defaultDueAt(tx, { workflowKey: "nope", startAt: START }),
    (e) => e instanceof LabOrderError && e.code === "INVALID",
  );
});
