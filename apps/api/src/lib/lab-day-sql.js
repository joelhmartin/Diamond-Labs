/**
 * Lab-local calendar days in SQL (LAB_TIMEZONE, never the UTC day). The one
 * place reports and services turn a timestamptz into the lab's day or month,
 * or filter a timestamptz by lab days.
 */
import { sql } from "drizzle-orm";
import { LAB_TIMEZONE } from "@my-app/shared";

if (!/^[A-Za-z_]+(\/[A-Za-z_]+)*$/.test(LAB_TIMEZONE)) throw new Error("LAB_TIMEZONE is not a zone name");
/**
 * The zone as a SQL literal, not a bound parameter: Postgres treats two
 * parameters as different expressions, so a select and its GROUP BY must
 * share one literal.
 */
const LAB_TZ = sql.raw(`'${LAB_TIMEZONE}'`);

/** A timestamptz column's lab-local calendar day (a SQL date). */
export const labDay = (col) => sql`(${col} at time zone ${LAB_TZ})::date`;

/** The same day as "YYYY-MM-DD" text (raw `execute` rows then need no date parsing). */
export const labDayText = (col) => sql`to_char(${labDay(col)}, 'YYYY-MM-DD')`;

/** A timestamptz column's lab-local month as "YYYY-MM" text. */
export const labMonthText = (col) => sql`to_char(${labDay(col)}, 'YYYY-MM')`;

/** The instant the lab-local day `iso` ("YYYY-MM-DD") begins: an inclusive lower bound for "on or after iso". */
export const startOfLabDay = (iso) => sql`(${iso}::date)::timestamp at time zone ${LAB_TZ}`;

/** The instant the lab-local day after `iso` ("YYYY-MM-DD") begins: an exclusive upper bound for "on or before iso". */
export const afterLabDay = (iso) => sql`((${iso}::date + 1)::timestamp at time zone ${LAB_TZ})`;

/**
 * THE lab-day range filter for a timestamptz column: inclusive lab-local days
 * `from`..`to`, written as instant bounds so an index on the column applies.
 */
export const labDayBetween = (col, { from, to }) =>
  sql`${col} >= ${startOfLabDay(from)} and ${col} < ${afterLabDay(to)}`;
