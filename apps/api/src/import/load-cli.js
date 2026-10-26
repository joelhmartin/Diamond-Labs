/**
 * Piece 5 loader. Operator machine only. DRY RUN BY DEFAULT; rehearsal first.
 *
 *   pnpm --filter @my-app/api import:load <clients|invoices|balances|orders> --target rehearsal [--live]
 *   pnpm --filter @my-app/api import:load <step> --target production --confirm-production diamond_labs \
 *        --invoice-start <n> --order-start <n> [--live]
 *   clients:  [--no-email placeholder|skip] [--email-taken report|placeholder]
 *   invoices: [--invoice-start <n> --order-start <n>] [--allow-after-balances]
 *             (production needs BOTH starts on invoices, balances and orders)
 *   balances: --balances per-invoice|per-client (--file <export.xls> | --file-id <id>) [--columns name="Header",…]
 *             [--cutover-at <ISO>] [--invoice-start <n> --order-start <n>] [--accept-export-problems]
 *   orders:   [--invoice-start <n> --order-start <n>]
 *
 * Run the steps in order: clients, invoices, balances, orders. Every step is
 * re-runnable. Every LIVE step holds the target's load lock for its whole run
 * (one live load per target). Needs IMPORT_DATABASE_URL, the target's
 * *_DATABASE_URL and production's PHI_ENCRYPTION_KEY in the shell; never run
 * with `--env-file` against a real target during development. `--file` seals the
 * export into the import DB and prints its id; delete the local file right after.
 *
 * A live `clients` run reads its plan before it writes, so run it inside the
 * write freeze (docs/cutover-runbook.md). A live `balances` run refuses when the
 * export had problems unless --accept-export-problems; the problems (row numbers
 * and keys only) are always printed. A live `invoices` run that would insert
 * invoices after balances already ran refuses unless --allow-after-balances;
 * then re-run balances with the same --file-id (the report says so).
 *
 * Exit codes: 0 ok, 2 refused, 1 failed.
 */
