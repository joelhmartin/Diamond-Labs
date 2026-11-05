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
 * Registers the lab's report groups, lookups and definitions on the generic
 * registry: all 63 audit reports (audit-names.js), the 14 that need a later
 * piece registered with `requires` until it calls provideCapability. Then the
 * dashboards (dashboards.js): their metrics, their unlisted tile reports and
 * Pulse, Operations, Insights and Sales.
 */
export function registerLabReports(registry) {
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
