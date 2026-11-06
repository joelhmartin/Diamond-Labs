import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { practiceRequired } from "./client-scope-rules.js";
import { InvoiceError } from "./billing/invoice-rules.js";
import { invoiceErrorReply } from "./billing/invoice-errors.js";
import { errorHandler } from "../middleware/error-handler.js";

/** THE 422 PRACTICE_REQUIRED refusal: one factory, the same 422 through either error path. */

test("one factory, two pinned texts, the same 422 body through the invoice mapper and the app error handler", () => {
  for (const [err, message] of [[practiceRequired(), "Choose a practice."], [practiceRequired("Choose which practice this is for."), "Choose which practice this is for."]]) {
    assert.ok(err instanceof InvoiceError);
    assert.equal(err.code, "PRACTICE_REQUIRED");
    assert.equal(err.statusCode, 422);
    assert.deepEqual(invoiceErrorReply(err), { status: 422, body: { error: { code: "PRACTICE_REQUIRED", status: 422, message } } });
    let sent = null;
    const reply = { code: (status) => ({ send: (body) => { sent = { status, body }; } }) };
    errorHandler(err, { log: { error: () => {} } }, reply);
    assert.deepEqual(sent, { status: 422, body: { error: { code: "PRACTICE_REQUIRED", message, status: 422 } } });
  }
});

test("no other source file builds a PRACTICE_REQUIRED error by hand", () => {
  const SRC = fileURLToPath(new URL("../", import.meta.url));
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { if (name !== "node_modules") walk(full); continue; }
      if (!name.endsWith(".js") || name.endsWith(".test.js") || full.includes(`${sep}__tests__${sep}`)) continue;
      const rel = relative(SRC, full).split(sep).join("/");
      if (rel === "services/client-scope-rules.js" || rel === "services/billing/invoice-errors.js") continue;
      if (/new InvoiceError\(\s*"PRACTICE_REQUIRED"|code\s*=\s*"PRACTICE_REQUIRED"/.test(readFileSync(full, "utf8"))) hits.push(rel);
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);
});
