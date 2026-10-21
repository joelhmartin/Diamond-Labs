import { test } from "vitest";
import assert from "node:assert/strict";
import { databaseName, assertNotCloudRun, resolveImportDb, resolveTarget, IMPORT_DB_NAME } from "./targets.js";
import { ImportRefusal } from "./import-errors.js";

const env = {
  IMPORT_DATABASE_URL: "postgresql://importer:x@127.0.0.1:6001/diamond_labs_import",
  REHEARSAL_DATABASE_URL: "postgresql://admin:x@127.0.0.1:6002/diamond_labs_rehearsal",
  PRODUCTION_DATABASE_URL: "postgresql://admin:x@127.0.0.1:6003/diamond_labs",
};

test("database names come from TCP and Cloud SQL socket URLs", () => {
  assert.equal(databaseName(env.REHEARSAL_DATABASE_URL), "diamond_labs_rehearsal");
  assert.equal(databaseName("postgresql://u:p@/diamond_labs?host=/cloudsql/x"), "diamond_labs");
  assert.equal(databaseName("not a url"), null);
});

test("import commands refuse to run on Cloud Run (service or job)", () => {
  assert.throws(() => assertNotCloudRun({ K_SERVICE: "diamond-labs-api" }), ImportRefusal);
  assert.throws(() => assertNotCloudRun({ CLOUD_RUN_JOB: "diamond-labs-jobs" }), ImportRefusal);
  assert.doesNotThrow(() => assertNotCloudRun({}));
});

test("the import DB must be diamond_labs_import", () => {
  assert.equal(resolveImportDb(env).database, IMPORT_DB_NAME);
  assert.throws(() => resolveImportDb({}), /IMPORT_DATABASE_URL/);
  assert.throws(() => resolveImportDb({ IMPORT_DATABASE_URL: env.PRODUCTION_DATABASE_URL }), /diamond_labs_import/);
});

test("rehearsal must point at diamond_labs_rehearsal; production needs its exact confirmation", () => {
  assert.equal(resolveTarget("rehearsal", env).database, "diamond_labs_rehearsal");
  assert.throws(() => resolveTarget("rehearsal", { REHEARSAL_DATABASE_URL: env.PRODUCTION_DATABASE_URL }), /diamond_labs_rehearsal/);
  assert.throws(() => resolveTarget("production", env), /--confirm-production diamond_labs/);
  assert.throws(() => resolveTarget("production", env, { confirmProduction: "yes" }), /--confirm-production diamond_labs/);
  assert.equal(resolveTarget("production", env, { confirmProduction: "diamond_labs" }).database, "diamond_labs");
  assert.throws(() => resolveTarget("staging", env), /rehearsal or production/);
  assert.throws(() => resolveTarget("rehearsal", {}), /REHEARSAL_DATABASE_URL/);
});

test("DATABASE_URL is never a load target", () => {
  assert.throws(() => resolveTarget("rehearsal", { DATABASE_URL: env.REHEARSAL_DATABASE_URL }), /REHEARSAL_DATABASE_URL/);
});