import { readFile } from "node:fs/promises";
import { parseArgs, intFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";
import { assertNotCloudRun } from "./targets.js";
import { openTargetSession } from "./cli-session.js";
import { readExport, parseColumnsFlag } from "./export-table.js";
import { loadClients } from "./load-clients.js";
import { loadInvoices } from "./load-invoices.js";
import { loadBalances } from "./load-balances.js";
import { loadOrders } from "./load-orders.js";
import { paidCentsFor } from "../services/billing/paid-cents.js";
import { printLines, printReport, runIfMain } from "./report.js";

const COMMON = ["target", "confirm-production", "live"];
/** The seed check guards BOTH number sequences on every step that loads numbered records, so a production run needs both starts. */
const STARTS = ["invoice-start", "order-start"];
/** Per step: the flags it accepts beyond COMMON. Anything else is refused, never ignored. */
const STEP_FLAGS = {
  clients: ["no-email", "email-taken"],
  invoices: [...STARTS, "allow-after-balances"],
  balances: [...STARTS, "balances", "file", "file-id", "columns", "cutover-at", "accept-export-problems"],
  orders: STARTS,
};
const FLAGS = {
  allowed: [...new Set([...COMMON, ...Object.values(STEP_FLAGS).flat()])],
  booleans: ["live", "accept-export-problems", "allow-after-balances"],
};

const defaultDeps = { print: printLines, printReport, readFile, openSession: openTargetSession };

/** Everything a step needs from its flags, validated before anything connects. */
function stepOptions(step, flags) {
  const stray = Object.keys(flags).filter((f) => !COMMON.includes(f) && !STEP_FLAGS[step].includes(f));
  if (stray.length) throw new ImportRefusal(`--${stray.join(", --")} does not apply to the ${step} step.`);
  const starts = { invoice: intFlag(flags, "invoice-start"), order: intFlag(flags, "order-start") };
  if (step === "clients") {
    const noEmail = flags["no-email"] ?? "placeholder";
    if (noEmail !== "placeholder" && noEmail !== "skip") throw new ImportRefusal("--no-email must be placeholder or skip.");
    const emailTaken = flags["email-taken"] ?? "report";
    if (emailTaken !== "report" && emailTaken !== "placeholder") throw new ImportRefusal("--email-taken must be report or placeholder.");
    return { starts, noEmail, emailTaken };
  }
  if (step !== "balances") return { starts };
  if (flags.balances !== "per-invoice" && flags.balances !== "per-client") throw new ImportRefusal("--balances must be per-invoice or per-client.");
  if (flags.file && flags["file-id"]) throw new ImportRefusal("Give --file or --file-id, not both.");
  const columns = flags.columns ? parseColumnsFlag(flags.columns) : {};
  const cutoverAt = flags["cutover-at"] ? new Date(flags["cutover-at"]) : new Date();
  if (Number.isNaN(cutoverAt.getTime())) throw new ImportRefusal("--cutover-at must be an ISO date-time.");
  return { starts, mode: flags.balances, columns, cutoverAt };
}

const problemLines = (problems) =>
  problems.map((p) => `  ${p.kind} x${p.count}: rows ${p.lines.slice(0, 20).join(", ")}${p.lines.length > 20 ? ", …" : ""}; keys ${p.seazonaIds.slice(0, 20).join(", ")}`);

/** Stored export → parsed rows. Problems are printed here, before the step can refuse on them (Ruling Q4). */
async function parsedExport({ raw, flags, opts, deps }) {
  const kind = opts.mode === "per-client" ? "client" : "invoice";
  let fileId = flags["file-id"];
  if (flags.file) {
    fileId = await raw.saveFile({ kind: `balances_${kind}`, bytes: await deps.readFile(flags.file) });
    deps.print([`Stored the export as file ${fileId}. Delete the local copy now (and empty the Trash).`]);
  }
  if (!fileId) throw new ImportRefusal("balances needs --file <export.xls> (first time) or --file-id <id>.");
  const stored = await raw.readFile(fileId);
  if (!stored || stored.kind !== `balances_${kind}`) throw new ImportRefusal(`No ${opts.mode} export stored with id ${fileId}.`);
  const parsed = readExport(stored.bytes, { kind, columns: opts.columns });
  if (parsed.problems.length) deps.print(["Balance export problems (row numbers and keys only):", ...problemLines(parsed.problems)]);
  return { parsed, fileId };
}

const STEPS = {
  clients: (c) => loadClients({ raw: c.raw, db: c.db, live: c.live, noEmail: c.opts.noEmail, emailTaken: c.opts.emailTaken, lock: c.lock }),
  invoices: (c) => loadInvoices({
    raw: c.raw, db: c.db, live: c.live, target: c.target, starts: c.opts.starts, lock: c.lock,
    allowAfterBalances: c.flags["allow-after-balances"] === true,
  }),
  orders: (c) => loadOrders({ raw: c.raw, db: c.db, live: c.live, target: c.target, starts: c.opts.starts, lock: c.lock }),
  async balances(c) {
    const { parsed, fileId } = await parsedExport(c);
    return loadBalances({
      raw: c.raw, db: c.db, live: c.live, target: c.target, mode: c.opts.mode, parsed, fileId, starts: c.opts.starts, cutoverAt: c.opts.cutoverAt,
      // The app's own paid sum (paid-cents.js, the one ledger.service.js delegates to), run against the TARGET db.
      paidCents: paidCentsFor, acceptExportProblems: c.flags["accept-export-problems"] === true, lock: c.lock,
    });
  },
};

export async function main(argv, env = process.env, overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  assertNotCloudRun(env);
  const { positional, flags } = parseArgs(argv, FLAGS);
  const step = positional[0];
  if (!STEPS[step] || positional.length !== 1) throw new ImportRefusal(`Usage: import:load <${Object.keys(STEPS).join("|")}> --target <rehearsal|staging|production> [--live] (production: --invoice-start and --order-start on invoices, balances and orders)`);
  const live = flags.live === true;
  const opts = stepOptions(step, flags);
  const session = await deps.openSession(env, flags, { writes: true });
  try {
    if (live && step === "clients" && session.target.name === "production") {
      deps.print(["The clients step reads its plan before it writes: it must run inside the write freeze (docs/cutover-runbook.md). Continuing."]);
    }
    const report = await STEPS[step]({ raw: session.raw, db: session.db, live, target: session.target.name, opts, flags, deps, lock: session.makeLock() });
    deps.printReport({ target: session.target.name, database: session.target.database, ...report });
    if (report.next) deps.print([`NEXT: ${report.next}`]);
    if (!live) deps.print(["Dry run: nothing was written to the target. Re-run with --live."]);
    return 0;
  } finally {
    await session.close();
  }
}

await runIfMain(import.meta.url, main);
