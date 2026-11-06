import { test, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// authenticate is a JWT + DB lookup: stub it to an approved doctor. The real
// requireClientPortal (an approved doctor passes) and validate() run, so the schema's .default({}) path
// is what's under test.
const doctor = { id: "d1", role: "doctor", approvalStatus: "approved", seazonaClientId: "P1" };
vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = doctor; } }));
// lab.routes.js pulls in the whole lab service graph; only STAFF is used here.
vi.mock("../lab.routes.js", () => ({ STAFF: [] }));
vi.mock("../../services/audit.service.js", () => ({ logSafe: vi.fn() }));

const calls = [];
vi.mock("../../services/lab/pickups.service.js", () => ({
  cancelPickup: vi.fn(async (id, body, user) => {
    calls.push({ id, body, user });
    return { id, pickupNumber: 17, status: "cancelled", version: 2 };
  }),
  listPickups: vi.fn(), requestPickup: vi.fn(), schedulePickup: vi.fn(), completePickup: vi.fn(),
}));

const { default: pickupsRoutes } = await import("../pickups.routes.js");

async function app() {
  const f = Fastify();
  await f.register(pickupsRoutes, { prefix: "/api/v1" });
  return f;
}

beforeEach(() => { calls.length = 0; });

test("a doctor cancel with no body at all reaches the service with {}", async () => {
  const f = await app();
  const res = await f.inject({ method: "POST", url: "/api/v1/pickups/p1/cancel" });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ data: { id: "p1", status: "cancelled", version: 2 } });
  expect(calls).toEqual([{ id: "p1", body: {}, user: doctor }]);
  await f.close();
});

test("a doctor cancel with an empty JSON object works too", async () => {
  const f = await app();
  const res = await f.inject({ method: "POST", url: "/api/v1/pickups/p1/cancel", payload: {} });
  expect(res.statusCode).toBe(200);
  expect(calls[0].body).toEqual({});
  await f.close();
});

test("a malformed version is still a 422", async () => {
  const f = await app();
  const res = await f.inject({ method: "POST", url: "/api/v1/pickups/p1/cancel", payload: { expectedVersion: "x" } });
  expect(res.statusCode).toBe(422);
  expect(calls.length).toBe(0);
  await f.close();
});
