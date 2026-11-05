/**
 * A report that depends on a capability a later piece brings (pan numbers,
 * materials, record tags, workflows, the business calendar, pickups,
 * deliveries, price lists). It is registered now with `requires`, so the index
 * lists it as "Not available yet: needs …"; the runner refuses it before its
 * run is reached. Its run also refuses, so providing the capability early
 * never runs a placeholder. Task 10 replaces each run with the real query.
 */
import { ReportError } from "../../../modules/reports/runner.js";

export function dependentReport(def) {
  if (!def.requires?.length) throw new Error(`${def.key}: a dependent report names what it requires`);
  return {
    ...def,
    async run() {
      throw new ReportError("UNAVAILABLE", `Needs: ${def.requires.join(", ")}`);
    },
  };
}
