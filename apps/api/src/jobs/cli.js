/**
 * Job CLI — the entrypoint the Cloud Run Job executes.
 *
 *   node src/jobs/cli.js autopay             # dry run (default)
 *   node src/jobs/cli.js autopay --live      # actually charge
 *   node src/jobs/cli.js --list
 *
 * Exits non-zero on failure so Cloud Run marks the execution failed.
 */
import { registerAllJobs } from "./definitions/index.js";
import { runJob } from "./runner.js";
import { listJobs } from "./registry.js";

registerAllJobs();

const args = process.argv.slice(2);

if (args.includes("--list") || args.length === 0) {
  for (const job of listJobs()) console.log(`${job.name}\t${job.description}`);
  process.exit(0);
}

const name = args[0];
// Dry run is the default. Charging requires BOTH --live here and
// AUTOPAY_LIVE_RUN=true in the environment — two independent switches.
const dryRun = !args.includes("--live");

const result = await runJob(name, { dryRun, trigger: "cli" });
console.log(JSON.stringify({ job: name, ...result }, null, 2));
process.exit(result.status === "succeeded" ? 0 : 1);
