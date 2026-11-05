# business-calendar

A generic module: it knows dates, weekdays, holidays and a capacity number, and nothing about what the host app schedules. The host injects guards, counts and audit; the module never imports app config. For a worked example of wiring it into an app, see Key File Paths in the root CLAUDE.md.

## The Calendar value

Every rule takes a plain `Calendar`:

```
{ key, timezone, leadDays, closedWeekdays: number[] /* 0 = Sunday */,
  holidays: Set<"YYYY-MM-DD">, holidayLabels?: Map<date, label>,
  capacityBasis: "none" | "orders" | "units",
  capacityByWeekday: { [0..6]: number | null } }
```

Dates are `"YYYY-MM-DD"` strings in the calendar's timezone. Day math uses `Date.UTC` on parsed parts, so DST never moves a day.

## Pure rules (`rules.js`)

- `toCalendar(row, holidayDates)`: normalise a stored row and build the holiday Set.
- `dateIn(timezone, instant)`: the zone's calendar date for an instant.
- `weekdayOf(date)`, `addDays(date, n)`: plain date helpers.
- `isOpen(date, calendar)`: not a closed weekday and not a holiday.
- `nextOpenDay(date, calendar)`: the same day when open; throws `NO_OPEN_DAYS` if nothing is ever open.
- `addBusinessDays(date, n, calendar)`: the start day is not counted; `n = 0` on a closed day rolls forward.
- `subtractBusinessDays(date, n, calendar)`: the mirror; `n = 0` rolls back to the previous open day.
- `businessDaysBetween(from, to, calendar)`: open days in `(from, to]`; negative when `to < from`.
- `capacityFor(date, calendar)`: `null` = no limit, `0` on a closed day, else the weekday limit.
- `loadLevel(count, capacity)`: `none | under | near | over` (near is 85% or more).
- `calendarDays(calendar, from, to, counts)`: one entry per day: `{ date, weekday, open, holiday, capacity, count, level }`.

## Configuration

- `key`: which calendar (default `"default"`); one app may hold several.
- `timezone`: IANA zone the dates are read in.
- `capacityBasis`: `none`, `orders` or `units`. The host decides what is counted and supplies `loadCounts`.

## Data model

`schema.js` (re-exported from `db/schema/index.js`), no foreign keys:

- `calendars`: `key` (pk), `timezone`, `lead_days`, `closed_weekdays` (jsonb int[]), `capacity_basis`, `capacity_by_weekday` (jsonb), `updated_by`, `updated_at`.
- `calendar_holidays`: `id`, `calendar_key`, `date`, `label`; unique on (`calendar_key`, `date`).

`service.js`: `getCalendar(db, key)` (built-in defaults when no row exists, plus `holidayLabels`), `saveCalendar(db, key, settings, { byUserId })` (refuses a calendar with every weekday closed), `listHolidays`, `addHoliday` (`CONFLICT` on a duplicate date), `removeHolidays`.

## Routes factory

`calendarRoutes(fastify, { db, key = "default", prefix = "/scheduling/calendar", readGuard, writeGuard, loadCounts?, onAudit? })`:

- `GET {prefix}`: settings and holidays (readGuard).
- `PUT {prefix}`: save settings (writeGuard).
- `POST {prefix}/holidays`, `DELETE {prefix}/holidays/:id`, `POST {prefix}/holidays/delete` (`{ ids }`): holidays (writeGuard).
- `GET {prefix}/days?from&to&basis`: `calendarDays` for up to 62 days (readGuard).

The host owns the guards and passes `db`. `loadCounts(db, { from, to, basis })` returns a `Map<date, number>`; without it every count is 0. `onAudit(request, action, targetId, metadata)` runs after each write; metadata is ids, keys and dates only. Errors reply `{ error: { code, status, message } }` (400 `INVALID`, 404 `NOT_FOUND`, 409 `CONFLICT`).

## Wiring it into another app

TODO (Task 11).
