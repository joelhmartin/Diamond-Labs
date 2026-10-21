import { env } from "../config/env.js";
import { RATE_LIMIT_WINDOW_MS, MAX_REQUESTS_PER_WINDOW, LIST_PAGE_CAP } from "./seazona-limits.js";

// The limiter's numbers live in seazona-limits.js (no env needed) so piece 5's
// operator CLIs can import them without loading config/env.js.
export { RATE_LIMIT_WINDOW_MS, MAX_REQUESTS_PER_WINDOW, LIST_PAGE_CAP };

/** True when SEAZONA_DISABLED="true" (staging): no Seazona call may leave the process. */
export function isDisabled() {
  return env.SEAZONA_DISABLED === "true";
}

function getAuthHeader() {
  const credentials = Buffer.from(`${env.SEAZONA_API_KEY}:${env.SEAZONA_SECRET}`).toString("base64");
  return `Basic ${credentials}`;
}

// ── Rate limiting ───────────────────────────────────────────────────────────
//
// Seazona's documented limits (https://support.seazona.net/Api.html#rate-limits):
//   • 60 requests/minute per integration, ALL request types combined
//   • 20 requests/minute for POST/PUT/PATCH/DELETE, counted INSIDE the 60
//   • Exceeding either returns 429 with a Retry-After header
//
// Sustained overage escalates past 429 to a tenant-wide block: on 2026-08-07 a
// burst of ~950 GETs in 90s (~630/min, 10x the limit) got API access disabled
// for the whole host — every endpoint 403 "API access is temporarily disabled
// for this host", unfixable by new credentials or a different IP.
//
// So the throttle lives HERE, not in callers. Every Seazona request in the
// codebase funnels through requestRaw, which means no caller — present or
// future — can bypass the limit or has to remember to.
// RATE_LIMIT_WINDOW_MS (60s) and MAX_REQUESTS_PER_WINDOW (50, deliberately under
// the documented 60) come from seazona-limits.js.
export const MAX_WRITES_PER_WINDOW = 15; // under the documented 20
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Timestamps of recent requests, and of recent writes, within the window. */
const recentRequests = [];
const recentWrites = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Serializes admission so two concurrent callers cannot both pass the check. */
let admissionChain = Promise.resolve();

function prune(list, now) {
  while (list.length && now - list[0] >= RATE_LIMIT_WINDOW_MS) list.shift();
}

/**
 * Block until making one more request keeps us inside both documented limits.
 * Admission is serialized through a promise chain so concurrent callers queue
 * rather than racing past the check together.
 */
function acquireSlot(method) {
  const isWrite = WRITE_METHODS.has(String(method || "GET").toUpperCase());
  const run = admissionChain.then(async () => {
    for (;;) {
      const now = Date.now();
      prune(recentRequests, now);
      prune(recentWrites, now);

      const overall = recentRequests.length >= MAX_REQUESTS_PER_WINDOW;
      const writes = isWrite && recentWrites.length >= MAX_WRITES_PER_WINDOW;
      if (!overall && !writes) {
        recentRequests.push(now);
        if (isWrite) recentWrites.push(now);
        return;
      }

      // Wait exactly until the oldest relevant request ages out of the window.
      const oldest = overall ? recentRequests[0] : recentWrites[0];
      await sleep(Math.max(RATE_LIMIT_WINDOW_MS - (now - oldest), 25));
    }
  });
  // Keep the chain alive even if a link rejects, so one failure can't wedge
  // every subsequent Seazona call in the process.
  admissionChain = run.catch(() => {});
  return run;
}

/** Parse Retry-After, which may be seconds or an HTTP date. Clamped to 5 min. */
function retryAfterMs(header) {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0) * 1000, 300_000);
  const when = Date.parse(header);
  if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 0), 300_000);
  return null;
}

/** Test-only: reset the limiter between cases. */
export function __resetRateLimiter() {
  recentRequests.length = 0;
  recentWrites.length = 0;
  admissionChain = Promise.resolve();
}

/**
 * Low-level Seazona call. Returns `{ ok, status, data }` so each caller learns its
 * OWN call's outcome with no shared module state — important for the health probe,
 * which must not pick up a concurrent request's status. `data` is the parsed JSON
 * on 2xx, else null. Never throws: network errors resolve to `{ ok:false, status:0 }`.
 */
