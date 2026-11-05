/**
 * Mirrors the server's phone rule so a bad number is rejected before any request:
 * ten US digits (or eleven with a leading 1), or "+" and 8 to 15 digits. → E.164 or null.
 */
export function normalizePhone(input) {
  const raw = String(input ?? "").trim();
  if (!raw || /[a-z]/i.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return digits.length >= 8 && digits.length <= 15 && (digits[0] !== "1" || digits.length === 11) ? `+${digits}` : null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
