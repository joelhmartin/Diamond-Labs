/**
 * `businessDaysSql` / `turnaroundDaysSql` (lab-metrics) are the SQL twin of
 * piece 7's `businessDaysBetween`. The shapes are checked in lab-metrics.test.js;
 * this proves the two AGREE, on a real Postgres, so a change to one rule that
 * misses the other fails here. Opt-in (needs a LOCAL server; skipped otherwise):
 *   SCRATCH_DB_SERVER_URL=postgresql://bif@localhost:5432/postgres npx vitest run src/services/lab/reports/business-days-parity.test.js
 * It creates, migrates and drops its own database (test/scratch-db.js).
 *
 * The JS side counts open days in (received day, shipped day] and goes
 * negative for a reversed pair; the SQL side is documented "never below 0",
 * so the comparison is against max(0, JS).
 */
import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { LAB_TIMEZONE } from "@my-app/shared";
import { businessDaysBetween, dateIn } from "../../../modules/business-calendar/index.js";
import { createScratchDb } from "../../../test/scratch-db.js";
import { businessDaysSql, turnaroundDaysSql, labDay } from "./lab-metrics.js";

const scratch = createScratchDb({ prefix: "business_days_parity", label: "business-days-parity" });
afterAll(scratch.drop);

const calendar = (closedWeekdays, holidays = []) => ({ closedWeekdays, holidays: new Set(holidays) });

// America/Los_Angeles: PST = UTC-8 (after Nov 1 2026), PDT = UTC-7 (before).
const CALENDARS = {
  monFri: calendar([0, 6]),
  monFriHolidays: calendar([0, 6], ["2026-11-26", "2026-12-25", "2026-11-07" /* a holiday on a closed Saturday */]),
  closedWednesdayToo: calendar([0, 3, 6], ["2026-11-27"]),
  allOpen: calendar([]),
  sevenDayHolidayOnly: calendar([], ["2026-11-10"]),
};

// [label, receivedAt, shippedAt]
const CASES = [
  ["same instant", "2026-11-05T18:00:00Z", "2026-11-05T18:00:00Z"],
  ["same lab day, hours apart", "2026-11-05T17:00:00Z", "2026-11-06T06:00:00Z"],
  ["Fri evening to Mon (weekend between)", "2026-11-07T01:00:00Z", "2026-11-09T20:00:00Z"],
  ["Sat to Sun (no open day between)", "2026-11-07T20:00:00Z", "2026-11-08T20:00:00Z"],
  ["Wed to Fri across the Nov 26 holiday", "2026-11-25T20:00:00Z", "2026-11-27T20:00:00Z"],
  // Timezone edge: 23:30 Thu in Pacific is already Fri in UTC; 00:30 Fri Pacific is Fri in UTC too.
  ["23:30 to 00:30 Pacific, one UTC day", "2026-11-06T07:30:00Z", "2026-11-06T08:30:00Z"],
  ["23:59 Pacific to 00:01 Pacific", "2026-11-10T07:59:00Z", "2026-11-10T08:01:00Z"],
  ["Pacific Friday 23:00 is Saturday in UTC", "2026-11-14T07:00:00Z", "2026-11-16T07:30:00Z"],
  // Daylight-saving boundaries (fall back Nov 1 2026, spring forward Mar 8 2026): day math must not slip.
  ["across fall back", "2026-10-30T20:00:00Z", "2026-11-03T20:00:00Z"],
  ["across spring forward", "2026-03-06T20:00:00Z", "2026-03-10T20:00:00Z"],
  ["the fall-back night itself", "2026-11-01T06:59:00Z", "2026-11-02T07:59:00Z"],
  ["shipped before received (reversed)", "2026-11-12T20:00:00Z", "2026-11-05T20:00:00Z"],
  ["a month with the Christmas holiday", "2026-12-21T20:00:00Z", "2026-12-29T20:00:00Z"],
  ["a long span (most of a year)", "2026-01-02T20:00:00Z", "2026-12-31T20:00:00Z"],
];

test.skipIf(!scratch.enabled)("businessDaysSql / turnaroundDaysSql agree with businessDaysBetween on a real Postgres", async () => {
  const { db } = await scratch.open();
  const rowsOf = async (q) => { const r = await db.execute(q); return Array.isArray(r) ? r : r.rows; };

  // 1. The expression on literal instants: every (calendar, case) pair, through the lab-day rule the report uses.
  let compared = 0;
  for (const [name, cal] of Object.entries(CALENDARS)) {
    for (const [label, received, shipped] of CASES) {
      const [row] = await rowsOf(sql`select ${businessDaysSql(labDay(sql`${received}::timestamptz`), labDay(sql`${shipped}::timestamptz`), cal)} as n`);
      const expected = Math.max(0, businessDaysBetween(dateIn(LAB_TIMEZONE, new Date(received)), dateIn(LAB_TIMEZONE, new Date(shipped)), cal));
      assert.equal(Number(row.n), expected, `${name} / ${label}`);
      compared += 1;
    }
  }
  assert.equal(compared, Object.keys(CALENDARS).length * CASES.length);

  // 2. The exported turnaroundDaysSql over real lab_orders rows (the column expression every report averages).
  const cal = CALENDARS.monFriHolidays;
  const values = CASES.map(([, received, shipped], i) => `('p${i}', ${9000 + i}, 'staff', 's${i}', '${received}', '${shipped}')`).join(", ");
  await db.execute(sql.raw(`insert into lab_orders (id, order_number, source, source_id, received_at, shipped_at) values ${values}`));
  const rows = await rowsOf(sql`select ${sql.raw("id")} as id, ${turnaroundDaysSql(cal)} as n from lab_orders order by order_number`);
  assert.equal(rows.length, CASES.length);
  CASES.forEach(([label, received, shipped], i) => {
    const expected = Math.max(0, businessDaysBetween(dateIn(LAB_TIMEZONE, new Date(received)), dateIn(LAB_TIMEZONE, new Date(shipped)), cal));
    assert.equal(Number(rows[i].n), expected, `lab_orders / ${label}`);
  });

  // 3. The edge is real: in UTC the Pacific-midnight pair is one day, in the lab it is two.
  const [edge] = CASES.filter(([label]) => label.startsWith("23:30"));
  assert.equal(dateIn("UTC", new Date(edge[1])), dateIn("UTC", new Date(edge[2])));
  assert.notEqual(dateIn(LAB_TIMEZONE, new Date(edge[1])), dateIn(LAB_TIMEZONE, new Date(edge[2])));
}, 60000);
