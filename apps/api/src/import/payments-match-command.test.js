import { test } from "vitest";
import assert from "node:assert/strict";
import { main } from "./fetch-cli.js";
import { readExport } from "./export-table.js";
import { derivedProvenance } from "./payments-export.js";
import { invoicesFromRecords, clientResolver } from "./payments-match-command.js";
import { fakeRawStore } from "../test/fake-raw-store.js";

// Fake practices, accounts and invoice numbers only.
const table = (rows) => Buffer.from(`<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);
const HEAD = ["Date", "Client", "Amount", "Reference", "Notes"];

function rig(files) {
  const store = fakeRawStore();
  const out = { lines: [], written: new Map() };
  let clock = Date.parse("2026-11-05T12:00:00Z");
  const deps = {
    print: (l) => out.lines.push(...l),
    printReport: () => {},
    readFile: async (p) => files[p],
    writeFile: async (p, data, opts) => {
      if (opts?.flag === "wx" && out.written.has(p)) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      out.written.set(p, { data, opts });
    },
    now: () => new Date((clock += 1000) - 1000), // one second per run, so default review paths never collide
    openStore: async () => ({ store, close: async () => {}, tryLock: async () => true }),
    loadSeazona: async () => { throw new Error("payments-match must never load the Seazona service"); },
  };
  return { store, out, run: (argv) => main(argv, {}, deps), text: () => out.lines.join("\n") };
}

async function seedArchive(store) {
  const inv = (id, invoiceNumber, total, clientId, status = "Shipped") => ({ seazonaId: id, payload: { id, invoiceNumber, total, clientId, status } });
  await store.upsert("invoice", [
    inv("s1", 50001, 100, "c1"), inv("s2", 50002, 50, "c1"), inv("s3", 50003, 80, "c1"),
    inv("s4", 50004, 20, "c2"), inv("s5", 50005, 30, "c2", "Void"), inv("s6", 50006, 40, "c1"), inv("s7", 50007, 0, "c1"),
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
  assert.match(t, /Payments read: 5 from 2 file\(s\) \(1 repeated across files dropped; 0 reversal\/void row\(s\) subtracted; 0 problem row\(s\)\)/);
  assert.match(t, /client resolved: 5 \(100\.0%/);
  assert.match(t, /attributed 3, client unknown \(invoices unclear\) 0, cross-client \(not applied\) 1 \(2000 cents\), unattributed \(no known invoice named\) 1 \(1500 cents\)/);
  assert.match(t, /unattributed refunds: 0 \(0 cents\)/);
  assert.match(t, /prefixed reference \(inv \/ invoice \/ #\): 2; by a bare number: 2/);
  assert.match(t, /left out: 1 void/);
  assert.match(t, /paid: 1 invoice\(s\), 10000 cents billed, 0 cents left open/);
  assert.match(t, /unclear: 2 invoice\(s\), 13000 cents billed, 13000 cents left open/);
  assert.match(t, /partial: 1 invoice\(s\), 4000 cents billed, 3000 cents left open/);
  assert.match(t, /unpaid: 1 invoice\(s\), 2000 cents billed, 2000 cents left open/);
  assert.match(t, /zero-total: 1 invoice\(s\), 0 cents billed, 0 cents left open/);
  assert.match(t, /Dry run: nothing was stored/);
  for (const secret of ["Fake Patient", "secret note", "Example Dental", "Sample Smiles"]) assert.ok(!t.includes(secret), secret);
  assert.equal(r.store.files.size, 0);
  const csv = r.out.written.get("/review.csv");
  assert.deepEqual(csv.opts, { mode: 0o600, flag: "wx" });
  assert.equal(csv.data, [
    "invoice_number,status,flags,total_cents,definite_cents,open_cents,payment_ids,payment_dates,payment_amounts_cents",
    "50002,unclear,,5000,0,5000,f1:L3,01/06/2026,10000",
    "50003,unclear,,8000,0,8000,f1:L3,01/06/2026,10000",
    "50006,partial,,4000,1000,3000,f2:L3,02/02/2026,1000",
    "",
  ].join("\n"));
  assert.ok(!csv.data.includes("secret") && !csv.data.includes("Example"));
  await assert.rejects(r.run(["payments-match", "--file", "jan.xls", "--review-out", "/review.csv"]), /already exists; it is never overwritten/);
});

test("the review CSV defaults to the OS temp dir and the path is printed", async () => {
  const r = rig({ "jan.xls": JAN });
  await seedArchive(r.store);
  await r.run(["payments-match", "--file", "jan.xls"]);
  const [path] = r.out.written.keys();
  assert.match(path, /payments-match-review-2026-11-05T12-00-00-000Z\.csv$/);
  assert.ok(r.text().includes(path));
});

test("--live seals the raw exports and the derived balances with provenance; every per-invoice reader accepts it", async () => {
  const r = rig({ "jan.xls": JAN, "feb.xls": FEB });
  await seedArchive(r.store);
  assert.equal(await r.run(["payments-match", "--file", "jan.xls", "--file", "feb.xls", "--live"]), 0);
  const kinds = [...r.store.files.values()].map((f) => f.kind);
  assert.deepEqual(kinds, ["payments_export", "payments_export", "payments_derived"]);
  assert.match(r.text(), /NEXT: import:load balances --balances per-invoice --file-id file3/);
  const bytes = r.store.files.get("file3").bytes;
  assert.deepEqual(derivedProvenance(bytes), {
    maxInvoiceNumber: 50007, invoiceRecords: 7, derivedRows: 6, sourceFiles: 2, unclear: "credit-definite", derivedAt: "2026-11-05T12:00:00.000Z",
  });
  const parsed = readExport(bytes, { kind: "invoice" });
  assert.deepEqual(parsed.problems, []);
  assert.deepEqual(parsed.rows.map(({ key, cents }) => [key, cents]), [[50001, 0], [50002, 5000], [50003, 8000], [50004, 2000], [50006, 3000], [50007, 0]]);
  await r.run(["invoices", "--detail", "--open-balance", "--file-id", "file3"]);
  assert.match(r.text(), /Plan: 4 Seazona request/);
});

test("--unclear open is recorded; the old 'review' value and other values are refused", async () => {
  const r = rig({ "jan.xls": JAN });
  await seedArchive(r.store);
  await r.run(["payments-match", "--file", "jan.xls", "--unclear", "open", "--live"]);
  assert.equal(derivedProvenance([...r.store.files.values()].pop().bytes).unclear, "open");
  await assert.rejects(r.run(["payments-match", "--file", "jan.xls", "--unclear", "review"]), /--unclear must be credit-definite/);
});

test("live gates: unresolved clients, an unmapped status-like column, unattributed refunds; each waivable with its own flag", async () => {
  const files = {
    "who.xls": table([HEAD, ["01/05/2026", "Some Other Practice", "100.00", "Invoices 50001", ""]]),
    "type.xls": table([[...HEAD, "Transaction Type"], ["01/05/2026", "ACC-100", "100.00", "Invoices 50001", "", "Visa"]]),
    "refund.xls": table([HEAD, ["01/05/2026", "ACC-100", "-5.00", "chk 12", ""]]),
  };
  const r = rig(files);
  await seedArchive(r.store);
  await assert.rejects(r.run(["payments-match", "--file", "who.xls", "--live"]), /99% of payments resolve.*--accept-unresolved-clients/);
  assert.match(r.text(), /client resolved: 0 \(0\.0%/);
  assert.match(r.text(), /client unknown \(invoices unclear\) 1/);
  assert.equal(await r.run(["payments-match", "--file", "who.xls", "--live", "--accept-unresolved-clients"]), 0);
  await assert.rejects(r.run(["payments-match", "--file", "type.xls", "--live"]), /looks like a status.*--accept-unmapped-status/);
  assert.match(r.text(), /UNMAPPED status-like column\(s\): "Transaction Type"/);
  assert.equal(await r.run(["payments-match", "--file", "type.xls", "--live", "--columns", "status=Transaction Type"]), 0);
  await assert.rejects(r.run(["payments-match", "--file", "refund.xls", "--live"]), /refunds name no known invoice.*--accept-unattributed-refunds/);
  assert.match(r.text(), /unattributed refunds: 1 \(-500 cents\)/);
  assert.equal(await r.run(["payments-match", "--file", "refund.xls", "--live", "--accept-unattributed-refunds"]), 0);
});

test("a payment row plus a separate reversal row for the same invoice nets to 0: the invoice stays open", async () => {
  const head = [...HEAD, "Status"];
  const r = rig({
    "rev.xls": table([
      head,
      ["01/05/2026", "ACC-100", "100.00", "Invoices 50001", "", "Posted"],
      ["01/09/2026", "ACC-100", "100.00", "Invoices 50001", "", "Reversed"],
    ]),
  });
  await seedArchive(r.store);
  assert.equal(await r.run(["payments-match", "--file", "rev.xls", "--live"]), 0);
  assert.match(r.text(), /; 1 reversal\/void row\(s\) subtracted;/);
  const rows = readExport([...r.store.files.values()].pop().bytes, { kind: "invoice" }).rows;
  assert.deepEqual(rows.find((x) => x.key === 50001).cents, 10000, "fully open: the reversal cancelled the payment");
});

test("a reversal that names no invoice is an unattributed refund and hits the same gate", async () => {
  const r = rig({ "rev.xls": table([[...HEAD, "Status"], ["01/09/2026", "ACC-100", "40.00", "chk 9911", "", "Returned"]]) });
  await seedArchive(r.store);
  await assert.rejects(r.run(["payments-match", "--file", "rev.xls", "--live"]), /refunds name no known invoice.*--accept-unattributed-refunds/);
  assert.match(r.text(), /unattributed refunds: 1 \(-4000 cents\)/);
});

test("a live run refuses on export problems unless accepted; stray flags and a missing file are refused", async () => {
  const bad = table([HEAD, ["01/05/2026", "ACC-100", "oops", "50001", ""], ["01/06/2026", "ACC-100", "1.00", "50001", ""]]);
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
  await assert.rejects(r.run(["invoices", "--accept-unresolved-clients"]), /belongs to export or payments-match/);
  await assert.rejects(r.run(["export", "--balances", "per-invoice", "--file", "a", "--file", "b"]), /one file/);
});

test("invoices from records: a duplicated number is credited for NEITHER record and listed; void, unnumbered, bad totals left out", () => {
  const rec = (seazonaId, payload) => ({ seazonaId, payload });
  const { invoices, skipped, duplicateNumbers } = invoicesFromRecords([
    rec("s9", { invoiceNumber: 1, total: 3, clientId: 9 }), rec("s1", { invoiceNumber: 1, total: 10, clientId: 7 }),
    rec("s2", { invoiceNumber: 2, total: 5, status: "Void" }), rec("s3", { invoiceNumber: "x", total: 5 }), rec("s4", { invoiceNumber: 3, total: -1 }),
    rec("s5", { invoiceNumber: 4, total: 8, clientId: 7 }),
  ]);
  assert.deepEqual(invoices, [{ number: 4, totalCents: 800, clientKey: "7" }]);
  assert.deepEqual(skipped, { void: 1, noNumber: 1, badTotal: 1, duplicateNumber: 2 });
  assert.deepEqual(duplicateNumbers, [1]);
});

test("a payment naming a duplicated number credits nothing; the number is printed", async () => {
  const r = rig({ "dup.xls": table([HEAD, ["01/05/2026", "ACC-100", "100.00", "Invoices 50001", ""]]) });
  await seedArchive(r.store);
  await r.store.upsert("invoice", [{ seazonaId: "s1b", payload: { id: "s1b", invoiceNumber: 50001, total: 100, clientId: "c1", status: "Shipped" } }]);
  assert.equal(await r.run(["payments-match", "--file", "dup.xls", "--live"]), 0);
  const rows = readExport([...r.store.files.values()].pop().bytes, { kind: "invoice" }).rows;
  assert.equal(rows.some((x) => x.key === 50001), false, "not in the derived file: the loader keeps it open (absent or duplicated)");
  assert.match(r.text(), /invoice number\(s\) on more than one record \(never credited\): 1: 50001/);
  assert.match(r.text(), /unattributed \(no known invoice named\) 1/);
});

test("client resolver: account number or exact practice name; a shared account or name resolves to nothing", () => {
  const resolve = clientResolver([
    { seazonaId: "c1", payload: { accountNumber: "ACC-1", company: "Shared Name" } },
    { seazonaId: "c2", payload: { accountNumber: "ACC-2", company: "Shared Name", fullName: "Only Two" } },
    { seazonaId: "c3", payload: { accountNumber: "acc-2" } },
  ]);
  assert.equal(resolve(" acc-1 "), "c1");
  assert.equal(resolve("Only Two"), "c2");
  assert.equal(resolve("Shared Name"), null);
  assert.equal(resolve("ACC-2"), null, "two clients carry that account number");
  assert.equal(resolve(""), null);
  assert.equal(resolve(null), null);
});
