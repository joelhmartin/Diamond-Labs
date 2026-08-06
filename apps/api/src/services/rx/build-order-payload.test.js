import { test } from "vitest";
import assert from "node:assert/strict";
import { buildSeazonaOrderPayload } from "./build-order-payload.js";
import { DEVICE_ROWS } from "./catalog-map/devices.table.js";

const baseCase = {
  seazonaClientId: "client-1",
  patientFirst: "Jane",
  patientLast: "Doe",
  dueDate: "2026-07-01",
  deviceKey: "ddso",
  deviceOptions: {
    baseMaterial: "Nylon",
    occlusalContact: "Posterior",
    designPreference: "Buccal-Free",
  },
  generalComments: "cover 1st molar to 1st molar",
  rush: false,
};

// Build codeToId from the actual table so tests track real seeded codes.
function makeCodeToId() {
  const m = {};
  for (const row of DEVICE_ROWS) if (row.code) m[row.code] = `id-${row.code}`;
  return m;
}

test("payload has patient name, due, clientId, items with resolved ids", () => {
  const codeToId = makeCodeToId();
  const { payload } = buildSeazonaOrderPayload(baseCase, { codeToId, userId: "lab-staff-1" });
  assert.equal(payload.clientId, "client-1");
  assert.equal(payload.patientName, "Jane Doe");
  assert.equal(payload.due, "2026-07-01");
  assert.equal(payload.userId, "lab-staff-1");
  assert.ok(payload.items.length >= 1 && payload.items.every((i) => i.id));
});

test("structured options + comments compile into notes", () => {
  const { payload } = buildSeazonaOrderPayload(baseCase, { codeToId: makeCodeToId(), userId: "x" });
  assert.match(payload.notes, /Occlusal Contact: Posterior/);
  assert.match(payload.notes, /Design Preference: Buccal-Free/);
  assert.match(payload.notes, /cover 1st molar to 1st molar/);
});

test("material and modifications are NOT in notes (they are line items)", () => {
  // Matches real Seazona orders: material is baked into the device product code
  // and each modification is its own line item — never notes.
  const c = {
    ...baseCase,
    deviceOptions: { baseMaterial: "Nylon", modifications: ["Labial bow"], occlusalContact: "Posterior" },
  };
  const { payload } = buildSeazonaOrderPayload(c, { codeToId: makeCodeToId(), userId: "x" });
  assert.doesNotMatch(payload.notes, /Material:/);
  assert.doesNotMatch(payload.notes, /Modifications:/);
  assert.doesNotMatch(payload.notes, /Labial bow/);
  // occlusal contact (no product code) still belongs in notes
  assert.match(payload.notes, /Occlusal Contact: Posterior/);
});

test("unmapped lines surface as warnings and never enter items", () => {
  const c = {
    ...baseCase,
    deviceOptions: { ...baseCase.deviceOptions, modifications: ["__nope__"] },
  };
  const { payload, warnings } = buildSeazonaOrderPayload(c, { codeToId: makeCodeToId(), userId: "x" });
  assert.ok(warnings.some((w) => w.includes("__nope__")));
  assert.ok(payload.items.every((i) => i.id));
});

test("arch strings normalize to Seazona 1/2/null", () => {
  // Guard is resolver-driven now (its arches come from the standardGuards
  // matrix — see catalog-map/resolvers/guard.test.js) and no longer reads
  // deviceOptions.arch, so exercise normalizeArch via a row-based device.
  const c = {
    ...baseCase,
    deviceKey: "ddso",
    deviceOptions: { baseMaterial: "Nylon", arch: "Upper" },
  };
  const { payload } = buildSeazonaOrderPayload(c, { codeToId: makeCodeToId(), userId: "x" });
  assert.ok(payload.items.some((i) => i.arch === 1));
});

test("buildSeazonaOrderPayload applies overrides", () => {
  const c = { seazonaClientId: "x", patientFirst: "A", patientLast: "B", deviceKey: "ddso",
    deviceOptions: { baseMaterial: "Nylon", modifications: ["__nope__"] } };
  const overrides = { "mod:__nope__": { code: "9999", name: "Custom" } };
  const codeToId = { "9999": "id-9999" };
  const { payload, warnings } = buildSeazonaOrderPayload(c, { codeToId, userId: "u", overrides });
  assert.ok(payload.items.some((i) => i.id === "id-9999"));
  assert.ok(!warnings.some((w) => w.includes("__nope__")));
});

test("a device whose primary line cannot resolve marks the payload not-ok", () => {
  const { ok, warnings } = buildSeazonaOrderPayload(
    { deviceKey: "olmos-night", deviceOptions: { variant: "DEPROGRAMMER (ON-D) - Anterior Occlusion" }, seazonaClientId: "c1" },
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.ok(warnings.some((w) => /unmapped/.test(w)));
});

test("a fully resolvable device is ok", () => {
  const { ok } = buildSeazonaOrderPayload(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } },
    { codeToId: { 2608: "id-2608" }, userId: "u1" }
  );
  assert.equal(ok, true);
});

test("a guard-only order is ok when its code resolves", () => {
  const { ok, warnings } = buildSeazonaOrderPayload(
    { deviceKey: "guard", deviceOptions: { standardGuards: { "Essix Tray": { "UPPER ARCH": true } } }, seazonaClientId: "c1" },
    { codeToId: { 2161: "id-2161" }, userId: "u1" }
  );
  assert.equal(ok, true);
  assert.deepEqual(warnings, []);
});
