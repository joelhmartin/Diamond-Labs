import { test } from "vitest";
import assert from "node:assert/strict";
import { rxCaseLines } from "./rx-case-lines.js";

test("the table exposes the columns the review flow depends on", () => {
  const cols = Object.keys(rxCaseLines);
  for (const c of [
    "id", "caseId", "position", "seazonaCode", "seazonaProductId",
    "name", "arch", "mapKey", "status", "origin", "noteOnly",
  ]) {
    assert.ok(cols.includes(c), `missing column: ${c}`);
  }
});
