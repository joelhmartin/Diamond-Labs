/**
 * One Idempotency-Key per charge ATTEMPT. A retry of the same charge (same
 * `signature`: card + amount + allocations) after a timeout or error reuses
 * the key, so the server dedupes it instead of charging twice. The key rotates
 * when the charge changes (new signature) or after it succeeded (`reset`).
 */
export function createAttemptKey(generate = () => crypto.randomUUID()) {
  let current = null;
  return {
    keyFor(signature) {
      if (!current || current.signature !== signature) current = { signature, key: generate() };
      return current.key;
    },
    reset() {
      current = null;
    },
  };
}

/** Stable signature for a charge request body (key order fixed by the caller). */
export const chargeSignature = (parts) => JSON.stringify(parts);
