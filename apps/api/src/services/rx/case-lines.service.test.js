import { test } from "vitest";
import assert from "node:assert/strict";
import { linesForDevices } from "./case-lines.service.js";

test("a resolvable device produces coded lines", () => {
  const lines = linesForDevices([
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } },
  ]);
  const ddso = lines.find((l) => l.seazonaCode === "2608");
  assert.ok(ddso, "expected DDSO Nylon 2608");
  assert.equal(ddso.status, "confirmed");
  assert.equal(ddso.origin, "auto");
  assert.equal(ddso.noteOnly, false);
});

test("an unmapped selection becomes an open line, never a guessed code", () => {
  const lines = linesForDevices([
    { deviceKey: "olmos-night", deviceOptions: { variant: "DEPROGRAMMER (ON-D) - Anterior Occlusion" } },
  ]);
  const open = lines.filter((l) => l.status === "open");
  assert.ok(open.length > 0, "expected an open line");
  for (const l of open) {
    assert.equal(l.seazonaCode, null);
    assert.ok(l.mapKey, "an open line still needs its mapKey so it can be overridden");
  }
});

test("lines from several devices are positioned in order", () => {
  const lines = linesForDevices([
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } },
    { deviceKey: "snorehook", deviceOptions: {} },
  ]);
  assert.deepEqual(lines.map((l) => l.position), lines.map((_, i) => i));
});
