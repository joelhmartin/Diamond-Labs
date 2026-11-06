import { test } from "vitest";
import assert from "node:assert/strict";
import { main } from "./fetch-cli.js";
import { readExport } from "./export-table.js";
import { derivedProvenance } from "./payments-export.js";
import { deriveFromAccountBalances, exportDay } from "./account-balance-derive.js";
import { fakeRawStore } from "../test/fake-raw-store.js";

// Fake accounts and invoice numbers only.
const CUT = "2026-09-30";
const inv = (number, totalCents, due, clientKey = "c1") => ({ number, totalCents, due, clientKey });
const openOf = (d) => Object.fromEntries(d.rows.map((r) => [r.key, r.cents]));

test("the newest invoices stay open up to the balance, with a partial at the boundary", () => {
  const d = deriveFromAccountBalances({
    invoices: [inv(1, 100, "2026-07-15"), inv(2, 100, "2026-08-15"), inv(3, 100, "2026-09-15")],
    balances: new Map([["c1", 150]]), statementThrough: CUT,
  });
  assert.deepEqual(openOf(d), { 1: 0, 2: 50, 3: 100 });
  assert.deepEqual(d.credits, []);
  assert.deepEqual(d.excess, []);
});

test("invoices after the last statement add to what the report says", () => {
  const d = deriveFromAccountBalances({
    invoices: [inv(1, 100, "2026-09-15"), inv(2, 40, "2026-10-15")],
    balances: new Map([["c1", 30]]), statementThrough: CUT,
  });
  assert.deepEqual(openOf(d), { 1: 30, 2: 40 });
});

test("a credit pays down unstatemented invoices; a bigger credit is reported for staff", () => {
  const paid = deriveFromAccountBalances({ invoices: [inv(1, 100, "2026-10-15")], balances: new Map([["c1", -30]]), statementThrough: CUT });
  assert.deepEqual(openOf(paid), { 1: 70 });
  const credit = deriveFromAccountBalances({ invoices: [inv(1, 100, "2026-10-15")], balances: new Map([["c1", -130]]), statementThrough: CUT });
  assert.deepEqual(openOf(credit), { 1: 0 });
  assert.deepEqual(credit.credits, [{ clientKey: "c1", cents: 30 }]);
});

test("payments after the report reduce what is owed", () => {
  const d = deriveFromAccountBalances({
    invoices: [inv(1, 100, "2026-09-15")], balances: new Map([["c1", 100]]), laterPayments: new Map([["c1", 60]]), statementThrough: CUT,
  });
  assert.deepEqual(openOf(d), { 1: 40 });
});

test("a balance above every invoice is reported, never spread or dropped silently", () => {
  const d = deriveFromAccountBalances({ invoices: [inv(1, 100, "2026-09-15")], balances: new Map([["c1", 175], ["c9", 20]]), statementThrough: CUT });
  assert.deepEqual(openOf(d), { 1: 100 });
  assert.deepEqual(d.excess, [{ clientKey: "c1", cents: 75 }, { clientKey: "c9", cents: 20 }]);
});

test("a client the report omits: old invoices settled, new ones open; undated and clientless stay out of the file", () => {
  const d = deriveFromAccountBalances({
    invoices: [inv(1, 100, "2026-09-15"), inv(2, 40, "2026-10-15"), inv(3, 9, null), inv(4, 8, "2026-09-15", null)],
    balances: new Map(), statementThrough: CUT,
  });
  assert.deepEqual(openOf(d), { 1: 0, 2: 40 });
  assert.deepEqual(d.notInReport, [{ clientKey: "c1", invoices: 2, cents: 140 }]);
  assert.deepEqual(d.undated.map((i) => i.number), [3]);
  assert.deepEqual(d.noClient.map((i) => i.number), [4]);
});

test("every account's open total equals what it owes", () => {
  const invoices = [inv(1, 100, "2026-06-01"), inv(2, 250, "2026-09-01"), inv(3, 75, "2026-10-01"), inv(4, 60, "2026-08-01", "c2"), inv(5, 90, "2026-09-02", "c2")];
  const d = deriveFromAccountBalances({ invoices, balances: new Map([["c1", 200], ["c2", 100]]), statementThrough: CUT });
  const o = openOf(d);
  assert.equal(o[1] + o[2] + o[3], 275);
  assert.equal(o[4] + o[5], 100);
});

