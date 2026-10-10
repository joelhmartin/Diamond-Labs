import { test } from "vitest";
import assert from "node:assert/strict";
import { knownMapKeys } from "./known-map-keys.js";

test("known mapKeys include stable catalog slugs and exclude doctor-typed literals", () => {
  const k = new Set(knownMapKeys());
  assert.ok(k.size > 100);
  for (const slug of ["mod:labial-bow", "attr:occlusal:full", "primary:olmos-day:pmt"]) assert.ok(k.has(slug), slug);
  for (const literal of ["mod:Jane Doe's special loop", "attr:Dr Smith custom", "primary:ddso:Jane Doe"]) assert.ok(!k.has(literal), literal);
});
