/**
 * Piece 5 fetcher. Operator machine only (refuses on Cloud Run). DRY RUN BY DEFAULT.
 *
 *   pnpm --filter @my-app/api import:fetch <clients|users|products|invoices|orders> [--live]
 *   pnpm --filter @my-app/api import:fetch <invoices|orders> --detail <filter> [--refetch] [--live [--approved <n>]]
 *     filters: --ids <id,id> | --since YYYY-MM-DD | --open (orders) | --open-balance --file-id <id> [--columns …] (invoices)
 *     --refetch  re-fetch detail even when the stored record looks fresh. Orders carry no
 *                lastModified, so a stored order is never re-read without it: use it for the
 *                cutover refresh of open-order detail.
 *   pnpm --filter @my-app/api import:fetch <invoices|orders> --detail --resume <runId> [--live [--approved <n>]]
 *   pnpm --filter @my-app/api import:fetch export --balances per-invoice|per-client --file <export.xls> [--columns …]
 *     (seals a portal balance export into the import DB, prints its id and the parser's problems; no Seazona call)
 *
 *   pnpm --filter @my-app/api import:fetch <invoices|orders|…> --mark-stale <runId>
 *     (marks a run left "running" by a crash or Ctrl-C as failed so a new live run may start)
 *
 * Only ONE live fetch runs at a time: a live run takes a Postgres advisory lock on the
 * import DB for its whole life and refuses if another process holds it. --mark-stale and
 * resuming a run still marked running work only while that lock is free.
 *
 * Ctrl-C is safe: the cursor is saved every 25 records, so --detail --resume
 * re-fetches at most the last 24. A live run refuses to start while another run
 * of the same entity is still marked running (resume it, or --mark-stale it).
 *
 * Needs IMPORT_DATABASE_URL (diamond_labs_import) and production's
 * PHI_ENCRYPTION_KEY exported in the shell (docs/import-operations.md). Prints
 * the request count and minutes first (the fetcher paces itself at 30/min, under
 * the service's limiter, because the live portal shares the integration's quota:
 * run off-hours). A live run over 100 requests needs --approved <count>, which
 * stands for the user's OK. Stops on the first block and records a cursor.
 *
 * This file loads without DATABASE_URL / JWT_SECRET: seazona.service.js (which
 * needs them, through config/env.js) is imported only when a live run starts.
 */
import { readFile } from "node:fs/promises";
import * as importSchema from "./db/schema.js";
import { parseArgs, intFlag, listFlag } from "./cli-args.js";
import { ImportRefusal } from "./import-errors.js";
import { assertNotCloudRun, resolveImportDb, connect } from "./targets.js";
import { assertImportKey } from "./key-check.js";
import { rawStore } from "./raw-store.js";
import { readExport, parseColumnsFlag } from "./export-table.js";
import { SUMMARY_ENTITIES, DETAIL_ENTITIES, APPROVAL_THRESHOLD, REQUESTS_PER_MINUTE, detailFilterProblem, selectDetailIds } from "./fetch-plan.js";
import { runSummaryCommand, runDetailCommand } from "./seazona-fetch.js";
import { makeFetchLock } from "./fetch-lock.js";
import { printLines, printReport, runIfMain } from "./report.js";

const FLAGS = {
  allowed: ["live", "detail", "ids", "since", "open", "open-balance", "file-id", "columns", "refetch", "resume", "approved", "file", "balances", "mark-stale"],
  booleans: ["live", "detail", "open", "open-balance", "refetch"],
};

const EXPORTS = {
  "per-invoice": { fileKind: "balances_invoice", parseKind: "invoice" },
  "per-client": { fileKind: "balances_client", parseKind: "client" },
};

const FETCH_ONLY_FLAGS = ["live", "detail", "ids", "since", "open", "open-balance", "file-id", "refetch", "resume", "approved", "mark-stale"];
const FILTER_FLAGS = ["ids", "since", "open", "open-balance", "file-id", "refetch"];

/** The default dependencies; tests pass fakes for any of them. */
const defaultDeps = {
  print: printLines,
  printReport,
  readFile,
  async openStore(env) {
    const resolved = resolveImportDb(env);
    const importDb = connect(resolved, importSchema);
    try {
      await assertImportKey(importDb.db, { keyCheck: importSchema.keyCheck });
    } catch (err) {
      await importDb.close();
      throw err;
    }
    const lock = makeFetchLock(resolved.url);
    return { store: rawStore(importDb.db), tryLock: lock.tryLock, close: async () => { await lock.close(); await importDb.close(); } };
  },
  loadSeazona: () => import("../services/seazona.service.js"),
};

/** The seazona.service.js API, loaded on first call (a dry run never loads it). */
function lazySeazona(load) {
  let mod;
  return new Proxy({}, {
    get: (_t, fn) => (fn === "then" ? undefined : async (...args) => (mod ??= await load())[fn](...args)),
  });
}

