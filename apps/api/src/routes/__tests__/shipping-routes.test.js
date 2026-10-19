import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";
import { fakeTx } from "../../test/fake-tx.js";

const mocks = vi.hoisted(() => ({
  buyForOrders: vi.fn(), voidShipment: vi.fn(), markShipmentShipped: vi.fn(), markAllLabelledShipped: vi.fn(), rateShipment: vi.fn(), syncLabTracking: vi.fn(),
  getLabel: vi.fn(), logSafe: vi.fn(), redis: { store: new Map() },
}));
vi.mock("../../services/lab/lab-shipping.service.js", () => ({
  buyForOrders: mocks.buyForOrders, voidShipment: mocks.voidShipment, markShipmentShipped: mocks.markShipmentShipped,
  markAllLabelledShipped: mocks.markAllLabelledShipped, rateShipment: mocks.rateShipment, syncLabTracking: mocks.syncLabTracking, markOrderShipped: vi.fn(),
}));
vi.mock("../../services/shipping/shipments.service.js", async (orig) => ({ ...(await orig()), getLabel: mocks.getLabel }));
vi.mock("../../services/audit.service.js", () => ({ logSafe: mocks.logSafe }));
vi.mock("../../config/redis.js", () => {
  const store = mocks.redis.store;
  return {
    redis: {
      get: async (k) => store.get(k) ?? null,
      set: async (k, v, ...rest) => { if (rest.includes("NX") && store.has(k)) return null; store.set(k, v); return "OK"; },
      del: async (k) => { store.delete(k); },
    },
  };
});

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const src = read("../shipping.routes.js");
const fn = (name) => src.slice(src.indexOf(`async function ${name}`), src.indexOf("\n}\n", src.indexOf(`async function ${name}`)) + 2);

const MARKERS = [
  'fastify.get("/lab/orders/:id/ship",', 'fastify.get("/lab/carriers",', 'fastify.post("/lab/shipments/rates",',
  'fastify.post("/lab/shipments",', 'fastify.get("/lab/shipments",', 'fastify.get("/lab/shipments/:id/label",',
  'fastify.post("/lab/shipments/:id/void",', 'fastify.post("/lab/shipments/:id/mark-shipped",', 'fastify.post("/lab/shipments/mark-all-shipped",',
];

beforeEach(() => { vi.clearAllMocks(); mocks.redis.store.clear(); });

// ── Source pins ─────────────────────────────────────────────────────────────
test("every shipping route is staff-only (admin or lab), using the lab routes' one STAFF guard", () => {
  for (const m of MARKERS) assert.match(handlerSource(src, m), /STAFF/, m);
  assert.match(src, /import \{ STAFF \} from "\.\/lab\.routes\.js"/);
});

