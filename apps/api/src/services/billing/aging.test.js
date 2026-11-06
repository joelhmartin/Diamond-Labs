import { test } from "vitest";
import assert from "node:assert/strict";
import { agingKeyFor, daysPastDue, ageBalances, buildReceivables } from "./aging.js";
import { addIsoDays } from "@my-app/shared";

const asOf = "2026-10-15";
const dueDaysAgo = (n) => addIsoDays(asOf, -n);

test("aging buckets at their boundaries: due today, 30, 31, 90, 91 days", () => {
  assert.equal(agingKeyFor(dueDaysAgo(-5), asOf), "current", "not yet due");
  assert.equal(agingKeyFor(dueDaysAgo(0), asOf), "current", "due today");
  assert.equal(agingKeyFor(dueDaysAgo(1), asOf), "d1_30");
  assert.equal(agingKeyFor(dueDaysAgo(30), asOf), "d1_30");
  assert.equal(agingKeyFor(dueDaysAgo(31), asOf), "d31_60");
  assert.equal(agingKeyFor(dueDaysAgo(60), asOf), "d31_60");
  assert.equal(agingKeyFor(dueDaysAgo(61), asOf), "d61_90");
  assert.equal(agingKeyFor(dueDaysAgo(90), asOf), "d61_90");
  assert.equal(agingKeyFor(dueDaysAgo(91), asOf), "d90_plus");
  assert.equal(agingKeyFor(null, asOf), "current", "no due date is never past due");
});

test("days past due count calendar days across a DST change", () => {
  assert.equal(daysPastDue("2026-11-01", "2026-11-02"), 1);
  assert.equal(daysPastDue("2026-03-07", "2026-03-09"), 2);
});

test("ageBalances buckets each open balance and finds the oldest due date", () => {
  const out = ageBalances([
    { dueDate: dueDaysAgo(0), balanceCents: 1000 },
    { dueDate: dueDaysAgo(45), balanceCents: 2500 },
    { dueDate: dueDaysAgo(120), balanceCents: 400 },
    { dueDate: dueDaysAgo(200), balanceCents: 0 },
  ], asOf);
  assert.deepEqual(out.buckets, { current: 1000, d1_30: 0, d31_60: 2500, d61_90: 0, d90_plus: 400 });
  assert.equal(out.totalCents, 3900);
  assert.equal(out.oldestDueDate, dueDaysAgo(120), "a zero balance is not the oldest open item");
});

test("receivables: one row per practice account with a balance, past-due filter, totals, worst first", () => {
  const open = [
    { accountId: "a", dueDate: dueDaysAgo(0), balanceCents: 5000 },
    { accountId: "b", dueDate: dueDaysAgo(40), balanceCents: 1000 },
    { accountId: "b", dueDate: dueDaysAgo(2), balanceCents: 500 },
    { accountId: "c", dueDate: dueDaysAgo(10), balanceCents: 0 },
    { accountId: null, dueDate: dueDaysAgo(99), balanceCents: 999 },
  ];
  const practices = new Map([["a", { name: "A Dental", ownerUserId: "ua" }], ["b", { name: "B Ortho", ownerUserId: "ub" }]]);
  const all = buildReceivables(open, practices, asOf);
  assert.deepEqual(all.rows.map((r) => [r.accountId, r.balanceCents, r.pastDueCents]), [["b", 1500, 1500], ["a", 5000, 0]]);
  assert.equal(all.rows[0].oldestDueDate, dueDaysAgo(40));
  assert.deepEqual(all.totals.buckets, { current: 5000, d1_30: 500, d31_60: 1000, d61_90: 0, d90_plus: 0 });
  assert.equal(all.totals.balanceCents, 6500);
  const pastDue = buildReceivables(open, practices, asOf, { pastDueOnly: true });
  assert.deepEqual(pastDue.rows.map((r) => r.accountId), ["b"]);
  assert.equal(pastDue.totals.balanceCents, 1500, "totals follow the filter");
});
