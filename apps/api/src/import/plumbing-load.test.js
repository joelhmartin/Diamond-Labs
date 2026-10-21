import { test } from "vitest";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

// Import tools must not pull in config/env.js (which exits without DATABASE_URL /
// JWT_SECRET) or config/database.js, directly or transitively. Load each module
// in a clean child process with those unset and assert it loads.
const modules = [
  "../config/pg-client.js",
  "../db/run-migrations.js",
  "./import-errors.js",
  "./targets.js",
  "./cli-args.js",
  "./key-check.js",
  "./raw-store.js",
  "./export-table.js",
  "./db/schema.js",
  "../services/seazona-limits.js",
  "./seazona-records.js",
  "./fetch-plan.js",
  "./seazona-fetch.js",
  "./fetch-lock.js",
  "./report.js",
  // loads without env; the Seazona service is imported only when a live run starts
  "./fetch-cli.js",
];

for (const m of modules) {
  test(`${m} loads with DATABASE_URL and JWT_SECRET unset`, () => {
    const file = new URL(m, import.meta.url).href;
    const env = { PATH: process.env.PATH, PHI_ENCRYPTION_KEY: "0".repeat(64) };
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(file)}); console.log("loaded")`], { env, encoding: "utf8" });
    assert.match(out, /loaded/);
  });
}
