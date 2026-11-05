/**
 * Runs a report: validates the request, then executes it in a read-only
 * transaction with a statement timeout, holding one of a few per-process run
 * slots so a burst of heavy reports cannot exhaust the database pool.
 */
import { sql } from "drizzle-orm";
import { localDay } from "@my-app/shared";
import { paramsSchema } from "./params.js";
import { PAGING_KEYS } from "./registry.js";

export const ROW_CAP = 5000;
export const DEFAULT_TIMEOUT_MS = 10000;
export const MAX_CONCURRENT_RUNS = 4;
export const SLOT_WAIT_MS = 5000;
export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 500;
export { PAGING_KEYS };

const TIMEOUT_PG_CODE = "57014";

/** code: NOT_FOUND | FORBIDDEN | INVALID | UNAVAILABLE | TIMEOUT | BUSY. `field` names the bad input for INVALID. */
export class ReportError extends Error {
  constructor(code, message, field) {
    super(message || code);
    this.name = "ReportError";
    this.code = code;
    if (field) this.field = field;
  }
}

/** A counting semaphore. `run(fn)` waits up to waitMs for a slot, then fails with BUSY. */
export function createRunSlots({ max = MAX_CONCURRENT_RUNS, waitMs = SLOT_WAIT_MS } = {}) {
  let active = 0;
  const waiters = [];

  const release = () => {
    const next = waiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.grant(); // hands the slot straight over: active stays the same
    } else {
      active -= 1;
    }
  };

  const acquire = () => {
    if (active < max) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { grant: resolve };
      waiter.timer = setTimeout(() => {
        waiters.splice(waiters.indexOf(waiter), 1);
        reject(new ReportError("BUSY", "Reports are busy"));
      }, waitMs);
      waiters.push(waiter);
    });
  };

  return {
    active: () => active,
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

/** The per-process default; tests pass their own. */
export const defaultRunSlots = createRunSlots();

const isTimeout = (err) => err?.code === TIMEOUT_PG_CODE || err?.cause?.code === TIMEOUT_PG_CODE;

/**
 * Run `fn(tx)` in a read-only transaction under `SET LOCAL statement_timeout`,
 * inside a run slot. A postgres statement timeout becomes ReportError("TIMEOUT").
 */
export async function inReadOnlyTx({ db, timeoutMs, slots = defaultRunSlots }, fn) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error("timeoutMs must be a positive integer");
  return slots.run(async () => {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql.raw(`SET LOCAL statement_timeout = ${timeoutMs}`)); // integer asserted above
        return fn(tx);
      }, { accessMode: "read only" });
    } catch (err) {
      if (isTimeout(err)) throw new ReportError("TIMEOUT", "This report took too long. Try a shorter date range.");
      throw err;
    }
  });
}

function fieldOf(zodError) {
  const issue = zodError.issues?.[0];
  return { field: String(issue?.path?.[0] ?? "params"), message: issue?.message || "Invalid value" };
}

function intInRange(raw, name, { min, max, fallback }) {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new ReportError("INVALID", `${name} must be an integer of at least ${min}`, name);
  return Math.min(n, max);
}

function parseSort(raw, def) {
  if (raw === undefined || raw === "") return null;
  const desc = String(raw).startsWith("-");
  const id = desc ? String(raw).slice(1) : String(raw);
  const col = def.columns.find((c) => c.id === id);
  if (!col || col.sortable === false) throw new ReportError("INVALID", `Cannot sort by "${id}"`, "sort");
  return { id, desc };
}

/**
 * Everything checked before any SQL runs: the report exists, the actor may
 * view it, its capabilities are present, and the query is valid. Returns
 * { def, params, page, clock } where page is null for client-paged reports and
 * clock is { now, today, tz } (today = now's calendar day in tz).
 */
export function prepareRun({ registry, key, query = {}, actor, now = new Date(), tz = "UTC" }) {
  const def = registry.getReport(key);
  if (!def) throw new ReportError("NOT_FOUND", "Report not found");
  if (!registry.canView(actor, def)) throw new ReportError("FORBIDDEN", "You cannot view this report");
  const missing = (def.requires || []).filter((c) => !registry.hasCapability(c));
  if (missing.length) throw new ReportError("UNAVAILABLE", `Needs: ${missing.join(", ")}`);

  const paramQuery = Object.fromEntries(Object.entries(query).filter(([k]) => !PAGING_KEYS.includes(k)));
  let params;
  try {
    params = paramsSchema(def).parse(paramQuery, { now, tz });
  } catch (err) {
    if (!err?.issues) throw err;
    const { field, message } = fieldOf(err);
    throw new ReportError("INVALID", `${field}: ${message}`, field);
  }
  const page = def.paging === "server"
    ? {
        limit: intInRange(query.limit, "limit", { min: 1, max: MAX_PAGE_LIMIT, fallback: DEFAULT_PAGE_LIMIT }),
        offset: intInRange(query.offset, "offset", { min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 }),
        sort: parseSort(query.sort, def),
      }
    : null;
  return { def, params, page, clock: runClock(now, tz) };
}

/** What a definition's run sees of time: `{ now, today, tz }`, today being now's "YYYY-MM-DD" in tz. */
export const runClock = (now = new Date(), tz = "UTC") => ({ now, today: localDay(now, tz), tz });

/**
 * Execute one prepared run (one page, for server-paged reports) and shape the
 * result. The definition's run gets ctx = { page, now, today, tz }. A
 * client-paged result is cut at `rowCap` rows (ROW_CAP on screen; the CSV
 * export passes its own, larger cap).
 */
export async function executePrepared({ def, params, page, clock = runClock() }, { db, actor, slots, timeoutMs: override, rowCap = ROW_CAP }) {
  const started = Date.now();
  const timeoutMs = override ?? def.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const out = await inReadOnlyTx({ db, timeoutMs, slots }, (tx) => def.run(tx, params, actor, { page, ...clock }));
  const rows = out?.rows || [];
  // A run may cut its own list (`truncated: true`, `total` = how many exist); the cap below cuts the rest.
  const result = { rows, total: out?.total ?? rows.length, truncated: out?.truncated === true, generatedAt: new Date().toISOString() };
  if (!page && rows.length > rowCap) {
    result.rows = rows.slice(0, rowCap);
    result.truncated = true;
    result.total = out?.total ?? rows.length;
  }
  if (out?.summary !== undefined) result.summary = out.summary;
  if (out?.notice !== undefined) result.notice = out.notice;
  result.tookMs = Date.now() - started;
  return result;
}

/**
 * Validate and run a report: `{ rows, total, truncated, summary?, notice?, generatedAt, tookMs }`.
 * `timeoutMs` overrides the report's own limit (dashboards run tiles at 5000).
 */
export async function runReport({ registry, db, key, query, actor, now = new Date(), tz = "UTC", slots = defaultRunSlots, timeoutMs }) {
  const prepared = prepareRun({ registry, key, query, actor, now, tz });
  return executePrepared(prepared, { db, actor, slots, timeoutMs });
}
