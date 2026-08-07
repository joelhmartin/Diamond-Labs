import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

// Task 14: GET /admin/invoices used to call normalizeInvoice(inv) with no paid
// figure, so every invoice reported portalBalance === total and
// portalPaid === false regardless of what was actually paid through the
// portal. These tests prove the route now wires getGlobalPortalPaidMap's
// output into normalizeInvoice per invoice id.

const admin = { id: "admin-1", role: "admin", approvalStatus: "approved" };
vi.mock("../../middleware/authenticate.js", () => ({
  authenticate: async (request) => {
    request.user = admin;
  },
}));

// The route file also imports db/redis/audit at module scope (used by sibling
// routes in the same file, not by GET /admin/invoices) — stub them so the
// import doesn't need a real connection.
vi.mock("../../config/database.js", () => ({ db: {}, queryClient: {} }));
vi.mock("../../config/redis.js", () => ({ redis: {} }));
vi.mock("../../services/audit.service.js", () => ({
  log: async () => {},
  logSafe: () => {},
}));

let invoices = [];
let clients = [];
vi.mock("../../services/seazona.service.js", () => ({
  getAllInvoicesResult: async () => ({ reachable: true, invoices }),
  getInvoicesResult: async () => ({ reachable: true, invoices }),
  listClients: async () => clients,
  getInvoice: async () => null,
}));

let paidMap = {};
vi.mock("../../services/invoice-ledger.service.js", () => ({
  getGlobalPortalPaidMap: async () => paidMap,
  getPortalPaidMap: async () => ({}),
  getInvoicePortalPaid: async () => 0,
  getInvoicePortalPaidStrict: async () => 0,
}));

const invoiceRoutes = (await import("../invoice.routes.js")).default;

async function buildApp() {
  const app = Fastify();
  await app.register(invoiceRoutes, { prefix: "/api/v1" });
  return app;
}

describe("GET /admin/invoices balances", () => {
  it("reports a real portalPaidAmount/portalBalance for an invoice with ledger rows, and leaves an unpaid invoice untouched", async () => {
    invoices = [
      { id: "101", invoiceNumber: "INV-101", total: 500, fullName: "Dr. A", clientId: "c1", status: "Shipped" },
      { id: "202", invoiceNumber: "INV-202", total: 300, fullName: "Dr. B", clientId: "c2", status: "Hold" },
    ];
    clients = [{ id: "c1" }, { id: "c2" }];
    // Net of a $200 payment and a $50 refund on invoice 101 — proves the route
    // passes through whatever getGlobalPortalPaidMap nets out, negative rows
    // included, rather than re-deriving it from raw invoice data.
    paidMap = { "101": 150 };

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/invoices" });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const inv101 = body.data.invoices.find((i) => i.id === "101");
    expect(inv101.portalPaidAmount).toBe(150);
    expect(inv101.portalBalance).toBe(350);
    expect(inv101.portalPaid).toBe(false);

    // No ledger rows for 202 — must default to fully unpaid (previous behavior
    // for EVERY row, now only for rows genuinely lacking payments).
    const inv202 = body.data.invoices.find((i) => i.id === "202");
    expect(inv202.portalPaidAmount).toBe(0);
    expect(inv202.portalBalance).toBe(300);
    expect(inv202.portalPaid).toBe(false);

    await app.close();
  });

  it("marks an invoice fully paid when the ledger net covers the total", async () => {
    invoices = [{ id: "303", invoiceNumber: "INV-303", total: 80, fullName: "Dr. C", clientId: "c3", status: "Shipped" }];
    clients = [{ id: "c3" }];
    paidMap = { "303": 80 };

    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/invoices" });
    const body = res.json();

    const inv = body.data.invoices.find((i) => i.id === "303");
    expect(inv.portalPaidAmount).toBe(80);
    expect(inv.portalBalance).toBe(0);
    expect(inv.portalPaid).toBe(true);

    await app.close();
  });

  it("rejects non-admins", async () => {
    admin.role = "doctor";
    invoices = [];
    clients = [];
    paidMap = {};
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/invoices" });
    expect(res.statusCode).toBe(403);
    admin.role = "admin";
    await app.close();
  });
});
