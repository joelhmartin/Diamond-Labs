import { describe, it, expect, vi } from "vitest";
import {
  extractDeclineMessage,
  withIdempotency,
  ChargeInProgressError,
  withInvoiceLocks,
  InvoiceLockedError,
  invoiceLockKey,
  isGatewayOutcomePending,
  PENDING_OUTCOME_TTL,
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

  it("replays a result cached under a legacy key (migration dual-read) without charging", async () => {
    const redis = makeFakeRedis();
    // Simulate a success cached under the OLD (pre-user-scoping) key format.
    redis.store.set("idem:result:charge-saved:uuid-1", JSON.stringify({ transactionId: "T1" }));
    const fn = vi.fn(async () => ({ transactionId: "SHOULD_NOT_CHARGE" }));
    const out = await withIdempotency(
      redis,
      "charge-saved:user-9:uuid-1",
      fn,
      { legacyKeys: ["charge-saved:uuid-1"] }
    );
    expect(fn).not.toHaveBeenCalled();
    expect(out.replayed).toBe(true);
    expect(out.result).toEqual({ transactionId: "T1" });
  });
});

describe("withInvoiceLocks", () => {
  it("acquires a lock per invoice, runs fn, then releases them all", async () => {
    const redis = makeFakeRedis();
    const fn = vi.fn(async () => "charged");
    const out = await withInvoiceLocks(redis, ["inv-b", "inv-a"], fn);
    expect(out).toBe("charged");
    expect(fn).toHaveBeenCalledTimes(1);
    // Every lock released — store empty again.
    expect(redis.store.size).toBe(0);
  });

  it("acquires the locks in sorted, deduped order (deadlock-free)", async () => {
    const redis = makeFakeRedis();
    const setKeys = [];
    const origSet = redis.set.bind(redis);
    redis.set = async (key, ...rest) => {
      setKeys.push(key);
      return origSet(key, ...rest);
    };
    await withInvoiceLocks(redis, ["inv-c", "inv-a", "inv-c", "inv-b"], async () => "ok");
    expect(setKeys).toEqual([
      invoiceLockKey("inv-a"),
      invoiceLockKey("inv-b"),
      invoiceLockKey("inv-c"),
    ]);
  });

  it("rejects with InvoiceLockedError when an invoice is already locked, and does not run fn", async () => {
    const redis = makeFakeRedis();
    // Another charge already holds the lock for inv-a.
    redis.store.set(invoiceLockKey("inv-a"), "1");
    const fn = vi.fn(async () => "should not run");
    await expect(
      withInvoiceLocks(redis, ["inv-a", "inv-b"], fn)
    ).rejects.toBeInstanceOf(InvoiceLockedError);
    expect(fn).not.toHaveBeenCalled();
    // The pre-existing lock is untouched; no lock leaked for inv-b.
    expect(redis.store.has(invoiceLockKey("inv-a"))).toBe(true);
    expect(redis.store.has(invoiceLockKey("inv-b"))).toBe(false);
  });

  it("is invoice-global — a lock held for the same invoice blocks regardless of user", async () => {
    const redis = makeFakeRedis();
    // The lock key no longer carries any user id, so a lock taken by ANY caller
    // for inv-x collides with a charge from a DIFFERENT user on the same invoice.
    // This is the cross-user serialization the per-user key failed to provide.
    redis.store.set(invoiceLockKey("inv-x"), "1");
    const fn = vi.fn(async () => "should not run");
    await expect(
      withInvoiceLocks(redis, ["inv-x"], fn)
    ).rejects.toBeInstanceOf(InvoiceLockedError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("releases all acquired locks even when fn throws", async () => {
    const redis = makeFakeRedis();
    const boom = new Error("charge declined");
    await expect(
      withInvoiceLocks(redis, ["inv-a", "inv-b"], async () => { throw boom; })
    ).rejects.toBe(boom);
    // No lock leaked — a legitimate retry can re-acquire.
    expect(redis.store.size).toBe(0);
    const out = await withInvoiceLocks(redis, ["inv-a", "inv-b"], async () => "recovered");
    expect(out).toBe("recovered");
  });

  it("rolls back already-acquired locks when a later invoice cannot be locked", async () => {
    const redis = makeFakeRedis();
    // inv-b is already locked; inv-a is free. Sorted order acquires inv-a first,
    // then fails on inv-b — inv-a must be released so it isn't orphaned.
    redis.store.set(invoiceLockKey("inv-b"), "1");
    await expect(
      withInvoiceLocks(redis, ["inv-a", "inv-b"], async () => "nope")
    ).rejects.toBeInstanceOf(InvoiceLockedError);
    expect(redis.store.has(invoiceLockKey("inv-a"))).toBe(false);
    // The other charge's lock is left intact.
    expect(redis.store.has(invoiceLockKey("inv-b"))).toBe(true);
  });

  it("serializes two concurrent charges on the same invoice (one wins, one 409s)", async () => {
    const redis = makeFakeRedis();
    let release;
    const gate = new Promise((r) => { release = r; });
    // First charge holds the lock inside fn until we release the gate.
    const first = withInvoiceLocks(redis, ["inv-a"], async () => {
      await gate;
      return "first";
    });
    // Give the first call a tick to acquire the lock before the second tries.
    await Promise.resolve();
    const second = withInvoiceLocks(redis, ["inv-a"], async () => "second");
    await expect(second).rejects.toBeInstanceOf(InvoiceLockedError);
    release();
    expect(await first).toBe("first");
    // Lock freed after the winner finished.
    expect(redis.store.size).toBe(0);
  });
});

// A fraud-review hold the service could NOT decline: the gateway may still
// capture it, so neither lock may be released (Codex P1 on PR #36).
describe("pending gateway outcome (undeclinable fraud hold)", () => {
  function pendingError() {
    return Object.assign(new Error("held for review"), {
      heldForReview: true,
      gatewayOutcomePending: true,
      transactionId: "T-HELD",
    });
  }

  function makeTtlRecordingRedis() {
    const redis = makeFakeRedis();
    const ttls = new Map();
    const baseSet = redis.set.bind(redis);
    redis.set = async (key, value, ...flags) => {
      const ex = flags.findIndex((f) => String(f).toUpperCase() === "EX");
      if (ex >= 0) ttls.set(key, Number(flags[ex + 1]));
      return baseSet(key, value, ...flags);
    };
    return { redis, ttls };
  }

  it("isGatewayOutcomePending only flags the pending case", () => {
    expect(isGatewayOutcomePending(pendingError())).toBe(true);
    expect(isGatewayOutcomePending(Object.assign(new Error("x"), { heldForReview: true }))).toBe(false);
    expect(isGatewayOutcomePending(new Error("declined"))).toBe(false);
    expect(isGatewayOutcomePending(null)).toBe(false);
  });

  it("withIdempotency keeps the key locked for the pending window, so a retry cannot charge again", async () => {
    const { redis, ttls } = makeTtlRecordingRedis();
    const err = pendingError();
    await expect(withIdempotency(redis, "held-1", async () => { throw err; })).rejects.toBe(err);

    expect(redis.store.get("idem:lock:held-1")).toBe("pending");
    expect(ttls.get("idem:lock:held-1")).toBe(PENDING_OUTCOME_TTL);
    expect(redis.store.has("idem:result:held-1")).toBe(false);

    const retry = vi.fn(async () => ({ transactionId: "SECOND" }));
    await expect(withIdempotency(redis, "held-1", retry)).rejects.toBeInstanceOf(ChargeInProgressError);
    expect(retry).not.toHaveBeenCalled();
  });

  it("withIdempotency still releases the key for a definitive failure (declined hold)", async () => {
    const redis = makeFakeRedis();
    const declinedHold = Object.assign(new Error("held, then declined"), { heldForReview: true });
    await expect(withIdempotency(redis, "held-2", async () => { throw declinedHold; })).rejects.toBe(declinedHold);
    expect(redis.store.has("idem:lock:held-2")).toBe(false);
  });

  it("withInvoiceLocks keeps every invoice locked, so a different key cannot pay against the same balance", async () => {
    const { redis, ttls } = makeTtlRecordingRedis();
    const err = pendingError();
    await expect(withInvoiceLocks(redis, ["inv-B", "inv-A"], async () => { throw err; })).rejects.toBe(err);

    for (const id of ["inv-A", "inv-B"]) {
      expect(redis.store.get(invoiceLockKey(id))).toBe("pending");
      expect(ttls.get(invoiceLockKey(id))).toBe(PENDING_OUTCOME_TTL);
    }
    const other = vi.fn(async () => "charged");
    await expect(withInvoiceLocks(redis, ["inv-A"], other)).rejects.toBeInstanceOf(InvoiceLockedError);
    expect(other).not.toHaveBeenCalled();
  });

  it("nested like charge-saved (idempotency around invoice locks): both stay held", async () => {
    const redis = makeFakeRedis();
    const err = pendingError();
    await expect(
      withIdempotency(redis, "held-3", () => withInvoiceLocks(redis, ["inv-C"], async () => { throw err; }))
    ).rejects.toBe(err);
    expect(redis.store.get("idem:lock:held-3")).toBe("pending");
    expect(redis.store.get(invoiceLockKey("inv-C"))).toBe("pending");
  });
});
