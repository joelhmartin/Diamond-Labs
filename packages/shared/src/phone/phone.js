/**
 * Phone numbers as E.164, the one rule for the API and the web. North
 * America by default: ten digits, or eleven starting with the country code;
 * or "+" and 8 to 15 digits. Anything else is null, never guessed at.
 */
export function normalizePhone(input, defaultCountry = "1") {
  const raw = String(input ?? "").trim();
  if (!raw || /[a-z]/i.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  const national = defaultCountry === "1" ? 10 : null;
  if (raw.startsWith("+")) return digits.length >= 8 && digits.length <= 15 && (digits[0] !== "1" || digits.length === 11) ? `+${digits}` : null;
  if (national && digits.length === national) return `+${defaultCountry}${digits}`;
  if (national && digits.length === national + defaultCountry.length && digits.startsWith(defaultCountry)) return `+${digits}`;
  return null;
}

/** "+15551234567" → "•••4567". Safe to log: only the last four digits survive. */
export function maskPhone(e164) {
  const digits = String(e164 ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : "•••";
}
