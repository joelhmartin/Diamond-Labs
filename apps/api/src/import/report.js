import { pathToFileURL } from "node:url";
import { ImportRefusal } from "./import-errors.js";

/**
 * Output for the piece-5 CLIs. Callers pass ids, numbers, counts and cents
 * only — never a record's contents. A failure prints its code and message
 * (Postgres messages carry no row values; `detail` does and is never printed).
 */
export function printLines(lines) {
  process.stdout.write(`${lines.join("\n")}\n`);
}

export function printReport(report) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

export async function runCli(main) {
  let code = 0;
  try {
    code = (await main(process.argv.slice(2), process.env)) ?? 0;
  } catch (err) {
    if (err instanceof ImportRefusal) {
      console.error(`Refused: ${err.message}`);
      code = 2;
    } else {
      console.error(`Failed: ${err?.code ? `${err.code} ` : ""}${String(err?.message ?? err).slice(0, 300)}`);
      code = 1;
    }
  }
  process.exitCode = code;
}

/**
 * Run `main` through runCli only when `metaUrl` is the script node was started
 * with, so a CLI module can be imported (by tests, or to check it loads) without running.
 */
export async function runIfMain(metaUrl, main) {
  if (process.argv[1] && metaUrl === pathToFileURL(process.argv[1]).href) await runCli(main);
}
