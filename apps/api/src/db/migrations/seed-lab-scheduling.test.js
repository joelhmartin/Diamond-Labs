import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateTemplate } from "../../modules/workflows/index.js";
import { LAB_MILESTONES } from "../../services/lab/lab-scheduling.js";

const dir = fileURLToPath(new URL(".", import.meta.url));
const file = readdirSync(dir).find((f) => /^\d{4}_seed_lab_scheduling\.sql$/.test(f));
const sql = file ? readFileSync(`${dir}/${file}`, "utf8") : "";

const KEYS = {
  "10d-2-device": ["10-day 2-device PMT/Acrylic/Dual-Laminate", 10],
  "10d-printed": ["10-day Printed", 10],
  "10d-standard-rush": ["10-day Standard Rush", 10],
  "15d-printed": ["15-day Printed", 15],
  "3d-max-rush": ["3-day Max Rush", 3],
  "7d-1-device": ["7-day 1-device", 7],
  "7d-expedited": ["7-day Expedited", 7],
  "8d-printed-shipping": ["8-day Printed + Shipping", 8],
};

const workflowRows = [...sql.matchAll(/\('(seed-workflow-[^']+)', '([^']+)', '([^']+)', (\d+), NULL, false, true, \d+\)/g)]
  .map(([, id, key, name, total]) => ({ id, key, name, totalDays: Number(total) }));
const stageRows = [...sql.matchAll(/\('seed-stage-[^']+', '([^']+)', (\d+), '([^']+)', '([^']+)', (\d+), '([^']+)'\)/g)]
  .map(([, workflowId, position, key, label, dayOffset, milestone]) => ({ workflowId, position: Number(position), key, label, dayOffset: Number(dayOffset), milestone }));

test("the seed migration exists and is split by statement breakpoints", () => {
  assert.ok(file, "a NNNN_seed_lab_scheduling.sql migration");
  assert.match(sql, /--> statement-breakpoint/);
});

test("every insert is ON CONFLICT DO NOTHING, so a re-run never overwrites staff edits", () => {
  const inserts = sql.match(/INSERT INTO/g) ?? [];
  assert.equal(inserts.length, 3, "calendar, workflows, stages");
  assert.equal((sql.match(/ON CONFLICT DO NOTHING;/g) ?? []).length, inserts.length);
  assert.doesNotMatch(sql, /DO UPDATE|UPDATE "|DELETE FROM/i);
});

test("the lab calendar: America/Chicago, 13 lead days, Saturday and Sunday closed, no capacity", () => {
  assert.match(sql, /VALUES \('default', 'America\/Chicago', 13, '\[0,6\]'::jsonb, 'none', '\{\}'::jsonb\)/);
});

test("all 8 workflows with their names and totals; no default, no rush links", () => {
  assert.deepEqual(Object.fromEntries(workflowRows.map((w) => [w.key, [w.name, w.totalDays]])), KEYS);
  assert.equal(new Set(workflowRows.map((w) => w.id)).size, 8, "fixed literal ids");
});

test("the last stage offset equals each total, and every template passes the module's own validation", () => {
  const milestones = new Set(LAB_MILESTONES.map((m) => m.value));
  for (const w of workflowRows) {
    const stages = stageRows.filter((s) => s.workflowId === w.id).sort((a, b) => a.position - b.position);
    assert.deepEqual(stages.map((s) => s.key), ["check-in", "production", "qc", "pack", "ship"], w.key);
    assert.equal(stages.at(-1).dayOffset, w.totalDays, w.key);
    assert.ok(stages.every((s) => milestones.has(s.milestone)), `${w.key} names lab milestones only`);
    assert.doesNotThrow(() => validateTemplate({ ...w, rushWorkflowKey: null, stages }), w.key);
  }
  assert.deepEqual(stageRows.filter((s) => s.workflowId === "seed-workflow-3d-max-rush").map((s) => s.dayOffset), [0, 0, 1, 2, 3]);
  assert.deepEqual(stageRows.filter((s) => s.workflowId === "seed-workflow-10d-printed").map((s) => s.dayOffset), [0, 1, 8, 9, 10]);
});
