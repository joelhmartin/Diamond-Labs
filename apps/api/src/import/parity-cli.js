/**
 * Piece 5 parity report. READ-ONLY on the target (its db handle refuses every
 * write); the report (ids, counts, cents; no names) is printed and saved to
 * the import DB's parity_reports.
 *
 *   pnpm --filter @my-app/api import:parity --target rehearsal [--balances per-invoice|per-client --file-id <id> [--columns …]] [--invoice-start <n> --order-start <n>]
 *   pnpm --filter @my-app/api import:parity --target production --confirm-production diamond_labs --balances … --file-id <id> --invoice-start <n> --order-start <n>
 *
 * Exit 0 = clean; 4 = differences to explain (the cutover is a go only when
 * clean or every difference is accepted by the user); 2 refused; 1 failed.
 * The export's problems (row numbers and keys only) are part of the report.
 */
import { parseArgs, intFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";
import { assertNotCloudRun } from "./targets.js";
import { openTargetSession } from "./cli-session.js";
import { readExport, parseColumnsFlag } from "./export-table.js";
import { enforceSeeds } from "./seed-check.js";
import { readSeazonaSide, readAppSide, readOnly } from "./parity-queries.js";
import { buildParity, exportBalances, exportCreditCents } from "./parity.js";
import { printReport, runIfMain } from "./report.js";

const FLAGS = { allowed: ["target", "confirm-production", "balances", "file-id", "columns", "invoice-start", "order-start"], booleans: [] };

const defaultDeps = { printReport, openSession: openTargetSession };

/** The stored export, rolled up to cents per account; null with no --balances (parity then says it compared none). */
async function exportSide(raw, flags, app) {
  if (!flags.balances) {
    if (flags["file-id"] || flags.columns) throw new ImportRefusal("--file-id and --columns need --balances per-invoice|per-client.");
    return { balanceByAccount: null };
  }
  const kind = flags.balances === "per-client" ? "client" : flags.balances === "per-invoice" ? "invoice" : null;
  if (!kind) throw new ImportRefusal("--balances must be per-invoice or per-client.");
  const stored = flags["file-id"] ? await raw.readFile(flags["file-id"]) : null;
  if (!stored || stored.kind !== `balances_${kind}`) throw new ImportRefusal(`No ${flags.balances} export stored with id ${flags["file-id"]}.`);
  const { rows, problems } = readExport(stored.bytes, { kind, columns: flags.columns ? parseColumnsFlag(flags.columns) : {} });
  return {
    balanceByAccount: exportBalances(rows, flags.balances, app.accountByInvoiceNumber),
    exportCreditCents: exportCreditCents(rows),
    exportProblems: problems,
  };
}

export async function main(argv, env = process.env, overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  assertNotCloudRun(env);
  const { flags } = parseArgs(argv, FLAGS);
  const starts = { invoice: intFlag(flags, "invoice-start"), order: intFlag(flags, "order-start") };
  const session = await deps.openSession(env, flags, { writes: false });
  try {
    const target = readOnly(session.db);
    const app = await readAppSide(target, session.raw);
    const seazona = { ...(await readSeazonaSide(session.raw)), ...(await exportSide(session.raw, flags, app)) };
    const seeds = (await enforceSeeds({ raw: session.raw, db: target, target: session.target.name, live: false, starts })).summary;
    const report = buildParity({ seazona, app, seeds });
    await session.raw.saveParityReport({ target: session.target.name, clean: report.clean, report });
    deps.printReport({ target: session.target.name, database: session.target.database, ...report });
    return report.clean ? 0 : 4;
  } finally {
    await session.close();
  }
}

await runIfMain(import.meta.url, main);
