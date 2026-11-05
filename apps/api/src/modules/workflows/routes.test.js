import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";

const svc = vi.hoisted(() => ({
  listWorkflows: vi.fn(), saveWorkflow: vi.fn(), setActive: vi.fn(), assignmentsFor: vi.fn(), setAssignments: vi.fn(), planFor: vi.fn(),
}));
const cal = vi.hoisted(() => ({ getCalendar: vi.fn() }));
vi.mock("./service.js", () => ({ createWorkflowsService: () => svc }));
vi.mock("../business-calendar/service.js", () => cal);

const { workflowRoutes } = await import("./routes.js");

const DB = { marker: "db" };
const MILESTONES = [{ value: "m0", label: "Start" }, { value: "m1", label: "End" }];
const ADMIN = { "x-role": "admin" };
const VIEWER = { "x-role": "viewer" };

async function build(options = {}) {
  const app = Fastify();
  const readGuard = async (request, reply) => {
    if (request.headers["x-role"] === "none") return reply.code(403).send({ error: { code: "FORBIDDEN" } });
    request.user = { id: "u1" };
  };
  const writeGuard = async (request, reply) => {
    if (request.headers["x-role"] !== "admin") return reply.code(403).send({ error: { code: "FORBIDDEN" } });
    request.user = { id: "u1" };
  };
  await app.register(async (f) => workflowRoutes(f, { db: DB, readGuard, writeGuard, milestones: MILESTONES, ...options }));
  return app;
}

const body = (over = {}) => ({
  key: "std", name: "Standard", totalDays: 4, rushWorkflowKey: null, isDefault: false, active: true,
  stages: [{ key: "a", label: "A", milestone: "m0", dayOffset: 0 }, { key: "b", label: "B", milestone: "m1", dayOffset: 4 }],
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); });

test("rejects a stage milestone the host did not declare", async () => {
  const app = await build();
  const res = await app.inject({
    method: "POST", url: "/scheduling/workflows", headers: ADMIN,
    payload: body({ stages: [{ key: "a", label: "A", milestone: "bogus", dayOffset: 4 }] }),
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, "INVALID");
  assert.equal(svc.saveWorkflow.mock.calls.length, 0);
});

test("a read-only caller cannot write; the list returns workflows and milestones", async () => {
  const app = await build();
  const denied = await app.inject({ method: "POST", url: "/scheduling/workflows", headers: VIEWER, payload: body() });
  assert.equal(denied.statusCode, 403);
  svc.listWorkflows.mockResolvedValueOnce([{ key: "std" }]);
  const ok = await app.inject({ method: "GET", url: "/scheduling/workflows", headers: VIEWER });
  assert.deepEqual(ok.json().data, { workflows: [{ key: "std" }], milestones: MILESTONES });
  assert.deepEqual(svc.listWorkflows.mock.calls[0][0], { includeInactive: true });
});

test("preview returns a plan using the stored calendar", async () => {
  const app = await build({ calendarKey: "main" });
  const calendar = { key: "main" };
  cal.getCalendar.mockResolvedValueOnce(calendar);
  svc.planFor.mockResolvedValueOnce({ workflowKey: "std", dueAt: "2026-11-06", stages: [] });
  const res = await app.inject({
    method: "POST", url: "/scheduling/workflows/preview", headers: VIEWER,
    payload: { workflowKey: "std", startAt: "2026-11-02T12:00:00Z", rush: true, dueAt: "2026-11-20" },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().data.dueAt, "2026-11-06");
  assert.deepEqual(cal.getCalendar.mock.calls[0], [DB, "main"]);
  const [input, usedCalendar] = svc.planFor.mock.calls[0];
  assert.equal(usedCalendar, calendar);
  assert.equal(input.workflowKey, "std");
  assert.equal(input.rush, true);
  assert.equal(input.dueAt, "2026-11-20");
  assert.equal(input.startAt.toISOString(), "2026-11-02T12:00:00.000Z");
});

test("writes are audited with keys only", async () => {
  const onAudit = vi.fn();
  const app = await build({ onAudit });
  svc.saveWorkflow.mockResolvedValue({ id: "w1", key: "std", totalDays: 4, name: "Standard", stages: [] });
  const created = await app.inject({ method: "POST", url: "/scheduling/workflows", headers: ADMIN, payload: body() });
  assert.equal(created.statusCode, 201);
  await app.inject({ method: "PUT", url: "/scheduling/workflows/w1", headers: ADMIN, payload: body() });
  assert.deepEqual(svc.saveWorkflow.mock.calls[1][1], { id: "w1" });
  svc.setActive.mockResolvedValueOnce(2);
  await app.inject({ method: "POST", url: "/scheduling/workflows/active", headers: ADMIN, payload: { ids: ["w1", "w2"], active: false } });
  svc.setAssignments.mockResolvedValueOnce(1);
  await app.inject({ method: "PUT", url: "/scheduling/workflows/assignments", headers: ADMIN, payload: { subjectType: "t", subjectIds: ["s1"], workflowKey: "std" } });

  assert.deepEqual(onAudit.mock.calls.map((c) => c[1]), ["workflow.create", "workflow.update", "workflow.active", "workflow.assign"]);
  assert.deepEqual(onAudit.mock.calls[0][3], { key: "std", totalDays: 4 });
  const flat = JSON.stringify(onAudit.mock.calls.map((c) => c[3]));
  assert.equal(flat.includes("Standard"), false, "no names or labels in audit metadata");
});

test("maps a WorkflowError to the repo error shape and lists assignments", async () => {
  const app = await build();
  const { WorkflowError } = await import("./errors.js");
  svc.saveWorkflow.mockRejectedValueOnce(new WorkflowError("CONFLICT", "A workflow with the key \"std\" already exists."));
  const res = await app.inject({ method: "POST", url: "/scheduling/workflows", headers: ADMIN, payload: body() });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: { code: "CONFLICT", status: 409, message: "A workflow with the key \"std\" already exists." } });

  svc.assignmentsFor.mockResolvedValueOnce(new Map([["s1", "std"]]));
  const list = await app.inject({ method: "GET", url: "/scheduling/workflows/assignments?subjectType=t", headers: VIEWER });
  assert.deepEqual(list.json().data, { assignments: [{ subjectId: "s1", workflowKey: "std" }] });
  assert.equal(svc.assignmentsFor.mock.calls[0][0], "t");
});
