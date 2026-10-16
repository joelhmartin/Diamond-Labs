/**
 * The next number in a business sequence (lab order numbers, invoice numbers):
 * continues from `start`, never reuses one, and raising `start` later jumps
 * ahead. Callers read the current max under a transaction-scoped advisory lock
 * (services/sequence.service.js allocateSequenceNumber).
 */
export function nextSequenceNumber(maxExisting, start) {
  if (!Number.isSafeInteger(start) || start < 1) {
    throw new RangeError(`A sequence start must be a positive integer, got ${start}`);
  }
  if (maxExisting == null) return start;
  return Math.max(Number(maxExisting) + 1, start);
}
