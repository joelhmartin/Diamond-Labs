/**
 * Invariant: a `lab`-role user never sees money. Checked over the REAL
 * registry, built exactly as reports.routes.js builds it, so a new report,
 * metric or tile that forgets `roles: ADMIN` fails here.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { STAFF_ROLES, LAB_TIMEZONE } from "@my-app/shared";
import { createRegistry } from "../../../modules/reports/registry.js";
import { fakeTx } from "../../../test/fake-tx.js";
import { registerLabReports } from "./index.js";
import { LAB_METRICS } from "./dashboards.js";

const lab = { id: "u-lab", role: "lab" };
const ctx = { now: new Date("2026-11-05T17:00:00Z"), today: "2026-11-05", tz: LAB_TIMEZONE };

/**
 * The only money a lab user may see. operations.shipping/charge: lab staff
 * already see each shipment's charge on the Shipments page, where they buy
 * the labels, so the report shows them nothing new.
 */
const ALLOWED_MONEY_COLUMNS = new Set(["operations.shipping/charge"]);

function labRegistry() {
  const registry = createRegistry({ defaultRoles: STAFF_ROLES, featuredTitle: "Lab favorites" });
  registerLabReports(registry);
  return registry;
}

const moneyColumns = (def) =>
  (def.columns || []).filter((c) => c.type === "money").map((c) => `${def.key}/${c.id}`).filter((id) => !ALLOWED_MONEY_COLUMNS.has(id));

test("no report a lab user can see (stubs included) has a money column, except the allowlist", () => {
  const registry = labRegistry();
  const visible = registry.listReports(lab);
  assert.ok(visible.some((r) => !r.available), "stub (requires) reports are part of the check");
  assert.ok(visible.some((r) => r.key === "operations.shipping"), "the allowlisted report is still visible to lab");
  assert.deepEqual(visible.flatMap(moneyColumns), []);
});

test("no metric a lab user can see returns a money figure", async () => {
  const registry = labRegistry();
  const visible = LAB_METRICS.map((m) => registry.getMetric(m.key)).filter((def) => registry.canView(lab, def));
  assert.ok(visible.length > 0);
  for (const def of visible) {
    const out = await def.run(fakeTx({ executes: [] }), {}, lab, ctx);
    assert.notEqual(out.format, "money", `${def.key} is money but visible to lab`);
  }
  // The money metrics exist and are hidden, not missing.
  assert.ok(LAB_METRICS.some((m) => m.key === "sales.today" && !registry.canView(lab, registry.getMetric(m.key))));
});

test("no dashboard tile a lab user can see is backed by money", async () => {
  const registry = labRegistry();
  const offenders = [];
  for (const dash of registry.listDashboards(lab)) {
    for (const tile of dash.tiles) {
      if (tile.roles && !tile.roles.includes(lab.role)) continue;
      const def = tile.report ? registry.getReport(tile.report) : registry.getMetric(tile.metric);
      assert.ok(def, `${dash.key}/${tile.id} has a source`);
      if (!registry.canView(lab, def)) continue;
      if (tile.report) offenders.push(...moneyColumns(def));
      else if ((await def.run(fakeTx({ executes: [] }), {}, lab, ctx)).format === "money") offenders.push(`${dash.key}/${tile.id}`);
    }
  }
  assert.deepEqual(offenders, []);
});
