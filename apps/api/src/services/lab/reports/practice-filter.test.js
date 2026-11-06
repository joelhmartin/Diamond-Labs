/**
 * The practice / group filter on client-bearing reports (report-helpers
 * PRACTICE_PARAMS, practiceFilterSql) and its two lookups (lookups.js
 * `practice`, `organization`). Fake-transaction checks always run; the
 * real-Postgres check runs only when a LOCAL server is named:
 *   PRACTICE_FILTER_TEST_SERVER_URL=postgresql://bif@localhost:5432/postgres npx vitest run src/services/lab/reports/practice-filter.test.js
 * It creates its own uniquely named database on that server, migrates and
 * seeds it, and drops it afterwards. It never writes to a database it did
 * not create (it checks current_database() before the first write).
 */
import { afterAll, test } from "vitest";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { STAFF_ROLES, LAB_TIMEZONE } from "@my-app/shared";
import { createRegistry } from "../../../modules/reports/registry.js";
import { runReport, createRunSlots } from "../../../modules/reports/runner.js";
import { fakeTx, fakeDb } from "../../../test/fake-tx.js";
import { renderSql, executedSql } from "../../../test/sql-text.js";
import { invoices } from "../../../db/schema/index.js";
import { registerLabReports } from "./index.js";
import { LAB_LOOKUPS } from "./lookups.js";
import { PRACTICE_PARAMS, practiceAccountIds, practiceFilterSql, practiceScope } from "./report-helpers.js";
import { ACCOUNTING_REPORTS } from "./accounting.reports.js";

const boss = { id: "u1", role: "admin" };
const lab = { id: "u2", role: "lab" };
const TZ = LAB_TIMEZONE;

function registry() {
  const r = createRegistry({ defaultRoles: STAFF_ROLES });
  registerLabReports(r);
  return r;
}

/** Every report whose rows come from records carrying account_id (orders, invoices, payments through their invoice). */
const FILTERED = {
  // listReceivables rows and the statement activity, through the filter's account ids (practiceAccountIds).
  byRows: ["accounting.account-balance", "accounting.aging-summary", "accounting.statements-summary"],
  bySql: [
    "accounting.adjustments", "accounting.discounts", "accounting.invoices", "accounting.invoices-summary",
    "accounting.invoices-payments", "accounting.payments-received",
    "sales.comparison", "sales.summary", "sales.daily", "sales.lab", "sales.net-chart", "sales.category", "sales.by-client", "sales.by-rep",
    "clients.health", "clients.top", "clients.bottom", "clients.inactive", "clients.new-orders", "clients.no-recent-sales",
    "products.sold", "products.units", "products.units-detail", "products.materials",
    "productivity.orders", "productivity.monthly-counts", "productivity.monthly-orders", "productivity.remakes", "productivity.turnaround",
    "operations.case-submission", "operations.daily-orders", "operations.daily-shipments", "operations.tbd-orders", "operations.pan-numbers",
  ],
};
const ALL_FILTERED = [...FILTERED.byRows, ...FILTERED.bySql];

const run = async (key, query, tx = fakeTx({ executes: [] }), actor = boss) =>
  ({ tx, out: await runReport({ registry: registry(), db: fakeDb(tx), key, query, actor, slots: createRunSlots(), tz: TZ }) });

const FILTER_RE = /(invoices|lab_orders)\.account_id = \$\d+/;
const GROUP_RE = /(invoices|lab_orders)\.account_id in \(select organization_accounts\.account_id from organization_accounts where organization_accounts\.organization_id = \$\d+\)/;

