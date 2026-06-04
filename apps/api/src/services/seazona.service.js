import { env } from "../config/env.js";

function getAuthHeader() {
  const credentials = Buffer.from(`${env.SEAZONA_API_KEY}:${env.SEAZONA_SECRET}`).toString("base64");
  return `Basic ${credentials}`;
}

async function request(path, options = {}) {
  if (!env.SEAZONA_API_KEY || !env.SEAZONA_SECRET || !env.SEAZONA_BASE_URL) {
    console.warn("[Seazona] API credentials not configured");
    return null;
  }

  const url = `${env.SEAZONA_BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: getAuthHeader(),
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[Seazona] ${options.method || "GET"} ${path} → ${res.status}: ${text}`);
    return null;
  }

  return res.json();
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
  return request(`v1/clients/${clientId}`);
}

/**
 * Get invoices modified since the given ISO timestamp. Seazona rejects the
 * call entirely if `lastModified` is empty, so default to an epoch-ish value
 * that means "everything".
 */
export async function getInvoices(lastModified) {
  const since = lastModified || "1900-01-01T00:00:00Z";
  const data = await request(`v1/invoices/?lastModified=${encodeURIComponent(since)}`);
  return Array.isArray(data) ? data : [];
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
  const seen = new Map();
  let cursor = "1900-01-01T00:00:00Z";

  for (let i = 0; i < 50; i++) {
    const batch = await getInvoices(cursor);
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

  return [...seen.values()];
}

/**
 * Get a specific invoice by ID.
 */
export async function getInvoice(id) {
  return request(`v1/invoices/${id}`);
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
  return request(`v1/orders/${id}`);
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
  return request(`v1/payments/${id}`);
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
  return request(`v1/products/${id}`);
}

/**
 * List Seazona users (lab staff: { id, firstName, lastName, email }).
 * The `id` is what an order's `userId` field expects.
 */
export async function listUsers() {
  const data = await request("v1/users/");
  return Array.isArray(data) ? data : [];
}
