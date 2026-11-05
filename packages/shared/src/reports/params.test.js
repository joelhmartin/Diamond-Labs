import { test } from "vitest";
import assert from "node:assert/strict";
import { PARAM_TYPES, DATE_PRESETS, resolveDateRange, resolvePreset, checkCustomRange, daysBetween, monthsBetween } from "./params.js";

const CHI = "America/Chicago";

test("spec constants", () => {
  assert.deepEqual(PARAM_TYPES, ["dateRange", "date", "select", "multiselect", "number", "toggle", "lookup"]);
  assert.equal(DATE_PRESETS.length, 10);
});

test("resolveDateRange uses the tz-local day at 04:30 UTC", () => {
  const r = resolveDateRange("today", new Date("2026-11-01T04:30:00Z"), CHI);
  assert.equal(r.from, "2026-10-31");
  assert.equal(r.to, "2026-10-31");
  assert.deepEqual(r.previous, { from: "2026-10-30", to: "2026-10-30" });
});

test("mtd previous is the same days last month", () => {
  const r = resolveDateRange("mtd", new Date("2026-11-05T18:00:00Z"), CHI);
  assert.deepEqual({ from: r.from, to: r.to }, { from: "2026-11-01", to: "2026-11-05" });
  assert.deepEqual(r.previous, { from: "2026-10-01", to: "2026-10-05" });
});

test("presets resolve across a DST change and year boundary", () => {
  const now = new Date("2026-11-02T12:00:00Z"); // DST ended 2026-11-01 in Chicago
  const r = resolveDateRange("last7", now, CHI);
  assert.deepEqual({ from: r.from, to: r.to }, { from: "2026-10-27", to: "2026-11-02" });
  const jan = new Date("2026-01-10T12:00:00Z");
  assert.equal(resolveDateRange("lastMonth", jan, CHI).from, "2025-12-01");
  assert.equal(resolveDateRange("lastMonth", jan, CHI).to, "2025-12-31");
  assert.equal(resolveDateRange("lastYear", jan, CHI).from, "2025-01-01");
  assert.equal(resolveDateRange("lastYear", jan, CHI).to, "2025-12-31");
  assert.equal(resolveDateRange("ytd", jan, CHI).from, "2026-01-01");
  assert.equal(resolveDateRange("qtd", new Date("2026-05-20T12:00:00Z"), CHI).from, "2026-04-01");
  assert.equal(resolveDateRange("last30", jan, CHI).from, "2025-12-12");
  assert.equal(resolveDateRange("last12m", jan, CHI).from, "2025-02-01");
  assert.equal(resolveDateRange("yesterday", jan, CHI).to, "2026-01-09");
});

