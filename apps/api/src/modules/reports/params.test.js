import { describe, test, expect } from "vitest";
import { paramsSchema } from "./params.js";

const NOW = new Date("2026-11-05T18:00:00Z");
const TZ = "America/Chicago";

const def = (params) => ({ key: "k", params });
const parse = (params, query) => paramsSchema(def(params)).parse(query, { now: NOW, tz: TZ });

describe("paramsSchema", () => {
  test('paramsSchema coerces "25" to 25 and rejects an unknown select option', () => {
    const params = [
      { name: "limit", type: "number", min: 1, max: 100 },
      { name: "kind", type: "select", options: [{ value: "a", label: "A" }, "b"] },
    ];
    expect(parse(params, { limit: "25", kind: "a" })).toEqual({ limit: 25, kind: "a" });
    expect(parse(params, { limit: "25", kind: "b" }).kind).toBe("b");
    expect(() => parse(params, { limit: "25", kind: "zzz" })).toThrow();
    expect(() => parse(params, { limit: "101" })).toThrow();
    expect(() => parse(params, { limit: "abc" })).toThrow();
  });

  test("dateRange resolves presets, defaults and custom ranges", () => {
    const params = [{ name: "range", type: "dateRange", default: "last7", maxDays: 40 }];
    const dflt = parse(params, {});
    expect(dflt.range.to).toBe("2026-11-05");
    expect(dflt.range.from).toBe("2026-10-30");
    expect(dflt.range.previous).toEqual({ from: "2026-10-23", to: "2026-10-29" });
    expect(parse(params, { range: "mtd" }).range.from).toBe("2026-11-01");
    expect(parse(params, { range: "2026-11-01..2026-11-03" }).range.to).toBe("2026-11-03");
    expect(parse(params, { range: { from: "2026-11-01", to: "2026-11-03" } }).range.from).toBe("2026-11-01");
    expect(() => parse(params, { range: "2026-11-04..2026-11-03" })).toThrow();
    expect(() => parse(params, { range: "2026-01-01..2026-11-03" })).toThrow(/40/);
    expect(() => parse(params, { range: "nonsense" })).toThrow();
  });

  test("date, toggle, multiselect, lookup and required", () => {
    const params = [
      { name: "on", type: "date" },
      { name: "flag", type: "toggle", default: false },
      { name: "many", type: "multiselect", options: ["x", "y", "z"] },
      { name: "who", type: "lookup", source: "client" },
      { name: "must", type: "select", options: ["q"], required: true },
    ];
    const out = parse(params, { on: "2026-11-02", flag: "true", many: "x,z", who: "u1", must: "q" });
    expect(out).toEqual({ on: "2026-11-02", flag: true, many: ["x", "z"], who: "u1", must: "q" });
    expect(parse(params, { many: ["y"], must: "q" })).toEqual({ flag: false, many: ["y"], must: "q" });
    expect(() => parse(params, { on: "2026-02-30", must: "q" })).toThrow();
    expect(() => parse(params, { many: "x,nope", must: "q" })).toThrow();
    expect(() => parse(params, {})).toThrow();
  });

  test("blank values count as missing; required and defaults still apply", () => {
    expect(parse([{ name: "n", type: "number" }], { n: "" })).toEqual({});
    expect(() => parse([{ name: "n", type: "number", required: true }], { n: "" })).toThrow();
    expect(() => parse([{ name: "n", type: "number", required: true }], { n: null })).toThrow();
    expect(parse([{ name: "n", type: "number", default: 5 }], { n: "" })).toEqual({ n: 5 });
  });

  test("a missing required toggle is an error; an optional one stays absent", () => {
    expect(() => parse([{ name: "t", type: "toggle", required: true }], {})).toThrow();
    expect(parse([{ name: "t", type: "toggle", required: true }], { t: "false" })).toEqual({ t: false });
    expect(parse([{ name: "t", type: "toggle" }], {})).toEqual({});
    expect(parse([{ name: "m", type: "multiselect", options: ["a"] }], {})).toEqual({});
  });

  test("unknown query keys are ignored", () => {
    expect(parse([{ name: "n", type: "number" }], { n: "3", limit: "10", sort: "x" })).toEqual({ n: 3 });
  });
});
