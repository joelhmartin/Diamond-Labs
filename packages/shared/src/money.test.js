import { test } from "vitest";
import assert from "node:assert/strict";
import {
  round2, toCents, toDecimalString, formatCents, sumCents, mulCents, pctOfCents, parseMoneyInput,
} from "./money.js";

test("toCents reads Postgres numeric strings and JS numbers exactly", () => {
  assert.equal(toCents("199.00"), 19900);
  assert.equal(toCents(199), 19900);
  assert.equal(toCents("12.5"), 1250);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents("-5.5"), -550);
});

test("toCents rounds the third decimal half-up", () => {
  assert.equal(toCents("1.005"), 101);
  assert.equal(toCents("1.0049"), 100);
});

test("toCents passes null/empty through and refuses junk", () => {
  assert.equal(toCents(null), null);
  assert.equal(toCents(""), null);
  assert.throws(() => toCents("abc"), TypeError);
  assert.throws(() => toCents("1e21"), TypeError);
});

test("toDecimalString writes numeric(12,2) column values", () => {
  assert.equal(toDecimalString(19900), "199.00");
  assert.equal(toDecimalString(5), "0.05");
  assert.equal(toDecimalString(-5), "-0.05");
});

test("formatCents formats USD", () => {
  assert.equal(formatCents(123456), "$1,234.56");
});

test("integer arithmetic refuses non-integer cents", () => {
  assert.equal(sumCents([]), 0);
  assert.equal(sumCents([100, 250]), 350);
  assert.equal(mulCents(1999, 3), 5997);
  assert.throws(() => mulCents(1.5, 2), TypeError);
  assert.throws(() => mulCents(100, 1.5), TypeError);
});

test("pctOfCents uses basis points and rounds half-up", () => {
  assert.equal(pctOfCents(1250, 800), 100);
  assert.equal(pctOfCents(1999, 800), 160); // 159.92
  assert.equal(pctOfCents(1, 5000), 1);     // 0.5 → 1
  assert.equal(pctOfCents(0, 800), 0);
});

test("round2 is the legacy dollar helper", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
});

test("formatCents shows a dash for no amount and refuses dollars", () => {
  assert.equal(formatCents(null), "—");
  assert.equal(formatCents(undefined), "—");
  assert.equal(formatCents(-1250), "-$12.50");
  assert.throws(() => formatCents(12.5), TypeError);
});

test("parseMoneyInput: staff type dollars, the code gets cents", () => {
  assert.equal(parseMoneyInput("199"), 19900);
  assert.equal(parseMoneyInput("$1,234.5"), 123450);
  assert.equal(parseMoneyInput("0"), 0);
  assert.equal(parseMoneyInput(""), null);
  assert.equal(parseMoneyInput("   "), null);
  assert.equal(parseMoneyInput("abc"), undefined);
  assert.equal(parseMoneyInput("1.999"), undefined);
  assert.equal(parseMoneyInput("-3"), undefined, "negative only when asked for");
  assert.equal(parseMoneyInput("-3", { allowNegative: true }), -300);
  assert.equal(parseMoneyInput("-$12.05", { allowNegative: true }), -1205);
});
