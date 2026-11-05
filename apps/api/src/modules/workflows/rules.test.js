import { test } from "vitest";
import assert from "node:assert/strict";
import { toCalendar } from "../business-calendar/rules.js";
import { planFromTemplate, planWith, resolveRush, validateTemplate, behindSchedule, pickLongest } from "./rules.js";

const calendar = (over = {}) => ({ ...toCalendar({ key: "c", timezone: "UTC", leadDays: 13, closedWeekdays: [0, 6] }, []), ...over });

const tenDay = (over = {}) => ({
  key: "ten", name: "Ten day", totalDays: 10, rushWorkflowKey: null, isDefault: false, active: true, position: 0,
  stages: [
    { key: "a", label: "A", milestone: "m0", dayOffset: 0 },
    { key: "b", label: "B", milestone: "m1", dayOffset: 1 },
    { key: "c", label: "C", milestone: "m2", dayOffset: 10 },
  ],
  ...over,
});

test("forward plan offsets in business days", () => {
  const plan = planFromTemplate(tenDay(), { startDate: "2026-11-02" }, calendar());
  assert.equal(plan.dueAt, "2026-11-16");
  assert.equal(plan.direction, "forward");
  assert.equal(plan.stages[1].targetAt, "2026-11-03");
  assert.equal(plan.workflowKey, "ten");
});

test("reverse plan ends exactly on the requested date", () => {
  const plan = planFromTemplate(tenDay(), { startDate: "2026-11-02", dueAt: "2026-12-04" }, calendar());
  assert.equal(plan.direction, "reverse");
  assert.equal(plan.dueAt, "2026-12-04");
  assert.equal(plan.stages.at(-1).targetAt, "2026-12-04");
  assert.equal(plan.stages[1].targetAt, "2026-11-23");
});

test("reverse plan clamps targets to the start date", () => {
  const plan = planFromTemplate(tenDay(), { startDate: "2026-11-02", dueAt: "2026-11-04" }, calendar());
  for (const s of plan.stages) assert.ok(s.targetAt >= "2026-11-02");
  assert.equal(plan.stages.at(-1).targetAt, "2026-11-04");
});

test("no template falls back to lead days with no stages", () => {
  const plan = planFromTemplate(null, { startDate: "2026-11-02" }, calendar());
  assert.equal(plan.dueAt, "2026-11-19");
  assert.deepEqual(plan.stages, []);
  assert.equal(plan.workflowKey, null);
});

test("rush uses the linked active template, else the original", () => {
  const fast = tenDay({ key: "fast", totalDays: 3, stages: [{ key: "x", label: "X", milestone: "m0", dayOffset: 3 }] });
  const base = tenDay({ rushWorkflowKey: "fast" });
  const byKey = { ten: base, fast };
  assert.equal(resolveRush(base, byKey, true).key, "fast");
  assert.equal(resolveRush(base, byKey, false).key, "ten");
  assert.equal(resolveRush(base, { ...byKey, fast: { ...fast, active: false } }, true).key, "ten");
  assert.equal(resolveRush(tenDay(), byKey, true).key, "ten");
});

test("planWith resolves rush and rejects an unknown key", () => {
  const fast = tenDay({ key: "fast", totalDays: 3, stages: [{ key: "x", label: "X", milestone: "m0", dayOffset: 3 }] });
  const byKey = { ten: tenDay({ rushWorkflowKey: "fast" }), fast };
  const plan = planWith(byKey, { workflowKey: "ten", startAt: new Date("2026-11-02T15:00:00Z"), rush: true }, calendar());
  assert.equal(plan.workflowKey, "fast");
  assert.equal(plan.dueAt, "2026-11-05");
  assert.throws(() => planWith(byKey, { workflowKey: "nope", startAt: new Date() }, calendar()), { code: "NOT_FOUND" });
});

test("behindSchedule flags the first missed stage only when the rank lags", () => {
  const stages = [
    { key: "a", milestone: "m0", targetAt: "2026-11-02" },
    { key: "b", milestone: "m1", targetAt: "2026-11-03" },
    { key: "c", milestone: "m2", targetAt: "2026-11-20" },
  ];
  const rankOf = (m) => Number(m.slice(1));
  assert.deepEqual(behindSchedule(stages, 0, rankOf, "2026-11-05"), { behind: true, lateStage: "b" });
  assert.deepEqual(behindSchedule(stages, 1, rankOf, "2026-11-05"), { behind: false, lateStage: null });
  assert.deepEqual(behindSchedule(stages, 0, rankOf, "2026-11-01"), { behind: false, lateStage: null });
});

test("validateTemplate rejects decreasing offsets and a last offset != totalDays", () => {
  assert.doesNotThrow(() => validateTemplate(tenDay()));
  const bad = (over) => assert.throws(() => validateTemplate(tenDay(over)), { code: "INVALID" });
  bad({ stages: [{ key: "a", label: "A", milestone: "m", dayOffset: 5 }, { key: "b", label: "B", milestone: "m", dayOffset: 2 }], totalDays: 2 });
  bad({ totalDays: 9 });
  bad({ stages: [] });
  bad({ stages: [{ key: "a", label: "A", milestone: "m", dayOffset: 0 }, { key: "a", label: "A", milestone: "m", dayOffset: 10 }] });
  bad({ rushWorkflowKey: "ten" });
});

test("pickLongest prefers the most days", () => {
  const list = [tenDay({ key: "b", totalDays: 5, position: 0 }), tenDay({ key: "a", totalDays: 10, position: 3 }), tenDay({ key: "c", totalDays: 10, position: 1 })];
  assert.equal(pickLongest(list).key, "c");
  assert.equal(pickLongest([]), null);
});
