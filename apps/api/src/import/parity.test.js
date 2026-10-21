import { test } from "vitest";
import assert from "node:assert/strict";
import { seazonaInvoiceFacts, exportBalances, exportCreditCents, buildParity, applyAccepted, DIFFERENCE_KINDS, yearOf } from "./parity.js";

const facts = seazonaInvoiceFacts(
  [
    { seazonaId: "a", payload: { invoiceNumber: "1", total: 100, status: "Shipped", due: "2025-12-31" } },
    { seazonaId: "b", payload: { invoiceNumber: "2", total: 50.5, status: "Void", due: "2026-01-05" } },
  ],
  new Map([["a", { date: "2025-12-30T10:00:00" }]]),
);

const seazona = {
  clientIds: ["c1", "c2"],
  invoices: facts,
  orders: [
    { id: "o1", clientId: "c1", status: "in_production", open: true },
    { id: "o2", clientId: "c2", status: "shipped", open: false },
  ],
  balanceByAccount: new Map([["1324", 4000]]),
  exportCreditCents: 0,
  exportProblems: [],
};
const app = {
  linkedClientIds: ["c1", "c2"], linkedCount: 2, placeholders: 0,
  invoices: [
    { seazonaId: "a", number: 1, status: "issued", totalCents: 10000, year: "2025" },
    { seazonaId: "b", number: 2, status: "void", totalCents: 5050, year: "2026" },
  ],
  balanceByAccount: new Map([["1324", 4000]]),
  unowned: { count: 0, openCents: 0, invoiceNumbers: [] },
  historyWithoutSettlement: { count: 0, grossCents: 0, realPaidCents: 0, openCents: 0 },
  orderCount: 2,
  orderIds: ["o1", "o2"],
  openOrders: [{ status: "in_production" }],
  unownedOrders: [],
  openingInvoices: 0,
};
const seeds = { errors: [], warnings: [], seazonaMax: { invoice: 2, order: null } };

test("Seazona facts use the mapper's issue-day rule, cents and void state", () => {
  assert.deepEqual(facts, [
    { seazonaId: "a", number: 1, status: "issued", totalCents: 10000, year: "2025" },
    { seazonaId: "b", number: 2, status: "void", totalCents: 5050, year: "2026" },
  ]);
});

test("everything matching is clean", () => {
  const r = buildParity({ seazona, app, seeds });
  assert.equal(r.clean, true, JSON.stringify(r.differences));
  assert.deepEqual(r.invoices.byYear, [{ year: "2025", seazona: 1, app: 1 }, { year: "2026", seazona: 1, app: 1 }]);
  assert.equal(r.invoices.seazonaTotalCents, 10000, "void invoices stay out of the totals");
  assert.equal(r.balances.exportTotalCents, 4000);
  assert.equal(r.balances.appOwnedOpenCents, 4000);
  assert.equal(r.balances.appUnownedOpenCents, 0);
  assert.deepEqual(r.orders.seazonaOpen, { in_production: 1 });
  assert.deepEqual(r.invoices.seazonaNumberGaps, { missingNumbers: 0, gapCount: 0, ranges: [] });
});

test("one cent of AR, one unlinked client, one missing invoice, one open order or a seed error each make it unclean", () => {
  const cases = [
    { app: { ...app, balanceByAccount: new Map([["1324", 3999]]) }, want: "balances" },
    { app: { ...app, linkedClientIds: ["c1"] }, want: "clients" },
    { app: { ...app, invoices: app.invoices.slice(0, 1) }, want: "invoices not loaded" },
    { app: { ...app, openOrders: [] }, want: "open orders" },
    { app: { ...app, orderCount: 2, orderIds: ["o1", "zz"] }, want: "orders not loaded" },
    { seeds: { ...seeds, errors: ["INVOICE_NUMBER_START too low"] }, want: "seeds" },
  ];
  for (const c of cases) {
    const r = buildParity({ seazona, app: c.app ?? app, seeds: c.seeds ?? seeds });
    assert.equal(r.clean, false, c.want);
    assert.ok(r.differences.includes(c.want), `${c.want}: ${r.differences}`);
  }
  const off = buildParity({ seazona, app: { ...app, balanceByAccount: new Map([["1324", 3999]]) }, seeds });
  assert.deepEqual(off.balances.differences, [{ client: "1324", exportCents: 4000, appCents: 3999 }]);
  assert.deepEqual(off.balances.breakdown, { exportAboveAppCents: 1, appAboveExportCents: 0, exportOnlyAccounts: 0, appOnlyAccounts: 0 });
});

