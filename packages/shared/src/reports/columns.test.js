import { test } from "vitest";
import assert from "node:assert/strict";
import { COLUMN_TYPES, formatCell, csvValue } from "./columns.js";

test("formatCell money and pct", () => {
  assert.equal(formatCell({ type: "money" }, 123450), "$1,234.50");
  assert.equal(formatCell({ type: "money" }, -1250), "-$12.50");
  assert.equal(formatCell({ type: "money" }, 0), "$0.00");
  assert.equal(formatCell({ type: "pct" }, 0.074), "7.4%");
});

test("formatCell other types and nulls", () => {
  assert.equal(formatCell({ type: "text" }, null), "");
  assert.equal(formatCell({ type: "money" }, undefined), "");
  assert.equal(formatCell({ type: "int" }, 12345), "12,345");
  assert.equal(formatCell({ type: "link" }, { label: "Acme", href: "/x/1" }), "Acme");
  assert.equal(formatCell({ type: "link" }, "Acme"), "Acme");
  assert.equal(formatCell({ type: "badge" }, "Late"), "Late");
  assert.equal(formatCell({ type: "duration_days" }, 3), "3 d");
  assert.equal(formatCell({ type: "duration_days" }, 3.25), "3.3 d");
  assert.equal(formatCell({ type: "date" }, "2026-10-31"), "2026-10-31");
  assert.equal(
    formatCell({ type: "datetime", timeZone: "America/Chicago" }, "2026-11-01T04:30:00Z"),
    "2026-10-31 23:30",
  );
  assert.equal(COLUMN_TYPES.length, 9);
  assert.equal(formatCell({ type: "money" }, "abc"), "");
});

test("date columns read Dates and timestamps in the column timezone", () => {
  const chi = { type: "date", timeZone: "America/Chicago" };
  assert.equal(formatCell(chi, new Date("2026-11-05T12:00:00Z")), "2026-11-05");
  assert.equal(formatCell(chi, "2026-11-01T04:30:00Z"), "2026-10-31");
  assert.equal(formatCell(chi, "2026-11-01"), "2026-11-01");
  assert.equal(formatCell({ type: "date" }, "2026-11-01T04:30:00Z"), "2026-11-01");
  assert.equal(csvValue(chi, "2026-11-01T04:30:00Z"), "2026-10-31");
});

test("csvValue gives plain money and numbers", () => {
  assert.equal(csvValue({ type: "money" }, 123450), "1234.50");
  assert.equal(csvValue({ type: "money" }, -1250), "-12.50");
  assert.equal(csvValue({ type: "int" }, 7), 7);
  assert.equal(csvValue({ type: "text" }, null), "");
  assert.equal(csvValue({ type: "pct" }, 0.074), "7.4%");
});

test("datetime and date cells reuse one formatter per zone and read the same", () => {
  const Real = Intl.DateTimeFormat;
  let built = 0;
  Intl.DateTimeFormat = function (...args) { built += 1; return new Real(...args); };
  try {
    const chi = { type: "datetime", timeZone: "America/Chicago" };
    for (let i = 0; i < 100; i += 1) formatCell(chi, "2026-11-01T04:30:00Z");
    assert.equal(formatCell(chi, "2026-11-01T04:30:00Z"), "2026-10-31 23:30");
    assert.equal(formatCell({ type: "datetime", timeZone: "Asia/Tokyo" }, "2026-11-01T04:30:00Z"), "2026-11-01 13:30");
    assert.equal(formatCell({ type: "date", timeZone: "Asia/Tokyo" }, "2026-10-31T16:00:00Z"), "2026-11-01");
    assert.equal(formatCell({ type: "datetime" }, "2026-11-01T04:30:00Z"), "2026-11-01 04:30");
    assert.ok(built <= 3, `built ${built} formatters`);
  } finally {
    Intl.DateTimeFormat = Real;
  }
});
