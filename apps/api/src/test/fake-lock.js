/** A stand-in for fetch-lock.js makeFetchLock(): records tryLock/assertHeld/close calls. `held: false` models "another load holds it". */
export function fakeLock({ held = true } = {}) {
  const lock = {
    calls: [],
    tryLock: async () => { lock.calls.push("tryLock"); return held; },
    assertHeld: () => { lock.calls.push("assert"); },
    close: async () => { lock.calls.push("close"); },
  };
  return lock;
}
