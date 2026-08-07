import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";

const inserted = [];
const updated = [];
// One-shot error injection: set before a runJob() call to make the next
// insert/update throw; the mock clears the flag itself after throwing once.
let insertError = null;
let updateError = null;
vi.mock("../config/database.js", () => ({
  db: {
    insert: () => ({
      values: async (v) => {
        if (insertError) {
          const err = insertError;
          insertError = null;
          throw err;
        }
        inserted.push(v);
      },
    }),
    update: () => ({
      set: (v) => ({
        where: async () => {
          if (updateError) {
            const err = updateError;
            updateError = null;
            throw err;
          }
          updated.push(v);
        },
      }),
    }),
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
  insertError = null;
  updateError = null;
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

describe("runJob DB-write failure paths", () => {
  it("does not reject when db.insert fails, and still releases the lock", async () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({}) });
    insertError = new Error("insert boom");

    const result = await runJob("demo");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/insert boom/);

    // Lock must have been released despite the insert failure — a subsequent
    // run for the same job must succeed rather than hit JobLockedError.
    const second = await runJob("demo");
    expect(second.status).toBe("succeeded");
  });

  it("reports success with the real summary when the success-path db.update fails", async () => {
    defineJob({ name: "demo", description: "d", handler: async () => ({ charged: 3 }) });
    updateError = new Error("update boom");

    const result = await runJob("demo");
    expect(result.status).toBe("succeeded");
    expect(result.summary).toEqual({ charged: 3 });
    expect(result.recordingFailed).toBe(true);
  });

  it("resolves with the original handler error when the failure-recording db.update also fails", async () => {
    defineJob({ name: "boom", description: "d", handler: async () => { throw new Error("kaboom"); } });
    updateError = new Error("update boom");

    const result = await runJob("boom");
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/kaboom/);
    expect(result.error).not.toMatch(/update boom/);
  });

  it("releases the lock after a handler failure so the next run can proceed", async () => {
    defineJob({ name: "boom", description: "d", handler: async () => { throw new Error("kaboom"); } });

    const first = await runJob("boom");
    expect(first.status).toBe("failed");

    // If the lock weren't released, this would reject with JobLockedError
    // instead of resolving.
    const second = await runJob("boom");
    expect(second.status).toBe("failed");
  });
});
