import { test, vi, beforeEach } from "vitest";
import assert from "node:assert/strict";
import Fastify from "fastify";

const mocks = vi.hoisted(() => ({
  getCalendar: vi.fn(), saveCalendar: vi.fn(), listHolidays: vi.fn(), addHoliday: vi.fn(), removeHolidays: vi.fn(),
}));
vi.mock("./service.js", () => mocks);

const { calendarRoutes } = await import("./routes.js");
const { toCalendar } = await import("./rules.js");

const DB = { marker: "db" };
const calendar = (over = {}) => ({
  ...toCalendar({ key: "default", timezone: "UTC", leadDays: 0, closedWeekdays: [0, 6], capacityBasis: "orders", capacityByWeekday: { 1: 10 } }, []),
  holidayLabels: new Map(),
  ...over,
});

async function build(options = {}) {
  const app = Fastify();
  const guardCalls = [];
  const readGuard = async (request, reply) => {
    guardCalls.push("read");
    if (request.headers["x-role"] === "none") return reply.code(403).send({ error: { code: "FORBIDDEN" } });
    request.user = { id: "u1" };
  };
  const writeGuard = async (request, reply) => {
    guardCalls.push("write");
    if (request.headers["x-role"] !== "admin") return reply.code(403).send({ error: { code: "FORBIDDEN" } });
    request.user = { id: "u1" };
  };
  await app.register(async (f) => calendarRoutes(f, { db: DB, readGuard, writeGuard, ...options }));
  return { app, guardCalls };
}

beforeEach(() => { vi.clearAllMocks(); mocks.listHolidays.mockResolvedValue([]); });

const ADMIN = { "x-role": "admin" };
const VIEWER = { "x-role": "viewer" };

test("PUT is refused for a read-only caller (writeGuard runs)", async () => {
  const { app, guardCalls } = await build();
  const res = await app.inject({
    method: "PUT", url: "/scheduling/calendar", headers: VIEWER,
    payload: { timezone: "UTC", leadDays: 1, closedWeekdays: [0], capacityBasis: "none", capacityByWeekday: {} },
  });
  assert.equal(res.statusCode, 403);
  assert.deepEqual(guardCalls, ["write"]);
  assert.equal(mocks.saveCalendar.mock.calls.length, 0);
});

test("PUT saves for a writer, audits, and maps a CalendarError to the repo error shape", async () => {
  const onAudit = vi.fn();
  const { app } = await build({ onAudit });
  mocks.saveCalendar.mockResolvedValueOnce(calendar());
  const payload = { timezone: "UTC", leadDays: 1, closedWeekdays: [0, 6], capacityBasis: "orders", capacityByWeekday: { 1: 10 } };
  const ok = await app.inject({ method: "PUT", url: "/scheduling/calendar", headers: ADMIN, payload });
  assert.equal(ok.statusCode, 200);
  assert.equal(mocks.saveCalendar.mock.calls[0][0], DB);
  assert.deepEqual(mocks.saveCalendar.mock.calls[0][3], { byUserId: "u1" });
  assert.equal(onAudit.mock.calls[0][1], "calendar.update");

  const { CalendarError } = await import("./errors.js");
  mocks.saveCalendar.mockRejectedValueOnce(new CalendarError("INVALID", "At least one weekday must stay open."));
  const bad = await app.inject({ method: "PUT", url: "/scheduling/calendar", headers: ADMIN, payload });
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json(), { error: { code: "INVALID", status: 400, message: "At least one weekday must stay open." } });
});

test("duplicate holiday maps to 409", async () => {
  const { app } = await build();
  const { CalendarError } = await import("./errors.js");
  mocks.addHoliday.mockRejectedValueOnce(new CalendarError("CONFLICT", "2026-12-25 is already a holiday."));
  const res = await app.inject({ method: "POST", url: "/scheduling/calendar/holidays", headers: ADMIN, payload: { date: "2026-12-25", label: "Christmas" } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error.code, "CONFLICT");
});

test("GET days returns calendarDays with injected loadCounts", async () => {
  const loadCounts = vi.fn(async () => new Map([["2026-11-02", 9]]));
  const { app } = await build({ loadCounts });
  mocks.getCalendar.mockResolvedValueOnce(calendar());
  const res = await app.inject({ method: "GET", url: "/scheduling/calendar/days?from=2026-11-01&to=2026-11-03", headers: VIEWER });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(loadCounts.mock.calls[0], [DB, { from: "2026-11-01", to: "2026-11-03", basis: "orders" }]);
  const { days } = res.json().data;
  assert.equal(days.length, 3);
  assert.equal(days[1].count, 9);
  assert.equal(days[1].level, "near");
  assert.equal(days[0].open, false);
});

test("GET days without loadCounts reports zero counts, and a too-long span is 422", async () => {
  const { app } = await build();
  mocks.getCalendar.mockResolvedValueOnce(calendar());
  const ok = await app.inject({ method: "GET", url: "/scheduling/calendar/days?from=2026-11-01&to=2026-11-02", headers: VIEWER });
  assert.deepEqual(ok.json().data.days.map((d) => d.count), [0, 0]);
  const long = await app.inject({ method: "GET", url: "/scheduling/calendar/days?from=2026-11-01&to=2027-02-01", headers: VIEWER });
  assert.equal(long.statusCode, 422);
});

test("bulk holiday delete reports the count and audits ids only", async () => {
  const onAudit = vi.fn();
  const { app } = await build({ onAudit });
  mocks.removeHolidays.mockResolvedValueOnce(2);
  const res = await app.inject({ method: "POST", url: "/scheduling/calendar/holidays/delete", headers: ADMIN, payload: { ids: ["a", "b"] } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().data, { count: 2 });
  assert.deepEqual(onAudit.mock.calls[0].slice(1), ["calendar.holiday.remove", "default", { ids: ["a", "b"], count: 2 }]);
});

test("DELETE of an unknown holiday is 404 and not audited", async () => {
  const onAudit = vi.fn();
  const { app } = await build({ onAudit });
  mocks.removeHolidays.mockResolvedValueOnce(0);
  const res = await app.inject({ method: "DELETE", url: "/scheduling/calendar/holidays/nope", headers: ADMIN });
  assert.equal(res.statusCode, 404);
  assert.equal(onAudit.mock.calls.length, 0);
});

test("the factory refuses to register without guards", async () => {
  const app = Fastify();
  await assert.rejects(calendarRoutes(app, { db: DB }), /Guard/);
});

test("GET /days: counts in a unit other than the calendar's capacity basis get no load level", async () => {
  mocks.getCalendar.mockResolvedValue(calendar({ capacityBasis: "orders", capacityByWeekday: { 1: 10 } }));
  const loadCounts = vi.fn(async () => new Map([["2026-11-02", 50]]));
  const { app } = await build({ loadCounts });
  const same = await app.inject({ method: "GET", url: "/scheduling/calendar/days?from=2026-11-02&to=2026-11-02&basis=orders", headers: VIEWER });
  assert.equal(same.json().data.days[0].level, "over");
  const other = await app.inject({ method: "GET", url: "/scheduling/calendar/days?from=2026-11-02&to=2026-11-02&basis=units", headers: VIEWER });
  assert.equal(other.json().data.days[0].level, "none");
  assert.equal(other.json().data.days[0].capacity, null);
  assert.equal(other.json().data.days[0].count, 50);
});
