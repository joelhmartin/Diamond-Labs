/**
 * THE carrier code → normalised status tables (statuses: packages/shared
 * shipping.js). Pure. UPS codes are Tracking.yaml `status.type`; FedEx codes
 * are `latestStatusDetail.code` / `derivedStatusCode` from the research note's
 * field names [MEM]. The sandbox smoke script prints each carrier's raw code,
 * so a missing code is added here, not guessed at runtime.
 */
export const UPS_STATUS_TYPES = {
  M: "label_created", // billing information received: label made, package not yet with UPS
  P: "in_transit", // pickup scan
  I: "in_transit",
  W: "in_transit", // warehousing
  DO: "in_transit", // delivered to origin CFS
  DD: "in_transit", // delivered to destination CFS
  O: "out_for_delivery",
  X: "exception",
  D: "delivered",
  RS: "returned",
};

export const FEDEX_STATUS_CODES = {
  OC: "label_created", // order created / label printed
  PU: "in_transit",
  PX: "in_transit",
  IT: "in_transit",
  AR: "in_transit",
  AF: "in_transit",
  DP: "in_transit",
  FD: "in_transit",
  HL: "in_transit", // held at a FedEx location for pickup
  OD: "out_for_delivery",
  DE: "exception",
  SE: "exception",
  CD: "exception",
  DL: "delivered",
  RS: "returned",
};

const TABLES = { ups: UPS_STATUS_TYPES, fedex: FEDEX_STATUS_CODES };

/** A carrier's code → our status, or null when unknown (the caller keeps the current status and logs the code). */
export function normalizeCarrierStatus(carrier, code, description = "") {
  const table = TABLES[carrier];
  if (!table || !code) return null;
  const status = table[String(code).toUpperCase()] ?? null;
  if (status === "in_transit" && /out for delivery/i.test(description ?? "")) return "out_for_delivery";
  return status;
}
