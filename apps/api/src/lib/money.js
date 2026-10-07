/**
 * Money. New code works in integer cents. `round2` is the dollar-float helper
 * the Seazona invoice paths still use; piece 3 of own-the-lab replaces those.
 */

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

/** Cents → the string a numeric(12,2) column expects. */
export function toDecimalString(cents) {
  assertCents(cents);
  const a = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
}

const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export function formatCents(cents) {
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
