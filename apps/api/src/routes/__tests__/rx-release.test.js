import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const adminRx = read("../admin-rx-cases.routes.js");
const rx = read("../rx.routes.js");
const payment = read("../payment.routes.js");

const RELEASE = 'fastify.post("/admin/rx-cases/:id/release",';

test("release is open to lab staff and checks refusals, then the line gate, then releases in a transaction", () => {
  const body = handlerSource(adminRx, RELEASE);
  assert.match(body, /requireRole\(\.\.\.STAFF_ROLES\)/);
  assert.match(body, /validate\(rxReleaseSchema\)/);
  const refusal = body.indexOf("releaseRefusal(");
  const gate = body.indexOf("canRelease(");
  const tx = body.indexOf("db.transaction(");
  assert.ok(refusal >= 0 && gate > refusal && tx > gate, "order: releaseRefusal → canRelease → transaction");
  assert.match(body, /releaseRxCase\(tx,/);
  assert.match(body, /labErrorReply\(err\)/);
  assert.match(body, /rx_case\.released/);
  assert.match(body, /RX_RELEASE_BLOCKED/);
});

test("the case detail carries the current lab order", () => {
  const body = handlerSource(adminRx, 'fastify.get("/admin/rx-cases/:id",');
  assert.match(body, /labOrdersForCases\(\[caseRow\.id\]\)/);
  assert.match(body, /currentLabOrder\(/);
  assert.match(body, /labOrder:/);
});

test("auto-release reuses the same gate and the same release, and never fails the doctor's submission", () => {
  const start = rx.indexOf("shouldAutoRelease(env.RX_AUTO_RELEASE)");
  assert.ok(start >= 0, "auto-release block missing");
  const end = rx.indexOf("Notify the lab a case arrived", start);
  assert.ok(end > start, "arrival-email marker not found after the auto-release block");
  const block = rx.slice(start, end);
  assert.match(block, /canRelease\(lines\)\.ok/);
  assert.match(block, /db\.transaction\(\(tx\) => releaseRxCase\(tx,/);
  assert.match(block, /catch \(err\)/);
  assert.match(block, /finalStatus = "released"/);
});

test("checkout creates the lab order AFTER the paid-order transaction, in its own transaction, never failing the charge", () => {
  const fnStart = payment.indexOf("async function recordGuestOrder");
  const start = payment.indexOf("await db.transaction(async (tx) => {", fnStart);
  const end = payment.indexOf("} catch (orderErr)", start);
  assert.ok(start >= 0 && end > start, "recordGuestOrder's transaction not found");
  const paidTx = payment.slice(start, end);
  assert.match(paidTx, /tx\.insert\(orders\)/);
  assert.doesNotMatch(paidTx, /createShopLabOrder/, "lab order must not roll back the paid order");

  const after = payment.slice(end, payment.indexOf("if (pushStatus === \"pending\")", end));
  assert.match(after, /await db\.transaction\(\(tx\) =>\s*createShopLabOrder\(tx, \{ orderId, clientUserId: pricedForUserId, quoteLines: quote\.lines \}\)/);
  assert.match(after, /log\.error\(\{ orderId \}, `\[LAB\]\[SHOP_ORDER_FAILED\] order=\$\{orderId\}/);
  assert.match(after, /catch \(err\)/);
});
