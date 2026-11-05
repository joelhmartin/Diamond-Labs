import {
  calendarSettingsSchema, holidayCreateSchema, holidayBulkDeleteSchema, calendarDaysQuerySchema,
} from "@my-app/shared";
import { validate, validateQuery } from "../../middleware/validate.js";
import { CalendarError } from "./errors.js";
import { calendarDays } from "./rules.js";
import { getCalendar, saveCalendar, listHolidays, addHoliday, removeHolidays } from "./service.js";

const STATUS = { NO_OPEN_DAYS: 400, INVALID: 400, NOT_FOUND: 404, CONFLICT: 409 };

/** CalendarError → { status, body } in the repo's `{ error: { code, status, message } }` shape; anything else is not ours (null). */
export function calendarErrorReply(err) {
  if (!(err instanceof CalendarError)) return null;
  const status = STATUS[err.code] ?? 400;
  return { status, body: { error: { code: err.code, status, message: err.message } } };
}

async function run(reply, fn, status = 200) {
  try {
    return reply.code(status).send({ data: await fn() });
  } catch (err) {
    const r = calendarErrorReply(err);
    if (r) return reply.code(r.status).send(r.body);
    throw err;
  }
}

/** The settings as the API returns them (the holiday Set becomes a list with ids). */
function present(calendar, holidays) {
  const { holidays: _set, holidayLabels: _labels, ...settings } = calendar;
  return { ...settings, holidays };
}

/**
 * Settings, holidays and a per-day load view for one calendar.
 *
 *   GET    {prefix}                  settings + holidays          (readGuard)
 *   PUT    {prefix}                  save settings                (writeGuard)
 *   POST   {prefix}/holidays         add one holiday              (writeGuard)
 *   DELETE {prefix}/holidays/:id     remove one                   (writeGuard)
 *   POST   {prefix}/holidays/delete  remove many, { ids }         (writeGuard)
 *   GET    {prefix}/days?from&to     calendarDays with counts     (readGuard)
 *
 * The host passes `db` and the guards (preHandler functions or arrays),
 * `loadCounts(db, { from, to, basis }) → Map<date, number>` to say what
 * is counted per day, and `onAudit(request, action, targetId, metadata)`
 * which runs after each write (metadata: ids, keys and dates only).
 */
export async function calendarRoutes(fastify, options = {}) {
  const {
    db = fastify.db, key = "default", prefix = "/scheduling/calendar", readGuard, writeGuard, loadCounts, onAudit,
  } = options;
  if (!db) throw new Error("calendarRoutes needs a `db`.");
  if (!readGuard || !writeGuard) throw new Error("calendarRoutes needs a readGuard and a writeGuard.");
  const read = [].concat(readGuard);
  const write = [].concat(writeGuard);
  const audit = async (request, action, targetId, metadata) => { if (onAudit) await onAudit(request, action, targetId, metadata); };

  fastify.get(prefix, { preHandler: read }, (_request, reply) =>
    run(reply, async () => present(await getCalendar(db, key), await listHolidays(db, key))));

  fastify.put(prefix, { preHandler: [...write, validate(calendarSettingsSchema)] }, (request, reply) =>
    run(reply, async () => {
      const saved = await saveCalendar(db, key, request.body, { byUserId: request.user?.id ?? null });
      await audit(request, "calendar.update", key, { leadDays: saved.leadDays, capacityBasis: saved.capacityBasis, closedWeekdays: saved.closedWeekdays });
      return present(saved, await listHolidays(db, key));
    }));

  fastify.post(`${prefix}/holidays`, { preHandler: [...write, validate(holidayCreateSchema)] }, (request, reply) =>
    run(reply, async () => {
      const row = await addHoliday(db, key, request.body);
      await audit(request, "calendar.holiday.add", row.id, { calendarKey: key, date: row.date });
      return row;
    }, 201));

  // Registered before /holidays/:id so "delete" is never read as an id.
  fastify.post(`${prefix}/holidays/delete`, { preHandler: [...write, validate(holidayBulkDeleteSchema)] }, (request, reply) =>
    run(reply, async () => {
      const { ids } = request.body;
      const count = await removeHolidays(db, key, ids);
      await audit(request, "calendar.holiday.remove", key, { ids, count });
      return { count };
    }));

  fastify.delete(`${prefix}/holidays/:id`, { preHandler: write }, (request, reply) =>
    run(reply, async () => {
      const { id } = request.params;
      const count = await removeHolidays(db, key, [id]);
      if (!count) throw new CalendarError("NOT_FOUND", "That holiday no longer exists.");
      await audit(request, "calendar.holiday.remove", id, { calendarKey: key, ids: [id], count });
      return { count };
    }));

  fastify.get(`${prefix}/days`, { preHandler: [...read, validateQuery(calendarDaysQuerySchema)] }, (request, reply) =>
    run(reply, async () => {
      const { from, to, basis } = request.query;
      const calendar = await getCalendar(db, key);
      const counts = loadCounts ? await loadCounts(db, { from, to, basis: basis ?? calendar.capacityBasis }) : new Map();
      // A count in another unit than the capacity limits cannot be compared with them.
      const comparable = basis == null || basis === calendar.capacityBasis ? calendar : { ...calendar, capacityBasis: "none" };
      return { days: calendarDays(comparable, from, to, counts) };
    }));
}
