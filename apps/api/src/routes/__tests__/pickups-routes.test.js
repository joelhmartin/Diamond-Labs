import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { labRouteErrorReply } from "../lab-route-helpers.js";
import { PickupError } from "../../services/lab/pickup-rules.js";
import { handlerSource } from "./_source.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const source = read("../pickups.routes.js");
const index = read("../../index.js");

const DOCTOR = ['fastify.get("/pickups",', 'fastify.post("/pickups",', 'fastify.post("/pickups/:id/cancel",'];
const LAB = [
  'fastify.get("/lab/pickups",', 'fastify.post("/lab/pickups",', 'fastify.post("/lab/pickups/:id/schedule",',
  'fastify.post("/lab/pickups/:id/complete",', 'fastify.post("/lab/pickups/:id/cancel",',
];

test("doctor routes require approved doctor; lab routes require staff", () => {
  for (const marker of DOCTOR) {
    const body = handlerSource(source, marker);
    assert.match(body, /preHandler: \[authenticate, requireApprovedDoctor/, marker);
    assert.doesNotMatch(body, /STAFF/, marker);
  }
  for (const marker of LAB) assert.match(handlerSource(source, marker), /preHandler: \[\.\.\.STAFF/, marker);
  assert.match(source, /import \{ STAFF \} from "\.\/lab\.routes\.js"/);
});

test("every pickup mutation is audited, by id only", () => {
  for (const marker of [...DOCTOR.slice(1), ...LAB.slice(1)]) {
    const body = handlerSource(source, marker);
    assert.match(body, /audit\(request, "pickup\.[a-z_]+", [a-z.]+id, /, marker);
    assert.doesNotMatch(body, /notes|reason:/, `${marker} audit carries no free text`);
  }
});

test("every mutation validates its body with the shared schema", () => {
  for (const marker of [...DOCTOR.slice(1), ...LAB.slice(1)]) assert.match(handlerSource(source, marker), /validate\(/, marker);
  for (const marker of [DOCTOR[0], LAB[0]]) assert.match(handlerSource(source, marker), /validateQuery\(/, marker);
});

test("pickup errors map to a reply: another practice's pickup is 404, a stale version 409", () => {
  assert.equal(labRouteErrorReply(new PickupError("NOT_FOUND", "Pickup not found.")).status, 404);
  const stale = labRouteErrorReply(new PickupError("STALE", "This pickup changed — reload."));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.message, "This pickup changed — reload.");
  assert.equal(labRouteErrorReply(new PickupError("REASON_REQUIRED", "x")).status, 422);
  assert.equal(labRouteErrorReply(new PickupError("INVALID_TRANSITION", "x")).status, 422);
});

test("the deliveries route sheet is staff-only, validates its range and reads stops (no audit)", () => {
  const body = handlerSource(source, 'fastify.get("/lab/deliveries",');
  assert.match(body, /preHandler: \[\.\.\.STAFF, validateQuery\(labDeliveriesQuerySchema\)\]/);
  assert.match(body, /deliveryRange\(request\.query/);
  assert.match(body, /listStops\(db, range\)/);
  assert.doesNotMatch(body, /audit\(/);
});

test("GET /lab/deliveries answers an impossible calendar date with 422 before any query runs", async () => {
  const { validateQuery } = await import("../../middleware/validate.js");
  const { labDeliveriesQuerySchema } = await import("@my-app/shared");
  const check = validateQuery(labDeliveriesQuerySchema);
  for (const query of [{ from: "2026-13-01" }, { to: "2026-02-30" }]) {
    let status = null;
    const reply = { code(c) { status = c; return this; }, send() { return this; } };
    await check({ query }, reply);
    assert.equal(status, 422, JSON.stringify(query));
  }
  let status = null;
  const request = { query: { from: "2026-11-05", to: "2027-01-06" } };
  await check(request, { code(c) { status = c; return this; }, send() { return this; } });
  assert.equal(status, null, "a real date passes to the handler (the span rule is deliveryRange's)");
});

test("the routes are registered under /api/v1", () => {
  assert.match(index, /routes\/pickups\.routes\.js.*\{ prefix: "\/api\/v1" \}/);
});

test("the staff client picker is staff-only and read-only (no audit)", () => {
  const body = handlerSource(source, 'fastify.get("/lab/pickup-clients",');
  assert.match(body, /preHandler: STAFF/);
  assert.match(body, /searchPickupClients\(/);
  assert.doesNotMatch(body, /audit\(/);
});

test("the single-pickup read is staff-only and has no audit", () => {
  const body = handlerSource(source, 'fastify.get("/lab/pickups/:id",');
  assert.match(body, /preHandler: STAFF/);
  assert.match(body, /getPickup\(/);
  assert.doesNotMatch(body, /audit\(/);
});
