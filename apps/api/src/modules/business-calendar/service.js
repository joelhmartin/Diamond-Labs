import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { createId } from "../../lib/id.js";
import { calendars, calendarHolidays } from "./schema.js";
import { CalendarError } from "./errors.js";
import { DEFAULT_CALENDAR, toCalendar } from "./rules.js";

const UNIQUE_VIOLATION = "23505";

/** Holidays of a calendar, oldest first; `from` / `to` (inclusive) are optional. */
export async function listHolidays(db, key, { from, to } = {}) {
  const where = [eq(calendarHolidays.calendarKey, key)];
  if (from) where.push(gte(calendarHolidays.date, from));
  if (to) where.push(lte(calendarHolidays.date, to));
  const rows = await db
    .select({ id: calendarHolidays.id, date: calendarHolidays.date, label: calendarHolidays.label })
    .from(calendarHolidays)
    .where(and(...where))
    .orderBy(asc(calendarHolidays.date));
  return rows;
}

/** The calendar value for `key` (built-in defaults when it has no settings row yet), with holidayLabels. */
export async function getCalendar(db, key = DEFAULT_CALENDAR.key) {
  const [row] = await db.select().from(calendars).where(eq(calendars.key, key)).limit(1);
  const holidays = await listHolidays(db, key);
  const calendar = row ? toCalendar(row, holidays.map((h) => h.date)) : toCalendar({ ...DEFAULT_CALENDAR, key }, holidays.map((h) => h.date));
  calendar.holidayLabels = new Map(holidays.map((h) => [h.date, h.label]));
  return calendar;
}

/** Upsert the settings row. At least one weekday must stay open. */
export async function saveCalendar(db, key, settings, { byUserId = null } = {}) {
  const closed = [...new Set(settings.closedWeekdays)];
  if (closed.length >= 7) throw new CalendarError("INVALID", "At least one weekday must stay open.");
  const values = {
    timezone: settings.timezone,
    leadDays: settings.leadDays,
    closedWeekdays: closed,
    capacityBasis: settings.capacityBasis,
    capacityByWeekday: settings.capacityByWeekday,
    updatedBy: byUserId,
    updatedAt: new Date(),
  };
  await db.insert(calendars).values({ key, ...values }).onConflictDoUpdate({ target: calendars.key, set: values });
  return getCalendar(db, key);
}

export async function addHoliday(db, key, { date, label }) {
  const [existing] = await db
    .select({ id: calendarHolidays.id })
    .from(calendarHolidays)
    .where(and(eq(calendarHolidays.calendarKey, key), eq(calendarHolidays.date, date)))
    .limit(1);
  if (existing) throw new CalendarError("CONFLICT", `${date} is already a holiday.`);
  const row = { id: createId(), calendarKey: key, date, label };
  try {
    await db.insert(calendarHolidays).values(row);
  } catch (err) {
    if (err?.code === UNIQUE_VIOLATION) throw new CalendarError("CONFLICT", `${date} is already a holiday.`);
    throw err;
  }
  return { id: row.id, date, label };
}

/** Delete holidays of `key` by id; returns how many rows went. */
export async function removeHolidays(db, key, ids) {
  if (!ids.length) return 0;
  const gone = await db
    .delete(calendarHolidays)
    .where(and(eq(calendarHolidays.calendarKey, key), inArray(calendarHolidays.id, ids)))
    .returning({ id: calendarHolidays.id });
  return (gone ?? []).length;
}