async function requestRaw(path, options = {}) {
  // Staging kill switch: the only fetch in this file is below, so this gate
  // covers every exported function. Deliberately NOT logged with the `[Seazona]`
  // prefix the GCP alert metric matches.
  if (isDisabled()) {
    // Method only: the path can carry identifiers (client ids, emails in query strings).
    console.log(`[SeazonaDisabled] ${options.method || "GET"} skipped (SEAZONA_DISABLED=true)`);
    return { ok: false, status: 0, data: null };
  }
  if (!env.SEAZONA_API_KEY || !env.SEAZONA_SECRET || !env.SEAZONA_BASE_URL) {
    console.warn("[Seazona] API credentials not configured");
    return { ok: false, status: 0, data: null };
  }

  const url = `${env.SEAZONA_BASE_URL}${path}`;
  const method = options.method || "GET";

  // One retry only. A 429 means we already misjudged the pace; retrying harder
  // is what turns a throttle into a tenant-wide block.
  for (let attempt = 0; attempt < 2; attempt++) {
    await acquireSlot(method);

    let res;
    try {
      res = await fetch(url, {
        ...options,
        // Auth + Content-Type are applied AFTER the caller's headers so a caller can
        // never accidentally override them — the wrapper's contract is that every
        // Seazona request is HTTP Basic authed and sends application/json.
        headers: {
          ...options.headers,
          Authorization: getAuthHeader(),
          "Content-Type": "application/json",
        },
      });
    } catch (err) {
      // Network-level failure (DNS, TLS, connection reset). Treat like a non-2xx:
      // log with the same `[Seazona]` token the alerting metric matches, and resolve
      // to a not-ok result so callers degrade gracefully instead of throwing.
      console.error(`[Seazona] ${method} ${path} → network error: ${err?.message || err}`);
      return { ok: false, status: 0, data: null };
    }

    if (res.status === 429 && attempt === 0) {
      // Honour the server's own backoff instruction rather than guessing. Fall
      // back to a full window if the header is absent or unparseable.
      const waitMs = retryAfterMs(res.headers?.get?.("retry-after")) ?? RATE_LIMIT_WINDOW_MS;
      console.warn(
        `[Seazona] ${method} ${path} → 429 rate limited; honouring Retry-After and waiting ${Math.round(waitMs / 1000)}s before one retry`
      );
      await sleep(waitMs);
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[Seazona] ${method} ${path} → ${res.status}: ${text}`);
      return { ok: false, status: res.status, data: null };
    }

    // A 2xx with an empty or malformed body must not reject: requestRaw's
    // contract is "never throws", and a payment write that rejected here after
    // the card was charged would skip the local ledger write. Resolve with
    // data:null (callers already treat that as "no usable result") and log it
    // with the alertable [Seazona] token — for a write, it may have landed.
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      console.error(
        `[Seazona] ${method} ${path} → ${res.status} with an unparseable body (${err?.message || err}); ` +
          (method === "GET" ? "treating as no result" : "the write may have landed — check Seazona before re-entering")
      );
    }
    return { ok: true, status: res.status, data };
  }

  // Both attempts rate limited.
  console.error(`[Seazona] ${method} ${path} → 429 after retry; giving up this call`);
  return { ok: false, status: 429, data: null };
}

/**
 * Convenience wrapper used by most callers: returns the parsed JSON on success, or
 * null on any failure (already logged by requestRaw).
 */
async function request(path, options = {}) {
  return (await requestRaw(path, options)).data;
}

/**
 * Cheap liveness probe for the health route. Uses login-exists (a single indexed
 * lookup) so it stays fast and side-effect-free. Reads its own probe result from
 * requestRaw's return value — no shared state, so concurrent traffic can't taint
 * it. Returns { ok, status } (plus disabled:true when SEAZONA_DISABLED).
 */
export async function checkHealth() {
  if (isDisabled()) return { ok: false, status: 0, disabled: true };
  const { ok, status } = await requestRaw("v1/clients/login-exists?email=__healthcheck__%40diamond.invalid");
  return { ok, status };
}

/**
 * Check if a login already exists for the given email.
 * Returns the client data if found, null otherwise.
 */
export async function checkLoginExists(email) {
  const data = await request(`v1/clients/login-exists?email=${encodeURIComponent(email)}`);
  return data || null;
}

/**
 * Clients, with the call's HTTP status (piece 5's fetcher needs to see a 403).
 * The Seazona API requires the `lastModified` query param to be present (empty
 * string returns everything).
 */
export async function listClientsResult(lastModified = "") {
  const r = await requestRaw(`v1/clients/?lastModified=${encodeURIComponent(lastModified)}`);
  return { ok: r.ok && Array.isArray(r.data), status: r.status, clients: Array.isArray(r.data) ? r.data : [] };
}

/** List all clients ([] on any failure). */
export async function listClients(lastModified = "") {
  return (await listClientsResult(lastModified)).clients;
}

/**
 * Find a client by phone number. Fetches the full client list and filters.
 */
export async function findClientByPhone(phone) {
  if (!phone) return null;
  const normalized = phone.replace(/\D/g, "");
  const clients = await listClients();
  return clients.find((c) => {
    const clientPhone = (c.phone || "").replace(/\D/g, "");
    return clientPhone && clientPhone === normalized;
  }) || null;
}

/**
 * Get a specific client by ID.
 */
export async function getClient(clientId) {
  return request(`v1/clients/${encodeURIComponent(clientId)}`);
}

/**
 * Get invoices modified since the given ISO timestamp. Seazona rejects the
 * call entirely if `lastModified` is empty, so default to an epoch-ish value
 * that means "everything".
 */
export async function getInvoices(lastModified) {
  return (await getInvoicesResult(lastModified)).invoices;
}

/**
 * Like getInvoices but reports reachability and status: `reachable` is false
 * when the call errored (non-2xx / network), letting callers tell "Seazona is
 * down" (or blocked: status 403) apart from "Seazona returned an empty list".
 */
export async function getInvoicesResult(lastModified) {
  const since = lastModified || "1900-01-01T00:00:00Z";
  const r = await requestRaw(`v1/invoices/?lastModified=${encodeURIComponent(since)}`);
  return { reachable: r.data !== null, status: r.status, invoices: Array.isArray(r.data) ? r.data : [] };
}

// Seazona truncates the invoice and order lists at LIST_PAGE_CAP rows (seazona-limits.js).

/** ts + 1s as an ISO string; null when ts is not a parseable timestamp (never throws). */
function bumpOneSecond(ts) {
  const d = new Date(ts.endsWith("Z") ? ts : `${ts}Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCSeconds(d.getUTCSeconds() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Walk a capped Seazona list (the invoice and order lists truncate at 10,000
 * rows sorted by id) forward by `field`. The invoice archive was bulk-restamped
 * to a single lastModified, so a capped page that shares one value advances by
 * one second. De-dupes by id. `truncated` means a capped page gave no cursor to
 * advance by (the set is incomplete; never treat it as whole).
 */
async function walkCapped(fetchPage, field) {
  const seen = new Map();
  const noId = []; // records without an id can't be de-duped; keep them all
  const instant = (ts) => Date.parse(ts.endsWith("Z") ? ts : `${ts}Z`);
  let cursor = "1900-01-01T00:00:00Z";
  let reachable = true;
  let truncated = false;
  let done = false; // false after the loop = the page budget ran out mid-walk
  let status = 200;
  let requests = 0;
  for (let i = 0; i < 50 && !done; i++) {
    const page = await fetchPage(cursor);
    requests += 1;
    status = page.status;
    if (!page.reachable) { reachable = false; done = true; break; }
    if (!page.records.length) { done = true; break; }
    for (const rec of page.records) {
      if (rec.id === undefined || rec.id === null) noId.push(rec);
      else seen.set(rec.id, rec);
    }
    if (page.records.length < LIST_PAGE_CAP) { done = true; break; }
    const values = page.records.map((rec) => rec[field]).filter((v) => typeof v === "string" && Number.isFinite(instant(v)));
    if (values.length === 0) { truncated = true; done = true; break; }
    const max = values.reduce((m, v) => (instant(v) > instant(m) ? v : m));
    const next = page.records.every((rec) => rec[field] === max) ? bumpOneSecond(max) : max;
    // The cursor must move strictly forward in time, or the walk is stalled.
    if (next === null || !(instant(next) > instant(cursor))) { truncated = true; done = true; break; }
    cursor = next;
  }
  if (!done) truncated = true;
  return { reachable, status, records: [...seen.values(), ...noId], requests, truncated };
}

/** The FULL invoice archive past the 10k cap (see walkCapped). */
export async function getAllInvoices() {
  return (await getAllInvoicesResult()).invoices;
}

/**
 * getAllInvoices + reachability. `reachable` is false if ANY page failed (the
 * set may be incomplete; `status` is that page's), distinguishing a true empty
 * archive from an outage or a block.
 */
export async function getAllInvoicesResult() {
  const w = await walkCapped(async (cursor) => {
    const r = await getInvoicesResult(cursor);
    return { reachable: r.reachable, status: r.status, records: r.invoices };
  }, "lastModified");
  return { reachable: w.reachable, status: w.status, invoices: w.records, requests: w.requests, truncated: w.truncated };
}

/**
 * Get a specific invoice by ID.
 */
export async function getInvoice(id) {
  return request(`v1/invoices/${encodeURIComponent(id)}`);
}

/** One invoice (with its lines) and the call's status. Piece 5's fetcher only. */
export async function getInvoiceResult(id) {
  const r = await requestRaw(`v1/invoices/${encodeURIComponent(id)}`);
  return { ok: r.ok, status: r.status, invoice: r.data };
}

// Read-only; kept for own-the-lab piece 5's historical order import.
/**
 * Get orders ordered since the given ISO timestamp. Same gotcha as invoices:
 * the `ordered` query param is required, empty = 400.
 */
export async function getOrdersResult(ordered) {
  const since = ordered || "1900-01-01T00:00:00Z";
  const r = await requestRaw(`v1/orders/?ordered=${encodeURIComponent(since)}`);
  return { reachable: r.data !== null, status: r.status, orders: Array.isArray(r.data) ? r.data : [] };
}

export async function getOrders(ordered) {
  return (await getOrdersResult(ordered)).orders;
}

/** Every order, walked past a possible 10k cap by `ordered` (see walkCapped). Piece 5's fetcher only. */
export async function getAllOrdersResult() {
  const w = await walkCapped(async (cursor) => {
    const r = await getOrdersResult(cursor);
    return { reachable: r.reachable, status: r.status, records: r.orders };
  }, "ordered");
  return { reachable: w.reachable, status: w.status, orders: w.records, requests: w.requests, truncated: w.truncated };
}

/** Get a single order with products, files, settings. */
export async function getOrder(id) {
  return request(`v1/orders/${encodeURIComponent(id)}`);
}

/** One order (products, files, settings) and the call's status. Piece 5's fetcher only. */
export async function getOrderResult(id) {
  const r = await requestRaw(`v1/orders/${encodeURIComponent(id)}`);
  return { ok: r.ok, status: r.status, order: r.data };
}

/**
 * Create a payment in Seazona. Returns { paymentId, clientId } on success.
 */
export async function createPayment({ clientId, accountNumber, referenceNumber, notes, amount }) {
  return request("v1/payments/", {
    method: "POST",
    body: JSON.stringify({ clientId, accountNumber, referenceNumber, notes, amount }),
  });
}

/** Get a single payment by id. Note: there is no bulk list endpoint for payments. */
export async function getPayment(id) {
  return request(`v1/payments/${encodeURIComponent(id)}`);
}

/** Products with the call's status (a 2xx with a non-array body is not ok). */
export async function listProductsResult() {
  const r = await requestRaw("v1/products/");
  return { ok: r.ok && Array.isArray(r.data), status: r.status, products: Array.isArray(r.data) ? r.data : [] };
}

/**
 * List all Seazona products ({ id, code, name, taxable, price }).
 * Used to map our catalog SKUs / Rx devices to Seazona product ids.
 */
export async function listProducts() {
  return (await listProductsResult()).products;
}

/** Get a single product by id. */
export async function getProduct(id) {
  return request(`v1/products/${encodeURIComponent(id)}`);
}

/** Seazona users with the call's status (a 2xx with a non-array body is not ok). */
export async function listUsersResult() {
  const r = await requestRaw("v1/users/");
  return { ok: r.ok && Array.isArray(r.data), status: r.status, users: Array.isArray(r.data) ? r.data : [] };
}

/**
 * List Seazona users (lab staff: { id, firstName, lastName, email }).
 * Kept for piece 5's raw archive (the fetcher reads listUsersResult).
 */
export async function listUsers() {
  return (await listUsersResult()).users;
}
