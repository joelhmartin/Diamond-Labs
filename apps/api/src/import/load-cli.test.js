process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test, vi } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeLock } from "../test/fake-lock.js";

// The step modules are stubbed: this file tests what main() hands them (the lock, the injected ledger sum,
// the target db, the flags) and what it prints, with no database, no Seazona and no env file (Ruling Q1).
const calls = [];
vi.mock("./load-clients.js", () => ({ loadClients: async (a) => { calls.push(["clients", a]); return { step: "clients", live: a.live }; } }));
vi.mock("./load-invoices.js", () => ({ loadInvoices: async (a) => { calls.push(["invoices", a]); return { step: "invoices", live: a.live }; } }));
vi.mock("./load-orders.js", () => ({ loadOrders: async (a) => { calls.push(["orders", a]); return { step: "orders", live: a.live }; } }));
vi.mock("./load-balances.js", () => ({ loadBalances: async (a) => { calls.push(["balances", a]); return { step: "balances", live: a.live }; } }));

const { main } = await import("./load-cli.js");
const { ImportRefusal } = await import("./import-errors.js");
const { paidCentsFor } = await import("../services/billing/paid-cents.js");

const fixture = (n) => readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url));

function rig({ files = {} } = {}) {
  const out = { lines: [], reports: [], lock: fakeLock(), closed: 0, opened: [] };
  const target = { name: "rehearsal", database: "diamond_labs_rehearsal" };
  const stored = new Map();
  const raw = {
    saveFile: async ({ kind, bytes }) => { stored.set("f1", { kind, bytes }); return "f1"; },
    readFile: async (id) => stored.get(id) ?? null,
  };
  const db = { name: "TARGET_DB" };
  const deps = {
    print: (l) => out.lines.push(...l),
    printReport: (r) => out.reports.push(r),
    readFile: async (p) => files[p],
    openSession: async (env, flags, opts) => {
      out.opened.push({ flags, opts });
      return { target: { ...target, name: flags.target, database: flags.target === "production" ? "diamond_labs" : target.database }, raw, db, makeLock: () => out.lock, close: async () => { out.closed += 1; } };
    },
  };
  return { out, db, stored, run: (argv, env = {}) => main(argv, env, deps) };
}
const last = () => calls[calls.length - 1];

test("every step gets the target db, the load lock and its own flags; a dry run prints the reminder to re-run", async () => {
  for (const step of ["clients", "invoices", "orders"]) {
    const r = rig();
    assert.equal(await r.run([step, "--target", "rehearsal", "--live", ...(step === "orders" ? ["--order-start", "9"] : [])]), 0);
    const [name, args] = last();
    assert.equal(name, step);
    assert.equal(args.db, r.db, "the TARGET db");
    assert.equal(args.lock, r.out.lock, "one load lock for EVERY live step, clients and invoices included");
    assert.equal(args.live, true);
    assert.equal(r.out.closed, 1);
  }
  const dry = rig();
  assert.equal(await dry.run(["invoices", "--target", "rehearsal"]), 0);
  assert.equal(last()[1].live, false);
  assert.match(dry.out.lines.join("\n"), /Dry run: nothing was written/);
  assert.equal(dry.out.reports[0].step, "invoices");
});

test("balances: paidCents is the app's ledger sum, bound to the target db by the step; export problems are printed with rows and keys", async () => {
  const r = rig({ files: { "b.xls": fixture("invoices-export.xls") } });
  assert.equal(await r.run(["balances", "--balances", "per-invoice", "--file", "b.xls", "--target", "rehearsal", "--live", "--accept-export-problems", "--invoice-start", "11200"]), 0);
  const args = last()[1];
  assert.equal(args.paidCents, paidCentsFor);
  assert.equal(args.acceptExportProblems, true);
  assert.equal(args.mode, "per-invoice");
  assert.equal(args.fileId, "f1");
  assert.deepEqual(args.starts, { invoice: 11200, order: undefined });
  const text = r.out.lines.join("\n");
  assert.match(text, /Stored the export as file f1/);
  assert.match(text, /export-row-bad-balance x1: rows 6; keys 11121/);
  assert.match(text, /export-row-no-key x1: rows 8/);
  assert.ok(!/Example|Sample/.test(text), "no client names");
});

test("balances without --accept-export-problems passes false, so a live run with problems refuses inside the step", async () => {
  const r = rig({ files: { "b.xls": fixture("statements-export.xls") } });
  await r.run(["balances", "--balances", "per-client", "--file", "b.xls", "--target", "rehearsal"]);
  assert.equal(last()[1].acceptExportProblems, false);
  assert.equal(last()[1].mode, "per-client");
});

