import { test } from "vitest";
import assert from "node:assert/strict";
import { buildSeazonaOrderPayload, buildSeazonaOrderPayloadMulti } from "./build-order-payload.js";
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

test("buildSeazonaOrderPayloadMulti with zero devices is never ok (no vacuous true)", () => {
  const { ok, perDevice, warnings } = buildSeazonaOrderPayloadMulti(
    { seazonaClientId: "c1" },
    [],
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.deepEqual(perDevice, []);
  assert.ok(warnings.length > 0, "a not-ok result must always say why");
});

/* ── ok === false must always name something ───────────────────────────────
   The 422 that refuses an order puts `warnings` straight into `details`. A
   resolver that returns nothing at all (no items AND no unmapped keys) used to
   leave that list empty: staff read "selections are not yet mapped" naming
   nothing at all. */

test("a device that resolves to nothing at all still names itself in warnings", () => {
  const { ok, warnings, unmapped } = buildSeazonaOrderPayload(
    { deviceKey: "guard", deviceOptions: {}, seazonaClientId: "c1" },
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.deepEqual(unmapped, [], "this case is precisely the one with nothing flagged");
  assert.ok(warnings.some((w) => w.includes("guard")), `warnings did not name the device: ${JSON.stringify(warnings)}`);
});

test("per device, multi names the device whose appliance line is missing", () => {
  const { ok, warnings, perDevice } = buildSeazonaOrderPayloadMulti(
    { seazonaClientId: "c1" },
    [{ deviceKey: "guard", label: "Nightguard", deviceOptions: {} }],
    { codeToId: {}, userId: "u1" }
  );
  assert.equal(ok, false);
  assert.equal(perDevice[0].ok, false);
  assert.ok(warnings.some((w) => w.includes("Nightguard")), JSON.stringify(warnings));
});

test("an attribute-only device (a $0 line, no appliance) is refused AND explained", () => {
  // attr:occlusal:posterior → 2293 resolves, so items.length === 1 while the
  // appliance line is gone. Gating on items.length would push this to the lab.
  const { ok, payload, warnings } = buildSeazonaOrderPayloadMulti(
    { seazonaClientId: "c1" },
    [{ deviceKey: "guard", label: "Nightguard", deviceOptions: { occlusalContact: "Posterior Contact" } }],
    { codeToId: { 2293: "id-2293" }, userId: "u1" }
  );
  assert.equal(payload.items.length, 1, "the $0 attribute line alone");
  assert.equal(ok, false);
  assert.ok(warnings.length > 0);
});

test("whenever ok is false, warnings is non-empty — for every device in the tables", () => {
  const cases = [
    { deviceKey: "guard", deviceOptions: {} },
    { deviceKey: "ortho-expander", deviceOptions: {} },
    { deviceKey: "ddso", deviceOptions: {} },
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } }, // no codeToId entry
    { deviceKey: undefined, deviceOptions: {} },
    { deviceKey: "olmos-night", deviceOptions: { variant: "RAMP (ON-R) - Anterior Occlusion" } },
  ];
  for (const c of cases) {
    const { ok, warnings } = buildSeazonaOrderPayload({ ...c, seazonaClientId: "c1" }, { codeToId: {}, userId: "u1" });
    if (ok) continue;
    assert.ok(warnings.length > 0, `ok=false with empty warnings for ${JSON.stringify(c)}`);
  }
});
