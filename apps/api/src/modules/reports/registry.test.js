import { describe, test, expect } from "vitest";
import { createRegistry } from "./registry.js";

const make = () => {
  const reg = createRegistry({ defaultRoles: ["admin", "staff"] });
  reg.defineGroup({ key: "sales", title: "Sales", position: 1 });
  return reg;
};
const base = (over = {}) => ({
  key: "sales.daily",
  group: "sales",
  title: "Daily Sales",
  params: [{ name: "range", type: "dateRange", default: "last30" }],
  columns: [{ id: "day", label: "Day", type: "date" }],
  run: async () => ({ rows: [] }),
  ...over,
});

describe("defineReport validation", () => {
  test("defineReport throws on duplicate key and on timeoutMs 30001", () => {
    const reg = make();
    reg.defineReport(base());
    expect(() => reg.defineReport(base())).toThrow(/already/);
    expect(() => reg.defineReport(base({ key: "sales.b", timeoutMs: 30001 }))).toThrow(/timeoutMs/);
    expect(() => reg.defineReport(base({ key: "sales.c", timeoutMs: 30000 }))).not.toThrow();
  });

  test("throws on unknown group, param type, column type, chart type, paging, display", () => {
    const reg = make();
    expect(() => reg.defineReport(base({ group: "nope" }))).toThrow(/group/);
    expect(() => reg.defineReport(base({ params: [{ name: "x", type: "wat" }] }))).toThrow(/param type/);
    expect(() => reg.defineReport(base({ columns: [{ id: "x", label: "X", type: "wat" }] }))).toThrow(/column type/);
    expect(() => reg.defineReport(base({ chart: { type: "pie", x: "day", series: [] } }))).toThrow(/chart/);
    expect(() => reg.defineReport(base({ paging: "huge" }))).toThrow(/paging/);
    expect(() => reg.defineReport(base({ display: "tv" }))).toThrow(/display/);
  });

  test("accepts the optional fields", () => {
    const reg = make();
    reg.defineReport(base({
      description: "d", roles: ["admin"], paging: "server", requires: ["cap"], featured: true,
      timeoutMs: 5000, chart: { type: "stackedBar", x: "day", series: [{ field: "n", label: "N" }] }, display: "wall",
    }));
    expect(reg.getReport("sales.daily").featured).toBe(true);
  });
});

describe("listing and access", () => {
  test("listReports marks missing capabilities and hides reports outside the actor's roles", () => {
    const reg = make();
    reg.defineReport(base({ key: "sales.a", requires: ["pickups"] }));
    reg.defineReport(base({ key: "sales.money", roles: ["admin"] }));
    reg.defineReport(base({ key: "sales.open" }));

    const staff = reg.listReports({ role: "staff" });
    expect(staff.map((r) => r.key).sort()).toEqual(["sales.a", "sales.open"]);
    const a = staff.find((r) => r.key === "sales.a");
    expect(a.available).toBe(false);
    expect(a.missing).toEqual(["pickups"]);
    expect(staff.find((r) => r.key === "sales.open").available).toBe(true);

    reg.provideCapability("pickups");
    expect(reg.listReports({ role: "staff" }).find((r) => r.key === "sales.a").available).toBe(true);
    expect(reg.listReports({ role: "admin" })).toHaveLength(3);
    expect(reg.listReports({ role: "guest" })).toEqual([]);
  });

  test("list meta omits the run function", () => {
    const reg = make();
    reg.defineReport(base());
    expect(reg.listReports({ role: "admin" })[0].run).toBeUndefined();
  });

  test("canView uses def.roles else the default", () => {
    const reg = make();
    reg.defineReport(base({ roles: ["admin"] }));
    const def = reg.getReport("sales.daily");
    expect(reg.canView({ role: "admin" }, def)).toBe(true);
    expect(reg.canView({ role: "staff" }, def)).toBe(false);
    expect(reg.canView(null, def)).toBe(false);
  });
});

describe("groups, dashboards, metrics, lookups", () => {
  test("groups sort by position and dashboards/metrics/lookups round trip", () => {
    const reg = make();
    reg.defineGroup({ key: "ops", title: "Ops", position: 0 });
    expect(reg.listGroups().map((g) => g.key)).toEqual(["ops", "sales"]);
    expect(() => reg.defineGroup({ key: "ops", title: "again", position: 2 })).toThrow(/already/);

    reg.defineMetric({ key: "m.one", run: async () => ({ value: 1, format: "int" }) });
    reg.defineLookup({ key: "client", search: async () => [], label: async () => "" });
    reg.defineDashboard({ key: "pulse", title: "Pulse", tiles: [{ id: "t", kind: "stat", metric: "m.one" }] });
    expect(reg.getMetric("m.one").key).toBe("m.one");
    expect(reg.getLookup("client").key).toBe("client");
    expect(reg.getDashboard("pulse").tiles).toHaveLength(1);
    expect(reg.getDashboard("missing")).toBeUndefined();
    expect(() => reg.defineMetric({ key: "m.one", run() {} })).toThrow(/already/);
    expect(() => reg.defineDashboard({ key: "d", title: "D", tiles: [{ id: "t", kind: "weird" }] })).toThrow(/kind/);
  });

  test("two registries do not share state", () => {
    const a = make();
    const b = make();
    a.defineReport(base());
    expect(b.getReport("sales.daily")).toBeUndefined();
  });
});
