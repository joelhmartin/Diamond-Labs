import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { fakeRawStore as fakeStore } from "../test/fake-raw-store.js";
import { fetchSummaries, runSummaryCommand, runDetailCommand, createPacer } from "./seazona-fetch.js";

const pace = async () => {}; // tests never wait on the real 2s pacer

// A fake seazona.service: records every call; `detail(id, n)` scripts each answer.
function fakeSeazona({ detail = () => ({ ok: true, status: 200, record: { id: "x" } }), invoices = [], truncated = false, pages = 2 } = {}) {
  const calls = [];
  const answer = (id) => {
    calls.push(id);
    return detail(id, calls.length);
  };
  return {
    calls,
    getInvoiceResult: async (id) => { const a = answer(id); return { ok: a.ok, status: a.status, invoice: a.record ?? null }; },
    getOrderResult: async (id) => { const a = answer(id); return { ok: a.ok, status: a.status, order: a.record ?? null }; },
    // Emulates the service's walk: maxPages caps it (truncated), beforePage runs before each page.
    getAllInvoicesResult: async (opts = {}) => {
      let n = 0;
      for (let i = 0; i < pages; i++) {
        if (opts.maxPages !== undefined && i >= opts.maxPages) return { reachable: true, status: 200, invoices: [], requests: n, truncated: true };
        await opts.beforePage?.();
        calls.push("page");
        n += 1;
      }
      return { reachable: true, status: 200, invoices, requests: n, truncated };
    },
    listClientsResult: async () => { calls.push("clients"); return { ok: false, status: 500, clients: [] }; },
  };
}

const ids = Array.from({ length: 5 }, (_, i) => `inv${i}`);

test("a dry run makes no Seazona call and reports the plan", async () => {
  const seazona = fakeSeazona();
  const out = await runDetailCommand({ entity: "invoice_detail", ids, live: false, seazona, store: fakeStore() });
  assert.deepEqual(out.plan, { requests: 5, minutes: 1 });
  assert.equal(out.dryRun, true);
  assert.equal(seazona.calls.length, 0);
  const summary = await runSummaryCommand({ entity: "invoice", live: false, seazona, store: fakeStore() });
  assert.equal(summary.dryRun, true);
  assert.equal(seazona.calls.length, 0);
});

test("over 100 requests without approval: refused before any call", async () => {
  const seazona = fakeSeazona();
  const many = Array.from({ length: 101 }, (_, i) => `i${i}`);
  const out = await runDetailCommand({ entity: "invoice_detail", ids: many, live: true, seazona, store: fakeStore(), pace });
  assert.match(out.refused, /--approved 101/);
  assert.equal(seazona.calls.length, 0);
});

test("a 403 stops the run at once: no further call, cursor kept, fetched records kept", async () => {
  const seazona = fakeSeazona({ detail: (id, n) => (n === 3 ? { ok: false, status: 403 } : { ok: true, status: 200, record: { id } }) });
  const store = fakeStore();
  const out = await runDetailCommand({ entity: "invoice_detail", ids, live: true, seazona, store, pace });
  assert.equal(out.result.status, "blocked");
  assert.equal(out.result.cursor, 2);
  assert.deepEqual(seazona.calls, ["inv0", "inv1", "inv2"]);
  assert.equal([...store.recs.keys()].length, 2);
  const run = store.runs.get(out.runId);
  assert.equal(run.status, "blocked");
  assert.equal(run.lastStatus, 403);
  assert.deepEqual(run.plannedIds, ids);
});

test("resume starts exactly at the cursor and carries the counts on", async () => {
  const store = fakeStore();
  const first = await runDetailCommand({ entity: "invoice_detail", ids, live: true, store, pace,
    seazona: fakeSeazona({ detail: (id, n) => (n === 3 ? { ok: false, status: 403 } : { ok: true, status: 200, record: { id } }) }) });
  const run = await store.getRun(first.runId);
  const seazona = fakeSeazona();
  const out = await runDetailCommand({ entity: "invoice_detail", ids: run.plannedIds, start: run.cursor, run, live: true, seazona, store, pace });
  assert.deepEqual(seazona.calls, ["inv2", "inv3", "inv4"]);
  assert.equal(out.result.status, "done");
  assert.equal(store.runs.get(first.runId).requestCount, 6, "3 before the block + 3 after");
});

test("a 404 for one record is skipped and counted; anything else stops", async () => {
  const seazona = fakeSeazona({ detail: (id) => (id === "inv1" ? { ok: false, status: 404 } : { ok: true, status: 200, record: { id } }) });
  const out = await runDetailCommand({ entity: "invoice_detail", ids, live: true, seazona, store: fakeStore(), pace });
  assert.equal(out.result.status, "done");
  assert.deepEqual(out.result.missing, ["inv1"]);
  assert.equal(seazona.calls.length, 5);

  const off = fakeSeazona({ detail: () => ({ ok: false, status: 0 }) });
  const stopped = await runDetailCommand({ entity: "invoice_detail", ids, live: true, seazona: off, store: fakeStore(), pace });
  assert.equal(stopped.result.status, "failed");
  assert.equal(off.calls.length, 1, "SEAZONA_DISABLED / network: stop at the first failure");
});

