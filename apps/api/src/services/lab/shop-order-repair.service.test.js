import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const created = [];
vi.mock("./lab-orders.service.js", () => ({
  createShopLabOrder: vi.fn(async (_tx, args) => { created.push(args); return { id: "lo", orderNumber: 1 }; }),
}));

const { repairMissingShopLabOrders, quoteFromStoredOrder } = await import("./shop-order-repair.service.js");
const { createShopLabOrder } = await import("./lab-orders.service.js");
const { fakeTx, fakeDb } = await import("../../test/fake-tx.js");

const now = new Date("2026-10-15T12:00:00Z");
const order = (id, minutesAgo = 60) => ({
  id, status: "paid", transactionId: `tx-${id}`, pricedForUserId: "doc1", createdAt: new Date(now.getTime() - minutesAgo * 60_000),
  subtotal: "100.00", tax: "8.25", shippingCost: "10.00", total: "118.25",
});
const item = (over = {}) => ({ variantId: "v1", name: "Splint", qty: 2, unitPrice: "50.00", lineTotal: "100.00", taxable: true, priceSource: "client", ...over });

// db.select() answers in call order: the missing-order query (anti-join is in SQL; the not-exists
// subquery is built but never awaited), then each order's tx reads (lock, existing lab order, items, variants).
function harness({ candidates, perOrder = [] }) {
  const tx = fakeTx({ selects: perOrder.flat() });
  const top = fakeTx({ selects: [candidates, []] });
  return { database: { select: top.select, transaction: (fn) => fn(tx) }, tx, top };
}
const perOrder = (existing, items, variants = [{ id: "v1", code: "2608" }]) => [[], existing, items, variants];

beforeEach(() => { created.length = 0; createShopLabOrder.mockClear(); });

describe("repairMissingShopLabOrders", () => {
  it("creates the missing lab order and invoice through createShopLabOrder with the rebuilt quote", async () => {
    const { database } = harness({ candidates: [order("o1")], perOrder: [perOrder([], [item()])] });
    const out = await repairMissingShopLabOrders({ now, database, log: { error: vi.fn() } });
    expect(out).toMatchObject({ checked: 1, missing: 1, repaired: 1, failed: 0 });
    expect(created).toEqual([{
      orderId: "o1", clientUserId: "doc1", transactionId: "tx-o1",
      quote: {
        lines: [{ variantId: "v1", code: "2608", name: "Splint", qty: 2, unitCents: 5000, lineCents: 10000, taxable: true, priceSource: "client" }],
        subtotalCents: 10000, taxCents: 825, shippingCents: 1000, totalCents: 11825,
      },
    }]);
  });

  it("skips orders that already have a lab order (the anti-join is in SQL, and re-checked under the row lock)", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./shop-order-repair.service.js", import.meta.url), "utf8");
    expect(src).toMatch(/not exists \(select 1 from \$\{labOrders\}/);
    const raced = harness({ candidates: [order("o2")], perOrder: [perOrder([{ id: "lo9" }], [])] });
    expect(await repairMissingShopLabOrders({ now, database: raced.database })).toMatchObject({ missing: 1, repaired: 0, alreadyHadLabOrder: 1 });
    expect(createShopLabOrder).not.toHaveBeenCalled();
  });

  it("reads a bounded batch and reports capped when more remain", async () => {
    const many = Array.from({ length: 201 }, (_, i) => order(`o${i}`));
    const { database } = harness({ candidates: many });
    const out = await repairMissingShopLabOrders({ now, dryRun: true, database });
    expect(out).toMatchObject({ missing: 200, capped: true });
  });

  it("asks only for orders older than the cutoff, so a checkout in flight is not raced", async () => {
    const { database, top } = harness({ candidates: [] });
    await repairMissingShopLabOrders({ now, olderThanMinutes: 15, database });
    const whereCall = top.log.filter((e) => e.op === "select");
    expect(whereCall).toHaveLength(1);
    const src = (await import("node:fs")).readFileSync(new URL("./shop-order-repair.service.js", import.meta.url), "utf8");
    expect(src).toMatch(/lt\(orders\.createdAt, new Date\(now\.getTime\(\) - olderThanMinutes \* 60_000\)\)/);
  });

  it("never backfills history: an order whose items have no variantId is skipped", async () => {
    const { database } = harness({ candidates: [order("old")], perOrder: [perOrder([], [item({ variantId: null })])] });
    expect(await repairMissingShopLabOrders({ now, database })).toMatchObject({ missing: 1, repaired: 0, skippedPreLabOrders: 1 });
    expect(createShopLabOrder).not.toHaveBeenCalled();
  });

  it("a dry run only counts", async () => {
    const { database } = harness({ candidates: [order("o1")] });
    expect(await repairMissingShopLabOrders({ now, dryRun: true, database })).toMatchObject({ dryRun: true, missing: 1, repaired: 0 });
    expect(createShopLabOrder).not.toHaveBeenCalled();
  });

  it("one failure is logged and counted, and the rest still run", async () => {
    const log = { error: vi.fn() };
    createShopLabOrder.mockRejectedValueOnce(new Error("boom"));
    const { database } = harness({
      candidates: [order("o1"), order("o2")], perOrder: [perOrder([], [item()]), perOrder([], [item()])],
    });
    const out = await repairMissingShopLabOrders({ now, database, log });
    expect(out).toMatchObject({ failed: 1, repaired: 1 });
    expect(log.error.mock.calls[0][0]).toMatch(/SHOP_ORDER_REPAIR_FAILED\] order=o1/);
  });
});

describe("quoteFromStoredOrder", () => {
  it("returns null for an order with no items or a pre-piece-2 item", () => {
    expect(quoteFromStoredOrder(order("o"), [])).toBeNull();
    expect(quoteFromStoredOrder(order("o"), [item({ variantId: null })])).toBeNull();
  });
});
