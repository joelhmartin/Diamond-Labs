import { test } from "vitest";
import assert from "node:assert/strict";
import { planIntakes, refusalFor, IntakeError } from "./rules.js";

const f = (originalName) => ({ kind: "scan", buffer: Buffer.from("x"), originalName });

test("per_file split makes one intake per file", () => {
  const { groups, refused } = planIntakes([f("a.stl"), f("b.ply"), f("c.PDF")], "per_file");
  assert.deepEqual(groups.map((g) => g.map((x) => x.originalName)), [["a.stl"], ["b.ply"], ["c.PDF"]]);
  assert.deepEqual(refused, []);
});

test("one split makes a single intake", () => {
  const { groups } = planIntakes([f("a.stl"), f("b.xml"), f("c.zip")], "one");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});

test("a .exe is refused by name and the rest proceed", () => {
  const { groups, refused } = planIntakes([f("a.stl"), f("setup.exe"), f("noext")], "one");
  assert.deepEqual(groups[0].map((x) => x.originalName), ["a.stl"]);
  assert.deepEqual(refused.map((r) => r.name), ["setup.exe", "noext"]);
  assert.deepEqual(refused.map((r) => r.reason), ["unsupported type", "unsupported type"], "a name-free reason a screen can count by");
  assert.match(refused[0].message, /setup\.exe/);
});

test("when every file is refused there is nothing to create", () => {
  assert.deepEqual(planIntakes([f("x.exe")], "per_file").groups, []);
});

test("every accepted extension passes, case-insensitively", () => {
  for (const n of ["a.zip", "a.xml", "a.html", "a.htm", "a.pdf", "a.stl", "a.ply", "a.OBJ"]) assert.equal(refusalFor(n), null, n);
});

test("an unknown split is invalid", () => {
  assert.throws(() => planIntakes([f("a.stl")], "weird"), IntakeError);
});
