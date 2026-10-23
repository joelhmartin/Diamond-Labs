import { test } from "vitest";
import assert from "node:assert/strict";
import { makeFetchLock, LOCK_CLIENT_OPTIONS, FetchLockLost } from "./fetch-lock.js";

// postgres-js reads these in SECONDS and arms setTimeout(seconds * 1000); anything over 2^31-1 ms fires at 1 ms.
const MAX_TIMER_MS = 2 ** 31 - 1;

test("no timer on the lock connection can overflow setTimeout, and recycling is off", () => {
  for (const k of ["idle_timeout", "max_lifetime", "connect_timeout", "keep_alive"]) {
    if (LOCK_CLIENT_OPTIONS[k] !== undefined) assert.ok(LOCK_CLIENT_OPTIONS[k] * 1000 <= MAX_TIMER_MS, `${k} overflows a 32-bit timer`);
  }
  assert.equal(LOCK_CLIENT_OPTIONS.max_lifetime, 0, "0 disables postgres-js's default 30-60 minute recycling");
  assert.equal(LOCK_CLIENT_OPTIONS.idle_timeout, 0);
  assert.equal(LOCK_CLIENT_OPTIONS.max, 1);
});

function fakeClient(answers) {
  const seen = { options: null, ended: 0 };
  const create = (_url, options) => {
    seen.options = options;
    const sql = async () => [{ ok: answers.shift() }];
    sql.end = async () => { seen.ended += 1; };
    return sql;
  };
  return { create, seen };
}

test("tryLock passes the safe options, is idempotent, and a refused lock closes its connection", async () => {
  const f = fakeClient([true]);
  const lock = makeFetchLock("postgresql://x/db", { createClient: f.create });
  assert.equal(await lock.tryLock(), true);
  assert.equal(await lock.tryLock(), true);
  assert.equal(f.seen.options.max_lifetime, 0);
  const g = fakeClient([false]);
  const other = makeFetchLock("postgresql://x/db", { createClient: g.create });
  assert.equal(await other.tryLock(), false);
  assert.equal(g.seen.ended, 1);
  assert.equal(other.isHeld(), false);
});

test("a lock connection that closes while held means the lock is lost: assertHeld throws", async () => {
  const f = fakeClient([true]);
  const lock = makeFetchLock("postgresql://x/db", { createClient: f.create });
  await lock.tryLock();
  lock.assertHeld();
  f.seen.options.onclose();
  assert.equal(lock.isHeld(), false);
  assert.throws(() => lock.assertHeld(), FetchLockLost);
});

test("closing the lock on purpose is not a loss", async () => {
  const f = fakeClient([true]);
  const lock = makeFetchLock("postgresql://x/db", { createClient: f.create });
  await lock.tryLock();
  await lock.close();
  f.seen.options.onclose();
  lock.assertHeld();
});

// Real-Postgres check, only when a local throwaway database is named:
//   FETCHLOCK_TEST_DATABASE_URL=postgresql://localhost:5432/fetchlock_probe pnpm vitest run src/import/fetch-lock.test.js
const REAL = process.env.FETCHLOCK_TEST_DATABASE_URL;
test.skipIf(!REAL)("against a real Postgres: second holder refused, freed when the first closes", async () => {
  assert.match(REAL, /localhost|127\.0\.0\.1/, "only a local database");
  const a = makeFetchLock(REAL);
  const b = makeFetchLock(REAL);
  try {
    assert.equal(await a.tryLock(), true);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(await b.tryLock(), false);
    await a.close();
    assert.equal(await b.tryLock(), true);
  } finally {
    await a.close();
    await b.close();
  }
});

test("the same lock machinery serves the load lock with a different key", async () => {
  const { LOAD_LOCK_KEY, FETCH_LOCK_KEY } = await import("./fetch-lock.js");
  assert.notEqual(LOAD_LOCK_KEY, FETCH_LOCK_KEY);
  let seen;
  const create = () => { const sql = async (_s, ...vals) => { seen = vals; return [{ ok: true }]; }; sql.end = async () => {}; return sql; };
  const lock = makeFetchLock("postgresql://x/db", { createClient: create, key: LOAD_LOCK_KEY });
  assert.equal(await lock.tryLock(), true);
  assert.deepEqual(seen, [LOAD_LOCK_KEY]);
});
