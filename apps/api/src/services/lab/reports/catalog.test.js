import { test } from "vitest";
import assert from "node:assert/strict";
import { STAFF_ROLES } from "@my-app/shared";
import { createRegistry } from "../../../modules/reports/registry.js";
import { runReport, createRunSlots } from "../../../modules/reports/runner.js";
import { fakeTx, fakeDb } from "../../../test/fake-tx.js";
import { LAB_CAPABILITIES, registerLabReports } from "./index.js";
import { AUDIT_REPORTS } from "./audit-names.js";
import { LAB_REPORT_GROUPS } from "./groups.js";

const boss = { id: "u1", role: "admin" };
const lab = { id: "u2", role: "lab" };

function registry() {
  const r = createRegistry({ defaultRoles: STAFF_ROLES });
  registerLabReports(r);
  return r;
}

/** The reports that need a later piece's data, and what each requires (index.js provides them all). */
const DEPENDENT = {
  "planning.calendar": ["business-calendar"],
  "planning.tasks-schedule": ["workflows"],
  "planning.assigned-tasks": ["workflows"],
  "planning.assigned-tasks-summary": ["workflows"],
  "departments.tasks": ["workflows"],
  "departments.tasks-summary": ["workflows"],
  "operations.daily-tasks": ["workflows"],
  "operations.production-tasks": ["workflows"],
  "operations.pan-numbers": ["pan-numbers"],
  "operations.pickups": ["pickups"],
  "operations.deliveries": ["deliveries"],
  "products.materials": ["materials"],
  "clients.same-pricing": ["price-lists"],
  "sales.by-rep": ["record-tags"],
};

test("every AUDIT_REPORTS title is defined exactly once in its group, and there are 63 definitions in total", () => {
  assert.equal(AUDIT_REPORTS.length, 63);
  // Dashboard-only tile reports are unlisted: not in the index or the audit count.
  const all = registry().listReports(boss).filter((d) => !d.unlisted);
  assert.equal(all.length, 63);
  const groupKeys = new Set(LAB_REPORT_GROUPS.map((g) => g.key));
  for (const { group, title } of AUDIT_REPORTS) {
    assert.ok(groupKeys.has(group), `unknown group ${group}`);
    const hits = all.filter((d) => d.group === group && d.title === title);
    assert.equal(hits.length, 1, `${group} / ${title}: ${hits.length} definitions`);
  }
  // ...and nothing is registered that the audit does not name (a typo'd title would show up here).
  const named = new Set(AUDIT_REPORTS.map((a) => `${a.group}/${a.title}`));
  assert.deepEqual(all.filter((d) => !named.has(`${d.group}/${d.title}`)).map((d) => d.key), []);
  // Group sizes as the spec's coverage tables: 9 + 9 + 8 + 10 + 7 + 7 + 5 + 8.
  const sizes = Object.fromEntries(LAB_REPORT_GROUPS.map((g) => [g.key, all.filter((d) => d.group === g.key).length]));
  assert.deepEqual(sizes, { accounting: 9, clients: 9, departments: 8, operations: 10, planning: 7, productivity: 7, products: 5, sales: 8 });
});

test("capability provided -> report available and runs: every formerly-stub key runs on a fake tx", async () => {
  const reg = registry();
  assert.deepEqual([...LAB_CAPABILITIES].sort(), [...new Set(Object.values(DEPENDENT).flat())].sort());
  const listed = Object.fromEntries(reg.listReports(boss).map((d) => [d.key, d]));
  assert.deepEqual(Object.values(listed).filter((d) => !d.available).map((d) => d.key), [], "nothing is unavailable");
  for (const [key, needs] of Object.entries(DEPENDENT)) {
    assert.deepEqual(listed[key].requires, needs, key);
    assert.deepEqual(listed[key].missing, [], key);
    assert.ok(listed[key].description, `${key} description`);
    // Through the real runner (params resolved, read-only tx): every query answers [] and the report still returns rows.
    const out = await runReport({ registry: reg, db: fakeDb(fakeTx({ executes: [] })), key, query: {}, actor: boss, slots: createRunSlots(), tz: "America/Chicago" });
    assert.ok(Array.isArray(out.rows), key);
  }
});

test("a registry without the capabilities still refuses those reports as UNAVAILABLE (the generic gate)", async () => {
  const reg = createRegistry({ defaultRoles: STAFF_ROLES });
  reg.defineGroup({ key: "g", title: "G" });
  reg.defineReport({ key: "g.needs", group: "g", title: "Needs", requires: ["workflows"], columns: [{ id: "a", label: "A", type: "text" }], run: async () => ({ rows: [] }) });
  await assert.rejects(
    runReport({ registry: reg, db: {}, key: "g.needs", query: {}, actor: boss, slots: createRunSlots() }),
    (err) => err.code === "UNAVAILABLE",
  );
});

test("roles: money and pricing are admin only; operations, planning, productivity and departments are staff", () => {
  const reg = registry();
  const all = reg.listReports(boss);
  const staffGroups = ["operations", "planning", "productivity", "departments"];
  for (const def of all.filter((d) => staffGroups.includes(d.group))) {
    assert.equal(def.roles, undefined, `${def.key} should use the staff default`);
    assert.equal(reg.canView(lab, reg.getReport(def.key)), true, def.key);
  }
  assert.deepEqual(reg.getReport("sales.by-rep").roles, ["admin"]);
  assert.deepEqual(reg.getReport("clients.same-pricing").roles, ["admin"]);
  assert.equal(reg.getReport("products.materials").roles, undefined);
});

test("featured (starred in Labzona) reports", () => {
  const featured = registry().listReports(boss).filter((d) => d.featured && !d.unlisted).map((d) => d.key).sort();
  assert.deepEqual(featured, [
    "clients.health", "departments.monitoring-boards", "operations.case-submission",
    "planning.calendar", "planning.tasks-schedule", "planning.technician-workload",
    "productivity.orders", "productivity.orders-completed", "productivity.tasks-completed",
    "sales.comparison", "sales.summary",
  ]);
});

test("monitoring boards is the wall report", () => {
  const reg = registry();
  assert.equal(reg.getReport("departments.monitoring-boards").display, "wall");
  assert.deepEqual(reg.listReports(boss).filter((d) => d.display === "wall").map((d) => d.key), ["departments.monitoring-boards"]);
});
