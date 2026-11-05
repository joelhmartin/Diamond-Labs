import { test } from "vitest";
import assert from "node:assert/strict";
import { defineIntakeParser, genericParser, createParserRegistry } from "./parsers.js";

const files = [{ originalName: "a.stl" }, { originalName: "b.xml" }];

test("the generic parser accepts everything and returns only the file names", () => {
  assert.equal(genericParser.key, "generic");
  assert.ok(files.every((f) => genericParser.accepts(f)));
  assert.deepEqual(genericParser.parse(files), { files: ["a.stl", "b.xml"] });
});

test("a registered parser that accepts every file wins over generic", () => {
  const registry = createParserRegistry();
  registry.register(defineIntakeParser({ key: "xml-only", accepts: (f) => f.originalName.endsWith(".xml"), parse: () => ({}) }));
  assert.equal(registry.pick(files).key, "generic");
  assert.equal(registry.pick([files[1]]).key, "xml-only");
});

test("defineIntakeParser requires key, accepts and parse", () => {
  assert.throws(() => defineIntakeParser({ key: "x" }));
});
