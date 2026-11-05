import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

let currentUser = { id: "u1", role: "admin", approvalStatus: "approved", email: "x@y.z", name: "X" };

vi.mock("../middleware/authenticate.js", () => ({
  // Stands in for a successful authentication; the real token path is covered elsewhere.
  authenticate: async (request) => { request.user = currentUser; },
}));
vi.mock("../config/database.js", () => ({ db: {} }));

const { ADMIN } = await import("../routes/admin-invoice.routes.js");
const { createExportsRoutes } = await import("../modules/exports/index.js");
const { appExports } = await import("./index.js");

async function appAs(role) {
  currentUser = { ...currentUser, role };
  const app = Fastify();
  await app.register(createExportsRoutes({ registry: appExports, db: {}, preHandler: ADMIN, audit: () => {} }), { prefix: "/api/v1/admin" });
  return app;
}

const URLS = [
  "/api/v1/admin/exports",
  "/api/v1/admin/exports/invoices/preview?dateField=issued&from=2026-01-01&to=2026-01-31",
  "/api/v1/admin/exports/invoices/download.csv?dateField=issued&from=2026-01-01&to=2026-01-31",
];

describe("export routes are admin-only", () => {
  for (const role of ["lab", "doctor", "user"]) {
    for (const url of URLS) {
      it(`${url.split("?")[0]} is 403 for ${role}`, async () => {
        const app = await appAs(role);
        expect((await app.inject({ url })).statusCode).toBe(403);
        await app.close();
      });
    }
  }

  it("the registry listing is served to an admin", async () => {
    const app = await appAs("admin");
    const res = await app.inject({ url: "/api/v1/admin/exports" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data[0].key).toBe("invoices");
    await app.close();
  });
});
