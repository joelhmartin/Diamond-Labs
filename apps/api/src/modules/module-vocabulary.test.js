import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Generic modules must stay reusable on other sites: no lab/clinic vocabulary
// in code, comments, README or test names. The exports dirs are also free of
// the word "invoice" (the invoice source is app glue in apps/api/src/exports).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MODULE_DIRS = ["apps/api/src/modules", "apps/web/src/modules", "packages/shared/src/exports"];
const EXPORT_DIRS = ["apps/api/src/modules/exports", "apps/web/src/modules/exports", "packages/shared/src/exports"];
const LAB_WORDS = /\b(lab|doctor|patient|dental|rx)\b/i;
const INVOICE_WORD = /invoice/i;
const SELF = fileURLToPath(import.meta.url);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const within = (file, dirs) => dirs.some((d) => file.startsWith(path.join(ROOT, d) + path.sep));

test("generic modules contain no lab vocabulary", () => {
  const offenders = MODULE_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => f !== SELF)
    .filter((f) => LAB_WORDS.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, []);
});

test("the exports module does not mention invoices", () => {
  const offenders = MODULE_DIRS.flatMap((d) => walk(path.join(ROOT, d)))
    .filter((f) => f !== SELF && within(f, EXPORT_DIRS))
    .filter((f) => INVOICE_WORD.test(readFileSync(f, "utf8")))
    .map((f) => path.relative(ROOT, f));
  assert.deepEqual(offenders, []);
});
