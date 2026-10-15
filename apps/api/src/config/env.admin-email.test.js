import { test, vi, afterEach } from "vitest";
import assert from "node:assert/strict";

const BASE = {
  DATABASE_URL: "postgres://u:p@localhost:5432/test",
  JWT_SECRET: "test-jwt-secret-that-is-at-least-32-chars",
};
const saved = process.env.ADMIN_NOTIFICATION_EMAIL;

async function load(value) {
  vi.resetModules();
  Object.assign(process.env, BASE);
  if (value === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL;
  else process.env.ADMIN_NOTIFICATION_EMAIL = value;
  return (await import("./env.js")).env;
}

afterEach(() => {
  vi.restoreAllMocks();
  if (saved === undefined) delete process.env.ADMIN_NOTIFICATION_EMAIL;
  else process.env.ADMIN_NOTIFICATION_EMAIL = saved;
});

test("a single admin address parses to a one-element list", async () => {
  assert.deepEqual((await load("ops@example.com")).ADMIN_NOTIFICATION_EMAIL, ["ops@example.com"]);
});

test("a comma list is trimmed and empty entries are dropped", async () => {
  const env = await load(" a@example.com , b@example.com,, c@example.com ,");
  assert.deepEqual(env.ADMIN_NOTIFICATION_EMAIL, ["a@example.com", "b@example.com", "c@example.com"]);
});

test("unset or blank means no admins configured", async () => {
  assert.equal((await load(undefined)).ADMIN_NOTIFICATION_EMAIL, undefined);
  assert.equal((await load("")).ADMIN_NOTIFICATION_EMAIL, undefined);
});

test("one invalid entry fails validation", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation((code) => { throw new Error(`exit ${code}`); });
  await assert.rejects(load("a@example.com, not-an-email"), /exit 1/);
});
