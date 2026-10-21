process.env.PHI_ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeTx } from "../test/fake-tx.js";
import { fakeLock } from "../test/fake-lock.js";

const { main } = await import("./parity-cli.js");
const { ImportRefusal } = await import("./import-errors.js");

const fixture = (n) => readFileSync(new URL(`../../test-fixtures/seazona/${n}`, import.meta.url));

// A raw store with one client, no invoices and no orders, and a target with nothing loaded: parity has
// differences to report (the client is unlinked) but must never touch the target.
function rig({ files = {}, selects, lockHeld = true } = {}) {
  const out = { reports: [], lines: [], saved: [], closed: 0, flags: null, lock: fakeLock({ held: lockHeld }) };
  const tx = fakeTx({ selects: selects ?? [[], [], [], [], [], [], [], []] });
  const records = { client: [{ seazonaId: "c1", payload: { id: "c1", accountNumber: "1324" } }] };
  const raw = {
    records: async (e) => records[e] ?? [],
    readFile: async (id) => files[id] ?? null,
    saveParityReport: async (o) => { out.saved.push(o); return "p1"; },
  };
  const deps = {
    printReport: (r) => out.reports.push(r),
    print: (l) => out.lines.push(...l),
    openSession: async (env, flags, opts) => {
      out.flags = { flags, opts };
      return { target: { name: flags.target, database: "diamond_labs_rehearsal" }, raw, db: tx, makeLock: () => out.lock, close: async () => { out.closed += 1; } };
    },
  };
  return { out, tx, run: (argv, env = {}) => main(argv, env, deps) };
}

test("parity is read-only on the target: no insert, update, delete or transaction, and the session opens without write checks", async () => {
  const r = rig();
  assert.equal(await r.run(["--target", "rehearsal"]), 4, "a client with no loaded user is a difference");
  assert.equal(r.tx.log.some((e) => ["insert", "update", "delete"].includes(e.op)), false);
  assert.deepEqual(r.out.flags.opts, { writes: false });
  assert.equal(r.out.closed, 1);
  assert.equal(r.out.saved.length, 1, "the report is saved to the import DB");
  assert.equal(r.out.saved[0].clean, false);
  assert.ok(r.out.reports[0].differences.includes("clients"));
  assert.ok(r.out.reports[0].differences.includes("no balance export compared"));
});

test("with a stored export its rows and problems join the report", async () => {
  const r = rig({ files: { f1: { kind: "balances_invoice", bytes: fixture("invoices-export.xls") } } });
  await r.run(["--target", "rehearsal", "--balances", "per-invoice", "--file-id", "f1"]);
  const report = r.out.reports[0];
  assert.equal(report.balances.exportTotalCents, 125000 + 12050);
  assert.equal(report.balances.creditCents, 2000);
  assert.deepEqual(report.exportProblems.map((p) => [p.kind, p.lines]), [["export-row-bad-balance", [6]], ["export-row-no-key", [8]]]);
  assert.ok(report.differences.includes("balance export problems"));
  assert.ok(!/Example|Sample/.test(JSON.stringify(report)));
});

test("refusals: Cloud Run, a bad --balances, a missing or wrong-kind file, stray export flags", async () => {
  const r = rig({ files: { f1: { kind: "balances_client", bytes: fixture("statements-export.xls") } } });
  await assert.rejects(r.run(["--target", "rehearsal"], { K_SERVICE: "x" }), /Cloud Run/);
  await assert.rejects(r.run(["--target", "rehearsal", "--balances", "daily", "--file-id", "f1"]), /per-invoice or per-client/);
  await assert.rejects(r.run(["--target", "rehearsal", "--balances", "per-invoice", "--file-id", "f1"]), /No per-invoice export stored/);
  await assert.rejects(r.run(["--target", "rehearsal", "--balances", "per-invoice"]), /No per-invoice export stored/);
  await assert.rejects(r.run(["--target", "rehearsal", "--file-id", "f1"]), ImportRefusal);
  await assert.rejects(r.run(["--target", "rehearsal", "--live"]), /Unknown flag/);
});

test("with no configuration at all the real session refuses cleanly (Q1 smoke)", async () => {
  await assert.rejects(main(["--target", "rehearsal"], {}), /REHEARSAL_DATABASE_URL is not set/);
  await assert.rejects(main(["--target", "staging"], {}), /--target must be rehearsal or production/);
});

test("--accept moves named differences to `accepted` in the printed and the saved report; exit 0 only when none remain", async () => {
  const kinds = "clients,no balance export compared,orders not loaded,seeds";
  const r = rig();
  assert.equal(await r.run(["--target", "rehearsal", "--accept", kinds]), 0);
  assert.deepEqual(r.out.reports[0].differences, []);
  assert.ok(r.out.reports[0].accepted.includes("clients"));
  assert.deepEqual(r.out.saved[0].report.accepted, r.out.reports[0].accepted);
  assert.equal(r.out.saved[0].clean, true);
  assert.equal(r.out.reports[0].reportId, "p1");
  assert.match(r.out.lines.join("\n"), /Saved as parity report p1\. Accepted: clients/);
  const partial = rig();
  assert.equal(await partial.run(["--target", "rehearsal", "--accept", "clients"]), 4);
  assert.deepEqual(partial.out.reports[0].differences, ["no balance export compared"]);
  const none = rig();
  assert.equal(await none.run(["--target", "rehearsal"]), 4);
  assert.equal(none.out.reports[0].accepted, undefined, "accepting nothing changes nothing");
});

test("--accept with an unknown kind is refused before anything opens", async () => {
  const r = rig();
  await assert.rejects(r.run(["--target", "rehearsal", "--accept", "clients,nonsense"]), /unknown difference kind\(s\) nonsense/);
  assert.equal(r.out.flags, null);
});

test("parity takes the load lock, refuses while a load holds it, and releases it", async () => {
  const ok = rig();
  await ok.run(["--target", "rehearsal"]);
  assert.deepEqual(ok.out.lock.calls.filter((c) => c !== "assert"), ["tryLock", "close"]);
  const busy = rig({ lockHeld: false });
  await assert.rejects(busy.run(["--target", "rehearsal"]), /load lock is held/);
  assert.equal(busy.out.reports.length, 0, "nothing read");
  assert.equal(busy.out.saved.length, 0);
  assert.equal(busy.out.closed, 1);
});
