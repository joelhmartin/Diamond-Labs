import { test } from "vitest";
import assert from "node:assert/strict";
import { runScrub, NOT_SCRUBBED } from "./run.js";
import { SCRUB_PLAN } from "./plan.js";

const CTX = { knownMapKeys: ["mod:labial-bow"] };
const liveRows = (omit = []) =>
  Object.entries(SCRUB_PLAN).filter(([t]) => !omit.includes(t))
    .flatMap(([t, s]) => Object.keys(s.columns).map((c) => ({ schema: "public", table_name: t, column_name: c })));
const rels = (names, kind = "r", schema = "public") => names.map((t) => ({ schema, table_name: t, relkind: kind }));

/** Fake client: records every statement; failOn(sql) -> Error|undefined. */
function fake({ db = "diamond_labs_staging", columns = liveRows(), relations, failOn = () => undefined } = {}) {
  const log = [];
  const relationRows = relations ?? rels(Object.keys(SCRUB_PLAN));
  const run = async (sql) => {
    if (/current_database/.test(sql)) return [{ db }];
    if (/pg_attribute/.test(sql)) return columns;
    if (/FROM pg_catalog.pg_class c/.test(sql)) return relationRows;
    log.push(sql);
    const err = failOn(sql);
    if (err) throw err;
    return Object.assign([], { count: 1 });
  };
  const client = {
    log,
    unsafe: run,
    async begin(fn) {
      log.push("BEGIN");
      try { const r = await fn({ unsafe: run }); log.push("COMMIT"); return r; } catch (e) { log.push("ROLLBACK"); throw e; }
    },
  };
  return client;
}
const quiet = () => { const lines = []; return { lines, log: (l) => lines.push(l), error: (l) => lines.push(l) }; };
const truncs = (c) => c.log.filter((s) => s.startsWith("TRUNCATE"));
const OK_ENV = { APP_ENV: "staging" };
const go = (c, env = OK_ENV) => { const out = quiet(); return runScrub(c, env, { knownMapKeys: CTX.knownMapKeys, out }).then((r) => ({ ...r, out })); };

test("guard refusal (wrong db or env) never truncates or writes anything", async () => {
  for (const [c, env] of [[fake({ db: "diamond_labs" }), OK_ENV], [fake(), { APP_ENV: "production" }], [fake(), {}]]) {
    const { exitCode } = await go(c, env);
    assert.equal(exitCode, 1);
    assert.deepEqual(c.log, []);
  }
});

test("missing plan table: schema-behind message, empties EVERY listed table, exit 1, no scrub tx", async () => {
  const live = ["users", "orders", "extra_table"];
  const c = fake({ columns: liveRows(["client_prices"]), relations: rels(live) });
  const { exitCode, out } = await go(c);
  assert.equal(exitCode, 1);
  assert.ok(out.lines.some((l) => l.includes("schema behind code — run diamond-labs-migrate-staging before scrubbing")));
  assert.ok(out.lines.some((l) => l.includes("staging DB emptied — re-import")));
  assert.deepEqual(truncs(c), live.map((t) => `TRUNCATE TABLE "public"."${t}" CASCADE`));
  assert.ok(!c.log.includes("BEGIN"));
});

test("a scrub error empties every table (not just plan tables) and exits 1", async () => {
  const all = [...Object.keys(SCRUB_PLAN), "unlisted_extra"];
  const c = fake({ relations: rels(all), failOn: (s) => (s.startsWith('UPDATE "orders"') ? new Error("boom") : undefined) });
  const { exitCode, out } = await go(c);
  assert.equal(exitCode, 1);
  assert.ok(c.log.includes("ROLLBACK"));
  assert.equal(truncs(c).length, all.length);
  assert.ok(out.lines.some((l) => l.includes("transaction rolled back")));
});

test("unclassified extra table: drift empties everything", async () => {
  const columns = [...liveRows(), { schema: "public", table_name: "patients", column_name: "name" }];
  const c = fake({ columns, relations: rels([...Object.keys(SCRUB_PLAN), "patients"]) });
  const { exitCode } = await go(c);
  assert.equal(exitCode, 1);
  assert.ok(truncs(c).some((s) => s.includes('"patients"')));
});

test("a truncate failure on one table still attempts the rest, exit 2, names the table", async () => {
  const names = ["a", "b", "c"];
  const c = fake({ columns: liveRows(["client_prices"]), relations: rels(names), failOn: (s) => (s.includes('"b"') ? new Error("locked") : undefined) });
  const { exitCode, out } = await go(c);
  assert.equal(exitCode, 2);
  assert.equal(truncs(c).length, 3);
  assert.ok(out.lines.some((l) => l.includes("CRITICAL: staging DB NOT fully emptied — drop the database now") && l.includes("b")));
  assert.ok(!out.lines.some((l) => l.includes("staging DB emptied — re-import")));
});

test("scrub creates and upserts the marker inside the committing transaction", async () => {
  const c = fake();
  const { exitCode } = await go(c);
  assert.equal(exitCode, 0);
  const ddl = c.log.findIndex((s) => /CREATE TABLE IF NOT EXISTS public\.staging_seed_marker/.test(s));
  const up = c.log.findIndex((s) => /INSERT INTO public\.staging_seed_marker/.test(s));
  assert.ok(ddl > 0 && up > ddl);
  assert.ok(up < c.log.indexOf("COMMIT"));
});

