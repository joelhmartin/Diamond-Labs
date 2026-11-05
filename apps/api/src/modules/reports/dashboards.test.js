import { describe, test, expect, vi } from "vitest";
import { createRegistry } from "./registry.js";
import { createRunSlots, ReportError } from "./runner.js";
import { resolveDashboard, createDashboardCache, TILE_TIMEOUT_MS, CACHE_TTL_MS } from "./dashboards.js";

function setup() {
  const reg = createRegistry({ defaultRoles: ["admin", "staff"] });
  reg.defineGroup({ key: "g", title: "G" });
  const runs = { list: vi.fn(async (_tx, params) => ({ rows: [{ a: params.n ?? 0 }] })) };
  reg.defineReport({
    key: "r.list", group: "g", title: "List", params: [{ name: "n", type: "number" }],
    columns: [{ id: "a", label: "A", type: "int" }], chart: { type: "bar", x: "a", series: [{ field: "a", label: "A" }] },
    run: runs.list,
  });
  reg.defineReport({ key: "r.money", group: "g", title: "Money", roles: ["admin"], columns: [{ id: "a", label: "A", type: "money" }], run: async () => ({ rows: [] }) });
  reg.defineReport({ key: "r.boom", group: "g", title: "Boom", columns: [{ id: "a", label: "A", type: "int" }], run: async () => { throw new Error("relation secret_table does not exist"); } });
  reg.defineReport({ key: "r.slow", group: "g", title: "Slow", columns: [{ id: "a", label: "A", type: "int" }], run: async () => { throw Object.assign(new Error("canceling"), { code: "57014" }); } });
  const metricRun = vi.fn(async () => ({ value: 7, previous: 5, format: "int", href: "/x" }));
  reg.defineMetric({ key: "m.count", run: metricRun });
  reg.defineMetric({ key: "m.cash", roles: ["admin"], run: async () => ({ value: 100, format: "money" }) });
  reg.defineDashboard({
    key: "main", title: "Main",
    tiles: [
      { id: "count", kind: "stat", metric: "m.count", title: "Count" },
      { id: "list", kind: "chart", report: "r.list", span: 2, params: { n: "3" } },
      { id: "boom", kind: "table", report: "r.boom" },
      { id: "slow", kind: "table", report: "r.slow" },
      { id: "cash", kind: "stat", metric: "m.cash" },
      { id: "money", kind: "table", report: "r.money" },
      { id: "adminOnly", kind: "stat", metric: "m.count", roles: ["admin"] },
    ],
  });
  reg.defineDashboard({ key: "secret", title: "Secret", roles: ["admin"], tiles: [] });
  const executed = [];
  const txOpts = [];
  const tx = { execute: async (q) => { executed.push(JSON.stringify(q)); } };
  const db = { transaction: async (fn, opts) => { txOpts.push(opts); return fn(tx); } };
  let t = 1000;
  const clock = () => t;
  const cache = createDashboardCache({ clock });
  const go = (over = {}) => resolveDashboard({
    registry: reg, db, key: "main", query: {}, actor: { id: "u1", role: "staff" },
    slots: createRunSlots(), cache, tz: "UTC", ...over,
  });
  return { reg, runs, metricRun, go, executed, tx, db, txOpts, advance: (ms) => { t += ms; }, cache };
}

