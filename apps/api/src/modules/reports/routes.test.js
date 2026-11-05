import { describe, test, expect, vi } from "vitest";
import Fastify from "fastify";
import { createRegistry } from "./registry.js";
import { createRunSlots } from "./runner.js";
import { createMemoryFavoritesStore } from "./favorites.service.js";
import { createReportRoutes } from "./routes.js";

async function build({ role = "staff", reportOver = {} } = {}) {
  const registry = createRegistry({ defaultRoles: ["admin", "staff"] });
  registry.defineGroup({ key: "g", title: "G", position: 1 });
  registry.defineReport({
    key: "r.one", group: "g", title: "One", featured: true,
    params: [{ name: "n", type: "number", min: 1 }],
    columns: [{ id: "a", label: "A", type: "int" }],
    run: async () => ({ rows: [{ a: 1 }] }),
    ...reportOver,
  });
  registry.defineReport({ key: "r.money", group: "g", title: "Money", roles: ["admin"], columns: [{ id: "a", label: "A", type: "int" }], run: async () => ({ rows: [] }) });
  registry.defineLookup({ key: "things", search: async (_db, q) => Array.from({ length: 30 }, (_, i) => ({ value: `${q}${i}`, label: `L${i}` })), label: async () => "x" });
  registry.defineLookup({ key: "secret", roles: ["admin"], search: async () => [], label: async () => "x" });
  const audit = vi.fn();
  const favorites = createMemoryFavoritesStore();
  const db = { transaction: async (fn) => fn({ execute: async () => {} }) };
  const app = Fastify();
  await app.register(createReportRoutes({
    registry, db, favorites, audit, slots: createRunSlots(), tz: "UTC",
    preHandler: async (request) => { request.user = { id: "u1", role }; },
  }), { prefix: "/api/v1" });
  return { app, audit };
}

describe("report routes", () => {
  test("GET /reports groups and favorites flags", async () => {
    const { app } = await build();
    await app.inject({ method: "PUT", url: "/api/v1/reports/r.one/favorite" });
    const res = await app.inject({ method: "GET", url: "/api/v1/reports" });
    const body = res.json();
    expect(body.groups).toEqual([{ key: "g", title: "G", position: 1 }]);
    expect(body.reports.map((r) => r.key)).toEqual(["r.one"]);
    expect(body.reports[0]).toMatchObject({ favorite: true, available: true, featured: true });
    expect(body.reports[0].run).toBeUndefined();
  });

  test("PUT then DELETE /reports/:key/favorite", async () => {
    const { app } = await build();
    expect((await app.inject({ method: "PUT", url: "/api/v1/reports/r.one/favorite" })).json()).toEqual({ favorite: true });
    expect((await app.inject({ method: "DELETE", url: "/api/v1/reports/r.one/favorite" })).json()).toEqual({ favorite: false });
    const list = (await app.inject({ method: "GET", url: "/api/v1/reports" })).json();
    expect(list.reports[0].favorite).toBe(false);
  });

  test("favorite on a report the actor cannot see is 403, unknown is 404", async () => {
    const { app } = await build();
    expect((await app.inject({ method: "PUT", url: "/api/v1/reports/r.money/favorite" })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/v1/reports/nope/favorite" })).statusCode).toBe(404);
  });

  test("GET /reports/:key/run returns the result", async () => {
    const { app } = await build();
    const res = await app.inject({ method: "GET", url: "/api/v1/reports/r.one/run" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ rows: [{ a: 1 }], total: 1, truncated: false });
  });

  test("GET /reports/:key/run 400 names the bad param", async () => {
    const { app } = await build();
    const res = await app.inject({ method: "GET", url: "/api/v1/reports/r.one/run?n=0" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.field).toBe("n");
  });

  test("404 unknown key", async () => {
    const { app } = await build();
    expect((await app.inject({ method: "GET", url: "/api/v1/reports/nope/run" })).statusCode).toBe(404);
  });

  test("403 for an admin-only report as staff", async () => {
    const { app } = await build();
    const res = await app.inject({ method: "GET", url: "/api/v1/reports/r.money/run" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  test("409 REPORT_UNAVAILABLE", async () => {
    const { app } = await build({ reportOver: { requires: ["x"] } });
    const res = await app.inject({ method: "GET", url: "/api/v1/reports/r.one/run" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("REPORT_UNAVAILABLE");
  });

  test('503 body says "This report took too long. Try a shorter date range."', async () => {
    const { app } = await build({ reportOver: { run: async () => { throw Object.assign(new Error("x"), { code: "57014" }); } } });
    const res = await app.inject({ method: "GET", url: "/api/v1/reports/r.one/run" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: "REPORT_TIMEOUT", message: "This report took too long. Try a shorter date range." });
  });

  test("unexpected run errors are 500 without leaking detail", async () => {
    const { app } = await build({ reportOver: { run: async () => { throw new Error("secret detail"); } } });
    const res = await app.inject({ method: "GET", url: "/api/v1/reports/r.one/run?n=3" });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("secret detail");
  });

  test("export.csv streams, audits key and param names only", async () => {
    const { app, audit } = await build();
    const res = await app.inject({ method: "GET", url: "/api/v1/reports/r.one/export.csv?n=3" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.body).toBe("A\r\n1\r\n");
    expect(audit).toHaveBeenCalledTimes(1);
    const [, action, targetId, metadata] = audit.mock.calls[0];
    expect([action, targetId, metadata]).toEqual(["report.exported", "r.one", { params: ["n"] }]);
  });

  test("lookups return at most 20 and respect roles", async () => {
    const { app } = await build();
    const ok = await app.inject({ method: "GET", url: "/api/v1/reports/lookups/things?q=x" });
    expect(ok.json()).toHaveLength(20);
    expect((await app.inject({ method: "GET", url: "/api/v1/reports/lookups/secret?q=x" })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/v1/reports/lookups/none?q=x" })).statusCode).toBe(404);
  });
});
