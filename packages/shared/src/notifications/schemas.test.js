import { test } from "vitest";
import assert from "node:assert/strict";
import {
  notificationListQuerySchema, notificationReadSchema, notificationPreferenceSchema,
  notificationRecipientCreateSchema, notificationRecipientUpdateSchema, notificationDeliveryQuerySchema,
} from "../index.js";

test("read takes 1..200 ids or all: true, nothing else", () => {
  assert.ok(notificationReadSchema.safeParse({ ids: ["a"] }).success);
  assert.ok(notificationReadSchema.safeParse({ all: true }).success);
  assert.ok(!notificationReadSchema.safeParse({ ids: [] }).success);
  assert.ok(!notificationReadSchema.safeParse({ ids: Array.from({ length: 201 }, (_, i) => `n${i}`) }).success);
  assert.ok(!notificationReadSchema.safeParse({ all: false }).success);
  assert.ok(!notificationReadSchema.safeParse({}).success);
});

test("list query coerces paging and treats an empty event as none", () => {
  const q = notificationListQuerySchema.parse({ unread: "true", event: "", limit: "10", offset: "0" });
  assert.deepEqual(q, { unread: true, event: undefined, limit: 10, offset: 0 });
  assert.ok(!notificationListQuerySchema.safeParse({ limit: "0" }).success);
});

test("preference and recipient bodies", () => {
  assert.ok(notificationPreferenceSchema.safeParse({ event: "x.y", channel: "email", enabled: false }).success);
  assert.ok(!notificationPreferenceSchema.safeParse({ event: "x.y", channel: "sms", enabled: true }).success);
  assert.ok(notificationRecipientCreateSchema.safeParse({ event: "x.y", channel: "sms", address: "512-555-1234", label: "Desk" }).success);
  assert.ok(!notificationRecipientCreateSchema.safeParse({ event: "x.y", channel: "in_app", address: "512" }).success);
  assert.ok(!notificationRecipientCreateSchema.safeParse({ event: "x.y", channel: "sms", address: "12" }).success);
  assert.ok(!notificationRecipientCreateSchema.safeParse({ event: "x.y", channel: "email", address: "a@b.c", label: "x".repeat(81) }).success);
  assert.ok(notificationRecipientUpdateSchema.safeParse({ active: false }).success);
  assert.ok(!notificationDeliveryQuerySchema.safeParse({ status: "lost" }).success);
  assert.deepEqual(notificationDeliveryQuerySchema.parse({ channel: "sms", status: "sent", limit: "5" }), { channel: "sms", status: "sent", limit: 5 });
});