/** `import:fetch export`: parse, then seal a portal balance export into the import DB. No Seazona call. */
async function storeExport(flags, store, deps) {
  const spec = EXPORTS[flags.balances];
  if (!spec || !flags.file) throw new ImportRefusal("Usage: import:fetch export --balances per-invoice|per-client --file <export.xls> [--columns name=Header,…]");
  const bytes = await deps.readFile(flags.file);
  const { rows, problems } = readExport(bytes, { kind: spec.parseKind, columns: flags.columns ? parseColumnsFlag(flags.columns) : {} });
  const id = await store.saveFile({ kind: spec.fileKind, bytes });
  deps.print([
    `Stored the ${flags.balances} export as file ${id}: ${rows.length} usable row(s), ${problems.reduce((n, p) => n + p.count, 0)} problem row(s).`,
    "Delete the local copy now (and empty the Trash).",
  ]);
  if (problems.length) deps.print(["Export problems (ids and row numbers only):"]);
  if (problems.length) deps.printReport(problems);
  return 0;
}

async function openInvoiceNumbers(flags, store, deps) {
  if (!flags["file-id"]) throw new ImportRefusal("--open-balance needs --file-id (store the export first: import:fetch export --balances per-invoice --file <path>).");
  const file = await store.readFile(flags["file-id"]);
  if (!file || file.kind !== EXPORTS["per-invoice"].fileKind) throw new ImportRefusal(`No per-invoice export with id ${flags["file-id"]}.`);
  const { rows, problems } = readExport(file.bytes, { kind: "invoice", columns: flags.columns ? parseColumnsFlag(flags.columns) : {} });
  const bad = problems.reduce((n, p) => n + p.count, 0);
  if (bad) deps.print([`Warning: ${bad} row(s) of that export could not be read (run import:fetch export again to list them); invoices on those rows are not selected.`]);
  return new Set(rows.filter((r) => r.cents > 0).map((r) => r.key));
}

async function resumedRun({ detailEntity, flags, store, tryLock }) {
  const given = FILTER_FLAGS.filter((f) => flags[f] !== undefined);
  if (given.length) throw new ImportRefusal(`--resume replays the run's own id list; drop --${given.join(", --")}.`);
  const run = await store.getRun(flags.resume);
  if (!run || run.entity !== detailEntity || run.mode !== "detail") throw new ImportRefusal(`No ${detailEntity} run ${flags.resume}.`);
  if (run.status === "done") throw new ImportRefusal(`Run ${run.id} already finished.`);
  // A run still marked running is only resumable when no live process owns it, which holding the lock proves.
  if (run.status === "running" && !(await tryLock())) throw new ImportRefusal(`Run ${run.id} is marked running and another live fetch holds the fetch lock, so it may still be alive. Wait for it to end.`);
  return { ids: run.plannedIds ?? [], start: run.cursor, run };
}

async function detailIds({ name, entity, flags, store, deps, tryLock }) {
  const detailEntity = DETAIL_ENTITIES[name];
  if (flags.resume) return resumedRun({ detailEntity, flags, store, tryLock });
  if (flags.open && entity !== "order") throw new ImportRefusal("--open applies to orders only.");
  if (flags["open-balance"] && entity !== "invoice") throw new ImportRefusal("--open-balance applies to invoices only.");
  const filters = {
    ids: listFlag(flags, "ids"),
    since: flags.since,
    open: flags.open === true,
    refetch: flags.refetch === true,
    openInvoiceNumbers: flags["open-balance"] ? await openInvoiceNumbers(flags, store, deps) : undefined,
  };
  const problem = detailFilterProblem(filters);
  if (problem) throw new ImportRefusal(problem);
  const ids = selectDetailIds(entity, await store.records(entity), await store.index(detailEntity), filters);
  return { ids, start: 0, run: null };
}

function stopLines(r) {
  if (r.dropped > 0) return [`${r.dropped} record(s) in the list had no id and had no id. The set is incomplete, so NOTHING was stored and the run is marked failed; needs operator attention.`];
  if (r.needsMorePages) return [`The list walk needed more pages than allowed (${r.requests} used): NOTHING was stored. Get a larger count approved and re-run with --live --approved ${r.requests + 2}.`];
  if (r.status === "blocked") return ["Seazona refused with 403: the integration is BLOCKED (production too). Do not retry. Tell the user; check /health/seazona later."];
  if (r.truncated) return ["The list walk did not complete (Seazona's capped list gave no cursor to advance by, or the page budget ran out). The set is incomplete: NOTHING was stored or marked complete. Needs operator attention; do not load from this."];
  if (r.lastStatus === 0) return ["Seazona is unavailable (disabled, credentials or network); nothing more was attempted."];
  return [`Stopped on HTTP status ${r.lastStatus ?? "unknown"}; nothing more was attempted.`];
}

