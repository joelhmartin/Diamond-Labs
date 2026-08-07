import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const inserted = [];
const updated = [];
vi.mock("../config/database.js", () => ({
  db: {
    insert: () => ({ values: async (v) => { inserted.push(v); } }),
    update: () => ({ set: (v) => ({ where: async () => { updated.push(v); } }) }),
  },
}));

const store = new Map();
vi.mock("../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) {
      if (nx && store.has(key)) return null;
      store.set(key, val);
      return "OK";
    },
    async del(key) { store.delete(key); return 1; },
    async get(key) { return store.get(key) ?? null; },
  },
}));

const { defineJob, getJob, listJobs, clearRegistry } = await import("./registry.js");
const { runJob, JobLockedError } = await import("./runner.js");

beforeEach(() => {
  clearRegistry();
  inserted.length = 0;
  updated.length = 0;
  store.clear();
});

describe("registry", () => {
  it("registers and retrieves a job", () => {
    const handler = async () => ({ ok: true });
    defineJob({ name: "demo", description: "d", handler });
    expect(getJob("demo").handler).toBe(handler);
    expect(listJobs()).toEqual([{ name: "demo", description: "d" }]);
  });

  it("rejects a duplicate name", () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({}) });
    expect(() => defineJob({ name: "demo", description: "d", handler: async () => ({}) })).toThrow(/already registered/i);
  });

  it("rejects a job with no handler", () => {
    expect(() => defineJob({ name: "x", description: "d" })).toThrow(/handler/i);
  });
});

describe("runJob", () => {
  it("records a run row and returns the handler summary", async () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({ charged: 0 }) });
    const result = await runJob("demo", { dryRun: true, trigger: "manual" });

    expect(result.status).toBe("succeeded");
    expect(result.summary).toEqual({ charged: 0 });
    expect(inserted[0]).toMatchObject({ jobName: "demo", trigger: "manual", dryRun: true, status: "running" });
    expect(updated[0]).toMatchObject({ status: "succeeded" });
  });

  it("passes dryRun through to the handler", async () => {
    let seen;
    defineJob({ name: "demo", description: "d", handler: async (ctx) => { seen = ctx.dryRun; return {}; } });
    await runJob("demo", { dryRun: false, trigger: "cli" });
    expect(seen).toBe(false);
  });

  it("defaults to a dry run when not told otherwise", async () => {
    let seen;
    defineJob({ name: "demo", description: "d", handler: async (ctx) => { seen = ctx.dryRun; return {}; } });
    await runJob("demo");
    expect(seen).toBe(true);
  });

  it("records failure without throwing into the trigger", async () => {
    defineJob({ name: "boom", description: "d", handler: async () => { throw new Error("kaboom"); } });
    const result = await runJob("boom", { trigger: "schedule" });

    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/kaboom/);
    expect(updated[0]).toMatchObject({ status: "failed" });
  });

  it("throws for an unknown job", async () => {
    await expect(runJob("nope")).rejects.toThrow(/unknown job/i);
  });

  it("refuses to run the same job concurrently", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    defineJob({ name: "slow", description: "d", handler: async () => { await gate; return {}; } });

    const first = runJob("slow", { trigger: "schedule" });
    await expect(runJob("slow", { trigger: "manual" })).rejects.toThrow(JobLockedError);
    release();
    await first;
  });

  it("releases the lock after a run so the next one can proceed", async () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({}) });
    await runJob("demo");
    await expect(runJob("demo")).resolves.toMatchObject({ status: "succeeded" });
  });
});
