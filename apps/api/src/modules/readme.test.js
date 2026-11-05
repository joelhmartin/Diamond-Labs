import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEADINGS = ["## Purpose", "## Public interface", "## Configuration", "## Data model", "## Wiring it into another app"];

const READMES = {
  "business-calendar": "./business-calendar/README.md",
  workflows: "./workflows/README.md",
  exports: "./exports/README.md",
  "exports (web)": "../../../web/src/modules/exports/README.md",
  "record-tags": "./record-tags/README.md",
  "record-files": "./record-files/README.md",
  "barcode-lookup": "./barcode-lookup/README.md",
  "upload-intake": "./upload-intake/README.md",
};

for (const [mod, rel] of Object.entries(READMES)) {
  test(`${mod} README has the standard sections and no TODO`, () => {
    const text = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
    for (const h of HEADINGS) assert.ok(text.includes(`\n${h}\n`), `missing ${h}`);
    assert.ok(!/TODO/.test(text), "README still has a TODO");
  });
}
