import { test } from "vitest";
import assert from "node:assert/strict";
import { PARAM_TYPES, DATE_PRESETS, resolveDateRange, checkCustomRange } from "./params.js";

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
  assert.deepEqual(r.previous, { from: "2026-10-27", to: "2026-10-31" });
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

test("previous is the equal-length window right before, for every preset", () => {
  const now = new Date("2026-11-05T18:00:00Z");
  const prev = (k) => resolveDateRange(k, now, CHI).previous;
  assert.deepEqual(prev("lastMonth"), { from: "2026-08-31", to: "2026-09-30" });
  assert.deepEqual(prev("qtd"), { from: "2026-08-26", to: "2026-09-30" });
  assert.deepEqual(prev("ytd"), { from: "2025-02-26", to: "2025-12-31" });
  assert.deepEqual(prev("lastYear"), { from: "2024-01-02", to: "2024-12-31" });
  assert.deepEqual(prev("last12m"), { from: "2024-12-26", to: "2025-11-30" });
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
