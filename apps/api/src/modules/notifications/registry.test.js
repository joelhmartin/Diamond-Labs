import { test, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { defineNotificationEvent, getEvent, listEvents, clearEvents } from "./registry.js";

const base = (over = {}) => ({
  key: "thing.happened",
  label: "Thing happened",
  kinds: ["staff"],
  defaults: { staff: { in_app: true, email: false } },
  title: () => "Thing happened",
  link: () => null,
  ...over,
});

beforeEach(() => clearEvents());

test("defineNotificationEvent registers an event that getEvent returns", () => {
  defineNotificationEvent(base());
  const e = getEvent("thing.happened");
  assert.equal(e.key, "thing.happened");
  assert.equal(e.label, "Thing happened");
  assert.equal(getEvent("nope"), null);
});

test("duplicate key throws", () => {
  defineNotificationEvent(base());
  assert.throws(() => defineNotificationEvent(base()), /already registered/);
});

test("an event without a key, kinds, defaults per kind or title is rejected", () => {
  assert.throws(() => defineNotificationEvent(base({ key: "" })), /key/);
  assert.throws(() => defineNotificationEvent(base({ kinds: [] })), /kinds/);
  assert.throws(() => defineNotificationEvent(base({ defaults: {} })), /defaults/);
  assert.throws(() => defineNotificationEvent(base({ title: "x" })), /title/);
});

test("listEvents({kind}) returns only events whose kinds include it", () => {
  defineNotificationEvent(base({ key: "a.one", kinds: ["staff"] }));
  defineNotificationEvent(base({
    key: "b.two", kinds: ["staff", "client"],
    defaults: { staff: { in_app: true, email: false }, client: { in_app: true, email: true } },
  }));
  defineNotificationEvent(base({ key: "c.three", kinds: ["client"], defaults: { client: { in_app: true, email: true } } }));
  assert.deepEqual(listEvents().map((e) => e.key), ["a.one", "b.two", "c.three"]);
  assert.deepEqual(listEvents({ kind: "client" }).map((e) => e.key), ["b.two", "c.three"]);
  assert.deepEqual(listEvents({ kind: "staff" }).map((e) => e.key), ["a.one", "b.two"]);
});

test("clearEvents empties the registry", () => {
  defineNotificationEvent(base());
  clearEvents();
  assert.equal(getEvent("thing.happened"), null);
  assert.deepEqual(listEvents(), []);
});
