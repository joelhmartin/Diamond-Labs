import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { labErrorReply } from "../../services/lab/lab-errors.js";
import { LabOrderError } from "../../services/lab/lab-order-rules.js";
import { handlerSource } from "./_source.js";

test("lab errors map to the status a technician's screen can act on", () => {
  const illegal = labErrorReply(new LabOrderError("INVALID_TRANSITION", "nope", { allowed: ["in_production"] }));
  assert.equal(illegal.status, 422);
  assert.deepEqual(illegal.body.error.allowed, ["in_production"]);
  const stale = labErrorReply(new LabOrderError("STALE", "This order changed — reload."));
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "STALE");
  assert.equal(stale.body.error.message, "This order changed — reload.");
  assert.equal(labErrorReply(new LabOrderError("NOT_FOUND", "x")).status, 404);
  assert.equal(labErrorReply(new LabOrderError("ALREADY_RELEASED", "x")).status, 409);
  assert.deepEqual(labErrorReply(new LabOrderError("RELEASE_BLOCKED", "x", { blocking: ["mod:a"] })).body.error.blocking, ["mod:a"]);
  assert.equal(labErrorReply(new Error("boom")), null);
});

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const labSource = read("../lab.routes.js");
const rxSource = read("../admin-rx-cases.routes.js");

test("every /lab route is staff-only (admin or lab), built from the shared STAFF_ROLES", () => {
  for (const marker of [
    'fastify.get("/lab/orders",', 'fastify.get("/lab/orders/:id",', 'fastify.post("/lab/orders/:id/status",',
    'fastify.patch("/lab/orders/:id",', 'fastify.post("/lab/orders/:id/remake",', 'fastify.get("/lab/departments",',
    'fastify.get("/lab/staff",',
  ]) assert.match(handlerSource(labSource, marker), /STAFF/, marker);
  assert.match(labSource, /export const STAFF = \[authenticate, requireRole\(\.\.\.STAFF_ROLES\)\]/);
});

test("department management is admin-only", () => {
  assert.match(handlerSource(labSource, 'fastify.post("/admin/lab/departments",'), /requireAdmin/);
  assert.match(handlerSource(labSource, 'fastify.patch("/admin/lab/departments/:id",'), /requireAdmin/);
});

test("every lab mutation and the order detail read are audited", () => {
  for (const marker of [
    'fastify.get("/lab/orders/:id",', 'fastify.post("/lab/orders/:id/status",', 'fastify.patch("/lab/orders/:id",',
    'fastify.post("/lab/orders/:id/remake",', 'fastify.post("/admin/lab/departments",', 'fastify.patch("/admin/lab/departments/:id",',
  ]) assert.match(handlerSource(labSource, marker), /audit\(/, marker);
});

test("lab staff can read Rx cases and their files; editing stays admin-only", () => {
  for (const marker of ['fastify.get("/admin/rx-cases",', 'fastify.get("/admin/rx-cases/:id",', 'fastify.get("/admin/rx-cases/:id/files/:fileId",']) {
    assert.match(handlerSource(rxSource, marker), /requireRole\(\.\.\.STAFF_ROLES\)/, marker);
  }
  for (const marker of ['fastify.put("/admin/rx-cases/:id/lines/:lineId",', 'fastify.post("/admin/rx-cases/:id/lines",', 'fastify.delete("/admin/rx-cases/:id/lines/:lineId",', 'fastify.put("/admin/rx-cases/:id/status",', 'fastify.post("/admin/rx-cases/:id/re-resolve",']) {
    assert.match(handlerSource(rxSource, marker), /requireAdmin\]/, marker);
  }
});
