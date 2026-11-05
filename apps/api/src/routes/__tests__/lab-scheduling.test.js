import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

// The signed-in user's role comes from a test header; the real role guards run.
vi.mock("../../middleware/authenticate.js", () => ({
  authenticate: async (request, reply) => {
    const role = request.headers["x-role"];
    if (!role) return reply.code(401).send({ error: { code: "UNAUTHORIZED" } });
    request.user = { id: `user-${role}`, role };
  },
}));
vi.mock("../../config/database.js", () => ({ db: { marker: "db" } }));
const audits = vi.hoisted(() => []);
vi.mock("../../services/audit.service.js", () => ({ logSafe: async (e) => { audits.push(e); } }));
const svc = vi.hoisted(() => ({ changeWorkflow: vi.fn() }));
vi.mock("../../services/lab/lab-orders.service.js", () => svc);
const sched = vi.hoisted(() => ({ defaultDueAt: vi.fn() }));
vi.mock("../../services/lab/lab-scheduling.js", async (importOriginal) => ({ ...(await importOriginal()), defaultDueAt: sched.defaultDueAt }));

const { LabOrderError } = await import("../../services/lab/lab-order-rules.js");
const { default: labSchedulingRoutes } = await import("../lab-scheduling.routes.js");

async function app() {
  const f = Fastify();
  await f.register(labSchedulingRoutes, { prefix: "/api/v1" });
  return f;
}

beforeEach(() => { vi.clearAllMocks(); audits.length = 0; });

test("POST /lab/orders/:id/workflow requires expectedVersion and staff", async () => {
  const f = await app();
  const url = "/api/v1/lab/orders/lo-1/workflow";
  const payload = { workflowKey: "7d-1-device", keepDueDate: false, expectedVersion: 3 };

  assert.equal((await f.inject({ method: "POST", url, payload })).statusCode, 401);
  assert.equal((await f.inject({ method: "POST", url, payload, headers: { "x-role": "doctor" } })).statusCode, 403);
  const missing = await f.inject({ method: "POST", url, payload: { workflowKey: "7d-1-device" }, headers: { "x-role": "lab" } });
  assert.equal(missing.statusCode, 422);
  assert.equal(svc.changeWorkflow.mock.calls.length, 0);

  svc.changeWorkflow.mockResolvedValueOnce({ order: { id: "lo-1", version: 4, dueDate: "2026-11-11" }, changed: true });
  const ok = await f.inject({ method: "POST", url, payload, headers: { "x-role": "lab" } });
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().data, { id: "lo-1", version: 4, dueDate: "2026-11-11" });
  assert.deepEqual(svc.changeWorkflow.mock.calls[0], ["lo-1", { ...payload, byUserId: "user-lab" }]);
  const [entry] = audits;
  assert.equal(entry.action, "lab_order.workflow_changed");
  assert.equal(entry.targetType, "lab_order");
  assert.deepEqual(entry.metadata, { workflowKey: "7d-1-device", keepDueDate: false, dueDate: "2026-11-11", version: 4 });
  await f.close();
});

test("a stale or terminal workflow change replies with the lab error; an unknown workflow is a 404", async () => {
  const f = await app();
  const send = () => f.inject({ method: "POST", url: "/api/v1/lab/orders/lo-1/workflow", payload: { workflowKey: "x", expectedVersion: 3 }, headers: { "x-role": "admin" } });
  svc.changeWorkflow.mockRejectedValueOnce(new LabOrderError("STALE", "This order changed — reload."));
  assert.equal((await send()).statusCode, 409);
  const { WorkflowError } = await import("../../modules/workflows/index.js");
  svc.changeWorkflow.mockRejectedValueOnce(new WorkflowError("NOT_FOUND", "Unknown workflow."));
  assert.equal((await send()).statusCode, 404);
  assert.equal(audits.length, 0);
  await f.close();
});

test("GET /lab/schedule/preview is a staff dry run of defaultDueAt", async () => {
  const f = await app();
  sched.defaultDueAt.mockResolvedValueOnce({ dueDate: "2026-11-16", plan: { workflowKey: "10d-printed" } });
  const res = await f.inject({
    method: "GET", url: "/api/v1/lab/schedule/preview?variantIds=v1,v2&rush=true&requestedDueDate=2026-11-20", headers: { "x-role": "lab" },
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data, { dueDate: "2026-11-16", plan: { workflowKey: "10d-printed" } });
  const [exec, args] = sched.defaultDueAt.mock.calls[0];
  assert.deepEqual(exec, { marker: "db" });
  assert.deepEqual(args, { variantIds: ["v1", "v2"], rush: true, workflowKey: null, requestedDueDate: "2026-11-20" });
  assert.equal((await f.inject({ method: "GET", url: "/api/v1/lab/schedule/preview", headers: { "x-role": "doctor" } })).statusCode, 403);
  assert.equal((await f.inject({ method: "GET", url: "/api/v1/lab/schedule/preview?requestedDueDate=soon", headers: { "x-role": "lab" } })).statusCode, 422);
  await f.close();
});

test("the calendar and workflow factories are mounted: staff read, admin write", async () => {
  const f = await app();
  await f.ready();
  for (const [method, url] of [
    ["GET", "/api/v1/scheduling/calendar"], ["POST", "/api/v1/scheduling/calendar/holidays"], ["GET", "/api/v1/scheduling/calendar/days"],
    ["GET", "/api/v1/scheduling/workflows"], ["PUT", "/api/v1/scheduling/workflows/assignments"], ["POST", "/api/v1/scheduling/workflows/preview"],
  ]) assert.ok(f.hasRoute({ method, url }), `${method} ${url}`);
  // A lab tech may not change the calendar; the admin guard refuses before any db work.
  const denied = await f.inject({ method: "PUT", url: "/api/v1/scheduling/calendar", payload: {}, headers: { "x-role": "lab" } });
  assert.equal(denied.statusCode, 403);
  await f.close();

  const source = readFileSync(fileURLToPath(new URL("../lab-scheduling.routes.js", import.meta.url)), "utf8");
  assert.match(source, /readGuard: STAFF/);
  assert.match(source, /writeGuard: ADMIN/);
  assert.match(source, /milestones: LAB_MILESTONES/);
  assert.match(source, /audit\(request, action, targetId, metadata, "calendar"\)/);
  assert.match(source, /audit\(request, action, targetId, metadata, "workflow"\)/);
  assert.match(handlerSource(source, 'fastify.post("/lab/orders/:id/workflow",'), /STAFF/);
  const index = readFileSync(fileURLToPath(new URL("../../index.js", import.meta.url)), "utf8");
  assert.match(index, /await fastify\.register\(labSchedulingRoutes, \{ prefix: "\/api\/v1" \}\);/);
});