test("summaries: stored with their lastModified; a failed list stores nothing", async () => {
  const store = fakeStore();
  const seazona = fakeSeazona({ invoices: [{ id: "a", lastModified: "2026-10-01T00:00:00" }, { id: "b" }, { noId: true }] });
  const r = await fetchSummaries({ entity: "invoice", seazona, store });
  assert.equal(r.status, "failed", "a record without an id makes the set incomplete: never done");
  assert.equal(r.dropped, 1);
  assert.match(store.runs.get(r.runId).note, /1 record\(s\) had no id/);
  assert.equal(r.count, 2);
  assert.equal(r.requests, 2);
  assert.equal(store.recs.get("invoice:a").lastModified, "2026-10-01T00:00:00");
  const failed = await fetchSummaries({ entity: "client", seazona, store: fakeStore() });
  assert.equal(failed.status, "failed");
  assert.equal(failed.count, 0);
});

test("a truncated list walk is a failed fetch: nothing stored, flagged, not marked done", async () => {
  const store = fakeStore();
  const seazona = fakeSeazona({ invoices: [{ id: "a" }], truncated: true });
  const r = await fetchSummaries({ entity: "invoice", seazona, store });
  assert.equal(r.status, "failed");
  assert.equal(r.truncated, true);
  assert.equal(r.count, 0);
  assert.equal(store.recs.size, 0);
  const run = store.runs.get(r.runId);
  assert.equal(run.status, "failed");
  assert.match(run.note, /truncated/);
});

test("a 403 on a summary list is blocked, not retried", async () => {
  const seazona = fakeSeazona();
  seazona.getAllInvoicesResult = async () => { seazona.calls.push("list"); return { reachable: false, status: 403, invoices: [], requests: 1, truncated: false }; };
  const store = fakeStore();
  const r = await fetchSummaries({ entity: "invoice", seazona, store });
  assert.equal(r.status, "blocked");
  assert.equal(seazona.calls.length, 1);
  assert.equal(store.runs.get(r.runId).lastStatus, 403);
});

test("an unexpected store error mid-run keeps the cursor for --resume and is rethrown", async () => {
  const store = fakeStore();
  let n = 0;
  const upsert = store.upsert;
  store.upsert = async (...a) => { n += 1; if (n === 3) throw new Error("db down"); return upsert(...a); };
  await assert.rejects(runDetailCommand({ entity: "invoice_detail", ids, live: true, seazona: fakeSeazona(), store, pace }), /db down/);
  const [run] = store.runs.values();
  assert.equal(run.status, "failed");
  assert.equal(run.cursor, 2);
});

test("detail calls are paced: each waits out the interval since the previous one", async () => {
  let clock = 1000;
  const slept = [];
  const waitFor = createPacer({ intervalMs: 2000, now: () => clock, sleep: async (ms) => { slept.push(ms); clock += ms; } });
  await waitFor(); // first call: no wait
  clock += 500;
  await waitFor(); // 500ms since the last: wait the remaining 1500
  clock += 5000;
  await waitFor(); // already past the interval: no wait
  assert.deepEqual(slept, [1500]);

  // and the runner awaits the pacer before every request
  const order = [];
  const seazona = fakeSeazona({ detail: (id) => { order.push(`call ${id}`); return { ok: true, status: 200, record: { id } }; } });
  await runDetailCommand({ entity: "invoice_detail", ids: ["a", "b"], live: true, seazona, store: fakeStore(), pace: async () => { order.push("pace"); } });
  assert.deepEqual(order, ["pace", "call a", "pace", "call b"]);
});

test("in src/import, only fetch-cli.js names seazona.service.js, and only through a lazy import()", () => {
  const dir = fileURLToPath(new URL(".", import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".js") && !n.endsWith(".test.js"))) {
    const src = readFileSync(join(dir, f), "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    if (f === "fetch-cli.js") {
      assert.match(code, /import\("\.\.\/services\/seazona\.service\.js"\)/);
      assert.doesNotMatch(code, /^import .*seazona\.service/m, "a static import would load config/env.js");
    } else {
      assert.doesNotMatch(code, /seazona\.service/, f);
    }
  }
});

test("a summary walk honours the plan: paced before every page, capped at the planned count", async () => {
  const events = [];
  const seazona = fakeSeazona({ invoices: [{ id: "a" }] });
  const out = await runSummaryCommand({ entity: "invoice", live: true, seazona, store: fakeStore(), pace: async () => { events.push("pace"); } });
  assert.deepEqual(out.plan, { requests: 2, minutes: 1 });
  assert.equal(out.result.status, "done");
  assert.equal(events.length, 2, "the pacer ran before each of the 2 pages");

  // The walk needs 3 pages but 2 were planned: failed, nothing stored, re-plan message.
  const store = fakeStore();
  const long = fakeSeazona({ invoices: [{ id: "a" }], pages: 3 });
  const capped = await runSummaryCommand({ entity: "invoice", live: true, seazona: long, store, pace });
  assert.equal(capped.result.status, "failed");
  assert.equal(capped.result.needsMorePages, true);
  assert.equal(store.recs.size, 0);
  assert.match(store.runs.get(capped.runId).note, /more pages than planned/);
  assert.equal(long.calls.filter((c) => c === "page").length, 2, "never a request past the plan");
});

test("--approved lowers the page cap below the plan", async () => {
  const seazona = fakeSeazona({ invoices: [{ id: "a" }], pages: 2 });
  const out = await runSummaryCommand({ entity: "invoice", live: true, approved: 1, seazona, store: fakeStore(), pace });
  assert.equal(out.result.needsMorePages, true);
  assert.equal(seazona.calls.length, 1);
});

test("a store error during a summary marks the run failed, then rethrows", async () => {
  const store = fakeStore();
  store.upsert = async () => { throw new Error("db down"); };
  await assert.rejects(fetchSummaries({ entity: "invoice", seazona: fakeSeazona({ invoices: [{ id: "a" }] }), store }), /db down/);
  const [run] = store.runs.values();
  assert.equal(run.status, "failed");
});
