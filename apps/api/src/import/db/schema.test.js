import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import * as importSchema from "./schema.js";
import * as appSchema from "../../db/schema/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));
const apiRoot = join(here, "../../..");

test("the raw store keys every record by (entity, seazona_id) and keeps the payload sealed in text", () => {
  const { seazonaRecords, RAW_ENTITIES } = importSchema;
  assert.deepEqual(RAW_ENTITIES, ["client", "product", "user", "invoice", "invoice_detail", "order", "order_detail"]);
  for (const c of ["id", "entity", "seazonaId", "payload", "lastModified", "fetchedAt", "fetchRunId"]) assert.ok(seazonaRecords[c], c);
  assert.equal(seazonaRecords.payload.columnType, "PgText");
  assert.equal(seazonaRecords.payload.notNull, true);
});

test("fetch runs keep counts and a resume cursor; files and the key check are sealed text", () => {
  const { fetchRuns, importFiles, keyCheck, parityReports } = importSchema;
  for (const c of ["entity", "mode", "status", "requestCount", "errorCount", "plannedIds", "cursor", "lastStatus"]) assert.ok(fetchRuns[c], c);
  assert.equal(importFiles.content.columnType, "PgText");
  assert.ok(keyCheck.value);
  assert.ok(parityReports.report);
});

test("the import schema never reaches the app DB, and the app schema never reaches the import DB", () => {
  for (const name of ["seazonaRecords", "fetchRuns", "importFiles", "keyCheck", "parityReports"]) {
    assert.equal(name in appSchema, false, `${name} leaked into the app schema`);
  }
  const appConfig = readFileSync(join(apiRoot, "drizzle.config.js"), "utf8");
  assert.match(appConfig, /schema: "\.\/src\/db\/schema\/index\.js"/);
  assert.match(appConfig, /out: "\.\/src\/db\/migrations"/);
  const importConfig = readFileSync(join(apiRoot, "drizzle.import.config.js"), "utf8");
  assert.match(importConfig, /schema: "\.\/src\/import\/db\/schema\.js"/);
  assert.match(importConfig, /out: "\.\/src\/import\/db\/migrations"/);
  assert.match(importConfig, /IMPORT_DATABASE_URL/);
  assert.doesNotMatch(importConfig, /process\.env\.DATABASE_URL/);

  const appSql = readdirSync(join(apiRoot, "src/db/migrations")).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(apiRoot, "src/db/migrations", f), "utf8")).join("\n");
  assert.doesNotMatch(appSql, /seazona_records|fetch_runs|import_files/);
  const importSql = readdirSync(join(here, "migrations")).filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(here, "migrations", f), "utf8")).join("\n");
  assert.match(importSql, /CREATE TABLE "seazona_records"/);
  assert.doesNotMatch(importSql, /CREATE TABLE "(users|invoices|lab_orders)"/);
});
