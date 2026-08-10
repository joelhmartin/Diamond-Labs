import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env.DATABASE_URL ||= "postgres://u:p@localhost:5432/test";
process.env.JWT_SECRET ||= "test-jwt-secret-that-is-at-least-32-chars";
process.env.SEAZONA_API_KEY ||= "test-key";
process.env.SEAZONA_SECRET ||= "test-secret";
process.env.SEAZONA_BASE_URL ||= "https://example.invalid/";

const seazona = await import("./seazona.service.js");

/**
 * Regression guard for the rate limiter.
 *
 * Seazona allows 60 requests/minute per integration, 20 of which may be writes
 * (counted inside the 60). Exceeding it returns 429 — and sustained overage
 * escalates to a tenant-wide block: a burst of ~950 GETs in 90s once got API
 * access disabled for the entire host, recoverable only by contacting support.
 * New credentials and a different IP both made no difference.
 *
 * The throttle therefore lives in the wrapper every call funnels through, so no
 * caller can bypass it. These tests use fake timers so they assert the pacing
 * logic without actually waiting a minute.
 */
describe("Seazona rate limiting", () => {
  beforeEach(() => {
    seazona.__resetRateLimiter();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("lets a burst under the limit straight through", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all(Array.from({ length: 40 }, () => seazona.listProducts()));

    expect(fetchMock).toHaveBeenCalledTimes(40);
  });

  it("holds requests back once the per-minute budget is spent", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    // Fire well past the budget. The excess must not reach the network.
    const inFlight = Promise.all(Array.from({ length: 70 }, () => seazona.listProducts()));
    await vi.advanceTimersByTimeAsync(0);

    const afterBurst = fetchMock.mock.calls.length;
    expect(afterBurst).toBeLessThanOrEqual(50);
    expect(afterBurst).toBeGreaterThan(0);

    // Once the window rolls, the held requests drain.
    await vi.advanceTimersByTimeAsync(61_000);
    await inFlight;
    expect(fetchMock).toHaveBeenCalledTimes(70);
  });

  it("honours Retry-After on a 429 and retries once", async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return { ok: false, status: 429, headers: { get: (h) => (h === "retry-after" ? "2" : null) }, text: async () => "slow down" };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ recovered: true }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const p = seazona.listProducts();
    await vi.advanceTimersByTimeAsync(3_000);
    await p;

    // The retry is the behaviour under test: a 429 must be followed by exactly
    // one more attempt after the server's stated wait, not swallowed as a
    // permanent failure. (listProducts normalises its return shape, so the call
    // count — not the payload — is what proves the retry happened.)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it("gives up after one retry rather than hammering a limited endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "1" },
      text: async () => "slow down",
    });
    vi.stubGlobal("fetch", fetchMock);

    const p = seazona.listProducts();
    await vi.advanceTimersByTimeAsync(5_000);
    await p;

    // Two attempts total — never an unbounded retry loop, which is what turns a
    // throttle into a tenant-wide block.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