test("exportDay reads the portal's date cell", () => {
  assert.equal(exportDay("6/27/2025 12:00:00 AM"), "2025-06-27");
  assert.equal(exportDay("2026-01-08"), "2026-01-08");
  assert.equal(exportDay("soon"), null);
});

const table = (rows) => Buffer.from(`<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);
const REPORT = table([["Acct", "Client", "Amount Due", "Due", "Payments Received", "Adjustments", "Balance"], ["100", "Example Dental", "$500.00", "x", "$400.00", "$0.00", "$100.00"]]);
const PAYMENTS = table([["Date", "Acct", "Amount", "Reference", "Notes"], ["10/15/2026", "100", "$400.00", "r", "n"], ["11/2/2026", "100", "$25.00", "r", "n"]]);

function rig() {
  const store = fakeRawStore();
  const lines = [];
  const files = { "ab.xls": REPORT, "pay.xls": PAYMENTS };
  const deps = {
    print: (l) => lines.push(...l), printReport: () => {}, readFile: async (p) => files[p], now: () => new Date("2026-11-06T12:00:00Z"),
    openStore: async () => ({ store, close: async () => {}, tryLock: async () => true }),
    loadSeazona: async () => { throw new Error("balance-derive must never load the Seazona service"); },
  };
  return { store, lines, run: (argv) => main(argv, {}, deps) };
}

async function seed(store) {
  const i = (id, invoiceNumber, total, due) => ({ seazonaId: id, payload: { id, invoiceNumber, total, due, clientId: "c1", status: "Shipped" } });
  await store.upsert("invoice", [i("s1", 50001, 100, "2026-09-15"), i("s2", 50002, 60, "2026-09-20"), i("s3", 50003, 30, "2026-10-15")]);
  await store.upsert("client", [{ seazonaId: "c1", payload: { id: "c1", accountNumber: "100", company: "Example Dental" } }]);
}

const ARGS = ["balance-derive", "--balance-file", "ab.xls", "--statement-through", CUT, "--file", "pay.xls", "--payments-through", "2026-10-31", "--columns", "client=Acct"];

test("the report's Balance column is read, not Amount Due; dry run stores nothing", async () => {
  const r = rig();
  await seed(r.store);
  assert.equal(await r.run(ARGS), 0);
  const text = r.lines.join("\n");
  assert.match(text, /net 10000 cents/);
  assert.match(text, /Payments after 2026-10-31: 1 \(2500 cents\)/);
  // 100 + 30 unstatemented − 25 later payment = 105 owed.
  assert.match(text, /Derived open balance: 10500 cents/);
  assert.match(text, /Dry run/);
});

test("live seals the source files and a derived file the per-invoice reader takes", async () => {
  const r = rig();
  await seed(r.store);
  assert.equal(await r.run([...ARGS, "--live"]), 0);
  const id = /as file (\S+) /.exec(r.lines.join("\n"))[1];
  const stored = await r.store.readFile(id);
  assert.equal(stored.kind, "payments_derived");
  const read = readExport(stored.bytes, { kind: "invoice" });
  assert.deepEqual(read.rows.map((x) => [x.key, x.cents]), [[50001, 1500], [50002, 6000], [50003, 3000]]);
  assert.deepEqual(read.problems, []);
  assert.equal(derivedProvenance(stored.bytes).method, "account-balance");
});

test("live refuses when a report row matches no client, or an account owes beyond its invoices", async () => {
  const r = rig();
  await r.store.upsert("client", [{ seazonaId: "c1", payload: { id: "c1", accountNumber: "999", company: "Other" } }]);
  await assert.rejects(r.run(["balance-derive", "--balance-file", "ab.xls", "--statement-through", CUT, "--live"]), /accept-unresolved-accounts/);
  assert.equal(r.lines.some((l) => /Sealed/.test(l)), false);
});