test("calendar presets compare with the matching calendar period one period back", () => {
  const now = new Date("2026-11-05T18:00:00Z");
  const prev = (k) => resolveDateRange(k, now, CHI).previous;
  assert.deepEqual(prev("mtd"), { from: "2026-10-01", to: "2026-10-05" });
  assert.deepEqual(prev("qtd"), { from: "2026-07-01", to: "2026-08-05" }); // Oct 1..Nov 5 -> Jul 1..Aug 5
  assert.deepEqual(prev("ytd"), { from: "2025-01-01", to: "2025-11-05" });
  assert.deepEqual(prev("lastMonth"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(prev("lastYear"), { from: "2024-01-01", to: "2024-12-31" });
  // last12m = Dec 1 2025..Nov 5 2026; previous = the 12 months before it.
  assert.deepEqual(prev("last12m"), { from: "2024-12-01", to: "2025-11-30" });
});

test("calendar previous clamps month ends and leap days", () => {
  const on = (day, k) => resolvePreset(k, day).previous;
  assert.deepEqual(on("2026-03-31", "mtd"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(on("2028-03-31", "mtd"), { from: "2028-02-01", to: "2028-02-29" }); // leap year
  assert.deepEqual(on("2026-01-15", "mtd"), { from: "2025-12-01", to: "2025-12-15" }); // across the year
  assert.deepEqual(on("2026-05-31", "qtd"), { from: "2026-01-01", to: "2026-02-28" }); // Apr 1..May 31 -> Jan 1..Feb 28
  assert.deepEqual(on("2026-02-10", "qtd"), { from: "2025-10-01", to: "2025-11-10" }); // across the year
  assert.deepEqual(on("2028-02-29", "ytd"), { from: "2027-01-01", to: "2027-02-28" }); // Feb 29 -> Feb 28
  assert.deepEqual(on("2026-01-10", "lastMonth"), { from: "2025-11-01", to: "2025-11-30" });
  assert.deepEqual(on("2026-03-20", "lastMonth"), { from: "2026-01-01", to: "2026-01-31" });
  assert.deepEqual(on("2028-03-02", "lastMonth"), { from: "2028-01-01", to: "2028-01-31" });
  assert.deepEqual(on("2026-01-10", "lastYear"), { from: "2024-01-01", to: "2024-12-31" });
  assert.deepEqual(on("2026-01-10", "last12m"), { from: "2024-02-01", to: "2025-01-31" });
  assert.equal(resolvePreset("nope", "2026-01-10"), null);
});

test("rolling presets and custom ranges keep the equal-length window right before", () => {
  const on = (day, k) => resolvePreset(k, day).previous;
  assert.deepEqual(on("2026-03-01", "today"), { from: "2026-02-28", to: "2026-02-28" });
  assert.deepEqual(on("2026-03-01", "yesterday"), { from: "2026-02-27", to: "2026-02-27" });
  assert.deepEqual(on("2026-03-01", "last7"), { from: "2026-02-16", to: "2026-02-22" });
  assert.deepEqual(on("2028-03-01", "last30"), { from: "2028-01-02", to: "2028-01-31" }); // Feb 1..Mar 1 in a leap year
  const custom = resolveDateRange({ from: "2026-03-01", to: "2026-03-31" }, new Date("2026-11-05T18:00:00Z"), CHI);
  assert.deepEqual(custom.previous, { from: "2026-01-29", to: "2026-02-28" });
});

test("spring-forward DST and 05:30Z cases", () => {
  // DST began 2026-03-08 in Chicago; days stay whole.
  const r = resolveDateRange("last7", new Date("2026-03-09T12:00:00Z"), CHI);
  assert.deepEqual({ from: r.from, to: r.to }, { from: "2026-03-03", to: "2026-03-09" });
  assert.deepEqual(r.previous, { from: "2026-02-24", to: "2026-03-02" });
  // 05:30Z on Nov 2 is 23:30 on Nov 1 in Chicago (CST, UTC-6 after DST ended)
  assert.equal(resolveDateRange("today", new Date("2026-11-02T05:30:00Z"), CHI).to, "2026-11-01");
  assert.equal(resolveDateRange("today", new Date("2026-11-02T06:30:00Z"), CHI).to, "2026-11-02");
});

test("custom range rejects from after to and spans over maxDays", () => {
  const now = new Date("2026-11-05T12:00:00Z");
  const ok = resolveDateRange({ from: "2026-11-01", to: "2026-11-03" }, now, CHI);
  assert.deepEqual(ok.previous, { from: "2026-10-29", to: "2026-10-31" });
  assert.throws(() => resolveDateRange({ from: "2026-11-04", to: "2026-11-03" }, now, CHI), /after/);
  assert.throws(() => resolveDateRange({ from: "2026-01-01", to: "2026-03-01" }, now, CHI, { maxDays: 30 }), /30/);
  assert.throws(() => resolveDateRange("nope", now, CHI), /preset/);
  assert.equal(checkCustomRange({ from: "2026-01-01", to: "2026-01-31" }, { maxDays: 31 }), null);
  assert.match(checkCustomRange({ from: "2026-01-01", to: "2026-02-01" }, { maxDays: 31 }), /31/);
  assert.match(checkCustomRange({ from: "2026-02-30", to: "2026-03-01" }), /date/);
});

test("daysBetween and monthsBetween list every bucket, inclusive, across month and year ends", () => {
  assert.deepEqual(daysBetween("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
  assert.deepEqual(daysBetween("2026-11-02", "2026-11-01"), []);
  assert.deepEqual(monthsBetween("2025-11-15", "2026-02-01"), ["2025-11", "2025-12", "2026-01", "2026-02"]);
});
