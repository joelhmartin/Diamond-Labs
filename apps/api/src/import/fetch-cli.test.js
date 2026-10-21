import { test } from "vitest";
import assert from "node:assert/strict";
import { main } from "./fetch-cli.js";
import { ImportRefusal } from "./import-errors.js";
import { fakeRawStore } from "../test/fake-raw-store.js";

// main() is driven with injected fakes: no database, no Seazona, no env file.
function rig({ store = fakeRawStore(), seazona = {}, files = {} } = {}) {
  const out = { lines: [], reports: [], loads: 0 };
  const deps = {
    print: (l) => out.lines.push(...l),
    printReport: (r) => out.reports.push(r),
    readFile: async (p) => files[p] ?? Buffer.from(""),
    openStore: async () => ({ store, close: async () => {} }),
    loadSeazona: async () => { out.loads += 1; return seazona; },
    pace: async () => {},
  };
  return { out, deps, store, run: (argv, env = {}) => main(argv, env, deps) };
}

const seed = (store, entity, rows) => store.upsert(entity, rows.map((r) => ({ seazonaId: r.id, payload: r, lastModified: r.lastModified ?? null })));
const text = (out) => out.lines.join("\n");

test("a dry run prints the plan and never loads the Seazona service", async () => {
  const r = rig();
  assert.equal(await r.run(["invoices"]), 0);
  assert.match(text(r.out), /Plan: 1 Seazona request\(s\), about 1 min at 30\/min/);
  assert.match(text(r.out), /Dry run/);
  assert.equal(r.out.loads, 0);
});

test("Cloud Run, unknown flags, and detail flags without --detail are refused", async () => {
  const r = rig();
  await assert.rejects(r.run(["invoices"], { K_SERVICE: "x" }), ImportRefusal);
  await assert.rejects(r.run(["invoices", "--nope"]), /Unknown flag/);
  await assert.rejects(r.run(["invoices", "--since", "2026-01-01"]), /belongs to --detail/);
  await assert.rejects(r.run(["clients", "--detail", "--ids", "a"]), /no detail fetch/);
  assert.equal(r.out.loads, 0);
});

test("a live run over 100 requests is refused without --approved, before the service loads", async () => {
  const r = rig();
  await seed(r.store, "invoice", Array.from({ length: 101 }, (_, i) => ({ id: `i${i}`, date: "2026-02-01" })));
  await assert.rejects(r.run(["invoices", "--detail", "--since", "2026-01-01", "--live"]), /--approved 101/);
  assert.equal(r.out.loads, 0);
  const dry = await r.run(["invoices", "--detail", "--since", "2026-01-01"]);
  assert.equal(dry, 0);
  assert.match(text(r.out), /with their OK re-run with --live --approved 101/);
});

test("a 403 mid-detail run exits 3, says BLOCKED, and points at --resume", async () => {
  let n = 0;
  const seazona = { getInvoiceResult: async (id) => ((n += 1) === 2 ? { ok: false, status: 403, invoice: null } : { ok: true, status: 200, invoice: { id } }) };
  const r = rig({ seazona });
  assert.equal(await r.run(["invoices", "--detail", "--ids", "a,b,c", "--live"]), 3);
  assert.equal(n, 2, "no call after the block");
  assert.match(text(r.out), /BLOCKED/);
  assert.match(text(r.out), /--detail --resume run1/);
  // resume: starts at the cursor
  const seen = [];
  const again = rig({ store: r.store, seazona: { getInvoiceResult: async (id) => { seen.push(id); return { ok: true, status: 200, invoice: { id } }; } } });
  assert.equal(await again.run(["invoices", "--detail", "--resume", "run1", "--live"]), 0);
  assert.deepEqual(seen, ["b", "c"]);
  await assert.rejects(again.run(["invoices", "--detail", "--resume", "run1", "--live"]), /already finished/);
});

test("--resume cannot be mixed with a filter", async () => {
  const r = rig();
  await assert.rejects(r.run(["invoices", "--detail", "--resume", "run1", "--since", "2026-01-01"]), /drop --since/);
});

test("a truncated list walk exits 3 with an operator-attention message and stores nothing", async () => {
  const seazona = { getAllInvoicesResult: async () => ({ reachable: true, status: 200, invoices: [{ id: "a" }], requests: 1, truncated: true }) };
  const r = rig({ seazona });
  assert.equal(await r.run(["invoices", "--live"]), 3);
  assert.match(text(r.out), /NOTHING was stored/);
  assert.equal(r.store.recs.size, 0);
});

test("status 0 reads as unavailable without naming one cause", async () => {
  const seazona = { listClientsResult: async () => ({ ok: false, status: 0, clients: [] }) };
  const r = rig({ seazona });
  assert.equal(await r.run(["clients", "--live"]), 3);
  assert.match(text(r.out), /unavailable \(disabled, credentials or network\)/);
});

test("--refetch makes stored order detail eligible again; without it the order is skipped", async () => {
  const r = rig();
  await seed(r.store, "order", [{ id: "o1", status: "Hold" }, { id: "o2", status: "Shipped" }]);
  await seed(r.store, "order_detail", [{ id: "o1" }]);
  await r.run(["orders", "--detail", "--open"]);
  assert.match(text(r.out), /Plan: 0 Seazona request/);
  r.out.lines.length = 0;
  await r.run(["orders", "--detail", "--open", "--refetch"]);
  assert.match(text(r.out), /Plan: 1 Seazona request/);
});

const table = (rows) => Buffer.from(`<table>${rows.map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`);

test("export seals the file via saveFile and prints the grouped problem shape: ids and row numbers only", async () => {
  const bytes = table([["Invoice #", "Open Balance"], ["1001", "12.50"], ["1002", "oops"], ["Total", "12.50"]]);
  const r = rig({ files: { "balances.xls": bytes } });
  assert.equal(await r.run(["export", "--balances", "per-invoice", "--file", "balances.xls"]), 0);
  assert.equal(r.store.files.size, 1);
  assert.equal([...r.store.files.values()][0].kind, "balances_invoice");
  assert.match(text(r.out), /Stored the per-invoice export as file file1: 1 usable row\(s\), 2 problem row\(s\)/);
  assert.deepEqual(r.out.reports[0], [
    { kind: "export-row-bad-balance", count: 1, seazonaIds: ["1002"], lines: [3] },
    { kind: "export-row-no-key", count: 1, seazonaIds: [], lines: [4] },
  ]);
  await assert.rejects(r.run(["export", "--balances", "weird", "--file", "x"]), /Usage/);
});

test("--open-balance selects invoices whose stored export balance is positive", async () => {
  const r = rig();
  await seed(r.store, "invoice", [{ id: "i1", invoiceNumber: 1001 }, { id: "i2", invoiceNumber: 1002 }, { id: "i3", invoiceNumber: 1003 }]);
  r.store.files.set("f1", { kind: "balances_invoice", bytes: table([["Invoice #", "Open Balance"], ["1001", "12.50"], ["1002", "0.00"]]) });
  await r.run(["invoices", "--detail", "--open-balance", "--file-id", "f1"]);
  assert.match(text(r.out), /Plan: 1 Seazona request/);
  await assert.rejects(r.run(["invoices", "--detail", "--open-balance"]), /needs --file-id/);
  await assert.rejects(r.run(["invoices", "--detail", "--open-balance", "--file-id", "nope"]), /No per-invoice export/);
});
