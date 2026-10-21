import { isOpenOrderStatus, recordDate, recordNumber, INVOICE_NUMBER_FIELDS } from "./seazona-records.js";
import { RATE_LIMIT_WINDOW_MS, MAX_REQUESTS_PER_WINDOW, LIST_PAGE_CAP } from "../services/seazona-limits.js";

/**
 * Pure planning for the fetcher: how many requests, how long, which records.
 *
 * The fetcher paces itself at REQUESTS_PER_MINUTE, deliberately below the
 * service limiter's MAX_REQUESTS_PER_WINDOW (imported, not copied): the live
 * portal shares the integration's 60/min, so a bulk fetch must leave room for
 * it. The limits come from services/seazona-limits.js because importing
 * seazona.service.js itself would load config/env.js.
 */
export const REQUESTS_PER_MINUTE = 30;
export const APPROVAL_THRESHOLD = 100;
if (REQUESTS_PER_MINUTE >= MAX_REQUESTS_PER_WINDOW) throw new Error("The fetcher's pace must stay below the service limiter's.");

/** Gap between two detail requests, from the service's window length. */
export const PACE_INTERVAL_MS = Math.ceil(RATE_LIMIT_WINDOW_MS / REQUESTS_PER_MINUTE);

/** CLI name → raw store entity. */
export const SUMMARY_ENTITIES = { clients: "client", users: "user", products: "product", invoices: "invoice", orders: "order" };
export const DETAIL_ENTITIES = { invoices: "invoice_detail", orders: "order_detail" };

export const minutesFor = (requests) => Math.ceil(requests / REQUESTS_PER_MINUTE);

/** One list call, or one per full page plus the short last page for the capped lists. */
export function summaryRequests(entity, storedCount = 0) {
  if (entity !== "invoice" && entity !== "order") return 1;
  return Math.floor(storedCount / LIST_PAGE_CAP) + 1;
}

export function approvalProblem({ count, live, approved }) {
  if (!live || count <= APPROVAL_THRESHOLD) return null;
  if (Number.isSafeInteger(approved) && approved >= count) return null;
  return `${count} requests (about ${minutesFor(count)} min) is over ${APPROVAL_THRESHOLD}: it needs the user's OK. With it, re-run with --live --approved ${count}.`;
}

export function detailFilterProblem(filters) {
  if (!filters.ids?.length && !filters.since && !filters.open && !filters.openInvoiceNumbers) {
    return "A detail fetch needs a filter: --ids, --since YYYY-MM-DD, --open (orders) or --open-balance --file-id (invoices).";
  }
  if (filters.since && !/^\d{4}-\d{2}-\d{2}$/.test(filters.since)) return "--since must be YYYY-MM-DD.";
  return null;
}

const isFresh = (has, detailLm, summaryLm) => has && (summaryLm == null || (detailLm != null && detailLm >= summaryLm));

/**
 * The Seazona ids whose detail to fetch, sorted (so a resume replays the same
 * order). summaries: [{ seazonaId, payload, lastModified }]; fetched: Map of
 * already-fetched detail id → the summary lastModified it was fetched under.
 * A detail at least as new as its summary is skipped unless filters.refetch;
 * orders carry no lastModified, so a stored order detail always counts as fresh
 * and only --refetch re-reads it.
 */
export function selectDetailIds(entity, summaries, fetched, filters) {
  const summaryLm = new Map(summaries.map((s) => [s.seazonaId, s.lastModified ?? null]));
  const wanted = new Set(filters.ids ?? []);
  for (const s of summaries) {
    const p = s.payload ?? {};
    if (filters.since && (recordDate(entity, p) ?? "") >= filters.since) wanted.add(s.seazonaId);
    if (filters.open && entity === "order" && isOpenOrderStatus(p.status)) wanted.add(s.seazonaId);
    if (filters.openInvoiceNumbers && entity === "invoice" && filters.openInvoiceNumbers.has(recordNumber(p, INVOICE_NUMBER_FIELDS))) wanted.add(s.seazonaId);
  }
  return [...wanted]
    .filter((id) => filters.refetch || !isFresh(fetched.has(id), fetched.get(id), summaryLm.get(id) ?? null))
    .sort();
}
