import { test } from "vitest";
import assert from "node:assert/strict";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "../schema/index.js";
import {
  SCRUB_PLAN, COLUMN_CLASSES, buildStatements, findMissingFromLive, classSummary, assertScrubAllowed, findUnclassifiedLive,
} from "./plan.js";

const CTX = { knownMapKeys: ["mod:labial-bow"] };
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
  rx_code_overrides: ["seazona_name"],
  accounts: ["name", "slug", "settings"],
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
  const sql = buildStatements(SCRUB_PLAN, CTX).find((s) => s.table === "autopay_enrollments").sql;
  assert.match(sql, /"enabled" = false/);
  assert.match(sql, /"payment_profile_id" = 'SCRUBBED'/);
});

test("buildStatements never writes a keep column and is deterministic (idempotent)", () => {
  const a = buildStatements(SCRUB_PLAN, CTX);
  assert.deepEqual(a, buildStatements(SCRUB_PLAN, CTX));
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
  const sql = buildStatements(SCRUB_PLAN, CTX).find((s) => s.table === "users").sql;
  assert.match(sql, /"email" = CASE WHEN "role" = 'user' THEN 'user\+' \|\| "id" \|\| '@example.invalid' ELSE "email" END/);
  assert.match(sql, /"name" = CASE WHEN "role" = 'user' THEN 'Scrubbed User' ELSE "name" END/);
});

test("rx_case_lines: free text is neutralised", () => {
  const sql = buildStatements(SCRUB_PLAN, CTX).find((s) => s.table === "rx_case_lines").sql;
  assert.match(sql, /"source_label" = NULL/);
  // EVERY line's name is re-derived from the catalog (staff text spreads to auto lines).
  assert.ok(sql.includes(`"name" = LEFT(COALESCE((SELECT v."name" FROM "product_variants" v WHERE v."code" = "rx_case_lines"."seazona_code" LIMIT 1), (SELECT p."name" FROM "products" p WHERE p."code" = "rx_case_lines"."seazona_code" ORDER BY p."seazona_product_id" LIMIT 1), 'Line'), 255)`), sql);
  assert.doesNotMatch(sql, /"origin" = 'manual'/);
  assert.match(sql, /"map_key" = CASE WHEN "map_key" IS NULL THEN NULL WHEN "map_key" = ANY\(\$1\) THEN "map_key" ELSE 'line:' \|\| "id" END/);
  const st = buildStatements(SCRUB_PLAN, CTX).find((s) => s.table === "rx_case_lines");
  assert.deepEqual(st.params, [CTX.knownMapKeys]);
  assert.throws(() => buildStatements(SCRUB_PLAN, {}), /knownMapKeys/);
});

test("rx_code_overrides: rows not in the known catalog keys are deleted; no ctx fails loudly", () => {
  const s = buildStatements(SCRUB_PLAN, CTX).find((x) => x.table === "rx_code_overrides");
  assert.match(s.sql, /^DELETE FROM "rx_code_overrides" WHERE NOT \("map_key" = ANY\(\$1\)\)$/);
  assert.deepEqual(s.params, [["mod:labial-bow"]]);
  assert.throws(() => buildStatements(SCRUB_PLAN, {}), /knownMapKeys/);
});

test("rx_code_overrides: seazona_name re-derived from the catalog by code after the delete; NULL stays NULL", () => {
  const sts = buildStatements(SCRUB_PLAN, CTX).filter((x) => x.table === "rx_code_overrides");
  assert.deepEqual(sts.map((s) => s.mode), ["delete", "update"]);
  const sql = sts[1].sql;
  assert.ok(sql.startsWith(`UPDATE "rx_code_overrides" SET "seazona_name" = CASE WHEN "rx_code_overrides"."seazona_name" IS NULL THEN NULL ELSE LEFT(COALESCE(`), sql);
  assert.ok(sql.includes(`v."code" = "rx_code_overrides"."seazona_code"`) && sql.includes(`p."code" = "rx_code_overrides"."seazona_code"`), sql);
  assert.match(sql, /'Line'\), 255\) END$/);
});

test("accounts: shopper-owned accounts get id-derived name/slug; others keep theirs", () => {
  const sql = buildStatements(SCRUB_PLAN, CTX).find((s) => s.table === "accounts").sql;
  const owner = `EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "accounts"."owner_id" AND u."role" = 'user')`;
  assert.ok(sql.includes(`"name" = CASE WHEN ${owner} THEN 'Account ' || "accounts"."id" ELSE "accounts"."name" END`), sql);
  assert.ok(sql.includes(`"slug" = CASE WHEN ${owner} THEN 'account-' || "accounts"."id" ELSE "accounts"."slug" END`), sql);
});

test("findMissingFromLive reports plan tables/columns absent from the live DB", () => {
  const live = Object.fromEntries(Object.entries(SCRUB_PLAN).map(([t, s]) => [t, Object.keys(s.columns)]));
  assert.deepEqual(findMissingFromLive(live), []);
  const { client_prices: _x, ...noCp } = live;
  assert.deepEqual(findMissingFromLive(noCp), ["table client_prices is missing"]);
  assert.equal(findMissingFromLive({ ...live, users: ["id"] }).length, Object.keys(SCRUB_PLAN.users.columns).length - 1);
});

test("drift check ignores only drizzle migration bookkeeping, flags other schemas", () => {
  assert.deepEqual(findUnclassifiedLive({ "drizzle.__drizzle_migrations": ["id", "hash"] }), []);
  assert.equal(findUnclassifiedLive({ "other.patients": ["id"] }).length, 1);
});
