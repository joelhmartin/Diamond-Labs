import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pgConnectArgs } from "./pg-client.js";

test("a Cloud SQL socket URL becomes an options object", () => {
  const [opts] = pgConnectArgs("postgresql://app:p%40ss@/diamond_labs?host=/cloudsql/proj:us-central1:db", { max: 2 });
  assert.deepEqual(opts, { host: "/cloudsql/proj:us-central1:db", database: "diamond_labs", username: "app", password: "p@ss", max: 2 });
});

test("a TCP URL passes through with its options", () => {
  assert.deepEqual(pgConnectArgs("postgresql://u:p@127.0.0.1:5433/x", { max: 1 }), ["postgresql://u:p@127.0.0.1:5433/x", { max: 1 }]);
});

test("there is one socket-URL parser: database.js and run-migrations.js use pg-client.js", () => {
  for (const f of ["./database.js", "../db/run-migrations.js", "../db/migrate.js", "../db/scrub-staging.js", "../import/targets.js"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(src, /\?host=\(\.\+\)/, `${f} still parses socket URLs itself`);
  }
});
