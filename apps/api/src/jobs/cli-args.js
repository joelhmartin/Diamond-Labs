/**
 * Argument parsing for jobs/cli.js, split out so the dry-run default is
 * testable without executing the CLI.
 *
 * Dry run is the default. A live run needs BOTH `--live` here and
 * AUTOPAY_LIVE_RUN=true in the environment (checked by the job itself).
 *
 * @param {string[]} args  process.argv.slice(2)
 * @returns {{ list: true } | { list: false, name: string, dryRun: boolean }}
 */
export function parseCliArgs(args) {
  if (args.length === 0 || args.includes("--list")) return { list: true };
  return { list: false, name: args[0], dryRun: !args.includes("--live") };
}
