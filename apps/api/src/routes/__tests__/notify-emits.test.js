import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlerSource } from "./_source.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

// Emit points import the seam, never the module, and notify after the commit.
test("Rx submit notifies lab.order_received for staff after the case is saved and the arrival email", () => {
  const src = read("../rx.routes.js");
  assert.match(src, /import \{ notify \} from "\.\.\/services\/notify-seam\.js";/);
  const form = handlerSource(src, 'fastify.post("/rx/form-submissions"');
  const email = form.indexOf("await sendRxSubmissionReceived(");
  const emit = form.indexOf('event: "lab.order_received"');
  assert.ok(email > 0 && emit > email, "after the arrival email (the transaction has committed)");
  const call = /await notify\(db, \{ event: "lab\.order_received", recordType: "rx_case", recordId: caseId, audience: \{ kinds: \["staff"\] \}, data: \{ caseNumber, caseId \} \}\)/;
  assert.match(form, call);
  // The older multipart case route lands in the same review queue: same alert, after its transaction's catch.
  const cases = handlerSource(src, 'fastify.post("/rx/cases"');
  assert.match(cases, call);
  assert.ok(cases.indexOf('event: "lab.order_received"') > cases.indexOf("Failed to save case."));
});

test("shop checkout notifies lab.order_received after the lab order's own transaction, never inside it", () => {
  const src = read("../checkout.routes.js");
  assert.match(src, /import \{ notify \} from "\.\.\/services\/notify-seam\.js";/);
  const created = src.indexOf("createShopLabOrder(tx,");
  const emit = src.indexOf('event: "lab.order_received"');
  assert.ok(created > 0 && emit > created, "after createShopLabOrder");
  const between = src.slice(created, emit);
  assert.match(between, /\n {4}\);\n/, "the db.transaction(...) call has closed before the emit");
  assert.match(src.slice(emit - 200, emit + 300), /recordType: "lab_order", recordId: labOrder\.id[\s\S]*data: \{ orderNumber: labOrder\.orderNumber, labOrderId: labOrder\.id \}/);
});
