import { describe, it, expect, vi } from "vitest";
import {
  extractDeclineMessage,
  withIdempotency,
  ChargeInProgressError,
} from "./payment-helpers.js";

describe("extractDeclineMessage", () => {
  it("prefers the per-transaction decline text", () => {
    const resp = {
      transactionResponse: { errors: [{ errorCode: "2", errorText: "This transaction has been declined." }] },
      messages: { message: [{ text: "Some generic text" }] },
    };
    expect(extractDeclineMessage(resp)).toBe("This transaction has been declined.");
  });
  it("falls back to the top-level message text", () => {
    const resp = { messages: { message: [{ text: "Invalid card number." }] } };
    expect(extractDeclineMessage(resp)).toBe("Invalid card number.");
  });
  it("returns null when nothing usable is present", () => {
    expect(extractDeclineMessage(null)).toBeNull();
    expect(extractDeclineMessage(undefined)).toBeNull();
    expect(extractDeclineMessage({})).toBeNull();
    expect(extractDeclineMessage("oops")).toBeNull();
  });
});

// Minimal in-memory ioredis-compatible fake supporting get / set(EX,NX) / del.
function makeFakeRedis() {
  const store = new Map();
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value, ...flags) {
      const nx = flags.some((f) => String(f).toUpperCase() === "NX");
      if (nx && store.has(key)) return null;
      store.set(key, String(value));
      return "OK";
    },
    async del(key) {
      return store.delete(key) ? 1 : 0;
    },
  };
}

describe("withIdempotency", () => {
  it("runs fn once and caches the result", async () => {
    const redis = makeFakeRedis();
    const fn = vi.fn(async () => ({ ok: true, n: 1 }));
    const out = await withIdempotency(redis, "k1", fn);
    expect(out.replayed).toBe(false);
    expect(out.cacheWriteFailed).toBe(false);
    expect(out.result).toEqual({ ok: true, n: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(redis.store.get("idem:result:k1")).toBe(JSON.stringify({ ok: true, n: 1 }));
  });

  it("replays a cached result without calling fn again", async () => {
    const redis = makeFakeRedis();
    await withIdempotency(redis, "k2", async () => ({ v: 42 }));
    const fn2 = vi.fn(async () => ({ v: 999 }));
    const out = await withIdempotency(redis, "k2", fn2);
    expect(out.replayed).toBe(true);
    expect(out.result).toEqual({ v: 42 });
    expect(fn2).not.toHaveBeenCalled();
  });

  it("throws ChargeInProgressError when the lock is held and no result is cached", async () => {
    const redis = makeFakeRedis();
    // Simulate an in-flight charge holding the lock with no cached result yet.
    redis.store.set("idem:lock:k3", "1");
    await expect(
      withIdempotency(redis, "k3", async () => ({ shouldNotRun: true }))
    ).rejects.toBeInstanceOf(ChargeInProgressError);
  });

  it("releases the lock and rethrows when fn fails (so a retry can proceed)", async () => {
    const redis = makeFakeRedis();
    const boom = new Error("charge declined");
    await expect(
      withIdempotency(redis, "k4", async () => { throw boom; })
    ).rejects.toBe(boom);
    expect(redis.store.has("idem:lock:k4")).toBe(false);
    // A subsequent legitimate retry can acquire the lock and run.
    const out = await withIdempotency(redis, "k4", async () => ({ recovered: true }));
    expect(out.result).toEqual({ recovered: true });
  });
});
