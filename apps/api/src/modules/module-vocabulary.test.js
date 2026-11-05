import { test } from "vitest";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Generic modules must stay reusable: no lab vocabulary in code, comments,
// READMEs or test names. Lab words live only in glue files outside these dirs.
const BANNED = /\b(lab|doctor|patient|dental|rx)\b/i;
const SELF = fileURLToPath(import.meta.url);
const ROOTS = [
  fileURLToPath(new URL(".", import.meta.url)),
  fileURLToPath(new URL("../../../web/src/modules", import.meta.url)),
  fileURLToPath(new URL("../../../../packages/shared/src/business-calendar", import.meta.url)),
  fileURLToPath(new URL("../../../../packages/shared/src/workflows", import.meta.url)),
  ...["record-tags", "record-files", "barcode-lookup", "upload-intake"].map((m) =>
    fileURLToPath(new URL(`../../../../packages/shared/src/${m}`, import.meta.url)),
  ),
  fileURLToPath(new URL("../../../../packages/shared/src/exports", import.meta.url)),
  fileURLToPath(new URL("../../../../packages/shared/src/notifications", import.meta.url)),
  fileURLToPath(new URL("../../../../packages/shared/src/messaging", import.meta.url)),
];
// The exports dirs are also free of the word "invoice" (the invoice source is
// app glue in apps/api/src/exports).
const INVOICE_WORD = /invoice/i;
const EXPORT_ROOTS = [
  fileURLToPath(new URL("./exports", import.meta.url)),
  fileURLToPath(new URL("../../../web/src/modules/exports", import.meta.url)),
  fileURLToPath(new URL("../../../../packages/shared/src/exports", import.meta.url)),
];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

test("generic modules contain no lab vocabulary", () => {
  const hits = [];
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      if (file === SELF) continue;
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});

test("the exports module does not mention invoices", () => {
  const hits = [];
  for (const root of EXPORT_ROOTS) {
    for (const file of walk(root)) {
      readFileSync(file, "utf8").split("\n").forEach((line, i) => {
        if (INVOICE_WORD.test(line)) hits.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});
