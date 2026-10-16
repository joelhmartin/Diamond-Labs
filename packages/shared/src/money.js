/**
 * Money: integer cents end to end. The one implementation, shared by the API
 * (apps/api/src/lib/money.js re-exports it) and the web (apps/web/src/lib/money.js).
 * Dollars appear only at a boundary: a Postgres numeric column (toCents /
 * toDecimalString), the Authorize.net wire (toDecimalString out, toCents in), or
 * an amount a person typed (parseMoneyInput).
 */

/** Legacy dollar-float rounding. Only AutoPay's numeric(12,2) columns still need it. */
export function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

const AMOUNT = /^-?\d+(\.\d+)?$/;

/** Dollars (number, or a decimal string such as a Postgres numeric) → cents, half-up. */
export function toCents(value) {
  if (value == null || value === "") return null;
  const s = String(value).trim();
  if (!AMOUNT.test(s)) throw new TypeError(`Not a money amount: ${value}`);
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".");
  const digits = (frac + "000").slice(0, 3);
  let cents = Number(whole) * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) cents += 1;
  return negative ? -cents : cents;
}

export function assertCents(c, label = "amount") {
  if (!Number.isSafeInteger(c)) throw new TypeError(`${label} must be integer cents, got ${c}`);
  return c;
}

/** Cents → "123.45": the string a numeric(12,2) column and the Authorize.net wire expect. */
export function toDecimalString(cents) {
  assertCents(cents);
  const a = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** "$1,234.56"; "—" when there is no amount. Throws on anything that isn't integer cents. */
export function formatCents(cents) {
  if (cents == null) return "—";
  return USD.format(assertCents(cents) / 100);
}

export function sumCents(list) {
  return list.reduce((s, c) => s + assertCents(c), 0);
}

export function mulCents(cents, qty) {
  assertCents(cents);
  if (!Number.isSafeInteger(qty)) throw new TypeError(`qty must be an integer, got ${qty}`);
  return cents * qty;
}

/** A percentage given in basis points (800 = 8%), rounded half-up to the cent. */
export function pctOfCents(cents, rateBps) {
  assertCents(cents);
  assertCents(rateBps, "rateBps");
  const raw = cents * rateBps;
  const sign = raw < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(raw) + 5000) / 10000);
}

const TYPED = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/**
 * What a person typed ("$1,234.5") → cents. null when empty; undefined when it
 * isn't a money amount (more than two decimals, letters, or a minus sign
 * without `allowNegative`).
 */
export function parseMoneyInput(str, { allowNegative = false } = {}) {
  const s = String(str ?? "").replace(/[$,\s]/g, "");
  if (s === "") return null;
  const m = TYPED.exec(s);
  if (!m || (m[1] && !allowNegative)) return undefined;
  const cents = Number(m[2]) * 100 + Number(((m[3] ?? "") + "00").slice(0, 2));
  return m[1] ? -cents : cents;
}
