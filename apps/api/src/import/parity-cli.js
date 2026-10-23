/**
 * Piece 5 parity report. READ-ONLY on the target (its db handle refuses every
 * write); the report (ids, counts, cents; no names) is printed and saved to
 * the import DB's parity_reports.
 *
 *   pnpm --filter @my-app/api import:parity --target rehearsal [--balances per-invoice|per-client --file-id <id> [--columns …]] [--invoice-start <n> --order-start <n>]
 *   pnpm --filter @my-app/api import:parity --target production --confirm-production diamond_labs --balances … --file-id <id> --invoice-start <n> --order-start <n>
 *
 * Exit 0 = clean, or every remaining difference explicitly accepted with
 * `--accept <kind>[,<kind>…]` (they move to `accepted` in the report and the saved row);
 * 4 = differences to explain; 2 refused; 1 failed. Takes the load lock, so it refuses
 * while a load runs.
 * The export's problems (row numbers and keys only) are part of the report.
 */
import { parseArgs, intFlag, listFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";
import { assertNotCloudRun } from "./targets.js";
import { openTargetSession } from "./cli-session.js";
import { readExport, parseColumnsFlag } from "./export-table.js";
import { enforceSeeds } from "./seed-check.js";
import { readSeazonaSide, readAppSide, readOnly } from "./parity-queries.js";
import { buildParity, applyAccepted, exportBalances, exportCreditCents, DIFFERENCE_KINDS } from "./parity.js";
import { printLines, printReport, runIfMain } from "./report.js";

const FLAGS = { allowed: ["target", "confirm-production", "balances", "file-id", "columns", "invoice-start", "order-start", "accept"], booleans: [] };

const defaultDeps = { print: printLines, printReport, openSession: openTargetSession };

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

/** `--accept kind,kind`: validated up front; an unknown kind is refused with the known list. */
function acceptedKinds(flags) {
  const kinds = listFlag(flags, "accept") ?? [];
  const unknown = kinds.filter((k) => !DIFFERENCE_KINDS.includes(k));
  if (unknown.length) throw new ImportRefusal(`--accept: unknown difference kind(s) ${unknown.join(", ")}. Known kinds: ${DIFFERENCE_KINDS.join(" | ")}.`);
  return kinds;
}

export async function main(argv, env = process.env, overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  assertNotCloudRun(env);
  const { flags } = parseArgs(argv, FLAGS);
  const starts = { invoice: intFlag(flags, "invoice-start"), order: intFlag(flags, "order-start") };
  const accept = acceptedKinds(flags);
  const session = await deps.openSession(env, flags, { writes: false });
  // Never read a half-written target: a live load holds this lock for its whole run.
  const lock = session.makeLock();
  try {
    try {
      if (!(await lock.tryLock())) throw new ImportRefusal("A load is running against this target (the load lock is held). Wait for it to finish, then re-run parity.");
      const target = readOnly(session.db);
      const app = await readAppSide(target, session.raw);
      const seazona = { ...(await readSeazonaSide(session.raw)), ...(await exportSide(session.raw, flags, app)) };
      const seeds = (await enforceSeeds({ raw: session.raw, db: target, target: session.target.name, live: false, starts })).summary;
      const applied = applyAccepted(buildParity({ seazona, app, seeds }), accept);
      // The saved report records what the operator asked to accept, not only what matched, so a typo'd or stale accept is auditable.
      const report = accept.length ? { ...applied, acceptRequested: accept } : applied;
      const absent = accept.filter((k) => !(report.accepted ?? []).includes(k));
      const reportId = await session.raw.saveParityReport({ target: session.target.name, clean: report.clean, report });
      deps.printReport({ target: session.target.name, database: session.target.database, reportId, ...report });
      deps.print([`Saved as parity report ${reportId}.${report.accepted?.length ? ` Accepted: ${report.accepted.join(", ")}.` : ""}`]);
      if (absent.length) deps.print([`Requested to accept but not present in this report: ${absent.join(", ")}.`]);
      return report.clean ? 0 : 4;
    } finally {
      // A failing lock release must not leave the session (two connections) open.
      await lock.close();
    }
  } finally {
    await session.close();
  }
}

await runIfMain(import.meta.url, main);
