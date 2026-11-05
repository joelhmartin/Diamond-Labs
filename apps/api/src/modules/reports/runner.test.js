import { describe, test, expect, vi, afterEach } from "vitest";
import { createRegistry } from "./registry.js";
import { runReport, ReportError, createRunSlots, ROW_CAP } from "./runner.js";

function setup(over = {}, { slots } = {}) {
  const reg = createRegistry({ defaultRoles: ["admin", "staff"] });
  reg.defineGroup({ key: "g", title: "G" });
  const run = vi.fn(over.run || (async () => ({ rows: [{ a: 1 }] })));
  reg.defineReport({ key: "r.one", group: "g", title: "One", columns: [{ id: "a", label: "A", type: "int" }], ...over, run });
  const executed = [];
  const txOpts = [];
  const tx = { execute: async (q) => { executed.push(q); } };
  const db = { transaction: async (fn, opts) => { txOpts.push(opts); return fn(tx); } };
  return { reg, run, db, tx, executed, txOpts, slots: slots || createRunSlots({ max: 4, waitMs: 5000 }) };
}
const go = (s, extra = {}) => runReport({ registry: s.reg, db: s.db, key: "r.one", query: {}, actor: { role: "staff" }, slots: s.slots, ...extra });

describe("runReport", () => {
  test("run sets a read-only transaction and SET LOCAL statement_timeout 10000 by default", async () => {
    const s = setup();
    const out = await go(s);
    expect(s.txOpts).toEqual([{ accessMode: "read only" }]);
    expect(JSON.stringify(s.executed[0])).toContain("SET LOCAL statement_timeout = 10000");
    expect(s.run.mock.calls[0][0]).toBe(s.tx);
    expect(out.rows).toEqual([{ a: 1 }]);
    expect(out.truncated).toBe(false);
    expect(typeof out.tookMs).toBe("number");
    expect(out.generatedAt).toBeTruthy();
  });

  test("report timeoutMs is used", async () => {
    const s = setup({ timeoutMs: 2500 });
    await go(s);
    expect(JSON.stringify(s.executed[0])).toContain("= 2500");
  });

  test("statement timeout maps to REPORT_TIMEOUT and releases", async () => {
    const s = setup({ run: async () => { throw Object.assign(new Error("canceling"), { code: "57014" }); } });
    await expect(go(s)).rejects.toMatchObject({ name: "ReportError", code: "TIMEOUT" });
    expect(s.slots.active()).toBe(0);
  });

  test("a wrapped 57014 also maps to TIMEOUT", async () => {
    const s = setup({ run: async () => { throw Object.assign(new Error("Failed query"), { cause: { code: "57014" } }); } });
    await expect(go(s)).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  test("other errors propagate and release the slot", async () => {
    const s = setup({ run: async () => { throw new Error("boom"); } });
    await expect(go(s)).rejects.toThrow("boom");
    expect(s.slots.active()).toBe(0);
  });

  test("run refuses a report outside the actor's roles", async () => {
    const s = setup({ roles: ["admin"] });
    await expect(go(s, { actor: { role: "other" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(s.run).not.toHaveBeenCalled();
  });

  test("unknown key is NOT_FOUND", async () => {
    const s = setup();
    await expect(go(s, { key: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("unmet requires gives UNAVAILABLE without calling run", async () => {
    const s = setup({ requires: ["tags"] });
    await expect(go(s)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(s.run).not.toHaveBeenCalled();
  });

  test("bad param gives INVALID naming the field", async () => {
    const s = setup({ params: [{ name: "n", type: "number", min: 1 }] });
    const err = await go(s, { query: { n: "0" } }).catch((e) => e);
    expect(err).toBeInstanceOf(ReportError);
    expect(err).toMatchObject({ code: "INVALID", field: "n" });
  });

  test("client paging caps at 5000 and sets truncated", async () => {
    const rows = Array.from({ length: ROW_CAP + 10 }, (_, i) => ({ a: i }));
    const s = setup({ run: async () => ({ rows }) });
    const out = await go(s);
    expect(out.rows).toHaveLength(ROW_CAP);
    expect(out.truncated).toBe(true);
    expect(out.total).toBe(ROW_CAP + 10);
  });

  test("server paging passes ctx.page and keeps limit/offset/sort out of params", async () => {
    const s = setup({ paging: "server", columns: [{ id: "a", label: "A", type: "int", sortable: true }], run: async () => ({ rows: [], total: 9000 }) });
    const out = await go(s, { query: { limit: "25", offset: "50", sort: "-a" } });
    const [, params, , ctx] = s.run.mock.calls[0];
    expect(params).toEqual({});
    expect(ctx.page).toEqual({ limit: 25, offset: 50, sort: { id: "a", desc: true } });
    expect(out.total).toBe(9000);
  });

  test("server paging defaults and clamps limit, rejects an unknown sort column", async () => {
    const s = setup({ paging: "server", run: async () => ({ rows: [], total: 0 }) });
    await go(s);
    expect(s.run.mock.calls[0][3].page).toMatchObject({ limit: 50, offset: 0, sort: null });
    await go(s, { query: { limit: "9999" } });
    expect(s.run.mock.calls[1][3].page.limit).toBe(500);
    await expect(go(s, { query: { sort: "zzz" } })).rejects.toMatchObject({ code: "INVALID", field: "sort" });
  });

  test("client report gets ctx.page null", async () => {
    const s = setup();
    await go(s);
    expect(s.run.mock.calls[0][3].page).toBeNull();
  });
});

describe("run slots", () => {
  afterEach(() => vi.useRealTimers());

  test("fifth concurrent run waits then BUSY", async () => {
    vi.useFakeTimers();
    const slots = createRunSlots({ max: 4, waitMs: 5000 });
    const release = [];
    for (let i = 0; i < 4; i++) slots.run(() => new Promise((r) => release.push(r)));
    expect(slots.active()).toBe(4);
    const settled = slots.run(async () => "ok").catch((e) => e);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await settled).toMatchObject({ code: "BUSY" });
    release.forEach((r) => r());
    await vi.advanceTimersByTimeAsync(0);
    expect(slots.active()).toBe(0);
  });

  test("a waiter gets the slot when one frees", async () => {
    const slots = createRunSlots({ max: 1, waitMs: 5000 });
    let free;
    const first = slots.run(() => new Promise((r) => { free = r; }));
    const second = slots.run(async () => "second");
    await Promise.resolve();
    free("first");
    expect(await first).toBe("first");
    expect(await second).toBe("second");
    expect(slots.active()).toBe(0);
  });
});
