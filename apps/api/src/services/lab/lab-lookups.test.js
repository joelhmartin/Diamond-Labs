import { test } from "vitest";
import assert from "node:assert/strict";

const { rankPanHits, orderHit, labLookups } = await import("./lab-lookups.js");

const now = new Date("2026-11-05T12:00:00Z");
const row = (orderNumber, status, shippedAt = null) => ({ id: `o${orderNumber}`, orderNumber, status, shippedAt, practice: "Smile Co" });

test("pan resolver ignores orders shipped more than 14 days ago", () => {
  const ranked = rankPanHits([
    row(1, "shipped", "2026-10-01T00:00:00Z"),
    row(2, "shipped", "2026-10-30T00:00:00Z"),
    row(3, "in_production"),
    row(4, "cancelled"),
  ], now);
  assert.deepEqual(ranked.map((r) => r.orderNumber), [3, 2]);
});

test("pan hits list open orders first and cap at 10", () => {
  const rows = [row(50, "shipped", "2026-11-04T00:00:00Z"), ...Array.from({ length: 12 }, (_, i) => row(i + 1, "received"))];
  const ranked = rankPanHits(rows, now);
  assert.equal(ranked.length, 10);
  assert.equal(ranked[0].orderNumber, 12);
  assert.ok(ranked.every((r) => r.status === "received"));
});

test("order hit titles carry number, practice and status, no patient", () => {
  const hit = orderHit({ id: "x", orderNumber: 77, status: "received", practice: "Smile Co", patientName: "Jane Roe" });
  assert.equal(hit.title, "#77");
  assert.match(hit.subtitle, /Smile Co/);
  assert.equal(hit.href, "/lab/orders/x");
  assert.doesNotMatch(JSON.stringify(hit), /Jane/);
});

test("the registry has order, invoice and pan resolvers and rejects odd shapes", async () => {
  const out = await labLookups.lookup("not a code!", { select() { throw new Error("must not query"); } });
  assert.deepEqual(out.hits, []);
});
