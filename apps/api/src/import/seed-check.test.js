import { test } from "vitest";
import assert from "node:assert/strict";
import { seazonaMaxNumbers, checkSeeds, enforceSeeds } from "./seed-check.js";
import { ImportRefusal } from "./import-errors.js";
import { fakeTx } from "../test/fake-tx.js";

const max = { invoice: 16_210, order: 98_000 };
const none = { invoice: 0, order: 0 };

test("Seazona's highest numbers come from the summaries; non-numeric ones are ignored", () => {
  const m = seazonaMaxNumbers({
    invoiceSummaries: [{ payload: { invoiceNumber: "11114" } }, { payload: { invoiceNumber: "16210" } }, { payload: { invoiceNumber: "X-1" } }],
    orderSummaries: [{ payload: { orderNumber: 98000 } }],
  });
  assert.deepEqual(m, max);
  assert.deepEqual(seazonaMaxNumbers({ invoiceSummaries: [], orderSummaries: [] }), { invoice: null, order: null });
});

test("production refuses starts at or below Seazona's highest, and missing starts", () => {
  const ok = checkSeeds({ target: "production", max, starts: { invoice: 16_211, order: 98_001 }, liveAtOrBelow: none });
  assert.deepEqual(ok.errors, []);
  const low = checkSeeds({ target: "production", max, starts: { invoice: 16_210, order: 98_001 }, liveAtOrBelow: none });
  assert.match(low.errors[0], /INVOICE_NUMBER_START \(16210\).*16211/);
  const missing = checkSeeds({ target: "production", max, starts: {}, liveAtOrBelow: none });
  assert.equal(missing.errors.length, 2);
});

test("rehearsal only warns about starts; a live number in Seazona's range is refused everywhere", () => {
  const r = checkSeeds({ target: "rehearsal", max, starts: { invoice: 500 }, liveAtOrBelow: none });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
  const clash = checkSeeds({ target: "rehearsal", max, starts: {}, liveAtOrBelow: { invoice: 2, order: 0 } });
  assert.match(clash.errors[0], /2 invoice\(s\).*16210/);
});

test("enforceSeeds throws on a live run with errors and only reports on a dry run", async () => {
  const raw = { records: async (e) => (e === "invoice" ? [{ payload: { invoiceNumber: "16210" } }] : []) };
  const db = () => fakeTx({ selects: [[{ n: 1 }], [{ n: 0 }]] });
  const dry = await enforceSeeds({ raw, db: db(), target: "rehearsal", live: false, starts: {} });
  assert.equal(dry.errors.length, 1);
  await assert.rejects(enforceSeeds({ raw, db: db(), target: "rehearsal", live: true, starts: {} }), ImportRefusal);
});
