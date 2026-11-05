import { test } from "vitest";
import assert from "node:assert/strict";
import {
  messageThreadListQuerySchema, messageThreadCreateSchema, messagePostSchema, messagePartyQuerySchema,
  MESSAGE_BODY_MAX, MESSAGE_SUBJECT_MAX, MESSAGE_FOLDERS, MESSAGE_FILES_MAX, MESSAGE_FILE_MAX_BYTES,
} from "../index.js";

test("limits and folders are published for the web app", () => {
  assert.equal(MESSAGE_BODY_MAX, 5000);
  assert.equal(MESSAGE_SUBJECT_MAX, 200);
  assert.deepEqual(MESSAGE_FOLDERS, ["inbox", "completed", "archived"]);
});

test("attachment limits: 5 files a message, 20 MB each", () => {
  assert.equal(MESSAGE_FILES_MAX, 5);
  assert.equal(MESSAGE_FILE_MAX_BYTES, 20 * 1024 * 1024);
});

test("list query coerces paging and unread, treats blanks as none", () => {
  const q = messageThreadListQuerySchema.parse({ folder: "completed", unread: "true", recordType: "", q: " ", limit: "20", offset: "0" });
  assert.equal(q.folder, "completed");
  assert.equal(q.unread, true);
  assert.equal(q.recordType, undefined);
  assert.equal(q.q, undefined);
  assert.equal(q.limit, 20);
  assert.ok(!messageThreadListQuerySchema.safeParse({ folder: "trash" }).success);
  assert.ok(!messageThreadListQuerySchema.safeParse({ limit: "101" }).success);
});

test("create takes a body and an optional record pair, subject and party", () => {
  assert.ok(messageThreadCreateSchema.safeParse({ body: "hi" }).success);
  assert.ok(messageThreadCreateSchema.safeParse({ recordType: "widget", recordId: "w1", subject: "About w1", body: "hi" }).success);
  assert.ok(messageThreadCreateSchema.safeParse({ party: "org:1", body: "hi" }).success);
  assert.ok(!messageThreadCreateSchema.safeParse({ body: "   " }).success, "blank body");
  assert.ok(!messageThreadCreateSchema.safeParse({ body: "x".repeat(5001) }).success, "body over the cap");
  assert.ok(!messageThreadCreateSchema.safeParse({ body: "hi", subject: "s".repeat(201) }).success, "subject over the cap");
  assert.ok(!messageThreadCreateSchema.safeParse({ recordType: "widget", body: "hi" }).success, "record type without id");
  assert.ok(!messageThreadCreateSchema.safeParse({ recordId: "w1", body: "hi" }).success, "record id without type");
  assert.ok(!messageThreadCreateSchema.safeParse({ body: "hi", files: [] }).success, "unknown keys refused");
});

test("post takes only a body; parties take an optional q", () => {
  assert.deepEqual(messagePostSchema.parse({ body: "  hello  " }), { body: "hello" });
  assert.ok(!messagePostSchema.safeParse({}).success);
  assert.ok(!messagePostSchema.safeParse({ body: "x".repeat(5001) }).success);
  assert.equal(messagePartyQuerySchema.parse({}).q, undefined);
  assert.equal(messagePartyQuerySchema.parse({ q: " acme " }).q, "acme");
});