test("balances reads a stored export by --file-id, and refuses a missing or wrong-kind one", async () => {
  const r = rig();
  r.stored.set("f9", { kind: "balances_invoice", bytes: fixture("invoices-export.xls") });
  assert.equal(await r.run(["balances", "--balances", "per-invoice", "--file-id", "f9", "--target", "rehearsal"]), 0);
  assert.equal(last()[1].fileId, "f9");
  await assert.rejects(r.run(["balances", "--balances", "per-client", "--file-id", "f9", "--target", "rehearsal"]), /No per-client export stored with id f9/);
  await assert.rejects(r.run(["balances", "--balances", "per-invoice", "--target", "rehearsal"]), /needs --file/);
  await assert.rejects(r.run(["balances", "--balances", "per-invoice", "--file", "x", "--file-id", "f9", "--target", "rehearsal"]), /not both/);
});

test("a live clients run on production prints the write-freeze reminder; rehearsal and other steps do not", async () => {
  const prod = rig();
  await prod.run(["clients", "--target", "production", "--confirm-production", "diamond_labs", "--live"]);
  assert.match(prod.out.lines.join("\n"), /inside the write freeze/);
  const dry = rig();
  await dry.run(["clients", "--target", "production", "--confirm-production", "diamond_labs"]);
  assert.doesNotMatch(dry.out.lines.join("\n"), /write freeze/);
  const reh = rig();
  await reh.run(["clients", "--target", "rehearsal", "--live"]);
  assert.doesNotMatch(reh.out.lines.join("\n"), /write freeze/);
  const inv = rig();
  await inv.run(["invoices", "--target", "production", "--confirm-production", "diamond_labs", "--live"]);
  assert.doesNotMatch(inv.out.lines.join("\n"), /write freeze/);
});

test("bad shapes are refused before anything opens", async () => {
  const r = rig();
  for (const argv of [
    [], ["nope"], ["invoices", "extra"], ["invoices", "--bogus"],
    ["clients", "--no-email", "maybe", "--target", "rehearsal"],
    ["clients", "--invoice-start", "5", "--target", "rehearsal"],
    ["orders", "--balances", "per-client", "--target", "rehearsal"],
    ["balances", "--balances", "weekly", "--target", "rehearsal"],
    ["balances", "--balances", "per-client", "--file", "x", "--cutover-at", "soon", "--target", "rehearsal"],
    ["invoices", "--live=false", "--target", "rehearsal"],
  ]) await assert.rejects(r.run(argv), ImportRefusal, argv.join(" "));
  assert.equal(r.out.opened.length, 0);
  await assert.rejects(r.run(["invoices", "--target", "rehearsal"], { K_SERVICE: "x" }), /Cloud Run/);
  assert.equal(r.out.opened.length, 0);
});

test("with no configuration at all the real session refuses cleanly, before any connection (Q1 smoke)", async () => {
  const { main: realMain } = await import("./load-cli.js");
  await assert.rejects(realMain(["invoices", "--target", "rehearsal"], {}), /REHEARSAL_DATABASE_URL is not set/);
  await assert.rejects(realMain(["invoices", "--target", "production"], { PRODUCTION_DATABASE_URL: "" }), /PRODUCTION_DATABASE_URL is not set/);
  await assert.rejects(realMain(["invoices", "--target", "production"], { PRODUCTION_DATABASE_URL: "postgres://u@127.0.0.1:1/diamond_labs", IMPORT_DATABASE_URL: "postgres://u@127.0.0.1:1/diamond_labs_import" }), /--confirm-production diamond_labs/);
  await assert.rejects(realMain(["invoices", "--target", "rehearsal"], { REHEARSAL_DATABASE_URL: "postgres://u@127.0.0.1:1/diamond_labs_rehearsal" }), /IMPORT_DATABASE_URL is not set/);
});

test("the session is closed even when the step's report cannot be printed", async () => {
  let closed = 0;
  await assert.rejects(main(["orders", "--target", "rehearsal"], {}, {
    print: () => {}, printReport: () => { throw new Error("print failed"); },
    openSession: async () => ({ target: { name: "rehearsal", database: "d" }, raw: {}, db: {}, makeLock: () => fakeLock(), close: async () => { closed += 1; } }),
  }), /print failed/);
  assert.equal(closed, 1);
});
