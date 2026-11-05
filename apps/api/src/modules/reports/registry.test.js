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

  test("rejects a param named like a paging key (limit, offset, sort)", () => {
    const reg = make();
    for (const name of ["limit", "offset", "sort"]) {
      expect(() => reg.defineReport(base({ key: `sales.${name}`, params: [{ name, type: "number" }] }))).toThrow(new RegExp(`"${name}" is reserved for paging`));
    }
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

describe("define-time validation", () => {
  test("rejects duplicate params/columns, option-less selects and bad dateRange defaults", () => {
    const reg = make();
    const p = { name: "a", type: "number" };
    expect(() => reg.defineReport(base({ key: "v.1", params: [p, p] }))).toThrow(/duplicate param/);
    const c = { id: "x", label: "X", type: "text" };
    expect(() => reg.defineReport(base({ key: "v.2", columns: [c, c] }))).toThrow(/duplicate column/);
    expect(() => reg.defineReport(base({ key: "v.3", params: [{ name: "s", type: "select" }] }))).toThrow(/options/);
    expect(() => reg.defineReport(base({ key: "v.4", params: [{ name: "m", type: "multiselect", options: [] }] }))).toThrow(/options/);
    expect(() => reg.defineReport(base({ key: "v.5", params: [{ name: "r", type: "dateRange", default: "soon" }] }))).toThrow(/default/);
    expect(() => reg.defineReport(base({ key: "v.6", params: [{ name: "r", type: "dateRange", default: { from: "2026-01-01", to: "2026-01-31" } }] }))).not.toThrow();
  });

  test("an explicit undefined does not override a default", () => {
    const reg = make();
    reg.defineReport(base({ paging: undefined, requires: undefined }));
    const def = reg.getReport("sales.daily");
    expect(def.paging).toBe("client");
    expect(def.requires).toEqual([]);
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

  test("listDashboards falls back to defaultRoles and never fails open", () => {
    const reg = make();
    reg.defineDashboard({ key: "open", title: "Open", tiles: [] });
    reg.defineDashboard({ key: "money", title: "Money", roles: ["admin"], tiles: [] });
    expect(reg.listDashboards({ role: "staff" }).map((d) => d.key)).toEqual(["open"]);
    expect(reg.listDashboards({ role: "admin" }).map((d) => d.key)).toEqual(["open", "money"]);
    expect(reg.listDashboards({ role: "guest" })).toEqual([]);
    expect(reg.listDashboards(null)).toEqual([]);
    expect(reg.listDashboards({ role: undefined })).toEqual([]);
  });

  test("two registries do not share state", () => {
    const a = make();
    const b = make();
    a.defineReport(base());
    expect(b.getReport("sales.daily")).toBeUndefined();
  });
});