test("failed scrub: marker write rolls back and emptying does not exclude the marker", async () => {
  const relations = [...rels(Object.keys(SCRUB_PLAN)), ...rels(["staging_seed_marker"])];
  const c = fake({ relations, failOn: (s) => (/INSERT INTO public\.staging_seed_marker/.test(s) ? new Error("boom") : undefined) });
  const { exitCode } = await go(c);
  assert.equal(exitCode, 1);
  assert.ok(c.log.includes("ROLLBACK"));
  assert.ok(truncs(c).includes('TRUNCATE TABLE "public"."staging_seed_marker" CASCADE'));
});

test("emptying covers all non-system schemas, drops matviews, skips foreign tables and drizzle bookkeeping", async () => {
  const relations = [
    ...rels(["users"]), ...rels(["audit"], "r", "other"), ...rels(["mv"], "m"), ...rels(["part"], "p"),
    ...rels(["ft"], "f"), ...rels(["__drizzle_migrations"], "r", "drizzle"),
  ];
  const c = fake({ columns: liveRows(["client_prices"]), relations });
  const { exitCode, out } = await go(c);
  assert.equal(exitCode, 2);
  assert.deepEqual(c.log, [
    'DROP MATERIALIZED VIEW IF EXISTS "public"."mv" CASCADE',
    'TRUNCATE TABLE "public"."users" CASCADE',
    'TRUNCATE TABLE "other"."audit" CASCADE',
    'TRUNCATE TABLE "public"."part" CASCADE',
  ]);
  assert.ok(out.lines.some((l) => l.includes("ft")));
});

test("a skipped foreign table fails the emptying: exit 2, CRITICAL message names it", async () => {
  const c = fake({ columns: liveRows(["client_prices"]), relations: [...rels(["users"]), ...rels(["ft"], "f")] });
  const { exitCode, out } = await go(c);
  assert.equal(exitCode, 2);
  assert.ok(out.lines.some((l) => /CRITICAL: staging DB NOT fully emptied — drop the database now.*\bft\b/.test(l)), out.lines.join("\n"));
});

test("guard is re-checked on the same connection right before emptying; failure means no truncate and exit 2", async () => {
  let calls = 0;
  const c = fake({ columns: liveRows(["client_prices"]) });
  const orig = c.unsafe;
  c.unsafe = async (sql, p) => (/current_database/.test(sql) && ++calls === 2 ? [{ db: "diamond_labs" }] : orig(sql, p));
  const { exitCode } = await go(c);
  assert.equal(exitCode, 2);
  assert.deepEqual(truncs(c), []);
});

test("success: transaction commits, VACUUM FULL runs on touched tables, nothing is truncated", async () => {
  const c = fake();
  const { exitCode, out } = await go(c);
  assert.equal(exitCode, 0);
  assert.ok(c.log.includes("COMMIT"));
  assert.ok(c.log.some((s) => s === 'VACUUM FULL "rx_cases"'));
  assert.ok(c.log.some((s) => s.startsWith('DELETE FROM "rx_code_overrides" WHERE NOT')));
  assert.deepEqual(truncs(c), []);
  assert.ok(out.lines.some((l) => /VACUUM FULL ran on \d+ tables/.test(l)));
  assert.ok(c.log.indexOf("COMMIT") < c.log.findIndex((s) => s.startsWith("VACUUM")));
});

test("VACUUM failure after commit: precaution message, empties everything, exit 1", async () => {
  const c = fake({ failOn: (s) => (s.startsWith("VACUUM") ? new Error("disk") : undefined) });
  const { exitCode, out } = await go(c);
  assert.equal(exitCode, 1);
  assert.ok(c.log.includes("COMMIT"));
  assert.ok(out.lines.some((l) => l.includes("scrub committed; VACUUM failed — emptying as a precaution")));
  assert.ok(!out.lines.some((l) => l.includes("rolled back")));
  assert.equal(truncs(c).length, Object.keys(SCRUB_PLAN).length);
});

test("a non-Error throw (string/undefined) still reaches the emptying path", async () => {
  for (const thrown of ["boom string", undefined]) {
    const c = fake({ failOn: (s) => { if (s.startsWith('UPDATE "orders"')) throw thrown; } });
    const { exitCode, out } = await go(c);
    assert.equal(exitCode, 1);
    assert.equal(truncs(c).length, Object.keys(SCRUB_PLAN).length);
    assert.ok(out.lines.some((l) => l.includes("staging DB emptied — re-import")));
  }
});

test("NOT_SCRUBBED is printed on guard refusal, connection failure and exit 2; never on success", async () => {
  assert.match(NOT_SCRUBBED, /staging DB NOT scrubbed — do not serve it; drop or re-run/);
  const refused = await go(fake({ db: "diamond_labs" }));
  assert.ok(refused.out.lines.includes(NOT_SCRUBBED));

  const dead = fake();
  dead.unsafe = async () => { throw new Error("ECONNREFUSED"); };
  const conn = await go(dead);
  assert.equal(conn.exitCode, 1);
  assert.ok(conn.out.lines.includes(NOT_SCRUBBED));

  const two = await go(fake({ columns: liveRows(["client_prices"]), relations: rels(["a"]), failOn: (s) => (s.includes('"a"') ? new Error("locked") : undefined) }));
  assert.equal(two.exitCode, 2);
  assert.ok(two.out.lines.includes(NOT_SCRUBBED));

  const ok = await go(fake());
  assert.ok(!ok.out.lines.includes(NOT_SCRUBBED));
});