describe("resolveDashboard", () => {
  test("a metric tile's run gets ctx now, today and tz", async () => {
    const s = setup();
    const now = new Date("2026-11-01T04:30:00Z");
    await s.go({ now, tz: "America/Chicago" });
    expect(s.metricRun.mock.calls[0][3]).toMatchObject({ now, today: "2026-10-31", tz: "America/Chicago" });
  });

  test("a report tile's run gets ctx today", async () => {
    const s = setup();
    await s.go({ now: new Date("2026-11-01T04:30:00Z"), tz: "America/Chicago" });
    expect(s.runs.list.mock.calls[0][3]).toMatchObject({ today: "2026-10-31", tz: "America/Chicago" });
  });

  test("one failing tile does not fail the dashboard", async () => {
    const s = setup();
    const onTileError = vi.fn();
    const out = await s.go({ onTileError });
    const byId = Object.fromEntries(out.tiles.map((t) => [t.id, t]));
    expect(out).toMatchObject({ key: "main", title: "Main" });
    expect(byId.count).toMatchObject({ kind: "stat", ok: true, data: { value: 7, previous: 5, format: "int", href: "/x" } });
    expect(byId.list).toMatchObject({ kind: "chart", ok: true, span: 2, title: "List", data: { rows: [{ a: 3 }] } });
    expect(byId.list.chart).toEqual({ type: "bar", x: "a", series: [{ field: "a", label: "A" }] });
    expect(byId.list.columns).toHaveLength(1);
    expect(byId.boom).toMatchObject({ id: "boom", kind: "table", ok: false, error: { code: "INTERNAL_ERROR" } });
    expect(byId.boom.error.message).not.toMatch(/secret_table/);
    expect(byId.boom.data).toBeUndefined();
    expect(byId.slow).toMatchObject({ ok: false, error: { code: "TIMEOUT", message: "This report took too long. Try a shorter date range." } });
    expect(onTileError).toHaveBeenCalledTimes(1);
    expect(onTileError.mock.calls[0][0]).toBe("boom");
  });

  test("tile outside roles is omitted, not errored", async () => {
    const s = setup();
    const staff = await s.go();
    expect(staff.tiles.map((t) => t.id)).toEqual(["count", "list", "boom", "slow"]);
    const admin = await s.go({ actor: { id: "u2", role: "admin" } });
    expect(admin.tiles.map((t) => t.id)).toEqual(["count", "list", "boom", "slow", "cash", "money", "adminOnly"]);
  });

  test("tiles run with a 5000 ms statement timeout", async () => {
    const s = setup();
    await s.go();
    expect(TILE_TIMEOUT_MS).toBe(5000);
    expect(s.executed.length).toBeGreaterThan(0);
    for (const q of s.executed) expect(q).toContain("statement_timeout = 5000");
  });

  test("second call within 60 s is served from cache; after 60 s re-runs", async () => {
    const s = setup();
    expect(CACHE_TTL_MS).toBe(60000);
    await s.go();
    expect(s.runs.list).toHaveBeenCalledTimes(1);
    expect(s.metricRun).toHaveBeenCalledTimes(1);
    s.advance(59000);
    await s.go();
    expect(s.runs.list).toHaveBeenCalledTimes(1);
    expect(s.metricRun).toHaveBeenCalledTimes(1);
    s.advance(2000);
    await s.go();
    expect(s.runs.list).toHaveBeenCalledTimes(2);
    expect(s.metricRun).toHaveBeenCalledTimes(2);
  });

  test("cache is keyed by role and never holds failures", async () => {
    const s = setup();
    const fail = vi.fn(async () => { throw new ReportError("BUSY", "Reports are busy"); });
    s.reg.defineReport({ key: "r.flaky", group: "g", title: "Flaky", columns: [{ id: "a", label: "A", type: "int" }], run: fail });
    s.reg.defineDashboard({ key: "flaky", title: "F", tiles: [{ id: "f", kind: "table", report: "r.flaky" }, { id: "l", kind: "table", report: "r.list" }] });
    await s.go({ key: "flaky" });
    await s.go({ key: "flaky" });
    expect(fail).toHaveBeenCalledTimes(2);
    expect(s.runs.list).toHaveBeenCalledTimes(1);
    await s.go({ key: "flaky", actor: { id: "u3", role: "admin" } });
    expect(s.runs.list).toHaveBeenCalledTimes(2);
  });

  test("dashboard params pass through to tiles and change the cache key", async () => {
    const s = setup();
    s.reg.defineDashboard({ key: "p", title: "P", params: [{ name: "n", type: "number" }], tiles: [{ id: "l", kind: "table", report: "r.list" }] });
    const one = await s.go({ key: "p", query: { n: "4", junk: "x" } });
    expect(one.tiles[0].data.rows).toEqual([{ a: 4 }]);
    const two = await s.go({ key: "p", query: { n: "5" } });
    expect(two.tiles[0].data.rows).toEqual([{ a: 5 }]);
    expect(s.runs.list).toHaveBeenCalledTimes(2);
  });

  test("tile option resolves just that tile", async () => {
    const s = setup();
    const out = await s.go({ tile: "list" });
    expect(out.tiles.map((t) => t.id)).toEqual(["list"]);
    expect(s.metricRun).not.toHaveBeenCalled();
    await expect(s.go({ tile: "cash" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("unknown dashboard is NOT_FOUND; one outside roles is FORBIDDEN", async () => {
    const s = setup();
    await expect(s.go({ key: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(s.go({ key: "secret" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("a tile naming an unknown report or metric is an error tile", async () => {
    const s = setup();
    s.reg.defineDashboard({ key: "bad", title: "B", tiles: [{ id: "x", kind: "stat", metric: "m.nope" }] });
    const out = await s.go({ key: "bad" });
    expect(out.tiles[0]).toMatchObject({ id: "x", ok: false, error: { code: "NOT_FOUND" } });
  });
});

describe("review follow-ups", () => {
  test("a single-tile refresh bypasses the cache for that tile (a feed poll is never stale)", async () => {
    const s = setup();
    await s.go();
    expect(s.runs.list).toHaveBeenCalledTimes(1);
    const one = await s.go({ tile: "list" });
    expect(s.runs.list).toHaveBeenCalledTimes(2);
    expect(one.tiles[0]).toMatchObject({ id: "list", ok: true });
    // The fresh result refills the cache, so the next full load within 60 s reuses it.
    await s.go();
    expect(s.runs.list).toHaveBeenCalledTimes(2);
    expect(s.metricRun).toHaveBeenCalledTimes(1);
  });

  test("a tile never lengthens a report's own shorter time limit", async () => {
    const s = setup();
    s.reg.defineReport({ key: "r.quick", group: "g", title: "Quick", timeoutMs: 2000, columns: [{ id: "a", label: "A", type: "int" }], run: async () => ({ rows: [] }) });
    s.reg.defineReport({ key: "r.long", group: "g", title: "Long", timeoutMs: 20000, columns: [{ id: "a", label: "A", type: "int" }], run: async () => ({ rows: [] }) });
    s.reg.defineDashboard({ key: "t", title: "T", tiles: [{ id: "q", kind: "table", report: "r.quick" }] });
    s.reg.defineDashboard({ key: "l", title: "L", tiles: [{ id: "l", kind: "table", report: "r.long" }] });
    await s.go({ key: "t" });
    expect(s.executed.at(-1)).toContain("statement_timeout = 2000");
    await s.go({ key: "l" });
    expect(s.executed.at(-1)).toContain("statement_timeout = 5000");
  });

  test("a metric's run receives the read-only transaction, not the raw handle", async () => {
    const s = setup();
    await s.go({ tile: "count" });
    expect(s.metricRun.mock.calls[0][0]).toBe(s.tx);
    expect(s.metricRun.mock.calls[0][0]).not.toBe(s.db);
    expect(s.txOpts).toEqual([{ accessMode: "read only" }]);
    expect(s.executed).toEqual([expect.stringContaining("statement_timeout = 5000")]);
  });
});

describe("createDashboardCache", () => {
  test("evicts the oldest entry past its size cap", () => {
    const cache = createDashboardCache({ clock: () => 0, max: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toBe(3);
  });
});
