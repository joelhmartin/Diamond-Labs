import { approvalProblem, minutesFor, summaryRequests, PACE_INTERVAL_MS } from "./fetch-plan.js";

/**
 * Piece 5's ONLY caller of Seazona's invoice/order/user reads (the retired-path
 * guards allow this file by name). `seazona` is the seazona.service.js module,
 * injected by fetch-cli.js (tests pass a fake), so every call goes through the
 * service's limiter, one at a time, and detail calls are additionally paced by
 * createPacer (30/min, under the service's 50/min). Any refusal stops the run
 * at once — a 403 is Seazona blocking the integration, and retrying into a
 * block is what makes it last — and records the cursor. Only a 404 for one
 * record is skipped and counted.
 *
 * A list walk that comes back `truncated` is a FAILED fetch: the set is
 * incomplete, so nothing from it is stored or marked complete.
 */
const SUMMARY_CALLS = {
  client: async (s) => { const r = await s.listClientsResult(""); return { ok: r.ok, status: r.status, records: r.clients, requests: 1 }; },
  user: async (s) => { const r = await s.listUsersResult(); return { ok: r.ok, status: r.status, records: r.users, requests: 1 }; },
  product: async (s) => { const r = await s.listProductsResult(); return { ok: r.ok, status: r.status, records: r.products, requests: 1 }; },
  invoice: async (s) => { const r = await s.getAllInvoicesResult(); return { ok: r.reachable && !r.truncated, truncated: r.truncated === true, status: r.status, records: r.invoices, requests: r.requests }; },
  order: async (s) => { const r = await s.getAllOrdersResult(); return { ok: r.reachable && !r.truncated, truncated: r.truncated === true, status: r.status, records: r.orders, requests: r.requests }; },
};

const DETAIL_CALLS = {
  invoice_detail: async (s, id) => { const r = await s.getInvoiceResult(id); return { ok: r.ok, status: r.status, record: r.invoice }; },
  order_detail: async (s, id) => { const r = await s.getOrderResult(id); return { ok: r.ok, status: r.status, record: r.order }; },
};

const stopStatus = (httpStatus) => (httpStatus === 403 ? "blocked" : "failed");
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Await it before each request: resolves once `intervalMs` has passed since the previous one. */
export function createPacer({ intervalMs = PACE_INTERVAL_MS, now = Date.now, sleep = defaultSleep } = {}) {
  let last = null;
  return async () => {
    if (last !== null) {
      const wait = last + intervalMs - now();
      if (wait > 0) await sleep(wait);
    }
    last = now();
  };
}

export async function fetchSummaries({ entity, seazona, store }) {
  const runId = await store.startRun({ entity, mode: "summary" });
  const r = await SUMMARY_CALLS[entity](seazona);
  if (!r.ok) {
    const status = stopStatus(r.status);
    const note = r.truncated ? "list walk truncated: the set is incomplete, nothing stored" : null;
    await store.finishRun(runId, { status, cursor: 0, requestCount: r.requests, errorCount: 1, lastStatus: r.status, note });
    return { runId, status, requests: r.requests, count: 0, lastStatus: r.status, truncated: r.truncated === true };
  }
  const records = r.records
    .filter((rec) => rec?.id != null)
    .map((rec) => ({ seazonaId: String(rec.id), payload: rec, lastModified: typeof rec.lastModified === "string" ? rec.lastModified : null }));
  await store.upsert(entity, records, runId);
  await store.finishRun(runId, { status: "done", cursor: records.length, requestCount: r.requests, errorCount: r.records.length - records.length, lastStatus: r.status });
  return { runId, status: "done", requests: r.requests, count: records.length, lastStatus: r.status, truncated: false };
}

export async function fetchDetails({ entity, ids, start = 0, runId, seazona, store, lastModifiedById = new Map(), prior = { requests: 0, errors: 0 }, pace = createPacer(), progressEvery = 25 }) {
  const call = DETAIL_CALLS[entity];
  let requests = prior.requests;
  let errors = prior.errors;
  let fetched = 0;
  let at = start;
  const missing = [];
  try {
    for (; at < ids.length; at++) {
      const id = ids[at];
      await pace();
      const r = await call(seazona, id);
      requests += 1;
      if (r.ok && r.record) {
        await store.upsert(entity, [{ seazonaId: id, payload: r.record, lastModified: lastModifiedById.get(id) ?? null }], runId);
        fetched += 1;
      } else if (r.status === 404 || (r.ok && !r.record)) {
        missing.push(id);
        errors += 1;
      } else {
        const status = stopStatus(r.status);
        await store.finishRun(runId, { status, cursor: at, requestCount: requests, errorCount: errors + 1, lastStatus: r.status });
        return { status, cursor: at, requests, fetched, missing, lastStatus: r.status };
      }
      if ((at + 1 - start) % progressEvery === 0) await store.saveProgress(runId, { cursor: at + 1, requestCount: requests, errorCount: errors });
    }
  } catch (err) {
    // Unexpected (a store write failed): keep the cursor so --resume continues here, then surface it.
    await store.finishRun(runId, { status: "failed", cursor: at, requestCount: requests, errorCount: errors + 1, note: "stopped by an unexpected error" }).catch(() => {});
    throw err;
  }
  await store.finishRun(runId, { status: "done", cursor: ids.length, requestCount: requests, errorCount: errors });
  return { status: "done", cursor: ids.length, requests, fetched, missing };
}

/** Plan, then (only with --live) fetch every summary of one entity. */
export async function runSummaryCommand({ entity, live, approved, seazona, store }) {
  const requests = summaryRequests(entity, (await store.index(entity)).size);
  const plan = { requests, minutes: minutesFor(requests) };
  const refused = approvalProblem({ count: requests, live, approved });
  if (refused) return { plan, refused };
  if (!live) return { plan, dryRun: true };
  const result = await fetchSummaries({ entity, seazona, store });
  return { plan, runId: result.runId, result };
}

/** Plan, then (only with --live and, over 100 requests, --approved) fetch details from `start`. */
export async function runDetailCommand({ entity, ids, start = 0, run = null, live, approved, seazona, store, lastModifiedById, pace }) {
  const remaining = Math.max(0, ids.length - start);
  const plan = { requests: remaining, minutes: minutesFor(remaining) };
  const refused = approvalProblem({ count: remaining, live, approved });
  if (refused) return { plan, refused };
  if (!live) return { plan, dryRun: true };
  const runId = run?.id ?? (await store.startRun({ entity, mode: "detail", plannedIds: ids }));
  const prior = run ? { requests: run.requestCount ?? 0, errors: run.errorCount ?? 0 } : undefined;
  const result = await fetchDetails({ entity, ids, start, runId, seazona, store, lastModifiedById, prior, pace });
  return { plan, runId, result };
}
