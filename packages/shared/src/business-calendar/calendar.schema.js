import { z } from "zod";
import { isoDate } from "../schemas/common.schema.js";

export const CAPACITY_BASES = ["none", "orders", "units"];
export const MAX_DAYS_SPAN = 62;

const isValidZone = (tz) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const weekdayKey = z.string().regex(/^[0-6]$/);

export const calendarSettingsSchema = z.object({
  timezone: z.string().min(1).max(60).refine(isValidZone, "Use an IANA timezone, e.g. America/Chicago."),
  leadDays: z.number().int().min(0).max(90),
  closedWeekdays: z
    .array(z.number().int().min(0).max(6))
    .max(6, "At least one weekday must stay open.")
    .refine((a) => new Set(a).size === a.length, "Each weekday once."),
  capacityBasis: z.enum(CAPACITY_BASES),
  capacityByWeekday: z.record(weekdayKey, z.number().int().min(0).nullable()),
});

export const holidayCreateSchema = z.object({
  date: isoDate,
  label: z.string().trim().min(1).max(80),
});

export const holidayBulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(200),
});

const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000;

export const calendarDaysQuerySchema = z
  .object({ from: isoDate, to: isoDate, basis: z.enum(CAPACITY_BASES).optional() })
  .refine((q) => q.to >= q.from, { message: "`to` must not be before `from`.", path: ["to"] })
  .refine((q) => daysBetween(q.from, q.to) < MAX_DAYS_SPAN + 1, { message: `Ask for at most ${MAX_DAYS_SPAN} days.`, path: ["to"] });
