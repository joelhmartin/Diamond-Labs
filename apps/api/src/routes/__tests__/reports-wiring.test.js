import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

let user = { id: "u1", role: "lab" };
vi.mock("../../middleware/authenticate.js", () => ({ authenticate: async (request) => { request.user = user; } }));
const { stars } = vi.hoisted(() => ({ stars: new Map() }));
vi.mock("../../config/database.js", () => ({ db: { transaction: async (fn) => fn({ execute: async () => {} }) } }));
// record-tags stars, in memory: what the favorites store reads and writes (record type "report").
vi.mock("../../modules/record-tags/index.js", () => ({
  starsFor: async (recordType, ids, userId) => new Set(ids.filter((id) => stars.get(`${recordType}|${userId}`)?.has(id))),
  setStar: async ({ recordType, recordId, userId, starred }) => {
    const k = `${recordType}|${userId}`;
    if (!stars.has(k)) stars.set(k, new Set());
    if (starred) stars.get(k).add(recordId); else stars.get(k).delete(recordId);
    return { starred };
  },
}));
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

  it("favorites persist through record-tags stars (record type \"report\")", async () => {
    const f = await app();
    const put = await f.inject({ method: "PUT", url: "/api/v1/reports/operations.daily-orders/favorite" });
    expect(put.statusCode).toBe(200);
    expect(stars.get("report|u1")?.has("operations.daily-orders")).toBe(true);
    const list = await f.inject({ method: "GET", url: "/api/v1/reports" });
    expect(list.json().reports.find((r) => r.key === "operations.daily-orders").favorite).toBe(true);
    const del = await f.inject({ method: "DELETE", url: "/api/v1/reports/operations.daily-orders/favorite" });
    expect(del.statusCode).toBe(200);
    expect(stars.get("report|u1").has("operations.daily-orders")).toBe(false);
  });

  it("a non-staff role is refused", async () => {
    user = { id: "u2", role: "doctor" };
    const f = await app();
    const res = await f.inject({ method: "GET", url: "/api/v1/reports" });
    expect(res.statusCode).toBe(403);
    user = { id: "u1", role: "lab" };
  });
});
