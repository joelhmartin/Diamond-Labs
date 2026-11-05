import { and, between, count, eq, ne, notInArray } from "drizzle-orm";
import { TERMINAL_LAB_STATUSES } from "@my-app/shared";
import { labOrders, labOrderLines } from "../../db/schema/index.js";
import { dateIn, addDays, nextOpenDay } from "../../modules/business-calendar/index.js";
import { getCalendar } from "../../modules/business-calendar/service.js";
import { createWorkflowsService } from "../../modules/workflows/service.js";
import { LAB_RECORD_TYPE, scheduleFlags } from "./lab-scheduling.js";

/**
 * Read-side scheduling queries for the lab: the board's tiles, the ids behind
 * the at-risk filter, and the calendar's per-day load. All "today" values come
 * from the calendar's own timezone.
 */

const PLAN_BATCH = 400;

/** "Tomorrow" is the next open day after `today` (a Friday's tomorrow is Monday). */
export const tomorrowOf = (today, calendar) => nextOpenDay(addDays(today, 1), calendar);

/** Every non-terminal order's id, status, hold origin and due date, as lean rows. */
async function openOrderRows(db) {
  return db
    .select({ id: labOrders.id, status: labOrders.status, heldFrom: labOrders.heldFrom, dueDate: labOrders.dueDate })
    .from(labOrders)
    .where(notInArray(labOrders.status, TERMINAL_LAB_STATUSES));
}

/** Saved plans for `ids`, loaded in batches so the IN list stays small. */
async function plansInBatches(db, ids) {
  const workflows = createWorkflowsService(db);
  const plans = new Map();
  for (let i = 0; i < ids.length; i += PLAN_BATCH) {
    for (const [id, plan] of await workflows.plansFor(LAB_RECORD_TYPE, ids.slice(i, i + PLAN_BATCH))) plans.set(id, plan);
  }
  return plans;
}

async function atRiskIds(db, rows, today, calendar) {
  const plans = await plansInBatches(db, rows.map((r) => r.id));
  return rows.filter((r) => scheduleFlags(r, plans.get(r.id) ?? null, today, calendar).atRisk).map((r) => r.id);
}

/**
 * Counts over ALL open orders (not the board's list cap). An on-hold order is
 * counted in `onHold` and, when late or due soon, in the due-date tiles and
 * `atRisk` as well: the tiles are independent questions.
 */
export async function boardTiles(db, now = new Date()) {
  const calendar = await getCalendar(db);
  const today = dateIn(calendar.timezone, now);
  const tomorrowDate = tomorrowOf(today, calendar);
  const rows = await openOrderRows(db);
  const tally = { pastDue: 0, dueToday: 0, dueTomorrow: 0, onHold: 0 };
  for (const r of rows) {
    if (r.dueDate && r.dueDate < today) tally.pastDue += 1;
    else if (r.dueDate === today) tally.dueToday += 1;
    else if (r.dueDate === tomorrowDate) tally.dueTomorrow += 1;
    if (r.status === "on_hold") tally.onHold += 1;
  }
  const atRisk = (await atRiskIds(db, rows, today, calendar)).length;
  return { ...tally, atRisk, today, tomorrowDate };
}

/**
 * Ids behind a board tile when SQL alone can't say (`at_risk` needs plans and
 * the calendar); null for the tiles the WHERE clause expresses itself.
 */
export async function tileOrderIds(db, tile, now = new Date(), calendar = null) {
  if (tile !== "at_risk") return null;
  const cal = calendar ?? (await getCalendar(db));
  return atRiskIds(db, await openOrderRows(db), dateIn(cal.timezone, now), cal);
}

/**
 * Orders (or units) due on each day of [from, to], cancelled orders excluded.
 * Units are the sum of quantities over the lines that are products, not notes.
 * @returns {Promise<Map<string, number>>}
 */
export async function labLoadCounts(db, { from, to, basis = "orders" }) {
  const inRange = and(between(labOrders.dueDate, from, to), ne(labOrders.status, "cancelled"));
  const counts = new Map();
  if (basis === "units") {
    const rows = await db
      .select({ dueDate: labOrders.dueDate, qty: labOrderLines.qty, noteOnly: labOrderLines.noteOnly })
      .from(labOrders)
      .innerJoin(labOrderLines, eq(labOrderLines.labOrderId, labOrders.id))
      .where(inRange);
    for (const r of rows) if (!r.noteOnly) counts.set(r.dueDate, (counts.get(r.dueDate) ?? 0) + Number(r.qty));
    return counts;
  }
  const rows = await db.select({ dueDate: labOrders.dueDate, n: count() }).from(labOrders).where(inRange).groupBy(labOrders.dueDate);
  for (const r of rows) counts.set(r.dueDate, Number(r.n));
  return counts;
}
