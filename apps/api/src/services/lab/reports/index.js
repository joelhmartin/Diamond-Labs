import { registerLabGroups } from "./groups.js";
import { registerLabLookups } from "./lookups.js";
import { registerAccountingReports } from "./accounting.reports.js";
import { registerSalesReports } from "./sales.reports.js";
import { registerClientReports } from "./clients.reports.js";
import { registerProductReports } from "./products.reports.js";
import { registerDepartmentReports } from "./departments.reports.js";
import { registerOperationsReports } from "./operations.reports.js";
import { registerPlanningReports } from "./planning.reports.js";
import { registerProductivityReports } from "./productivity.reports.js";
import { registerLabDashboards } from "./dashboards.js";

/**
 * The later pieces' data the 14 dependent reports `require`, each present on
 * this branch: piece 7's business calendar and saved workflow plans, piece 6's
 * pan numbers, line materials and record tags, piece 8's pickups and local
 * deliveries, and piece 10's named price lists.
 */
export const LAB_CAPABILITIES = Object.freeze([
  "business-calendar", "workflows", "pan-numbers", "materials", "record-tags", "pickups", "deliveries", "price-lists",
]);

/**
 * Registers the lab's report groups, lookups and definitions on the generic
 * registry: all 63 audit reports (audit-names.js), with the capabilities the
 * 14 dependent ones name in `requires` (LAB_CAPABILITIES). Then the
 * dashboards (dashboards.js): their metrics, their unlisted tile reports and
 * Pulse, Operations, Insights and Sales.
 */
export function registerLabReports(registry) {
  for (const capability of LAB_CAPABILITIES) registry.provideCapability(capability);
  registerLabGroups(registry);
  registerLabLookups(registry);
  registerAccountingReports(registry);
  registerSalesReports(registry);
  registerClientReports(registry);
  registerProductReports(registry);
  registerDepartmentReports(registry);
  registerOperationsReports(registry);
  registerPlanningReports(registry);
  registerProductivityReports(registry);
  registerLabDashboards(registry);
}
