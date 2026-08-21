import { test } from "vitest";
import assert from "node:assert/strict";
import { linesForDevices, reResolveLines } from "./case-lines.service.js";

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

// Fake drizzle tx matching the exact chain reResolveLines calls:
//   select().from().where().orderBy()   -> existingRows
//   delete().where()                    -> recorded, no-op
//   update().set().where()              -> recorded { vals, cond }
//   insert().values()                   -> recorded rows
// `where(...)` is made thenable (as well as exposing `.orderBy`) so this one
// fake exercises both `await tx.select().from().where(...)` (no explicit
// order) and `await tx.select().from().where(...).orderBy(...)` — whichever
// chain the code under test happens to use.
function makeFakeTx(existingRows) {
  const deleted = [];
  const inserted = [];
  const updates = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          then: (resolve) => resolve(existingRows),
          orderBy: async () => existingRows,
        }),
      }),
    }),
    delete: () => ({
      where: async (cond) => {
        deleted.push(cond);
      },
    }),
    update: () => ({
      set: (vals) => ({
        where: async (cond) => {
          updates.push({ vals, cond });
        },
      }),
    }),
    insert: () => ({
      values: async (rows) => {
        inserted.push(...rows);
      },
    }),
  };
  return { tx, deleted, inserted, updates };
}

test("re-resolve keeps manual lines and never re-inserts them", async () => {
  const existing = [
    { id: "l1", caseId: "c1", origin: "auto", position: 0 },
    { id: "l2", caseId: "c1", origin: "manual", position: 1, seazonaCode: "9999" },
  ];
  const { tx, inserted } = makeFakeTx(existing);

  const result = await reResolveLines(
    "c1",
    [{ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } }],
    { tx }
  );

  assert.equal(result.kept, 1);
  assert.ok(!inserted.some((r) => r.id === "l2"), "the manual line must not be re-inserted");
  assert.ok(inserted.every((r) => r.origin === "auto"), "only auto lines are inserted");
});

test("re-resolve does not collide positions when a manual line sits at a non-zero position", async () => {
  // The reviewer's worked example: 4 original lines at positions 0-3, one
  // edited to manual sitting at position 2. Naively assuming kept manual
  // rows already occupy 0..kept.length-1 leaves this row at position 2 while
  // the regenerated auto lines are numbered kept.length + i (1, 2, ...) —
  // colliding at position 2.
  const existing = [
    { id: "a0", caseId: "c1", origin: "auto", position: 0 },
    { id: "a1", caseId: "c1", origin: "auto", position: 1 },
    { id: "m2", caseId: "c1", origin: "manual", position: 2, seazonaCode: "9999" },
    { id: "a3", caseId: "c1", origin: "auto", position: 3 },
  ];
  const { tx, inserted, updates } = makeFakeTx(existing);

  await reResolveLines(
    "c1",
    [
      { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } },
      { deviceKey: "snorehook", deviceOptions: {} },
    ],
    { tx }
  );

  // Exactly one manual row is kept, so any update call renumbers it.
  const manualFinalPosition = updates.length > 0 ? updates[0].vals.position : existing[2].position;
  const allPositions = [manualFinalPosition, ...inserted.map((r) => r.position)];
  const unique = new Set(allPositions);
  assert.equal(
    unique.size,
    allPositions.length,
    `expected no two lines to share a position, got [${allPositions.join(", ")}]`
  );
});
