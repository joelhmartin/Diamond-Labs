import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import Fastify from "fastify";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.JOBS_TRIGGER_SECRET = "test-secret";

// Same db/redis mocking pattern as runner.test.js — runJob is the real
// function; only its storage/lock dependencies are faked.
vi.mock("../../config/database.js", () => ({
  db: {
    insert: () => ({ values: async () => {} }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));

const lockStore = new Map();
vi.mock("../../config/redis.js", () => ({
  redis: {
    async set(key, val, _ex, _ttl, nx) {
      if (nx && lockStore.has(key)) return null;
      lockStore.set(key, val);
      return "OK";
    },
    async del(key) {
      lockStore.delete(key);
      return 1;
    },
    async get(key) {
      return lockStore.get(key) ?? null;
    },
  },
}));

const { defineJob, clearRegistry } = await import("../registry.js");
const { registerJobTriggerRoutes } = await import("./http.js");

let fastify;

beforeAll(async () => {
  fastify = Fastify();
  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    if (!body || body.trim() === "") return done(null, {});
    try {
      done(null, JSON.parse(body));
    } catch (err) {
      done(err);
    }
  });
  registerJobTriggerRoutes(fastify);
  await fastify.ready();
});

afterAll(async () => {
  await fastify.close();
});

beforeEach(() => {
  clearRegistry();
  lockStore.clear();
  defineJob({ name: "autopay", description: "d", handler: async () => ({ pending: true }) });
});

describe("registerJobTriggerRoutes", () => {
  it("rejects a request with no secret header", async () => {
    const res = await fastify.inject({ method: "POST", url: "/internal/jobs/autopay/run" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a request with the wrong secret", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/internal/jobs/autopay/run",
      headers: { "x-jobs-trigger-secret": "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("runs the job (dry run by default) with the correct secret", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/internal/jobs/autopay/run",
      headers: { "x-jobs-trigger-secret": "test-secret" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.status).toBe("succeeded");
    expect(body.data.summary).toEqual({ pending: true });
  });

  it("returns 404 for an unknown job name", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/internal/jobs/nope/run",
      headers: { "x-jobs-trigger-secret": "test-secret" },
    });
    expect(res.statusCode).toBe(404);
  });

  // Same length as "test-secret" (11 chars) but wrong content. This is the
  // case that would slip past a timingSafeEqual implementation whose
  // length-mismatch guard is the only thing preventing a throw — if the
  // guard were accidentally short-circuiting equality itself instead of
  // just length, this would wrongly pass.
  it("rejects a same-length-but-wrong secret on POST", async () => {
    const wrongSameLength = "aaaaaaaaaaa";
    expect(wrongSameLength.length).toBe("test-secret".length);
    const res = await fastify.inject({
      method: "POST",
      url: "/internal/jobs/autopay/run",
      headers: { "x-jobs-trigger-secret": wrongSameLength },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects GET /internal/jobs with no secret header", async () => {
    const res = await fastify.inject({ method: "GET", url: "/internal/jobs" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects GET /internal/jobs with the wrong secret", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/internal/jobs",
      headers: { "x-jobs-trigger-secret": "wrong" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("lists jobs on GET /internal/jobs with the correct secret", async () => {
    const res = await fastify.inject({
      method: "GET",
      url: "/internal/jobs",
      headers: { "x-jobs-trigger-secret": "test-secret" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.jobs).toEqual([{ name: "autopay", description: "d" }]);
  });
});
