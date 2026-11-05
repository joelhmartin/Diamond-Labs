import { test } from "vitest";
import assert from "node:assert/strict";
import { main } from "./fetch-cli.js";
import { readExport } from "./export-table.js";
import { invoicesFromRecords, clientResolver } from "./payments-match-command.js";
import { fakeRawStore } from "../test/fake-raw-store.js";

// Fake practices, accounts and invoice numbers only.
const table = (rows) => Buffer.from(`<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);
const HEAD = ["Date", "Client", "Amount", "Reference", "Notes"];

function rig(files) {
  const store = fakeRawStore();
  const out = { lines: [], written: new Map() };
  const deps = {
    print: (l) => out.lines.push(...l),
    printReport: () => {},
    readFile: async (p) => files[p],
    writeFile: async (p, data, opts) => out.written.set(p, { data, opts }),
    now: () => new Date("2026-11-05T12:00:00Z"),
    openStore: async () => ({ store, close: async () => {}, tryLock: async () => true }),
    loadSeazona: async () => { throw new Error("payments-match must never load the Seazona service"); },
  };
  return { store, out, run: (argv) => main(argv, {}, deps), text: () => out.lines.join("\n") };
}

async function seedArchive(store) {
  const inv = (id, invoiceNumber, total, clientId, status = "Shipped") => ({ seazonaId: id, payload: { id, invoiceNumber, total, clientId, status } });
  await store.upsert("invoice", [
    inv("s1", 50001, 100, "c1"), inv("s2", 50002, 50, "c1"), inv("s3", 50003, 80, "c1"),
    inv("s4", 50004, 20, "c2"), inv("s5", 50005, 30, "c2", "Void"), inv("s6", 50006, 40, "c1"),
  ]);
  await store.upsert("client", [
    { seazonaId: "c1", payload: { id: "c1", accountNumber: "ACC-100", company: "Example Dental Studio" } },
    { seazonaId: "c2", payload: { id: "c2", accountNumber: "ACC-200", company: "Sample Smiles" } },
  ]);
}

const JAN = table([
  HEAD,
  ["01/05/2026", "ACC-100", "100.00", "Invoices 50001", "Fake Patient Name"],
  ["01/06/2026", "Example Dental Studio", "100.00", "", "inv 50002 & 50003 secret note"],
  ["01/07/2026", "ACC-200", "20.00", "", "50001"],
  ["01/08/2026", "ACC-100", "15.00", "chk 4471", ""],
]);
const FEB = table([
  HEAD,
  ["01/08/2026", "ACC-100", "15.00", "chk 4471", ""],
  ["02/02/2026", "ACC-100", "10.00", "", "50006 part"],
]);

test("dry run: counts only, a review CSV, nothing sealed, no names or notes printed", async () => {
  const r = rig({ "jan.xls": JAN, "feb.xls": FEB });
  await seedArchive(r.store);
  assert.equal(await r.run(["payments-match", "--file", "jan.xls", "--file", "feb.xls", "--review-out", "/review.csv"]), 0);
  const t = r.text();
  assert.match(t, /Payments read: 5 from 2 file\(s\) \(1 repeated across files dropped; 0 problem row\(s\)\)/);
  assert.match(t, /attributed 3, unattributed \(no known invoice named\) 1 \(1500 cents\), cross-client \(not applied\) 1 \(2000 cents\), client column not recognised 0/);
  assert.match(t, /left out: 1 void/);
  assert.match(t, /paid: 1 invoice\(s\), 10000 cents billed, 0 cents left open/);
  assert.match(t, /unclear: 2 invoice\(s\), 13000 cents billed, 13000 cents left open/);
  assert.match(t, /partial: 1 invoice\(s\), 4000 cents billed, 3000 cents left open/);
  assert.match(t, /unpaid: 1 invoice\(s\), 2000 cents billed, 2000 cents left open/);
  assert.match(t, /Dry run: nothing was stored/);
  for (const secret of ["Fake Patient", "secret note", "Example Dental", "Sample Smiles"]) assert.ok(!t.includes(secret), secret);
  assert.equal(r.store.files.size, 0);
  const csv = r.out.written.get("/review.csv");
  assert.equal(csv.opts.mode, 0o600);
  assert.equal(csv.data, [
    "invoice_number,status,total_cents,definite_cents,open_cents,payment_ids,payment_dates,payment_amounts_cents",
    "50002,unclear,5000,0,5000,f1:L3,01/06/2026,10000",
    "50003,unclear,8000,0,8000,f1:L3,01/06/2026,10000",
    "50006,partial,4000,1000,3000,f2:L3,02/02/2026,1000",
    "",
  ].join("\n"));
  assert.ok(!csv.data.includes("secret") && !csv.data.includes("Example"));
});

test("the review CSV defaults to the OS temp dir and the path is printed", async () => {
  const r = rig({ "jan.xls": JAN });
  await seedArchive(r.store);
  await r.run(["payments-match", "--file", "jan.xls"]);
  const [path] = r.out.written.keys();
  assert.match(path, /payments-match-review-2026-11-05T12-00-00-000Z\.csv$/);
  assert.ok(r.text().includes(path));
});

test("--live seals the raw exports and the derived balances, which every per-invoice reader accepts", async () => {
  const r = rig({ "jan.xls": JAN, "feb.xls": FEB });
  await seedArchive(r.store);
  assert.equal(await r.run(["payments-match", "--file", "jan.xls", "--file", "feb.xls", "--live"]), 0);
  const kinds = [...r.store.files.values()].map((f) => f.kind);
  assert.deepEqual(kinds, ["payments_export", "payments_export", "payments_derived"]);
  assert.match(r.text(), /NEXT: import:load balances --balances per-invoice --file-id file3/);
  const parsed = readExport(r.store.files.get("file3").bytes, { kind: "invoice" });
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.rows.map(({ key, cents }) => [key, cents]), [[50001, 0], [50002, 5000], [50003, 8000], [50004, 2000], [50006, 3000]]);
  // --open-balance takes the derived file like a lab export.
  await r.run(["invoices", "--detail", "--open-balance", "--file-id", "file3"]);
  assert.match(r.text(), /Plan: 4 Seazona request/);
});

test("--unclear review credits only the definite part; a bad value is refused", async () => {
  const r = rig({ "jan.xls": JAN });
  await seedArchive(r.store);
  await r.run(["payments-match", "--file", "jan.xls", "--unclear", "review", "--live"]);
  assert.match(r.text(), /2 unclear invoice\(s\) to review/);
  await assert.rejects(r.run(["payments-match", "--file", "jan.xls", "--unclear", "paid"]), /--unclear must be open/);
});

test("a live run refuses on export problems unless accepted; stray flags and a missing file are refused", async () => {
  const bad = table([HEAD, ["01/05/2026", "ACC-100", "oops", "50001", ""]]);
  const r = rig({ "bad.xls": bad });
  await seedArchive(r.store);
  await assert.rejects(r.run(["payments-match", "--file", "bad.xls", "--live"]), /problem rows/);
  assert.equal(r.store.files.size, 0);
  assert.equal(await r.run(["payments-match", "--file", "bad.xls", "--live", "--accept-export-problems"]), 0);
  assert.match(r.text(), /payment-row-bad-amount x1: rows 2/);
  await assert.rejects(r.run(["payments-match", "--file", "bad.xls", "--accept-export-problems"]), /only with --live/);
  await assert.rejects(r.run(["payments-match"]), /Usage: import:fetch payments-match/);
  await assert.rejects(r.run(["payments-match", "--file", "bad.xls", "--approved", "5"]), /payments-match takes only/);
  await assert.rejects(r.run(["invoices", "--unclear", "open"]), /belongs to export or payments-match/);
  await assert.rejects(r.run(["export", "--balances", "per-invoice", "--file", "a", "--file", "b"]), /one file/);
});

test("invoices from records: void, unnumbered, bad-total and duplicate numbers are left out", () => {
  const rec = (payload) => ({ payload });
  const { invoices, skipped } = invoicesFromRecords([
    rec({ invoiceNumber: 1, total: 10, clientId: 7 }), rec({ invoiceNumber: 2, total: 5, status: "Void" }),
    rec({ invoiceNumber: "x", total: 5 }), rec({ invoiceNumber: 3, total: -1 }), rec({ invoiceNumber: 1, total: 3 }),
  ]);
  assert.deepEqual(invoices, [{ number: 1, totalCents: 1000, clientKey: "7" }]);
  assert.deepEqual(skipped, { void: 1, noNumber: 1, badTotal: 1, duplicateNumber: 1 });
});

test("client resolver: account number or exact practice name; a shared name resolves to nothing", () => {
  const resolve = clientResolver([
    { seazonaId: "c1", payload: { accountNumber: "ACC-1", company: "Shared Name" } },
    { seazonaId: "c2", payload: { accountNumber: "ACC-2", company: "Shared Name", fullName: "Only Two" } },
  ]);
  assert.equal(resolve(" acc-1 "), "c1");
  assert.equal(resolve("Only Two"), "c2");
  assert.equal(resolve("Shared Name"), null);
  assert.equal(resolve(""), null);
  assert.equal(resolve(null), null);
});
