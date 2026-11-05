# business-calendar

## Purpose

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

## Public interface

`index.js` exports `CalendarError` and the pure rules below. `service.js` (database access) and `routes.js` (`calendarRoutes`, `calendarErrorReply`) are imported by path. The web components are in `apps/web/src/modules/business-calendar/` (`CalendarGrid`, `CalendarSettingsForm`, `HolidaysTable`) and the zod request schemas in `packages/shared/src/business-calendar/`.

### Pure rules (`rules.js`)

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
- `GET {prefix}/days?from&to&basis`: `calendarDays` for at most 62 days apart (`to - from <= 62`) (readGuard).

The host owns the guards and passes `db`. `loadCounts(db, { from, to, basis })` returns a `Map<date, number>`; without it every count is 0. `onAudit(request, action, targetId, metadata)` runs after each write; metadata is ids, keys and dates only. Errors reply `{ error: { code, status, message } }` (400 `INVALID`, 404 `NOT_FOUND`, 409 `CONFLICT`).

## Wiring it into another app

Needs from the host: a Drizzle `db`, Fastify with auth guards, `createId()` from `apps/api/src/lib/id.js`, `validate` and `validateQuery` from `apps/api/src/middleware/validate.js` (zod body and query validation), `@my-app/shared` for the request schemas, and on the web the shared UI kit (`Button`, `Input`, `DataTable` + `useDataTable`, `useResource`, `Toast`, `config/api.js`, `lib/requests.js`).

1. **Schema.** Re-export `calendars` and `calendarHolidays` from `modules/business-calendar/schema.js` in the app's Drizzle schema index, then generate a migration.
2. **Routes.** Register `calendarRoutes` with `db`, `readGuard`, `writeGuard`, optionally `prefix` and `key`, `onAudit` and `loadCounts`. Map errors with `calendarErrorReply` where the host formats its own replies.
3. **Seed.** Add a custom migration that inserts the `default` calendar row (timezone, `lead_days`, `closed_weekdays`, `capacity_basis`, `capacity_by_weekday`) with `ON CONFLICT DO NOTHING`, so a re-run never overwrites staff edits.
4. **Use it.** Where records are created call `getCalendar(db, key)` once, then `addBusinessDays`, `isOpen` and `capacityFor` with that value. Dates stay `"YYYY-MM-DD"` strings in the calendar timezone.
5. **Counts.** Implement `loadCounts(db, { from, to, basis })` returning a `Map<date, number>` for what your app counts per day (records or units). Skip it and every count is 0.
6. **UI.** Mount `CalendarSettingsForm` and `HolidaysTable` with `basePath` set to your route prefix, and `CalendarGrid` fed from `GET {prefix}/days` (`days`, `view`, `anchor`, `onAnchorChange`, `onDayClick`, optional `renderCell`).
