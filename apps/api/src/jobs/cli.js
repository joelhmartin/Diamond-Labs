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

// runJob throws (rather than recording a run) for an unknown job name and for a
// run already holding the job lock. Report both as the same JSON shape, and let
// stdout drain before exiting: the summary is the operator's record of a run,
// and process.exit() right after a write to a pipe can truncate it.
let output;
let code;
try {
  const result = await runJob(name, { dryRun, trigger: "cli" });
  output = { job: name, ...result };
  code = result.status === "succeeded" ? 0 : 1;
} catch (err) {
  output = { job: name, status: "failed", error: err?.message || String(err) };
  code = 1;
}
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`, () => process.exit(code));
