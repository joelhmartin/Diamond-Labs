import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

// own-the-lab piece 3 ended Seazona's invoice role: no invoice reads from
// Seazona for display or payment, and no payment writes to Seazona. The reads
// and createPayment stay in seazona.service.js for piece 5's history import;
// when that import lands, add its file to ALLOWED by name. Scans code AND
// comments, so a stale instruction can't survive either.
const here = fileURLToPath(new URL(".", import.meta.url));
const repo = join(here, "../../../../../");
const ROOTS = ["apps/api/src", "apps/api/scripts", "scripts"].map((p) => join(repo, p));
const ALLOWED = new Set(["apps/api/src/services/seazona.service.js"]);
const SELF = fileURLToPath(import.meta.url);

const FORBIDDEN = [
  /\bcreatePayment\b/, /\bgetInvoice\b/, /\bgetInvoices\b/, /\bgetAllInvoices\b/, /v1\/invoices/, /\bgetInvoicesResult\b/, /\bgetAllInvoicesResult\b/,
  /writeToSeazona/, /recordInSeazona/, /buildInvoiceReference/, /SEAZONA_CLIENT_NOT_LINKED/, /seazonaUnavailable/,
  /PAYMENT_WRITE_FAILED/, /getClientPaidMap/, /invoice-ledger\.service/,
];

/** The forbidden patterns a source text trips (exported shape for the negative test below). */
const violations = (text) => FORBIDDEN.filter((re) => re.test(text)).map(String);

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(js|jsx|mjs)$/.test(name) && !/\.test\.(js|jsx|mjs)$/.test(name) && p !== SELF) yield p;
  }
}

test("nothing outside seazona.service.js reads invoices from or writes payments to Seazona", () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of files(root)) {
      const rel = relative(repo, file);
      if (ALLOWED.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      for (const v of violations(text)) hits.push(`${rel}: ${v}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("the matcher flags every forbidden form (the guard fails when it should)", () => {
  const samples = [
    "createPayment(x)", "getInvoice(1)", "getInvoices()", "getInvoicesResult()", "getAllInvoicesResult()", "getAllInvoices()",
    "writeToSeazona", "recordInSeazona", "buildInvoiceReference", "SEAZONA_CLIENT_NOT_LINKED", "seazonaUnavailable",
    "PAYMENT_WRITE_FAILED", "getClientPaidMap", "invoice-ledger.service", 'fetch(base + "v1/invoices/?lastModified=")',
  ];
  for (const sample of samples) assert.ok(violations(sample).length > 0, `not flagged: ${sample}`);
  assert.deepEqual(violations("listInvoices(); openInvoice(row)"), [], "our own invoice code is not flagged");
});