test("practiceFilterSql: nothing set is true; a practice is an equality; a group is its member accounts; both must hold", () => {
  assert.equal(renderSql(practiceFilterSql({}, invoices.accountId)).text, "true");
  assert.equal(renderSql(practiceFilterSql(undefined, invoices.accountId)).text, "true");
  const one = renderSql(practiceFilterSql({ practice: "A1" }, invoices.accountId));
  assert.equal(one.text, "invoices.account_id = $1");
  assert.deepEqual(one.params, ["A1"]);
  const group = renderSql(practiceFilterSql({ organization: "G1" }, invoices.accountId));
  assert.equal(group.text, "invoices.account_id in (select organization_accounts.account_id from organization_accounts where organization_accounts.organization_id = $1)");
  assert.deepEqual(group.params, ["G1"]);
  const both = renderSql(practiceFilterSql({ practice: "A1", organization: "G1" }, sql.raw("x.account_id")));
  assert.match(both.text, /^x\.account_id = \$1 and x\.account_id in \(select/);
  assert.deepEqual(both.params, ["A1", "G1"]);
  assert.equal(practiceScope({}), null, "no filter: the shared metrics' SQL is unchanged");
  assert.equal(renderSql(practiceScope({ practice: "A1" })(invoices.accountId)).text, "invoices.account_id = $1");
});

test("PRACTICE_PARAMS are generic lookups on the two lab lookups, which staff may use (no money)", () => {
  const reg = registry();
  assert.deepEqual(PRACTICE_PARAMS.map((p) => [p.name, p.type, p.source]), [["practice", "lookup", "practice"], ["organization", "lookup", "organization"]]);
  for (const p of PRACTICE_PARAMS) {
    const lookup = reg.getLookup(p.source);
    assert.ok(lookup, p.source);
    assert.equal(reg.canView(lab, lookup), true, `${p.source} is staff`);
  }
});

test("exactly the client-bearing reports take the practice and group params", () => {
  const reg = registry();
  const withFilter = reg.listReports(boss).filter((d) => {
    const names = (reg.getReport(d.key).params ?? []).map((p) => p.name);
    return names.includes("practice") || names.includes("organization");
  }).map((d) => d.key).sort();
  assert.deepEqual(withFilter, [...ALL_FILTERED].sort());
  for (const key of ALL_FILTERED) {
    const params = reg.getReport(key).params;
    for (const p of PRACTICE_PARAMS) assert.deepEqual(params.find((x) => x.name === p.name), p, `${key} ${p.name}`);
  }
});

test("every SQL report adds the practice filter to its records when a practice is set, and only then", async () => {
  for (const key of FILTERED.bySql) {
    const { tx } = await run(key, { practice: "A1" });
    const q = executedSql(tx);
    assert.ok(q.length > 0, `${key} ran a query`);
    assert.ok(q.some((x) => FILTER_RE.test(x.text) && x.params.includes("A1")), `${key} filters by practice`);
    const plain = executedSql((await run(key, {})).tx);
    assert.ok(plain.every((x) => !FILTER_RE.test(x.text) && !/organization_accounts/.test(x.text)), `${key} unfiltered SQL has no practice filter`);
  }
});

test("a group resolves to its member accounts through organization_accounts", async () => {
  for (const key of FILTERED.bySql) {
    const { tx } = await run(key, { organization: "G1" });
    assert.ok(executedSql(tx).some((x) => GROUP_RE.test(x.text) && x.params.includes("G1")), `${key} filters by group`);
  }
});

test("every query a filtered SQL report runs is filtered, so its totals agree with its rows", async () => {
  // The shared sales metric (salesWhere) and both halves of a two-query report carry the filter.
  for (const key of ["sales.summary", "clients.top", "clients.bottom", "clients.inactive", "productivity.remakes", "accounting.adjustments", "accounting.invoices", "accounting.payments-received"]) {
    const { tx } = await run(key, { practice: "A1" });
    const q = executedSql(tx).filter((x) => /\b(from|join) (invoices|lab_orders)\b/.test(x.text));
    assert.ok(q.length > 0, key);
    for (const x of q) assert.match(x.text, FILTER_RE, `${key}: ${x.text.slice(0, 80)}`);
  }
  // One statement, several record reads: each is filtered (union halves, the lifetime-sales and eligibility subqueries).
  const filters = async (key) => executedSql((await run(key, { practice: "A1" })).tx)
    .reduce((n, x) => n + (x.text.match(/(invoices|lab_orders)\.account_id = \$\d+/g) ?? []).length, 0);
  assert.equal(await filters("accounting.adjustments"), 2);
  assert.equal(await filters("clients.inactive"), 2);
  assert.equal(await filters("clients.top"), 2);
  assert.equal(await filters("clients.bottom"), 3);
});

// That an unknown id gives an EMPTY result is checked against real Postgres below; a fake tx can only show it is accepted.
test("an unknown practice or group does not throw (the lookup param accepts any id; no INVALID)", async () => {
  for (const key of FILTERED.bySql) {
    const { out } = await run(key, { practice: "no-such-practice", organization: "no-such-group" });
    assert.ok(Array.isArray(out.rows), key);
  }
  // A non-admin runs a staff report with the filter.
  const { out } = await run("productivity.orders", { practice: "no-such-practice" }, fakeTx({ executes: [] }), lab);
  assert.ok(Array.isArray(out.rows));
});

// ── The receivables and statement reports ────────────────────────────────

const report = (key) => ACCOUNTING_REPORTS.find((r) => r.key === key);
const openInvoices = [
  { id: "i1", clientUserId: "doc1", accountId: "A1", status: "issued", totalCents: 30000, dueDate: "2000-01-01", paid: "10000" },
  { id: "i3", clientUserId: "doc2", accountId: "A2", status: "issued", totalCents: 8000, dueDate: "2999-01-01", paid: "0" },
  { id: "i4", clientUserId: "doc3", accountId: null, status: "issued", totalCents: 500, dueDate: "2999-01-01", paid: "0" },
];
const practices = [{ id: "A1", name: "One Dental", accountNumber: "1", ownerUserId: "doc1" }, { id: "A2", name: "Two Ortho", accountNumber: "2", ownerUserId: "doc2" }];
const groups = [{ accountId: "A2", organizationId: "G1", name: "Smile Group" }];
const doc3 = [{ id: "doc3", name: "Dr Three", accountNumber: null, practice: null }];
/** The receivables reads, after the filter's account ids (practiceAccountIds) when one is set. */
const receivablesTx = (ids) => fakeTx({ selects: [...(ids ? [ids.map((id) => ({ id }))] : []), openInvoices, practices, groups, doc3] });

test("account balance and aging: rows and totals within the practice or group; unassigned rows only unfiltered", async () => {
  const all = await report("accounting.account-balance").run(receivablesTx(), {});
  assert.equal(all.rows.length, 3);
  assert.equal(all.summary.balance, 28500);

  const one = await report("accounting.account-balance").run(receivablesTx(["A1"]), { practice: "A1" });
  assert.deepEqual(one.rows.map((r) => [r.client, r.balance]), [["One Dental", 20000]]);
  assert.deepEqual(one.summary, { openInvoices: 1, pastDue: 20000, balance: 20000 });

  // The group's member accounts come from the id read (any group status), not the row's active-group name.
  const group = await report("accounting.aging-summary").run(receivablesTx(["A2"]), { organization: "G1" });
  assert.deepEqual(group.rows.map((r) => [r.client, r.balance]), [["Two Ortho", 8000]]);
  assert.equal(group.summary.balance, 8000);
  assert.equal(group.summary.current, 8000);

  const none = await report("accounting.aging-summary").run(receivablesTx([]), { practice: "nope" });
  assert.deepEqual(none.rows, []);
  assert.equal(none.summary.balance, 0);
});

test("statements summary: the filter becomes the activity's account list; unknown is empty with no activity read", async () => {
  assert.equal(await practiceAccountIds(fakeTx(), {}), null, "no filter: every invoice (null)");
  const tx = fakeTx({ selects: [[]] });
  const out = await report("accounting.statements-summary").run(tx, { practice: "nope" }, null, { today: "2026-03-10" });
  assert.deepEqual(out.rows, []);
  assert.equal(tx.log.filter((e) => e.op === "select").length, 1, "only the account id read; loadStatementActivity([]) reads nothing");
  const ids = await practiceAccountIds(fakeTx({ selects: [[{ id: "A1" }, { id: "A2" }]] }), { organization: "G1" });
  assert.deepEqual(ids, ["A1", "A2"]);
});

// ── Lookups ──────────────────────────────────────────────────────────────

/** A builder fake that keeps each call's arguments, so the where clause can be rendered. */
function recordingDb(rows) {
  const calls = {};
  const b = new Proxy({}, {
    get(_t, prop) {
      if (prop === "then") return (res, rej) => Promise.resolve(rows).then(res, rej);
      return (...args) => { calls[prop] = args; return b; };
    },
  });
  return { db: { select: () => b }, calls };
}
const lookup = (key) => LAB_LOOKUPS.find((l) => l.key === key);

test("the practice lookup lists only client accounts, by name or account number, labelled with number and status", async () => {
  const { db, calls } = recordingDb([
    { value: "A1", name: "One Dental", accountNumber: "1001", status: "active" },
    { value: "A2", name: "Two Ortho", accountNumber: null, status: "suspended" },
  ]);
  const found = await lookup("practice").search(db, " 100 ");
  assert.deepEqual(found, [{ value: "A1", label: "One Dental · 1001" }, { value: "A2", label: "Two Ortho (suspended)" }]);
  const where = renderSql(calls.where[0]);
  assert.match(where.text, /accounts\.is_client = \$1 and \(accounts\.name ilike \$2 or accounts\.account_number ilike \$3\)/);
  assert.equal(where.params[0], true);
  // No text: still only client accounts.
  const blank = recordingDb([]);
  await lookup("practice").search(blank.db, "");
  assert.equal(renderSql(blank.calls.where[0]).text, "accounts.is_client = $1");
  // A label is only ever a client account's.
  const lbl = recordingDb([]);
  assert.equal(await lookup("practice").label(lbl.db, "U-personal"), null);
  assert.match(renderSql(lbl.calls.where[0]).text, /accounts\.id = \$1 and accounts\.is_client = \$2/);
});

test("the organization lookup lists groups by name and says when one is archived", async () => {
  const { db, calls } = recordingDb([{ value: "G1", name: "Smile Group", status: "active" }, { value: "G2", name: "Old Group", status: "archived" }]);
  assert.deepEqual(await lookup("organization").search(db, "group"), [{ value: "G1", label: "Smile Group" }, { value: "G2", label: "Old Group (archived)" }]);
  assert.match(renderSql(calls.where[0]).text, /organizations\.name ilike \$1/);
  const lbl = recordingDb([{ name: "Old Group", status: "archived" }]);
  assert.equal(await lookup("organization").label(lbl.db, "G2"), "Old Group (archived)");
});

// ── Real Postgres (opt-in) ───────────────────────────────────────────────

const SERVER = process.env.PRACTICE_FILTER_TEST_SERVER_URL;
/** The database this test creates (and is the only one it writes to or drops). */
const SCRATCH = `practice_filter_test_${process.pid}_${Date.now()}`;
const withDatabase = (url, name) => { const u = new URL(url); u.pathname = `/${name}`; return u.toString(); };
let created = false;

async function adminSql(statement) {
  const { default: postgres } = await import("postgres");
  const admin = postgres(SERVER, { max: 1, onnotice: () => {} });
  try { await admin.unsafe(statement); } finally { await admin.end(); }
}

afterAll(async () => {
  if (created) await adminSql(`drop database if exists "${SCRATCH}" with (force)`);
});

test.skipIf(!SERVER)("against a real Postgres: lookups, practice, group, both, outside the group and unknown on sales and orders", async () => {
  assert.match(new URL(SERVER).hostname, /^(localhost|127\.0\.0\.1)$/, "only a local server");
  assert.match(SCRATCH, /^practice_filter_test_\d+_\d+$/);
  await adminSql(`create database "${SCRATCH}"`);
  created = true;
  const url = withDatabase(SERVER, SCRATCH);
  const { runMigrations } = await import("../../../db/run-migrations.js");
  await runMigrations({ url, migrationsFolder: fileURLToPath(new URL("../../../db/migrations", import.meta.url)), label: "practice-filter-test" });

  const { default: postgres } = await import("postgres");
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(url, { max: 1, onnotice: () => {} });
  const db = drizzle(client);
  try {
    const [{ name }] = await client`select current_database() as name`;
    assert.equal(name, SCRATCH, "writes only to the database this test created");
    await db.execute(sql`insert into users (id, email, name, role) values
      ('d1', 'd1@example.test', 'Dr A', 'doctor'), ('d2', 'd2@example.test', 'Dr B', 'doctor'), ('d3', 'd3@example.test', 'Dr C', 'doctor')`);
    await db.execute(sql`insert into accounts (id, name, slug, owner_id, is_client, account_number) values
      ('A1', 'Alpha Dental', 'alpha', 'd1', true, '1001'), ('A2', 'Beta Ortho', 'beta', 'd2', true, '1002'),
      ('A3', 'Gamma Smiles', 'gamma', 'd3', true, '1003'), ('P1', 'Personal', 'personal', 'd1', false, null)`);
    // G1 holds A1 and A2; A3 is a client practice outside every group.
    await db.execute(sql`insert into organizations (id, name) values ('G1', 'Smile Group')`);
    await db.execute(sql`insert into organization_accounts (organization_id, account_id) values ('G1', 'A1'), ('G1', 'A2')`);
    await db.execute(sql`insert into invoices (id, invoice_number, kind, status, issued_at, subtotal_cents, client_user_id, account_id) values
      ('i1', 1, 'order', 'issued', '2026-10-05T18:00:00Z', 1000, 'd1', 'A1'),
      ('i2', 2, 'order', 'issued', '2026-10-06T18:00:00Z', 2000, 'd2', 'A2'),
      ('i3', 3, 'shop', 'issued', '2026-10-07T18:00:00Z', 4000, null, null),
      ('i4', 4, 'order', 'issued', '2026-10-08T18:00:00Z', 8000, 'd3', 'A3')`);
    await db.execute(sql`insert into lab_orders (id, order_number, source, source_id, received_at, client_user_id, account_id) values
      ('o1', 1, 'staff', 's1', '2026-10-05T18:00:00Z', 'd1', 'A1'), ('o2', 2, 'staff', 's2', '2026-10-06T18:00:00Z', 'd2', 'A2'),
      ('o3', 3, 'staff', 's3', '2026-10-07T18:00:00Z', 'd3', 'A3'), ('o4', 4, 'staff', 's4', '2026-10-08T18:00:00Z', null, null)`);

    const reg = registry();
    const runReal = (key, query) => runReport({ registry: reg, db, key, query, actor: boss, slots: createRunSlots(), tz: TZ });
    const range = { range: "2026-10-01..2026-10-31" };
    const sales = async (q) => (await runReal("sales.daily", { ...range, ...q })).summary.sales;
    assert.equal(await sales({}), 15000, "unfiltered: every invoice, the no-account one included");
    assert.equal(await sales({ practice: "A1" }), 1000);
    assert.equal(await sales({ practice: "A3" }), 8000);
    assert.equal(await sales({ organization: "G1" }), 3000, "the group's members only: not A3, not the no-account invoice");
    assert.equal(await sales({ organization: "G1", practice: "A2" }), 2000);
    assert.equal(await sales({ organization: "G1", practice: "A3" }), 0, "a practice outside the group does not widen it");
    assert.equal(await sales({ practice: "nope" }), 0);
    assert.equal(await sales({ organization: "nope" }), 0);

    const orderNumbers = async (q) => {
      const out = await runReal("productivity.orders", { ...range, ...q });
      assert.equal(out.total, out.rows.length);
      return out.rows.map((r) => r.orderNumber).sort();
    };
    assert.deepEqual(await orderNumbers({}), [1, 2, 3, 4]);
    assert.deepEqual(await orderNumbers({ practice: "A2" }), [2]);
    assert.deepEqual(await orderNumbers({ organization: "G1" }), [1, 2], "no A3, no no-account order");
    assert.deepEqual(await orderNumbers({ organization: "G1", practice: "A3" }), []);
    assert.deepEqual(await orderNumbers({ practice: "nope" }), []);
    assert.deepEqual(await orderNumbers({ organization: "nope" }), []);

    // Every filtered report's real SQL runs with both filters set and with none; an unknown id is empty everywhere.
    for (const key of ALL_FILTERED) {
      for (const q of [{}, { practice: "A1", organization: "G1" }]) {
        const out = await runReal(key, q);
        assert.ok(Array.isArray(out.rows), `${key} ${JSON.stringify(q)}`);
      }
      const unknown = await runReal(key, { practice: "nope", organization: "nope" });
      const counted = unknown.rows.filter((r) => Object.entries(r).some(([k, v]) => typeof v === "number" && v !== 0 && !["rank", "year", "share"].includes(k)));
      assert.deepEqual(counted, [], `${key}: an unknown id has no figures`);
    }

    const found = await lookup("practice").search(db, "");
    assert.deepEqual(found.map((f) => f.value), ["A1", "A2", "A3"], "client accounts only");
    assert.equal(await lookup("practice").label(db, "P1"), null);
    assert.deepEqual((await lookup("organization").search(db, "smile")).map((f) => f.label), ["Smile Group"]);
  } finally {
    await client.end();
  }
}, 60000);
