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
 * List all clients. Results are not paginated by the API.
 */
export async function listClients() {
  const data = await request("v1/clients/");
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
 * Get invoices, optionally filtered by lastModified date.
 */
export async function getInvoices(lastModified) {
  const params = lastModified ? `?lastModified=${encodeURIComponent(lastModified)}` : "";
  const data = await request(`v1/invoices/${params}`);
  return Array.isArray(data) ? data : [];
}

/**
 * Get a specific invoice by ID.
 */
export async function getInvoice(id) {
  return request(`v1/invoices/${id}`);
}

/**
 * Create a payment in Seazona.
 */
export async function createPayment({ clientId, accountNumber, referenceNumber, notes, amount }) {
  return request("v1/payments/", {
    method: "POST",
    body: JSON.stringify({ clientId, accountNumber, referenceNumber, notes, amount }),
  });
}
