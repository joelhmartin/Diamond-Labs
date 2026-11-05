import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";

let currentUser = { id: "u1", role: "admin", approvalStatus: "approved", email: "x@y.z", name: "X" };

vi.mock("../../middleware/authenticate.js", () => ({
  // Stands in for a successful authentication; the real token path is covered elsewhere.
  authenticate: async (request) => { request.user = currentUser; },
}));
vi.mock("../../config/database.js", () => ({ db: {} }));
vi.mock("../../services/price-lists.service.js", async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    createPriceList: vi.fn(async () => { throw new real.PriceListError("NAME_TAKEN", "A price list with that name already exists."); }),
    listClients: vi.fn(async (id) => {
      if (id === "nope") throw new real.PriceListError("NOT_FOUND", "Price list not found.");
      return [{ id: "c1", name: "Ana", email: "a@x.test", accountNumber: "10", practice: "Ruiz Dental", position: 0, assignedAt: "2026-01-01" }];
    }),
    assignListToClients: vi.fn(async ({ clientUserIds }) => ({ ok: clientUserIds.length, failed: [] })),
  };
});

const adminPriceListsRoutes = (await import("../admin-price-lists.routes.js")).default;
const index = readFileSync(fileURLToPath(new URL("../../index.js", import.meta.url)), "utf8");

async function appAs(role) {
  currentUser = { ...currentUser, role };
  const app = Fastify();
  await app.register(adminPriceListsRoutes, { prefix: "/api/v1" });
  return app;
}

const ROUTES = [
  ["GET", "/api/v1/admin/price-lists"],
  ["POST", "/api/v1/admin/price-lists"],
  ["PATCH", "/api/v1/admin/price-lists/L1"],
  ["GET", "/api/v1/admin/price-lists/L1/items"],
  ["GET", "/api/v1/admin/price-lists/L1/clients"],
  ["PUT", "/api/v1/admin/price-lists/L1/items/v1"],
  ["DELETE", "/api/v1/admin/price-lists/L1/items/v1"],
  ["POST", "/api/v1/admin/price-lists/L1/items/bulk"],
  ["GET", "/api/v1/admin/clients/c1/price-lists"],
  ["PUT", "/api/v1/admin/clients/c1/price-lists"],
  ["POST", "/api/v1/admin/price-lists/assign"],
];

describe("price list routes", () => {
  for (const role of ["lab", "doctor"]) {
    for (const [method, url] of ROUTES) {
      it(`route is 403 for the ${role} role: ${method} ${url}`, async () => {
        const app = await appAs(role);
        expect((await app.inject({ method, url, payload: {} })).statusCode).toBe(403);
        await app.close();
      });
    }
  }

  it("lists the clients on a list, and 404s an unknown list", async () => {
    const app = await appAs("admin");
    const ok = await app.inject({ method: "GET", url: "/api/v1/admin/price-lists/L1/clients" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data[0]).toMatchObject({ id: "c1", name: "Ana", practice: "Ruiz Dental", position: 0 });
    expect((await app.inject({ method: "GET", url: "/api/v1/admin/price-lists/nope/clients" })).statusCode).toBe(404);
    await app.close();
  });

  it("duplicate name is 409 NAME_TAKEN", async () => {
    const app = await appAs("admin");
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/price-lists", payload: { name: "Standard" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("NAME_TAKEN");
    await app.close();
  });

  it("bulk assign validates its body and returns { ok, failed }", async () => {
    const app = await appAs("admin");
    const bad = await app.inject({ method: "POST", url: "/api/v1/admin/price-lists/assign", payload: { listId: "L1", clientUserIds: [], mode: "add" } });
    expect(bad.statusCode).toBe(422);
    const tooMany = Array.from({ length: 501 }, (_, i) => `c${i}`);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/price-lists/assign", payload: { listId: "L1", clientUserIds: tooMany, mode: "add" } })).statusCode).toBe(422);
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/price-lists/assign", payload: { listId: "L1", clientUserIds: ["c1", "c2"], mode: "replace" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ ok: 2, failed: [] });
    await app.close();
  });

  it("bulk items refuse more than 500 rows and negative cents at the edge", async () => {
    const app = await appAs("admin");
    const items = Array.from({ length: 501 }, (_, i) => ({ variantId: `v${i}`, priceCents: 1 }));
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/price-lists/L1/items/bulk", payload: { items } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/api/v1/admin/price-lists/L1/items/bulk", payload: { items: [{ variantId: "v1", priceCents: -5 }] } })).statusCode).toBe(422);
    await app.close();
  });

  it("the server registers the price list routes", () => {
    expect(index).toMatch(/await fastify\.register\(adminPriceListsRoutes, \{ prefix: "\/api\/v1" \}\)/);
  });
});
