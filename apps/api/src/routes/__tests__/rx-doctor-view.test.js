import { test } from "vitest";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { handlerSource } from "./_source.js";

const source = readFileSync(fileURLToPath(new URL("../rx.routes.js", import.meta.url)), "utf8");
const handler = (marker) => handlerSource(source, marker);

test("a doctor's case list and case page go through the allow-list view", () => {
  for (const marker of ['fastify.get("/rx/cases",', 'fastify.get("/rx/cases/:id",']) {
    const body = handler(marker);
    assert.match(body, /doctorCaseView\(/, marker);
    assert.match(body, /labOrdersForCases\(/, marker);
    assert.doesNotMatch(body, /\.\.\.decrypted/, `${marker} must not spread the decrypted row`);
    assert.doesNotMatch(body, /return \{ data: cases \}/, `${marker} must not return raw rows`);
  }
});

test("the case page lists files without their storage pointers", () => {
  const body = handler('fastify.get("/rx/cases/:id",');
  assert.doesNotMatch(body, /gcsUrl/);
  assert.match(body, /select\(\{[^}]*originalName[^}]*\}\)\s*\.from\(rxCaseFiles\)/, "file query must select explicit columns");
});
