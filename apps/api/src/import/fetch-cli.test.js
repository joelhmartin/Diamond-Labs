import { test } from "vitest";
import assert from "node:assert/strict";
import { main } from "./fetch-cli.js";
import { ImportRefusal } from "./import-errors.js";
import { FetchLockLost } from "./fetch-lock.js";
import { fakeRawStore } from "../test/fake-raw-store.js";

// main() is driven with injected fakes: no database, no Seazona, no env file.
function rig({ store = fakeRawStore(), seazona = {}, files = {}, lockFree = true } = {}) {
  const out = { lines: [], reports: [], loads: 0, lock: { free: lockFree, taken: 0 } };
  const deps = {
    print: (l) => out.lines.push(...l),
    printReport: (r) => out.reports.push(r),
    readFile: async (p) => files[p] ?? Buffer.from(""),
    openStore: async () => ({ store, close: async () => {}, assertHeld: () => out.lock.check?.(), tryLock: async () => { out.lock.taken += 1; return out.lock.free; } }),
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
  assert.match(text(r.out), /Plan: 2 Seazona request\(s\), about 1 min at 30\/min/);
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

test("a live run is refused while another run of the same entity is still running; --mark-stale clears it", async () => {
  const seazona = { listClientsResult: async () => ({ ok: true, status: 200, clients: [{ id: "c1" }] }) };
  const r = rig({ seazona });
  await r.store.startRun({ entity: "client", mode: "summary" });
  await assert.rejects(r.run(["clients", "--live"]), /Run run1 \(client\) is still marked running.*--mark-stale run1/);
  assert.equal(r.out.loads, 0);
  assert.equal(await r.run(["clients"]), 0, "a dry run is not blocked");
  assert.equal(await r.run(["clients", "--mark-stale", "run1"]), 0);
  assert.equal(r.store.runs.get("run1").status, "failed");
  assert.equal(await r.run(["clients", "--live"]), 0);
  await assert.rejects(r.run(["clients", "--mark-stale", "run1"]), /not running/);
});

test("a crashed detail run can be resumed even though it is still marked running", async () => {
  const seazona = { getInvoiceResult: async (id) => ({ ok: true, status: 200, invoice: { id } }) };
  const r = rig({ seazona });
  const id = await r.store.startRun({ entity: "invoice_detail", mode: "detail", plannedIds: ["a", "b"] });
  assert.equal(await r.run(["invoices", "--detail", "--resume", id, "--live"]), 0);
});

test("a list that needs more pages than planned exits 3 with a re-plan message", async () => {
  const seazona = { getAllInvoicesResult: async (o) => ({ reachable: true, status: 200, invoices: [], requests: o.maxPages, truncated: true, budgetExhausted: true }) };
  const r = rig({ seazona });
  assert.equal(await r.run(["invoices", "--live"]), 3);
  assert.match(text(r.out), /needed more pages than allowed \(2 used\).*--approved 4/);
});

test("export refuses flags that only apply to fetches", async () => {
  const r = rig();
  await assert.rejects(r.run(["export", "--balances", "per-invoice", "--file", "x", "--live"]), /export takes only/);
  await assert.rejects(r.run(["export", "--balances", "per-invoice", "--file", "x", "--approved", "5"]), /export takes only/);
});

test("a second live fetch is refused while another process holds the lock; dry runs never take it", async () => {
  const seazona = { listClientsResult: async () => ({ ok: true, status: 200, clients: [{ id: "c1" }] }) };
  const held = rig({ seazona, lockFree: false });
  await assert.rejects(held.run(["clients", "--live"]), /Another live fetch is running/);
  assert.equal(held.out.loads, 0);
  assert.equal(held.store.runs.size, 0, "refused before startRun");
  assert.equal(await held.run(["clients"]), 0);
  assert.equal(held.out.lock.taken, 1, "only the refused live run asked for the lock");
  const free = rig({ seazona });
  assert.equal(await free.run(["clients", "--live"]), 0);
});

test("--mark-stale and resuming a running run need the lock to be free", async () => {
  const seazona = { getInvoiceResult: async (id) => ({ ok: true, status: 200, invoice: { id } }) };
  const r = rig({ seazona, lockFree: false });
  const id = await r.store.startRun({ entity: "invoice_detail", mode: "detail", plannedIds: ["a"] });
  await assert.rejects(r.run(["invoices", "--mark-stale", id]), /holds the fetch lock/);
  assert.equal(r.store.runs.get(id).status, "running");
  await assert.rejects(r.run(["invoices", "--detail", "--resume", id]), /may still be alive/);
  await assert.rejects(r.run(["invoices", "--detail", "--resume", id, "--live"]), /Another live fetch is running/);
  r.out.lock.free = true;
  assert.equal(await r.run(["invoices", "--detail", "--resume", id, "--live"]), 0);
  const id2 = await r.store.startRun({ entity: "invoice_detail", mode: "detail", plannedIds: ["a"] });
  assert.equal(await r.run(["invoices", "--mark-stale", id2]), 0);
  assert.equal(r.store.runs.get(id2).status, "failed");
});

test("a lost fetch lock stops the run before the next request and fails the run", async () => {
  const calls = [];
  const seazona = { getInvoiceResult: async (id) => { calls.push(id); return { ok: true, status: 200, invoice: { id } }; } };
  const r = rig({ seazona });
  let checks = 0;
  r.out.lock.check = () => { checks += 1; if (checks === 3) throw new FetchLockLost(); };
  await assert.rejects(r.run(["invoices", "--detail", "--ids", "a,b,c,d", "--live"]), FetchLockLost);
  assert.deepEqual(calls, ["a", "b"], "no request after the lock was lost");
  const run = r.store.runs.get("run1");
  assert.equal(run.status, "failed");
  assert.equal(run.cursor, 2, "resume continues from the cursor");
});

test("a lost lock during a list walk fails the run before the next page", async () => {
  const seazona = { getAllInvoicesResult: async (o) => { await o.beforePage(); await o.beforePage(); return { reachable: true, status: 200, invoices: [], requests: 2, truncated: false }; } };
  const r = rig({ seazona });
  let checks = 0;
  r.out.lock.check = () => { checks += 1; if (checks === 2) throw new FetchLockLost(); };
  await assert.rejects(r.run(["invoices", "--live"]), FetchLockLost);
  assert.equal(r.store.runs.get("run1").status, "failed");
});
