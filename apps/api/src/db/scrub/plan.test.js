import { test } from "vitest";
import assert from "node:assert/strict";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../schema/index.js";
import {
  SCRUB_PLAN, COLUMN_CLASSES, buildStatements, tablesToEmpty, buildEmptyStatement, classSummary, assertScrubAllowed, findUnclassifiedLive,
} from "./plan.js";

const tables = Object.values(schema).filter((v) => is(v, PgTable));
const dbColumns = (t) => Object.values(getTableColumns(t)).map((c) => c.name);

test("coverage: every table exported from schema/index.js is in the plan", () => {
  assert.ok(tables.length >= 20, "schema export discovery looks broken");
  const missing = tables.map(getTableName).filter((n) => !SCRUB_PLAN[n]);
  assert.deepEqual(missing, [], `tables missing from scrub plan: ${missing.join(", ")}`);
});

test("coverage: every column of every table is explicitly classified", () => {
  for (const t of tables) {
    const name = getTableName(t);
    const spec = SCRUB_PLAN[name];
    for (const col of dbColumns(t)) {
      const c = spec?.columns[col];
      assert.ok(c, `${name}.${col} is not classified in scrub/plan.js (add it, and to COLUMNS.md)`);
      assert.ok(COLUMN_CLASSES.includes(c.class), `${name}.${col} has invalid class ${c.class}`);
    }
  }
});

test("plan has no stale tables or columns that the schema no longer has", () => {
  const byName = Object.fromEntries(tables.map((t) => [getTableName(t), dbColumns(t)]));
  for (const [name, spec] of Object.entries(SCRUB_PLAN)) {
    assert.ok(byName[name], `plan table ${name} is not in the schema`);
    for (const col of Object.keys(spec.columns)) assert.ok(byName[name].includes(col), `plan column ${name}.${col} is not in the schema`);
  }
});

test("every non-keep column of an update table has a SQL expression; delete tables have none", () => {
  for (const [name, spec] of Object.entries(SCRUB_PLAN)) {
    for (const [col, c] of Object.entries(spec.columns)) {
      if (spec.mode === "delete") assert.equal(c.set, undefined, `${name}.${col} has set in a delete table`);
      else if (c.class !== "keep") assert.ok(typeof c.set === "string" && c.set.length, `${name}.${col} (${c.class}) needs a set expression`);
      else assert.equal(c.set, undefined, `${name}.${col} is keep but has a set`);
    }
  }
});

// The named PHI/PII/secret list. A new sensitive column added later must be added
// here (and classified in plan.js) - the plan test then forces it to be scrubbed.
const MUST_SCRUB = {
  rx_cases: ["patient_first", "patient_last", "dob", "gender", "contact_phone", "ship_to", "form_data", "device_options",
    "signature_url", "general_comments", "seazona_push_error", "payload_snapshot", "manual_note"],
  rx_case_files: ["original_name", "gcs_url"],
  orders: ["email", "phone", "shipping", "auth_code", "seazona_push_error"],
  rx_case_lines: ["name", "map_key", "source_label"],
  users: ["email", "name", "password_hash", "mfa_secret", "authorize_net_customer_profile_id", "default_payment_profile_id"],
  audit_log: ["metadata", "ip_address"],
  sessions: ["refresh_token_hash", "ip_address", "user_agent"],
  approval_tokens: ["token"],
  invitations: ["email", "token"],
  kv_store: ["key", "value"],
  autopay_enrollments: ["payment_profile_id", "paused_reason"],
  doctor_profiles: ["delivery_notes"],
};

test("named PHI/PII/secret columns are never classified keep", () => {
  for (const [table, cols] of Object.entries(MUST_SCRUB)) {
    for (const col of cols) {
      const c = SCRUB_PLAN[table]?.columns[col];
      assert.ok(c, `${table}.${col} missing from plan`);
      assert.notEqual(c.class, "keep", `${table}.${col} must not be kept`);
    }
  }
});

test("rx_case_files, sessions, kv_store, approval_tokens, invitations are emptied", () => {
  for (const t of ["rx_case_files", "sessions", "kv_store", "approval_tokens", "invitations"]) {
    assert.equal(SCRUB_PLAN[t].mode, "delete", t);
  }
});

test("autopay enrollments are disabled and prod payment profiles are replaced", () => {
  const sql = buildStatements().find((s) => s.table === "autopay_enrollments").sql;
  assert.match(sql, /"enabled" = false/);
  assert.match(sql, /"payment_profile_id" = 'SCRUBBED'/);
});