test("without an export, balances are not compared (and say so)", () => {
  const r = buildParity({ seazona: { ...seazona, balanceByAccount: null }, app, seeds });
  assert.equal(r.balances, null);
  assert.ok(r.differences.includes("no balance export compared"));
});

test("export balances: per-invoice rows roll up to the owner's account; credits count as zero", () => {
  const m = exportBalances([{ key: 1, cents: 300 }, { key: 2, cents: -50 }, { key: 9, cents: 10 }], "per-invoice", new Map([[1, "1324"], [2, "1324"]]));
  assert.deepEqual([...m], [["1324", 300], ["invoice 9", 10]]);
  assert.deepEqual([...exportBalances([{ key: "2001", cents: -2000 }], "per-client", new Map())], [["2001", 0]]);
  assert.equal(exportCreditCents([{ key: 1, cents: 300 }, { key: 2, cents: -50 }, { key: 3, cents: -2000 }]), 2050);
  assert.deepEqual([...exportBalances([{ key: " AB12 ", cents: 5 }], "per-client", new Map())], [["ab12", 5]], "account keys compare normalised, as the loader does");
});

test("unowned legacy invoices and their balance are reported, and a balance on them is a difference (AR skips them)", () => {
  const unowned = { count: 2, openCents: 700, invoiceNumbers: [4, 5] };
  const r = buildParity({ seazona, app: { ...app, unowned, balanceByAccount: new Map([["1324", 4000]]) }, seeds });
  assert.deepEqual(r.invoices.unowned, unowned);
  assert.ok(r.differences.includes("unowned invoices with a balance"));
  assert.equal(r.balances.appUnownedOpenCents, 700);
  assert.equal(r.balances.appOwnedOpenCents, 3300);
  const none = buildParity({ seazona, app: { ...app, unowned: { count: 1, openCents: 0, invoiceNumbers: [4] } }, seeds });
  assert.equal(none.clean, true, "an unowned invoice that owes nothing is reported, not a difference");
  assert.equal(none.invoices.unowned.count, 1);
});

test("unowned legacy orders are listed by Seazona client id; an unowned OPEN order is a difference", () => {
  const unownedOrders = [{ sourceId: "o1", open: true }, { sourceId: "o2", open: false }, { sourceId: "o3", open: false }];
  const r = buildParity({
    seazona: { ...seazona, orders: [...seazona.orders, { id: "o3", clientId: "c2", status: "shipped", open: false }] },
    app: { ...app, orderCount: 3, orderIds: ["o1", "o2", "o3"], unownedOrders }, seeds,
  });
  assert.deepEqual(r.orders.unownedByClient, [{ clientId: "c1", orders: 1, open: 1 }, { clientId: "c2", orders: 2, open: 0 }]);
  assert.equal(r.orders.unownedCount, 3);
  assert.ok(r.differences.includes("unowned open orders"));
  const closed = buildParity({ seazona, app: { ...app, unownedOrders: [{ sourceId: "o2", open: false }] }, seeds });
  assert.equal(closed.clean, true);
  assert.equal(closed.orders.unownedCount, 1);
});

test("export problems are part of the report and make it unclean; the history left open is reported gross AND net of real payments", () => {
  const exportProblems = [{ kind: "export-row-bad-balance", count: 1, seazonaIds: ["77"], lines: [12] }];
  const history = { count: 2, grossCents: 9000, realPaidCents: 2500, openCents: 6500 };
  const r = buildParity({ seazona: { ...seazona, exportProblems, exportCreditCents: 125 }, app: { ...app, historyWithoutSettlement: history }, seeds });
  assert.deepEqual(r.exportProblems, exportProblems);
  assert.ok(r.differences.includes("balance export problems"));
  assert.deepEqual(r.invoices.historyWithoutSettlement, history);
  assert.equal(r.balances.creditCents, 125);
});

test("the report carries ids, counts and cents only", () => {
  const text = JSON.stringify(buildParity({ seazona, app, seeds }));
  assert.doesNotMatch(text, /@|patient|name/i);
});

test("orders are compared by Seazona id, and the missing ids are listed (not just a count)", () => {
  const r = buildParity({ seazona, app: { ...app, orderCount: 2, orderIds: ["o1", "other"] }, seeds });
  assert.ok(r.differences.includes("orders not loaded"));
  assert.deepEqual(r.orders.missingIds, ["o2"]);
  assert.equal(r.orders.missingCount, 1);
});

