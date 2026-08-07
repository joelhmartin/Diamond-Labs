import { test } from "vitest";
import assert from "node:assert/strict";

// env.js validates required vars at import time; postgres-js connects lazily, so
// providing throwaway values lets us import the route module without a DB
// (same pattern as rx-approve-response.test.js).
process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const { buildIncompleteTestOrderResponse } = await import("../admin-rx-mapping.routes.js");
const { buildSeazonaOrderPayloadMulti } = await import("../../services/rx/build-order-payload.js");

/**
 * POST /admin/rx-mapping/send-test is the only route that writes to Seazona
 * today — it creates a REAL order on the lab's real account. It used to gate on
 * `payload.items.length`, discarding the `ok` the builder hands it.
 */
test("a device that resolved only a $0 attribute is refused, not sent", () => {
  // attr:occlusal:posterior → 2293 resolves on its own; the appliance line does
  // not. items.length === 1, so the old items-length gate would have sent this.
  const built = buildSeazonaOrderPayloadMulti(
    { seazonaClientId: "test-client" },
    [{ deviceKey: "guard", label: "Nightguard", deviceOptions: { occlusalContact: "Posterior Contact" } }],
    { codeToId: { 2293: "id-2293" }, userId: "u1" }
  );

  assert.equal(built.payload.items.length, 1, "precondition: the old gate would have passed this");
  assert.equal(built.ok, false);

  const refusal = buildIncompleteTestOrderResponse(built);
  assert.ok(refusal, "an order that lost its device line must not be sent");
  assert.equal(refusal.error.status, 422);
  assert.match(refusal.error.message, /Nightguard/);
  assert.ok(refusal.error.details.length > 0, "the refusal must name something actionable");
});

test("a fully resolved order is not refused", () => {
  const built = buildSeazonaOrderPayloadMulti(
    { seazonaClientId: "test-client" },
    [{ deviceKey: "ddso", label: "DDSO", deviceOptions: { baseMaterial: "NYLON" } }],
    { codeToId: { 2608: "id-2608" }, userId: "u1" }
  );
  assert.equal(built.ok, true);
  assert.equal(buildIncompleteTestOrderResponse(built), null);
});

test("an unmapped selection is refused even when other lines resolved", () => {
  const built = buildSeazonaOrderPayloadMulti(
    { seazonaClientId: "test-client" },
    [{ deviceKey: "ddso", label: "DDSO", deviceOptions: { baseMaterial: "NYLON", modifications: ["Wrap Distal"] } }],
    { codeToId: { 2608: "id-2608" }, userId: "u1" }
  );
  assert.equal(built.ok, false);
  const refusal = buildIncompleteTestOrderResponse(built);
  assert.ok(refusal);
  assert.ok(refusal.meta.unmapped.includes("mod:wrap-distal"));
});

test("zero-line results are still refused, with details that name something", () => {
  const built = buildSeazonaOrderPayloadMulti(
    { seazonaClientId: "test-client" },
    [{ deviceKey: "ortho-expander", label: "Orthodontic Appliance", deviceOptions: { applianceType: "Twin Block" } }],
    { codeToId: {}, userId: "u1" }
  );
  const refusal = buildIncompleteTestOrderResponse(built);
  assert.ok(refusal);
  assert.ok(refusal.error.details.length > 0);
});
