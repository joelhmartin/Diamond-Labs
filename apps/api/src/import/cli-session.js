import * as appSchema from "../db/schema/index.js";
import * as importSchema from "./db/schema.js";
import { assertNotCloudRun, resolveImportDb, resolveTarget, connect } from "./targets.js";
import { assertImportKey, assertTargetKey } from "./key-check.js";
import { rawStore } from "./raw-store.js";
import { makeFetchLock, LOAD_LOCK_KEY } from "./fetch-lock.js";

/**
 * The connections every target-facing CLI (import:load, import:parity) needs:
 * the resolved target (name and URL checked, production confirmed), the raw
 * store, the target db, and a load-lock factory for the TARGET. Every refusal
 * (Cloud Run, a URL naming the wrong database, a missing --confirm-production)
 * happens before anything connects; the key checks run before anything is
 * returned. `writes: false` opens the target read-only at the server (default_transaction_read_only); `writes` also checks the target holds data sealed with this key.
 * Call close() when done.
 */
export async function openTargetSession(env, flags, { writes = false } = {}) {
  assertNotCloudRun(env);
  const target = resolveTarget(flags.target, env, { confirmProduction: flags["confirm-production"] });
  const importResolved = resolveImportDb(env);
  const importConn = connect(importResolved, importSchema);
  const targetConn = connect(target, appSchema, { readOnly: !writes });
  const close = () => Promise.all([importConn.close(), targetConn.close()]);
  try {
    await assertImportKey(importConn.db, { keyCheck: importSchema.keyCheck });
    if (writes) await assertTargetKey(targetConn.db, { allowUnsealed: target.name === "staging" });
  } catch (err) {
    await close();
    throw err;
  }
  return {
    target, raw: rawStore(importConn.db), db: targetConn.db, close,
    makeLock: () => makeFetchLock(target.url, { key: LOAD_LOCK_KEY }),
  };
}