test("run/audit are the shared route helpers, not copies", () => {
  assert.match(src, /from "\.\/lab-route-helpers\.js"/);
  assert.doesNotMatch(src, /function run\(|auditService/);
  assert.match(read("../lab.routes.js"), /from "\.\/lab-route-helpers\.js"/);
});

test("Buy requires an Idempotency-Key, runs inside withIdempotency scoped by order, and maps a held key to 409", () => {
  assert.match(handlerSource(src, 'fastify.post("/lab/shipments",'), /validate\(shipmentBuySchema\)/);
  const body = fn("buyHandler");
  assert.match(body, /request\.headers\["idempotency-key"\]/);
  assert.match(body, /withIdempotency\(\s*redis,\s*`ship-buy:\$\{scope\}:\$\{key\}`/);
  assert.match(body, /ChargeInProgressError/);
});

test("purchase, void, mark-shipped and label views are audited (ids only)", () => {
  for (const [marker, action] of [
    ['fastify.post("/lab/shipments/:id/void",', "shipment.voided"],
    ['fastify.post("/lab/shipments/:id/mark-shipped",', "shipment.marked_shipped"],
    ['fastify.post("/lab/shipments/mark-all-shipped",', "shipment.marked_all_shipped"],
  ]) assert.match(handlerSource(src, marker), new RegExp(action.replace(".", "\\.")), marker);
  assert.match(fn("labelHandler"), /audit\(request, "shipment\.label_viewed"/);
  assert.match(src, /"shipment"\)/);
});

test("the label is never cached, and its filename is the tracking number only", () => {
  assert.match(handlerSource(src, 'fastify.get("/lab/shipments/:id/label",'), /labelHandler/);
  const body = fn("labelHandler");
  assert.match(body, /"Cache-Control", "no-store"/);
  assert.match(body, /LABEL_CONTENT_TYPES\[label\.labelFormat\]/);
  assert.match(body, /filename="label-\$\{safe\}\.\$\{label\.labelFormat\}"/);
});

test("the shipping routes are registered under /api/v1, and the CSP lets the print page show a blob: label", () => {
  const index = read("../../index.js");
  assert.match(index, /await fastify\.register\(shippingRoutes, \{ prefix: "\/api\/v1" \}\);/);
  assert.match(index, /imgSrc: \["'self'", "data:", "blob:", "https:"\]/);
});

// ── Behaviour, with the service layer faked ─────────────────────────────────
async function mountRoutes() {
  const handlers = {};
  const reg = (method) => (path, _opts, handler) => { handlers[`${method} ${path}`] = handler; };
  const fastify = { get: reg("GET"), post: reg("POST") };
  const { default: shippingRoutes } = await import("../shipping.routes.js");
  await shippingRoutes(fastify);
  return handlers;
}

function makeReply() {
  const r = { statusCode: 200, headers: {}, payload: undefined };
  r.code = (c) => { r.statusCode = c; return r; };
  r.header = (k, v) => { r.headers[k] = v; return r; };
  r.send = (p) => { r.payload = p; return r; };
  return r;
}
const req = (extra = {}) => ({ user: { id: "u1" }, ip: "1.1.1.1", log: { info() {}, warn() {}, error() {} }, params: {}, headers: {}, body: {}, query: {}, ...extra });

test("shippingReply: a lab conflict behind LABEL_NOT_SAVED is told in one sentence", async () => {
  const { shippingReply } = await import("../shipping.routes.js");
  const { ShippingError } = await import("../../services/shipping/shipping-errors.js");
  const { LabOrderError } = await import("../../services/lab/lab-order-rules.js");
  const err = new ShippingError("LABEL_NOT_SAVED", "The label was bought but couldn't be saved, so it was voided. Try again.", {
    cause: new LabOrderError("CONFLICT", "Order #100245 was labelled by someone else."),
  });
  const r = shippingReply(err);
  assert.equal(r.status, 500);
  assert.equal(r.body.error.message, "Order #100245 was labelled by someone else. The label was bought but couldn't be saved, so it was voided. Try again.");
  assert.equal(shippingReply(new LabOrderError("STALE", "This order changed — reload.")).status, 409);
  assert.equal(shippingReply(new Error("boom")), null);
});

test("Buy without an Idempotency-Key is refused before any purchase", async () => {
  const h = await mountRoutes();
  const reply = makeReply();
  await h["POST /lab/shipments"](req({ body: { orderIds: ["o1"] } }), reply);
  assert.equal(reply.statusCode, 422);
  assert.equal(mocks.buyForOrders.mock.calls.length, 0);
});

test("Buy: audits the purchase once; a replay of the same key returns the result without buying or auditing again", async () => {
  const result = { shipmentId: "s1", carrier: "ups", chargeCents: 1234, orderIds: ["o1"] };
  mocks.buyForOrders.mockResolvedValue(result);
  const h = await mountRoutes();
  const request = req({ body: { orderIds: ["o2", "o1"] }, headers: { "idempotency-key": "k1" } });
  const first = makeReply();
  await h["POST /lab/shipments"](request, first);
  assert.equal(first.statusCode, 201);
  assert.deepEqual(first.payload.data, result);
  assert.equal(mocks.logSafe.mock.calls.length, 1);
  assert.deepEqual(mocks.logSafe.mock.calls[0][0], {
    userId: "u1", action: "shipment.purchased", targetType: "shipment", targetId: "s1",
    metadata: { carrier: "ups", orderIds: ["o1"], chargeCents: 1234 }, ipAddress: "1.1.1.1",
  });
  const second = makeReply();
  await h["POST /lab/shipments"](request, second);
  assert.equal(second.statusCode, 201);
  assert.equal(mocks.buyForOrders.mock.calls.length, 1);
  assert.equal(mocks.logSafe.mock.calls.length, 1);
  assert.ok([...mocks.redis.store.keys()].some((k) => k.includes("ship-buy:o1:k1")), "scoped by the lowest order id");
});

test("Buy: an uncertain purchase or an unsaved live label keeps the key locked, so a retry answers 409 and never buys again", async () => {
  const { ShippingError } = await import("../../services/shipping/shipping-errors.js");
  for (const [code, label] of [["PURCHASE_UNCERTAIN", 504], ["LABEL_NOT_SAVED", 500]]) {
    mocks.redis.store.clear();
    mocks.buyForOrders.mockReset();
    mocks.buyForOrders.mockRejectedValue(new ShippingError(code, "may exist", { gatewayOutcomePending: true }));
    const h = await mountRoutes();
    const request = req({ body: { orderIds: ["o1"] }, headers: { "idempotency-key": "k" } });
    const first = makeReply();
    await h["POST /lab/shipments"](request, first);
    assert.equal(first.statusCode, label, code);
    const retry = makeReply();
    await h["POST /lab/shipments"](request, retry);
    assert.equal(retry.statusCode, 409, code);
    assert.equal(retry.payload.error.code, "IN_PROGRESS");
    assert.equal(mocks.buyForOrders.mock.calls.length, 1, `${code}: not bought twice`);
  }
});

test("Buy: a definite refusal (not pending) releases the key for a corrected retry", async () => {
  const { ShippingError } = await import("../../services/shipping/shipping-errors.js");
  mocks.buyForOrders.mockRejectedValueOnce(new ShippingError("NOT_SHIPPABLE", "Order is not ready."));
  mocks.buyForOrders.mockResolvedValueOnce({ shipmentId: "s2", carrier: "ups", chargeCents: 1, orderIds: ["o1"] });
  const h = await mountRoutes();
  const request = req({ body: { orderIds: ["o1"] }, headers: { "idempotency-key": "k" } });
  const a = makeReply();
  await h["POST /lab/shipments"](request, a);
  assert.equal(a.statusCode, 422);
  const b = makeReply();
  await h["POST /lab/shipments"](request, b);
  assert.equal(b.statusCode, 201);
});

test("Void, mark-shipped and mark-all-shipped return the service result and audit ids only", async () => {
  mocks.voidShipment.mockResolvedValue({ shipmentId: "s1", orderIds: ["o1"], invoiceLineRemoved: true });
  mocks.markShipmentShipped.mockResolvedValue({ shipmentId: "s1", ordersShipped: [100245], alreadyShipped: false });
  mocks.markAllLabelledShipped.mockResolvedValue({ shipped: 2, failed: 1 });
  const h = await mountRoutes();
  const r1 = makeReply();
  await h["POST /lab/shipments/:id/void"](req({ params: { id: "s1" } }), r1);
  assert.deepEqual(r1.payload.data.orderIds, ["o1"]);
  const r2 = makeReply();
  await h["POST /lab/shipments/:id/mark-shipped"](req({ params: { id: "s1" } }), r2);
  assert.equal(r2.payload.data.alreadyShipped, false);
  const r3 = makeReply();
  await h["POST /lab/shipments/mark-all-shipped"](req(), r3);
  assert.deepEqual(r3.payload.data, { shipped: 2, failed: 1 });
  assert.deepEqual(mocks.logSafe.mock.calls.map((c) => [c[0].action, c[0].targetType, c[0].targetId]), [
    ["shipment.voided", "shipment", "s1"], ["shipment.marked_shipped", "shipment", "s1"], ["shipment.marked_all_shipped", "shipment", null],
  ]);
  const { ShippingError } = await import("../../services/shipping/shipping-errors.js");
  mocks.voidShipment.mockRejectedValue(new ShippingError("VOID_REFUSED", "UPS refused the void: picked up"));
  const r4 = makeReply();
  await h["POST /lab/shipments/:id/void"](req({ params: { id: "s1" } }), r4);
  assert.equal(r4.statusCode, 422);
});

test("Label: bytes, no-store, content type and tracking-only filename; the view is audited; a missing label is 404", async () => {
  mocks.getLabel.mockResolvedValue({ carrier: "ups", labelFormat: "zpl", trackingNumber: "1Z 99/../A", bytes: Buffer.from("^XA") });
  const h = await mountRoutes();
  const reply = makeReply();
  await h["GET /lab/shipments/:id/label"](req({ params: { id: "s1" } }), reply);
  assert.equal(reply.headers["Cache-Control"], "no-store");
  assert.equal(reply.headers["Content-Disposition"], 'attachment; filename="label-1Z99A.zpl"');
  assert.ok(Buffer.isBuffer(reply.payload));
  assert.equal(mocks.logSafe.mock.calls[0][0].action, "shipment.label_viewed");
  mocks.getLabel.mockResolvedValue(null);
  const none = makeReply();
  await h["GET /lab/shipments/:id/label"](req({ params: { id: "s1" } }), none);
  assert.equal(none.statusCode, 404);
});

// ── Ship context and list outputs (real queries over a fake transaction) ────
const shipmentRow = (over) => ({
  id: "s1", carrier: "ups", trackingNumber: "1Z1", status: "label_created", shippedAt: null, createdByUserId: "u1",
  shipTo: { name: "Dr A", company: "Smile Co", street1: "1 Main" }, ...over,
});

test("the list returns canVoid / canMarkShipped per row, only a name for the ship-to, and truncated at the cap", async () => {
  const { listShipmentsForLab } = await import("../../services/lab/lab-shipping-queries.js");
  const { SHIPMENT_LIST_LIMIT } = await import("../../services/shipping/shipments.service.js");
  const rows = [
    shipmentRow({ id: "a" }),
    shipmentRow({ id: "b", shippedAt: new Date() }),
    shipmentRow({ id: "c", status: "voided" }),
    shipmentRow({ id: "d", status: "in_transit", shippedAt: null }),
  ];
  const tx = fakeTx({ selects: [rows, [{ shipmentId: "a", labOrderId: "o1", orderNumber: 100245 }], [{ id: "u1", name: "Pat" }]] });
  const out = await listShipmentsForLab({}, tx);
  const by = Object.fromEntries(out.shipments.map((s) => [s.id, s]));
  assert.deepEqual([by.a.canVoid, by.a.canMarkShipped], [true, true]);
  assert.deepEqual([by.b.canVoid, by.b.canMarkShipped], [false, false]);
  assert.deepEqual([by.c.canVoid, by.c.canMarkShipped], [false, false]);
  assert.deepEqual([by.d.canVoid, by.d.canMarkShipped], [false, true]);
  assert.equal(by.a.shipToName, "Smile Co");
  assert.equal("shipTo" in by.a, false);
  assert.deepEqual(by.a.orders, [{ id: "o1", orderNumber: 100245 }]);
  assert.equal(by.a.createdByName, "Pat");
  assert.equal(out.truncated, false);

  const full = Array.from({ length: SHIPMENT_LIST_LIMIT }, (_, i) => shipmentRow({ id: `x${i}` }));
  const capped = await listShipmentsForLab({}, fakeTx({ selects: [full, [], [{ id: "u1", name: "Pat" }]] }));
  assert.equal(capped.truncated, true);
});

test("the ship context route returns the context, or 404 for an unknown order", async () => {
  const { shipContext } = await import("../../services/lab/lab-shipping-queries.js");
  const context = await shipContext("o1", fakeTx({
    selects: [[{ id: "o1", orderNumber: 100245, status: "ready_to_ship", source: "rx_case", sourceId: "r1", clientUserId: null, isRemake: false, shipmentId: null, version: 3 }]],
  }));
  assert.deepEqual(context.order, { id: "o1", orderNumber: 100245, status: "ready_to_ship", source: "rx_case", shipmentId: null });
  assert.deepEqual(context.siblings, []);
  assert.ok(Array.isArray(context.carriers));
  assert.equal(await shipContext("nope", fakeTx({ selects: [[]] })), null);
});

test("Refresh tracking is staff-only, runs the lab sync for one shipment, and is audited", () => {
  const body = handlerSource(src, 'fastify.post("/lab/shipments/:id/refresh-tracking",');
  assert.match(body, /STAFF/);
  assert.match(body, /syncLabTracking\(\{ shipmentIds: \[request\.params\.id\]/);
  assert.match(body, /shipment\.tracking_refreshed/);
});

test("shippingReply copies the error body instead of mutating the shared reply; labels are nosniff", () => {
  assert.doesNotMatch(src, /r\.body\.error\.message =/);
  assert.match(fn("labelHandler"), /X-Content-Type-Options", "nosniff"/);
});
