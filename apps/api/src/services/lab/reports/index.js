import { registerLabGroups } from "./groups.js";
import { registerLabLookups } from "./lookups.js";
import { registerAccountingReports } from "./accounting.reports.js";
import { registerSalesReports } from "./sales.reports.js";
import { registerClientReports } from "./clients.reports.js";
import { registerProductReports } from "./products.reports.js";

/** Registers the lab's report groups, lookups and definitions on the generic registry. */
export function registerLabReports(registry) {
  registerLabGroups(registry);
  registerLabLookups(registry);
  registerAccountingReports(registry);
  registerSalesReports(registry);
  registerClientReports(registry);
  registerProductReports(registry);
}
