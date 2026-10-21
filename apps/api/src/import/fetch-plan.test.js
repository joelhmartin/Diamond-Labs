import { test } from "vitest";
import assert from "node:assert/strict";
import { MAX_REQUESTS_PER_WINDOW, LIST_PAGE_CAP } from "../services/seazona-limits.js";
import { REQUESTS_PER_MINUTE, PACE_INTERVAL_MS, minutesFor, summaryRequests, selectDetailIds, approvalProblem, detailFilterProblem } from "./fetch-plan.js";

const inv = (id, extra = {}) => ({ seazonaId: id, lastModified: "2026-10-01T00:00:00", payload: { id, invoiceNumber: Number(id.slice(1)), ...extra } });

test("the fetcher paces itself at 30/min, below the service limiter it imports its numbers from", () => {
  assert.equal(REQUESTS_PER_MINUTE, 30);
  assert.ok(REQUESTS_PER_MINUTE < MAX_REQUESTS_PER_WINDOW);
  assert.equal(PACE_INTERVAL_MS, 2000);
  assert.equal(summaryRequests("invoice", 2 * LIST_PAGE_CAP), 3);
});

test("request counts and minutes at 30/min", () => {
  assert.equal(minutesFor(0), 0);
  assert.equal(minutesFor(30), 1);
  assert.equal(minutesFor(31), 2);
  assert.equal(minutesFor(61), 3);
  assert.equal(summaryRequests("client", 0), 1);
  assert.equal(summaryRequests("invoice", 16_000), 2);
  assert.equal(summaryRequests("invoice", 0), 2, "a first fetch of a capped list is at least 2 requests");
  assert.equal(summaryRequests("order", 0), 2);
});

test("a live run over 100 requests needs --approved of at least the count", () => {
  assert.equal(approvalProblem({ count: 400, live: false }), null, "a dry run is never refused");
  assert.match(approvalProblem({ count: 400, live: true }), /--approved 400/);
  assert.match(approvalProblem({ count: 400, live: true, approved: 399 }), /--approved 400/);
  assert.equal(approvalProblem({ count: 400, live: true, approved: 400 }), null);
  assert.equal(approvalProblem({ count: 100, live: true }), null);
});

test("a detail fetch needs an explicit filter", () => {
  assert.match(detailFilterProblem({}), /needs a filter/);
  assert.match(detailFilterProblem({ since: "10/01/2026" }), /YYYY-MM-DD/);
  assert.equal(detailFilterProblem({ since: "2025-10-21" }), null);
});

test("filters select by date, open order state, open-balance invoice number and explicit id", () => {
  const invoices = [inv("i1", { date: "2025-01-01" }), inv("i2", { date: "2026-02-01" }), inv("i3", { due: "2026-05-01" })];
  assert.deepEqual(selectDetailIds("invoice", invoices, new Map(), { since: "2026-01-01" }), ["i2", "i3"]);
  assert.deepEqual(selectDetailIds("invoice", invoices, new Map(), { openInvoiceNumbers: new Set([1]) }), ["i1"]);
  assert.deepEqual(selectDetailIds("invoice", invoices, new Map(), { ids: ["zz", "i1"] }), ["i1", "zz"]);
  const orders = [{ seazonaId: "o1", payload: { status: "Hold" } }, { seazonaId: "o2", payload: { status: "Shipped" } }];
  assert.deepEqual(selectDetailIds("order", orders, new Map(), { open: true }), ["o1"]);
});

test("a fresh detail is skipped unless --refetch; a newer summary re-fetches", () => {
  const invoices = [inv("i1", { date: "2026-02-01" }), { ...inv("i2", { date: "2026-02-01" }), lastModified: "2026-10-20T00:00:00" }];
  const fetched = new Map([["i1", "2026-10-01T00:00:00"], ["i2", "2026-10-01T00:00:00"]]);
  assert.deepEqual(selectDetailIds("invoice", invoices, fetched, { since: "2026-01-01" }), ["i2"]);
  assert.deepEqual(selectDetailIds("invoice", invoices, fetched, { since: "2026-01-01", refetch: true }), ["i1", "i2"]);
});

test("an order detail (no lastModified) is skipped once stored, unless --refetch", () => {
  const orders = [{ seazonaId: "o1", payload: { status: "Hold" } }, { seazonaId: "o2", payload: { status: "In Production" } }];
  const fetched = new Map([["o1", null]]);
  assert.deepEqual(selectDetailIds("order", orders, fetched, { open: true }), ["o2"]);
  assert.deepEqual(selectDetailIds("order", orders, fetched, { open: true, refetch: true }), ["o1", "o2"]);
});
