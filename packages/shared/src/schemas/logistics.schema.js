import { z } from "zod";
import { id, isoDate, pageQueryShape, searchText } from "./common.schema.js";
import {
  PICKUP_STATUSES, TIME_PREFERENCES, PICKUP_BOXES_MIN, PICKUP_BOXES_MAX, PICKUP_NOTES_MAX,
} from "../lab/logistics.js";

const version = z.number().int().positive();
const freeText = z.string().trim().max(PICKUP_NOTES_MAX);

/**
 * A practice's pickup request. Date rules that need "today" (earliest ≥ today
 * in CT, a window of at most 14 days) are the API's (pickup-rules.js).
 * No latestDate means a one-day window.
 */
export const pickupRequestSchema = z.object({
  earliestDate: isoDate,
  latestDate: isoDate.optional(),
  timePreference: z.enum(TIME_PREFERENCES),
  boxCount: z.number().int().min(PICKUP_BOXES_MIN).max(PICKUP_BOXES_MAX),
  notes: freeText.nullable().optional(),
});

/** Staff entering a pickup for a client (also the cutover re-entry path). */
export const labPickupRequestSchema = pickupRequestSchema.extend({ clientUserId: id });

export const pickupScheduleSchema = z.object({
  scheduledDate: isoDate,
  // Absent keeps the current assignee; null clears it.
  assigneeUserId: id.nullable().optional(),
  expectedVersion: version,
});

export const pickupCompleteSchema = z.object({ expectedVersion: version });

/** Staff cancel: the reason is required by the rules (REASON_REQUIRED), so the message is the API's. */
export const pickupCancelSchema = z.object({ reason: freeText.optional(), expectedVersion: version });

/** A doctor's cancel: no reason needed, and the version is optional (the update is still conditional). */
export const pickupDoctorCancelSchema = z
  .object({ reason: freeText.optional(), expectedVersion: version.optional() })
  .default({});

export const pickupListQuerySchema = z.object({
  status: z.enum(PICKUP_STATUSES).optional(),
  ...pageQueryShape,
});

export const labPickupListQuerySchema = z.object({
  // "open" is requested + scheduled (the desk's default view).
  status: z.enum([...PICKUP_STATUSES, "open"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  assigneeUserId: id.optional(),
  q: searchText.optional(),
  ...pageQueryShape,
});