test("buildStatements never writes a keep column and is deterministic (idempotent)", () => {
  const a = buildStatements();
  assert.deepEqual(a, buildStatements());
  for (const s of a.filter((x) => x.mode === "update")) {
    const kept = Object.entries(SCRUB_PLAN[s.table].columns).filter(([, c]) => c.class === "keep").map(([n]) => n);
    for (const col of kept) assert.ok(!(s.sql.includes(` SET "${col}" =`) || s.sql.includes(`, "${col}" =`)), `${s.table}.${col} is keep but is written`);
  }
  // no statement depends on the prior value of a scrubbed column except via id/case_number
  assert.ok(a.every((s) => !/^TRUNCATE/i.test(s.sql)));
});

test("classSummary counts every column", () => {
  const total = Object.values(SCRUB_PLAN).reduce((n, s) => n + Object.keys(s.columns).length, 0);
  const sum = Object.values(classSummary()).reduce((a, b) => a + b, 0);
  assert.equal(sum, total);
});

test("guard: requires BOTH staging env and database diamond_labs_staging", () => {
  assert.doesNotThrow(() => assertScrubAllowed({ appEnv: "staging", currentDatabase: "diamond_labs_staging" }));
  const bad = [
    { appEnv: "staging", currentDatabase: "diamond_labs" },
    { appEnv: "staging", currentDatabase: "diamond_labs_staging2" },
    { appEnv: "staging", currentDatabase: "Diamond_Labs_Staging" },
    { appEnv: "staging", currentDatabase: undefined },
    { appEnv: "production", currentDatabase: "diamond_labs_staging" },
    { appEnv: undefined, currentDatabase: "diamond_labs_staging" },
    { appEnv: "development", currentDatabase: "diamond_labs" },
    {},
  ];
  for (const b of bad) assert.throws(() => assertScrubAllowed(b), /refuses to run/, JSON.stringify(b));
});

test("findUnclassifiedLive reports unknown tables and columns", () => {
  assert.deepEqual(findUnclassifiedLive({ users: ["id", "email"] }), []);
  assert.equal(findUnclassifiedLive({ users: ["id", "ssn"] }).length, 1);
  assert.equal(findUnclassifiedLive({ patients: ["id"] }).length, 1);
});

test("users: only role 'user' is anonymised; doctors/admins keep email and name", () => {
  const sql = buildStatements().find((s) => s.table === "users").sql;
  assert.match(sql, /"email" = CASE WHEN "role" = 'user' THEN 'user\+' \|\| "id" \|\| '@example.invalid' ELSE "email" END/);
  assert.match(sql, /"name" = CASE WHEN "role" = 'user' THEN 'Scrubbed User' ELSE "name" END/);
});

test("rx_case_lines: free text is neutralised", () => {
  const sql = buildStatements().find((s) => s.table === "rx_case_lines").sql;
  assert.match(sql, /"source_label" = NULL/);
  assert.match(sql, /"name" = CASE WHEN "origin" = 'manual' THEN 'Manual line' ELSE "name" END/);
  assert.match(sql, /"map_key" = CASE WHEN "status" = 'open' THEN 'open:' \|\| "id" ELSE "map_key" END/);
});

test("fail-closed: empty list is derived from the plan and covers every non-keep table", () => {
  const derived = Object.entries(SCRUB_PLAN)
    .filter(([, s]) => Object.values(s.columns).some((c) => c.class !== "keep"))
    .map(([t]) => t)
    .sort();
  assert.deepEqual([...tablesToEmpty()].sort(), derived);
  for (const t of ["rx_cases", "rx_case_files", "rx_case_lines", "orders", "users", "sessions", "kv_store", "audit_log"]) {
    assert.ok(tablesToEmpty().includes(t), t);
  }
  // pure-keep tables are not emptied
  assert.ok(!tablesToEmpty().includes("products"));
  // a synthetic plan proves derivation (no hand list)
  const synth = { a: { mode: "update", columns: { x: { class: "keep" } } }, b: { mode: "update", columns: { y: { class: "phi", set: "NULL" } } } };
  assert.deepEqual(tablesToEmpty(synth), ["b"]);
  assert.equal(buildEmptyStatement(synth), 'TRUNCATE "b" CASCADE');
  assert.match(buildEmptyStatement(), /^TRUNCATE .*"rx_cases".* CASCADE$/);
});

test("drift check ignores only drizzle migration bookkeeping, flags other schemas", () => {
  assert.deepEqual(findUnclassifiedLive({ "drizzle.__drizzle_migrations": ["id", "hash"] }), []);
  assert.equal(findUnclassifiedLive({ "other.patients": ["id"] }).length, 1);
});
