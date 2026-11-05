import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HEADINGS = ["## Purpose", "## Public interface", "## Configuration", "## Data model", "## Wiring it into another app"];

for (const mod of ["business-calendar", "workflows"]) {
  test(`${mod} README has the standard sections and no TODO`, () => {
    const text = readFileSync(fileURLToPath(new URL(`./${mod}/README.md`, import.meta.url)), "utf8");
    for (const h of HEADINGS) assert.ok(text.includes(`\n${h}\n`), `missing ${h}`);
    assert.ok(!/TODO/.test(text), "README still has a TODO");
  });
}
