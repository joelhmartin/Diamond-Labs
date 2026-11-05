/**
 * What may travel in a notification's `data`, and how addresses appear in logs.
 *
 * Titles, emails and texts are built only from `data`, so it is kept to short
 * identifiers: a flat object of strings, numbers, booleans, null, or arrays of
 * those; no string over 200 characters; at most 2 KB serialised. Free text and
 * personal names have no place here. Errors name the key, never the value.
 */
export const MAX_DATA_BYTES = 2048;
export const MAX_DATA_STRING = 200;

export class NotificationDataError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotificationDataError";
  }
}

const isPlainObject = (v) => v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;

function checkPrimitive(key, v) {
  if (v === null || typeof v === "boolean") return;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new NotificationDataError(`notification data ${key} is not a finite number`);
    return;
  }
  if (typeof v === "string") {
    if (v.length > MAX_DATA_STRING) throw new NotificationDataError(`notification data ${key} is longer than ${MAX_DATA_STRING} characters`);
    return;
  }
  throw new NotificationDataError(`notification data ${key} must be a string, number, boolean or null`);
}

export function assertSafeData(data) {
  if (!isPlainObject(data)) throw new NotificationDataError("notification data must be a plain object");
  for (const [key, v] of Object.entries(data)) {
    if (Array.isArray(v)) v.forEach((item) => checkPrimitive(key, item));
    else checkPrimitive(key, v);
  }
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (bytes > MAX_DATA_BYTES) throw new NotificationDataError(`notification data is ${bytes} bytes; the limit is 2 KB (${MAX_DATA_BYTES})`);
  return data;
}

/**
 * `•••1234` for a phone (or anything without an @), `j•••@domain` for an
 * email. Used for every address that reaches a log line or the deliveries table.
 */
export function maskAddress(addr) {
  const s = String(addr ?? "").trim();
  const at = s.lastIndexOf("@");
  if (at > 0) return `${s[0]}•••${s.slice(at)}`;
  const digits = s.replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : "•••";
}
