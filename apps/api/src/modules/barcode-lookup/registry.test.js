import { test } from "vitest";
import assert from "node:assert/strict";
import { createLookupRegistry } from "./registry.js";

const quiet = { error() {} };
const hit = (id) => ({ recordType: "widget", recordId: id, title: id, href: `/w/${id}` });

test("ambiguous code returns all hits", async () => {
  const r = createLookupRegistry({ log: quiet });
  r.defineResolver({ key: "a", match: (c) => c, resolve: async () => [hit("1")] });
  r.defineResolver({ key: "b", match: (c) => c, resolve: async () => [hit("2")] });
  const out = await r.lookup("42");
  assert.equal(out.code, "42");
  assert.deepEqual(out.hits.map((h) => h.recordId), ["1", "2"]);
});

test("a resolver whose match returns null is not asked to resolve", async () => {
  const r = createLookupRegistry({ log: quiet });
  r.defineResolver({ key: "a", match: () => null, resolve: async () => { throw new Error("no"); } });
  assert.deepEqual((await r.lookup("x")).hits, []);
});

test("duplicate hits from two resolvers collapse", async () => {
  const r = createLookupRegistry({ log: quiet });
  r.defineResolver({ key: "a", match: (c) => c, resolve: async () => [hit("1")] });
  r.defineResolver({ key: "b", match: (c) => c, resolve: async () => [hit("1"), hit("2")] });
  assert.deepEqual((await r.lookup("42")).hits.map((h) => h.recordId), ["1", "2"]);
});

test("a throwing resolver does not fail the lookup", async () => {
  const logged = [];
  const r = createLookupRegistry({ log: { error: (m) => logged.push(m) } });
  r.defineResolver({ key: "bad", match: (c) => c, resolve: async () => { throw new Error("secret 42"); } });
  r.defineResolver({ key: "ok", match: (c) => c, resolve: async () => [hit("1")] });
  const out = await r.lookup("42");
  assert.equal(out.hits.length, 1);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /bad/);
  assert.doesNotMatch(logged[0], /secret|42/);
});
