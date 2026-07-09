import { env } from "../config/env.js";

function getAuthHeader() {
  const credentials = Buffer.from(`${env.SEAZONA_API_KEY}:${env.SEAZONA_SECRET}`).toString("base64");
  return `Basic ${credentials}`;
}

/**
 * Low-level Seazona call. Returns `{ ok, status, data }` so each caller learns its
 * OWN call's outcome with no shared module state — important for the health probe,
 * which must not pick up a concurrent request's status. `data` is the parsed JSON
 * on 2xx, else null. Never throws: network errors resolve to `{ ok:false, status:0 }`.
 */
async function requestRaw(path, options = {}) {
  if (!env.SEAZONA_API_KEY || !env.SEAZONA_SECRET || !env.SEAZONA_BASE_URL) {
    console.warn("[Seazona] API credentials not configured");
    return { ok: false, status: 0, data: null };
  }

  const url = `${env.SEAZONA_BASE_URL}${path}`;
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
    console.error(`[Seazona] ${options.method || "GET"} ${path} → network error: ${err?.message || err}`);
    return { ok: false, status: 0, data: null };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[Seazona] ${options.method || "GET"} ${path} → ${res.status}: ${text}`);
    return { ok: false, status: res.status, data: null };
  }

  return { ok: true, status: res.status, data: await res.json() };
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
 * it. Returns { ok, status }.
 */
export async function checkHealth() {
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
 * List all clients. The Seazona API requires the `lastModified` query param
 * to be present (empty string returns everything).
 */
export async function listClients(lastModified = "") {
  const data = await request(`v1/clients/?lastModified=${encodeURIComponent(lastModified)}`);
  return Array.isArray(data) ? data : [];
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
 * Like getInvoices but reports reachability: `reachable` is false when the
 * underlying call errored (non-2xx / network), letting callers tell "Seazona is
 * down" apart from "Seazona returned an empty list".
 */
export async function getInvoicesResult(lastModified) {
  const since = lastModified || "1900-01-01T00:00:00Z";
  const data = await request(`v1/invoices/?lastModified=${encodeURIComponent(since)}`);
  return { reachable: data !== null, invoices: Array.isArray(data) ? data : [] };
}

const INVOICE_PAGE_CAP = 10000;

function bumpOneSecond(ts) {
  const d = new Date(ts.endsWith("Z") ? ts : `${ts}Z`);
  d.setUTCSeconds(d.getUTCSeconds() + 1);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * Fetch the FULL invoice archive, working around Seazona's hard 10,000-record
 * cap on `GET v1/invoices/`. The API sorts by id and truncates at the cap, and
 * the historical archive was bulk-restamped to a single `lastModified`, so we
 * walk forward by `lastModified` and bump one second whenever an entire capped
 * batch shares the same timestamp (otherwise the cursor can't escape the blob).
 * De-dupes by invoice id.
 */
export async function getAllInvoices() {
  return (await getAllInvoicesResult()).invoices;
}

/**
 * getAllInvoices + reachability. `reachable` is false if ANY page failed (so the
 * caller knows the set may be incomplete / Seazona is degraded), distinguishing a
 * true empty archive from an outage.
 */
export async function getAllInvoicesResult() {
  const seen = new Map();
  let cursor = "1900-01-01T00:00:00Z";
  let reachable = true;

  for (let i = 0; i < 50; i++) {
    const { reachable: ok, invoices: batch } = await getInvoicesResult(cursor);
    if (!ok) { reachable = false; break; }
    if (!batch.length) break;

    for (const inv of batch) seen.set(inv.id, inv);
    if (batch.length < INVOICE_PAGE_CAP) break;

    const maxLM = batch.reduce(
      (m, inv) => (inv.lastModified > m ? inv.lastModified : m),
      batch[0].lastModified
    );
    const allSame = batch.every((inv) => inv.lastModified === maxLM);
    cursor = allSame ? bumpOneSecond(maxLM) : maxLM;
  }

  return { reachable, invoices: [...seen.values()] };
}

/**
 * Get a specific invoice by ID.
 */
export async function getInvoice(id) {
  return request(`v1/invoices/${encodeURIComponent(id)}`);
}

/**
 * Get orders ordered since the given ISO timestamp. Same gotcha as invoices:
 * the `ordered` query param is required, empty = 400.
 */
export async function getOrders(ordered) {
  const since = ordered || "1900-01-01T00:00:00Z";
  const data = await request(`v1/orders/?ordered=${encodeURIComponent(since)}`);
  return Array.isArray(data) ? data : [];
}

/** Get a single order with products, files, settings. */
export async function getOrder(id) {
  return request(`v1/orders/${encodeURIComponent(id)}`);
}

/**
 * Create an order for a client.
 *   items: [{ id: <seazonaProductId>, arch: 1 (upper) | 2 (lower) | null }]
 *   userId: a Seazona user id (lab staff) — see listUsers().
 * Returns { orderId } on success, null on failure.
 */
export async function createOrder({ clientId, patientName, due, items, notes, userId }) {
  return request("v1/orders/", {
    method: "POST",
    body: JSON.stringify({ clientId, patientName, due, items, notes, userId }),
  });
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

/**
 * List all Seazona products ({ id, code, name, taxable, price }).
 * Used to map our catalog SKUs / Rx devices to Seazona product ids.
 */
export async function listProducts() {
  const data = await request("v1/products/");
  return Array.isArray(data) ? data : [];
}

/** Get a single product by id. */
export async function getProduct(id) {
  return request(`v1/products/${encodeURIComponent(id)}`);
}

/**
 * List Seazona users (lab staff: { id, firstName, lastName, email }).
 * The `id` is what an order's `userId` field expects.
 */
export async function listUsers() {
  const data = await request("v1/users/");
  return Array.isArray(data) ? data : [];
}
