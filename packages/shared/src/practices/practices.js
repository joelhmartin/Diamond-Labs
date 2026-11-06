/**
 * How the app names a practice (a client account) and its party key: the ONE
 * implementation the API (services/practice.js) and the web client portal both
 * use, so a label or key never reads differently on either side.
 *
 * A party key is the string the generic modules (notifications, messaging)
 * store for "who a record belongs to" without knowing what a practice is:
 * `practice:<accountId>`, or `user:<ownerId>` for a record with no practice.
 */

/** A practice as staff and clients read it: "Name (account number)", or whichever half exists. */
export function practiceLabel(practice) {
  const n = String(practice?.name ?? "").trim();
  const num = String(practice?.accountNumber ?? "").trim();
  if (n && num) return `${n} (${num})`;
  return n || num;
}

/** "practice:<accountId>", or "user:<ownerId>" when the record has no account. */
export function practiceKeyFor({ accountId = null, ownerId = null } = {}) {
  return accountId ? `practice:${accountId}` : `user:${ownerId}`;
}

/** "practice:X" → { practice: "X" }, "user:Y" → { userId: "Y" }, anything else → null. */
export function parsePartyKey(key) {
  const m = /^(practice|user):(.+)$/.exec(String(key ?? ""));
  if (!m) return null;
  return m[1] === "practice" ? { practice: m[2] } : { userId: m[2] };
}
