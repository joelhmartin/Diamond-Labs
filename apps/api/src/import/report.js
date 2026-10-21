import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
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

/**
 * A database error prints its name and code and a generic message: the driver's
 * message can quote the failing statement or row values, and the raw store holds PHI.
 */
export function failureText(err) {
  const code = err?.code ? String(err.code) : "";
  if (err?.name === "PostgresError" || err?.severity) {
    return `database error ${code}`.trim() + " (details withheld: they can quote row values; see the import database's logs).";
  }
  return `${code ? `${code} ` : ""}${String(err?.message ?? err).slice(0, 300)}`;
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
      console.error(`Failed: ${failureText(err)}`);
      code = 1;
    }
  }
  process.exitCode = code;
}

/**
 * Run `main` through runCli only when `metaUrl` is the script node was started
 * with (compared by real path, so a symlinked invocation still runs), so a CLI
 * module can be imported (by tests, or to check it loads) without running.
 */
export async function runIfMain(metaUrl, main) {
  if (!process.argv[1]) return;
  let isMain = false;
  try {
    isMain = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(metaUrl));
  } catch {
    isMain = false;
  }
  if (isMain) await runCli(main);
}
