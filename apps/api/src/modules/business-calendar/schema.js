import { pgTable, varchar, integer, jsonb, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

// business-calendar tables. GENERIC: nothing here knows what the host schedules.
// No DB foreign keys (repo convention): holidays point at calendars by key.

export const calendars = pgTable("calendars", {
  key: varchar("key", { length: 60 }).primaryKey(),
  timezone: varchar("timezone", { length: 60 }).notNull().default("UTC"),
  leadDays: integer("lead_days").notNull().default(0),
  // number[] of weekdays the business is closed, 0 = Sunday.
  closedWeekdays: jsonb("closed_weekdays").notNull().default([]),
  // none | orders | units
  capacityBasis: varchar("capacity_basis", { length: 10 }).notNull().default("none"),
  // { "0".."6": number | null }
  capacityByWeekday: jsonb("capacity_by_weekday").notNull().default({}),
  updatedBy: varchar("updated_by", { length: 128 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const calendarHolidays = pgTable("calendar_holidays", {
  id: varchar("id", { length: 128 }).primaryKey(),
  calendarKey: varchar("calendar_key", { length: 60 }).notNull(),
  date: date("date", { mode: "string" }).notNull(),
  label: varchar("label", { length: 80 }).notNull(),
}, (t) => [
  uniqueIndex("calendar_holidays_key_date_idx").on(t.calendarKey, t.date),
]);
