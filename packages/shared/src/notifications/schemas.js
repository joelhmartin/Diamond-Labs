import { z } from "zod";
import { CHANNELS, PREFERENCE_CHANNELS, RECIPIENT_CHANNELS, DELIVERY_STATUSES } from "./channels.js";

/**
 * Request schemas for the generic notifications routes. Whether an event key
 * is registered (and offered to the caller's kind) is checked server-side by
 * the notifier; these only bound the shapes.
 */
const eventKey = z.string().trim().min(1).max(80);
const blankToUndefined = (schema) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);
const paging = {
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
};

export const notificationListQuerySchema = z.object({
  unread: blankToUndefined(z.enum(["true", "false"]).transform((v) => v === "true").optional()),
  event: blankToUndefined(eventKey.optional()),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: paging.offset,
});

export const notificationReadSchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(128)).min(1).max(200) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export const notificationPreferenceSchema = z.object({
  event: eventKey,
  channel: z.enum(PREFERENCE_CHANNELS),
  enabled: z.boolean(),
});

export const notificationRecipientCreateSchema = z.object({
  event: eventKey,
  channel: z.enum(RECIPIENT_CHANNELS),
  address: z.string().trim().min(3).max(320),
  label: blankToUndefined(z.string().trim().max(80).nullable().optional()),
});

export const notificationRecipientUpdateSchema = z.object({ active: z.boolean() });

export const notificationDeliveryQuerySchema = z.object({
  channel: blankToUndefined(z.enum(CHANNELS).optional()),
  status: blankToUndefined(z.enum(DELIVERY_STATUSES).optional()),
  event: blankToUndefined(eventKey.optional()),
  ...paging,
});
