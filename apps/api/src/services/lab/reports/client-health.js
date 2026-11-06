/**
 * Client health (spec "Client health score (rule)"): the lab's thresholds and
 * the per-client rows, banded by the module's pure `activityHealth`. The
 * Client Health report and Insights (Task 8) both read `clientHealthRows`.
 *
 * Windows are lab-local days ending with asOf's lab day:
 *   recent   days 1–30 (asOf's day and the 29 before it)
 *   baseline days 31–210, divided by 6 (the prior 6 months' monthly average)
 *   monthly  six 30-day windows, oldest first; the last one is `recent`
 * Cancelled orders never count; clients who never ordered have no row.
 */
import { sql } from "drizzle-orm";
import { LAB_TIMEZONE, addDays, isoDateIn } from "@my-app/shared";
import { labOrders, users, doctorProfiles } from "../../../db/schema/index.js";
import { activityHealth } from "../../../modules/reports/health.js";
import { clientName, isClient, isLiveOrder, labCalendar, labDayBetween, labDayText, num, rowsOf, salesByClient, turnaroundDaysSql } from "./lab-metrics.js";

export const HEALTH_THRESHOLDS = { inactiveDays: 90, declining: 0.5, stable: 0.85 };

export const HEALTH_BANDS = [
  { value: "declining", label: "Declining" },
  { value: "stable", label: "Stable" },
  { value: "healthy", label: "Healthy" },
  { value: "inactive", label: "Inactive" },
];

const MONTHS = 6;

/** The lab-local windows for an instant: { today, recent, baseline, monthly[6] } of { from, to } days. */
export function healthWindows(asOf) {
  const today = isoDateIn(LAB_TIMEZONE, asOf);
  const window = (k) => ({ from: addDays(today, -30 * k - 29), to: addDays(today, -30 * k) });
  return {
    today,
    recent: window(0),
    baseline: { from: addDays(today, -209), to: addDays(today, -30) },
    monthly: Array.from({ length: MONTHS }, (_, i) => window(MONTHS - 1 - i)),
  };
}

const received = (range) => labDayBetween(labOrders.receivedAt, range);
const asIso = (v) => (v == null ? null : new Date(v).toISOString());
/** A lab day ("YYYY-MM-DD") as UTC midnight, so instant arithmetic between two of them counts whole lab days. */
const dayStart = (iso) => (iso == null ? null : new Date(`${iso}T00:00:00Z`));

/**
 * One row per client who has ever ordered:
 * { clientUserId, client, band, isNew, recent, baseline, trend, sales30Cents,
 *   avgTurnaroundDays, monthly: number[6], lastOrderAt, lastOrderDay }.
 * One grouped query over lab_orders plus one grouped sales query. `scope`
 * (report-helpers practiceScope) limits both to a practice or group: a
 * client's activity at those practices only.
 */
export async function clientHealthRows(db, { asOf, calendar = null, scope = null }) {
  const w = healthWindows(asOf);
  const cal = calendar ?? (await labCalendar(db));
  const monthly = w.monthly.map((m, i) => sql`count(*) filter (where ${received(m)}) as ${sql.identifier(`m${i}`)}`);
  const raw = await rowsOf(db, sql`
    select ${users.id} as "clientUserId", ${clientName} as "client",
      count(*) filter (where ${received(w.recent)}) as "recent",
      count(*) filter (where ${received(w.baseline)}) as "base",
      ${sql.join(monthly, sql`, `)},
      avg(${turnaroundDaysSql(cal)}) filter (where ${labDayBetween(labOrders.shippedAt, w.recent)}) as "turnaround",
      max(${labOrders.receivedAt}) as "lastOrderAt", ${labDayText(sql`max(${labOrders.receivedAt})`)} as "lastOrderDay"
    from ${labOrders}
    join ${users} on ${users.id} = ${labOrders.clientUserId} and ${isClient}
    left join ${doctorProfiles} on ${doctorProfiles.userId} = ${users.id}
    where ${isLiveOrder}${scope ? sql` and ${scope(labOrders.accountId)}` : sql``}
    group by ${users.id}, ${doctorProfiles.companyName}, ${users.name}`);
  const sales = await salesByClient(db, w.recent, scope);

  return raw.map((r) => {
    const recent = num(r.recent);
    const baseline = num(r.base) / 6;
    const lastOrderAt = asIso(r.lastOrderAt);
    // Idle time in whole lab days (last order's lab day to today's), so "inactive" is
    // "more than 90 lab days" exactly like clients.inactive, not 90×24h of wall-clock time.
    const { band, trend, isNew } = activityHealth(
      { recent, baseline, lastAt: dayStart(r.lastOrderDay ?? null), asOf: dayStart(w.today) }, HEALTH_THRESHOLDS);
    return {
      clientUserId: r.clientUserId, client: r.client, band, isNew, recent, baseline, trend,
      sales30Cents: sales.get(r.clientUserId) ?? 0,
      avgTurnaroundDays: r.turnaround == null ? null : Number(r.turnaround),
      monthly: Array.from({ length: MONTHS }, (_, i) => num(r[`m${i}`])),
      lastOrderAt, lastOrderDay: r.lastOrderDay ?? null,
    };
  });
}

/** "158 active (35 declining, 111 inactive)": active = not inactive (spec, used by Insights too). */
export function healthCounts(rows) {
  const count = (band) => rows.filter((r) => r.band === band).length;
  const inactive = count("inactive");
  return { active: rows.length - inactive, declining: count("declining"), inactive };
}
