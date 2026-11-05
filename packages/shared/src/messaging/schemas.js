import { z } from "zod";

/**
 * Request schemas for the generic messaging routes. Access (who may see a
 * thread, which party a thread belongs to) is decided server-side by the
 * messaging service; these only bound the shapes.
 */
export const MESSAGE_BODY_MAX = 5000;
export const MESSAGE_SUBJECT_MAX = 200;
export const MESSAGE_FOLDERS = ["inbox", "completed", "archived"];

const blankToUndefined = (schema) => z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), schema);
const key = (max) => z.string().trim().min(1).max(max);
const body = z.string().trim().min(1).max(MESSAGE_BODY_MAX);

export const messageThreadListQuerySchema = z.object({
  folder: blankToUndefined(z.enum(MESSAGE_FOLDERS).optional()),
  unread: blankToUndefined(z.enum(["true", "false"]).transform((v) => v === "true").optional()),
  recordType: blankToUndefined(key(40).optional()),
  recordId: blankToUndefined(key(128).optional()),
  party: blankToUndefined(key(160).optional()),
  q: blankToUndefined(z.string().trim().max(100).optional()),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export const messageThreadCreateSchema = z.object({
  recordType: blankToUndefined(key(40).optional()),
  recordId: blankToUndefined(key(128).optional()),
  party: blankToUndefined(key(160).optional()),
  subject: blankToUndefined(z.string().trim().max(MESSAGE_SUBJECT_MAX).optional()),
  body,
}).strict().refine((v) => Boolean(v.recordType) === Boolean(v.recordId), {
  message: "recordType and recordId go together.",
  path: ["recordId"],
});

export const messagePostSchema = z.object({ body }).strict();

export const messagePartyQuerySchema = z.object({
  q: blankToUndefined(z.string().trim().max(100).optional()),
});
