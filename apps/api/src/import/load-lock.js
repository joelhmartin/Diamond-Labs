import { ImportRefusal } from "./import-errors.js";

/**
 * Runs `fn(guard)` holding the target's load lock (one live load step per
 * target at a time; fetch-lock.js makeFetchLock with LOAD_LOCK_KEY). A dry
 * run needs none. `guard()` throws if the lock connection was lost: call it
 * before each write batch.
 */
export async function withLoadLock({ lock, live, step }, fn) {
  if (live && !lock) throw new TypeError(`A live ${step} run needs the load lock (makeFetchLock with LOAD_LOCK_KEY on the target).`);
  if (lock && live) {
    let got;
    try {
      got = await lock.tryLock();
    } catch (err) {
      await lock.close().catch(() => {}); // never leak the lock connection when acquiring it fails
      throw err;
    }
    if (!got) throw new ImportRefusal("Another load is running against this target (the load lock is held). Wait for it to finish.");
  }
  try {
    return await fn(() => lock?.assertHeld());
  } finally {
    if (lock && live) await lock.close();
  }
}