function outcomeLines(mode, out) {
  const lines = [`Plan: ${out.plan.requests} Seazona request(s), about ${out.plan.minutes} min at ${REQUESTS_PER_MINUTE}/min.`];
  if (out.dryRun) {
    lines.push(out.plan.requests > APPROVAL_THRESHOLD
      ? `Dry run. Over ${APPROVAL_THRESHOLD} requests: give the user this count and duration; with their OK re-run with --live --approved ${out.plan.requests}.`
      : "Dry run: nothing was fetched. Re-run with --live.");
    return { lines, code: 0 };
  }
  const r = out.result;
  lines.push(`Run ${out.runId}: ${r.status}; ${r.requests} request(s); ${r.count ?? r.fetched ?? 0} stored; ${r.missing?.length ?? 0} not found.`);
  if (r.missing?.length) lines.push(`Not found (first 20): ${r.missing.slice(0, 20).join(", ")}`);
  if (r.status !== "done") {
    lines.push(...stopLines(r));
    if (!r.truncated && !(r.dropped > 0)) lines.push(mode === "detail" ? `Resume later with --detail --resume ${out.runId}.` : "Re-run the summary fetch later.");
  }
  return { lines, code: r.status === "done" ? 0 : 3 };
}

function checkShape(name, entity, flags, positional) {
  if (name === "export") {
    const stray = FETCH_ONLY_FLAGS.filter((f) => flags[f] !== undefined);
    if (stray.length) throw new ImportRefusal(`export takes only --balances, --file and --columns (not --${stray.join(", --")}).`);
  }
  if ((!entity && name !== "export") || positional.length !== 1) {
    throw new ImportRefusal(`Usage: import:fetch <${Object.keys(SUMMARY_ENTITIES).join("|")}|export> [--detail <filter>] [--live]`);
  }
  if (flags.detail && !DETAIL_ENTITIES[name]) throw new ImportRefusal(`${name} has no detail fetch (invoices and orders do).`);
  if (!flags.detail && FILTER_FLAGS.concat("resume").some((f) => flags[f] !== undefined) && name !== "export") {
    throw new ImportRefusal("That flag belongs to --detail.");
  }
}

/** Refuse a live run while a run of the same entity is still marked running (other than the one being resumed). */
async function assertNoRunningRun(store, entityName, exceptId) {
  const busy = await store.findRunning(entityName);
  if (busy && busy.id !== exceptId) {
    throw new ImportRefusal(`Run ${busy.id} (${entityName}) is still marked running. If it is alive, wait for it; if it died or was stopped, resume it (--detail --resume ${busy.id}) or mark it stale: import:fetch <name> --mark-stale ${busy.id}.`);
  }
}

async function markStale(store, entityNames, flags, deps, tryLock) {
  if (!(await tryLock())) throw new ImportRefusal("Another live fetch holds the fetch lock, so a run marked running may still be alive. Wait for it to end; --mark-stale only works when no live fetch is running.");
  const run = await store.getRun(flags["mark-stale"]);
  if (!run || !entityNames.includes(run.entity)) throw new ImportRefusal(`No run ${flags["mark-stale"]} for this entity.`);
  if (run.status !== "running") throw new ImportRefusal(`Run ${run.id} is ${run.status}, not running.`);
  await store.finishRun(run.id, { status: "failed", cursor: run.cursor, requestCount: run.requestCount, errorCount: run.errorCount, lastStatus: run.lastStatus ?? null, note: "marked stale by the operator" });
  deps.print([`Run ${run.id} marked failed (stale). A new live run may start.`]);
  return 0;
}

export async function main(argv, env = process.env, overrides = {}) {
  const deps = { ...defaultDeps, ...overrides };
  assertNotCloudRun(env);
  const { positional, flags } = parseArgs(argv, FLAGS);
  const name = positional[0];
  const entity = SUMMARY_ENTITIES[name];
  checkShape(name, entity, flags, positional);
  const { store, close, tryLock } = await deps.openStore(env);
  try {
    if (name === "export") return await storeExport(flags, store, deps);
    const storeEntity = flags.detail ? DETAIL_ENTITIES[name] : entity;
    if (flags["mark-stale"]) return await markStale(store, [entity, DETAIL_ENTITIES[name]], flags, deps, tryLock);
    const live = flags.live === true;
    if (live && !(await tryLock())) throw new ImportRefusal("Another live fetch is running (it holds the import database's fetch lock). Only one live fetch at a time: wait for it to finish.");
    if (live) await assertNoRunningRun(store, storeEntity, flags.resume);
    const common = { live, approved: intFlag(flags, "approved"), seazona: lazySeazona(deps.loadSeazona), store, pace: deps.pace };
    let out;
    if (flags.detail) {
      const { ids, start, run } = await detailIds({ name, entity, flags, store, deps, tryLock });
      out = await runDetailCommand({ ...common, entity: DETAIL_ENTITIES[name], ids, start, run, lastModifiedById: await store.index(entity) });
    } else {
      out = await runSummaryCommand({ ...common, entity });
    }
    if (out.refused) throw new ImportRefusal(out.refused);
    const { lines, code } = outcomeLines(flags.detail ? "detail" : "summary", out);
    deps.print(lines);
    return code;
  } finally {
    await close();
  }
}

await runIfMain(import.meta.url, main);
