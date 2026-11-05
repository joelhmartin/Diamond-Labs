import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

let user = { id: "u1", role: "lab" };
vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = user; } }));
vi.mock("../../config/database.js", () => ({ db: { transaction: async (fn) => fn({ execute: async () => {} }) } }));
vi.mock("../../services/audit.service.js", () => ({ logSafe: vi.fn() }));

const { default: reportsRoutes, reportRegistry } = await import("../reports.routes.js");

async function app() {
  const f = Fastify();
  await f.register(reportsRoutes, { prefix: "/api/v1" });
  return f;
}

describe("reports.routes wiring", () => {
  it("staff can list reports (registry defaults to STAFF_ROLES)", async () => {
    const f = await app();
    const res = await f.inject({ method: "GET", url: "/api/v1/reports" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty("reports");
    expect(reportRegistry.listGroups).toBeTypeOf("function");
  });

  it("a non-staff role is refused", async () => {
    user = { id: "u2", role: "doctor" };
    const f = await app();
    const res = await f.inject({ method: "GET", url: "/api/v1/reports" });
    expect(res.statusCode).toBe(403);
    user = { id: "u1", role: "lab" };
  });
});
