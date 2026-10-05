import { test } from "vitest";
import assert from "node:assert/strict";
import { linesForDevices, reResolveLines, devicesForCase } from "./case-lines.service.js";

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

test("an 'always' note-only ruling survives a resolve as a non-blocking, non-product line", async () => {
  // Pins the whole path an admin's "always" + noteOnly resolution travels:
  // overrideRowFor (admin-rx-cases.routes.js) -> the shape loadOverrides()
  // would hand back from that DB row -> linesForDevices -> canPush. Each
  // link is unit-tested elsewhere; this composes them the way production
  // actually will.
  const { overrideRowFor, canPush } = await import("../../routes/admin-rx-cases.routes.js");

  const overrideRow = overrideRowFor({
    mapKey: "mod:wrap-distal",
    seazonaCode: null,
    noteOnly: true,
    confirmedBy: "u1",
  });

  // Simulate loadOverrides()'s row -> map shape without touching a real DB.
  const overrides = {
    [overrideRow.mapKey]: {
      code: overrideRow.seazonaCode,
      name: overrideRow.seazonaName,
      seazonaProductId: null,
      noteOnly: overrideRow.noteOnly,
    },
  };

  const lines = linesForDevices(
    [{ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["Wrap Distal"] } }],
    { overrides }
  );

  const wrapLine = lines.find((l) => l.mapKey === "mod:wrap-distal");
  assert.ok(wrapLine, "expected a line for the overridden modification");
  assert.equal(wrapLine.noteOnly, true, "the ruling must survive into the persisted line");
  assert.equal(wrapLine.seazonaCode, null, "a note-only ruling must never invent a code");

  assert.equal(
    canPush(lines).ok,
    true,
    "a note-only line must never block the push — it is a build instruction, not an unresolved product"
  );
});

test("devicesForCase prefers devices resolved at submit", () => {
  const stored = [{ deviceKey: "snorehook", deviceOptions: {} }];
  const devices = devicesForCase({
    formType: "digital",
    formData: { devicesToOrder: ["ddso"], ddsoMaterial: "NYLON" },
    deviceOptions: { devices: stored },
  });
  assert.deepEqual(devices, stored);
});

test("devicesForCase derives devices from formData on a pre-resolution digital case", () => {
  const devices = devicesForCase({
    formType: "digital",
    formData: { devicesToOrder: ["ddso"], ddsoMaterial: "NYLON" },
    deviceKey: null,
    deviceOptions: {},
  });
  assert.equal(devices.length, 1);
  assert.equal(devices[0].deviceKey, "ddso");
  assert.equal(devices[0].deviceOptions.baseMaterial, "NYLON");
});

test("devicesForCase wraps a wizard case's single device", () => {
  const devices = devicesForCase({ formType: null, deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.deepEqual(devices, [{ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } }]);
});

test("devicesForCase returns nothing rather than inventing a device", () => {
  assert.deepEqual(devicesForCase({}), []);
  assert.deepEqual(devicesForCase({ formType: "digital", formData: {}, deviceOptions: {} }), []);
});

// ── case-level lab services (catalog-map/lab-services.js) ───────────────────

const SCAN = { records: ["ITERO"], firstDevice: "Yes" };

test("seeding with formData adds the case's lab-service lines once, after the devices", () => {
  const lines = linesForDevices(
    [
      { deviceKey: "olmos-day", deviceOptions: { baseMaterial: "OD (PMT)" } },
      { deviceKey: "olmos-night", deviceOptions: { variant: "POSITIONER (ON-P) - Anterior Occlusion", baseMaterial: "NYLON" } },
    ],
    { formData: SCAN }
  );
  assert.deepEqual(
    lines.map((l) => [l.seazonaCode, l.arch]),
    [
      ["2102", null], ["2130", null],
      ["2367", "upper"], ["2367", "lower"],
      ["2372", "upper"], ["2372", "lower"],
      ["2368", "upper"], ["2368", "lower"],
    ]
  );
  const service = lines.filter((l) => l.mapKey?.startsWith("service:"));
  assert.ok(service.every((l) => l.status === "confirmed" && l.origin === "auto"));
});

test("without formData (the retired wizard) no lab-service lines are added", () => {
  const lines = linesForDevices([{ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } }]);
  assert.ok(!lines.some((l) => l.mapKey?.startsWith("service:")));
});

test("re-resolve recomputes the same lab-service lines as seeding", async () => {
  const devices = [{ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } }];
  const seeded = linesForDevices(devices, { formData: SCAN });
  const { tx, inserted } = makeFakeTx([]);
  await reResolveLines("c1", devices, { tx, formData: SCAN });
  assert.deepEqual(
    inserted.map((l) => [l.mapKey, l.seazonaCode, l.arch]),
    seeded.map((l) => [l.mapKey, l.seazonaCode, l.arch])
  );
});

test("a device with no appliance line cannot ride a lab-service-only order past the gate", () => {
  // A nightguard section with nothing ordered resolves to no lines at all; the
  // model-fabrication lines alone must not make the case look sendable.
  const lines = linesForDevices([{ deviceKey: "guard", label: "Nightguard", deviceOptions: {} }], { formData: SCAN });
  const open = lines.filter((l) => l.status === "open");
  assert.equal(open.length, 1);
  assert.match(open[0].sourceLabel, /no device line resolved for Nightguard/);
  assert.equal(open[0].seazonaCode, null);
});

test("occlusal contact and design preference seed no line at all", () => {
  const lines = linesForDevices([
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", occlusalContact: "TRIPOD Occlusion", designPreference: "Full Coverage" } },
  ]);
  assert.deepEqual(lines.map((l) => l.seazonaCode), ["2608"]);
});