test("an unknown issue year is \"unknown\", never a truncated word", () => {
  assert.equal(yearOf(null), "unknown");
  assert.equal(yearOf("2025-12-30"), "2025");
  const f = seazonaInvoiceFacts([{ seazonaId: "x", payload: { invoiceNumber: "5", total: 1, status: "Shipped" } }], new Map());
  assert.equal(f[0].year, "unknown");
});

test("accepted differences move out of `differences`; clean means none remain; nothing accepted changes nothing", () => {
  const dirty = buildParity({ seazona: { ...seazona, balanceByAccount: null }, app: { ...app, openOrders: [] }, seeds });
  assert.deepEqual(dirty.differences, ["no balance export compared", "open orders"]);
  assert.equal(applyAccepted(dirty, []), dirty);
  const some = applyAccepted(dirty, ["open orders"]);
  assert.deepEqual([some.differences, some.accepted, some.clean], [["no balance export compared"], ["open orders"], false]);
  const all = applyAccepted(dirty, ["open orders", "no balance export compared", "seeds"]);
  assert.deepEqual([all.differences, all.accepted, all.clean], [[], ["no balance export compared", "open orders"], true]);
  assert.throws(() => applyAccepted(dirty, ["opne orders"]), /Unknown difference kind/);
  assert.ok(DIFFERENCE_KINDS.includes("seeds"));
});

test("Seazona invoice-number gaps are reported as information, never a difference (F3)", async () => {
  const { numberGaps } = await import("./parity.js");
  assert.deepEqual(numberGaps([5, 1, 2, 2, 9]), { missingNumbers: 5, gapCount: 2, ranges: [[3, 4], [6, 8]] });
  assert.deepEqual(numberGaps([]), { missingNumbers: 0, gapCount: 0, ranges: [] });
  assert.deepEqual(numberGaps([7]), { missingNumbers: 0, gapCount: 0, ranges: [] });
  const gappy = { ...seazona, invoices: [...seazona.invoices, { seazonaId: "z", number: 9, status: "void", totalCents: 0, year: "2026" }] };
  const r = buildParity({ seazona: gappy, app, seeds });
  assert.equal(r.invoices.seazonaNumberGaps.missingNumbers, 6);
  assert.ok(!r.differences.some((d) => /gap/.test(d)), "information only");
});

test("after a possibly-incomplete invoice walk, number gaps become the difference seazona_invoice_numbers_missing (F3b)", () => {
  const gappy = { ...seazona, invoices: [...seazona.invoices, { seazonaId: "z", number: 9, status: "void", totalCents: 0, year: "2026" }] };
  const flagged = { ...gappy, invoiceSummaryPossiblyIncomplete: { runId: "run-c", note: "possiblyIncomplete: ..." } };
  const r = buildParity({ seazona: flagged, app, seeds });
  assert.ok(r.differences.includes("seazona_invoice_numbers_missing"));
  assert.deepEqual(r.invoices.seazonaNumbersMissing, { count: 6, numbers: [3, 4, 5, 6, 7, 8], runId: "run-c" });
  assert.ok(DIFFERENCE_KINDS.includes("seazona_invoice_numbers_missing"), "--accept can take it");
  assert.equal(applyAccepted(r, ["seazona_invoice_numbers_missing"]).differences.includes("seazona_invoice_numbers_missing"), false);
  // No gaps → no difference even when flagged; gaps without the flag stay information only.
  assert.ok(!buildParity({ seazona: { ...seazona, invoiceSummaryPossiblyIncomplete: { runId: "x" } }, app, seeds }).differences.includes("seazona_invoice_numbers_missing"));
  assert.ok(!buildParity({ seazona: gappy, app, seeds }).differences.includes("seazona_invoice_numbers_missing"));
  const many = numberGapsCap();
  assert.equal(many.length, 50, "at most 50 numbers listed");
});
function numberGapsCap() {
  const inv = [{ seazonaId: "a", number: 1, status: "issued", totalCents: 0, year: "2026" }, { seazonaId: "b", number: 200, status: "issued", totalCents: 0, year: "2026" }];
  return buildParity({ seazona: { ...seazona, invoices: inv, invoiceSummaryPossiblyIncomplete: { runId: "r" } }, app, seeds }).invoices.seazonaNumbersMissing.numbers;
}
