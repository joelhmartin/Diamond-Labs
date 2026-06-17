import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSeazonaOrderPayload } from "./build-order-payload.js";
import { DEVICE_MAP } from "./device-seazona-map.js";

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

// Build codeToId from the actual map so tests track real seeded codes.
function makeCodeToId() {
  const m = {};
  const add = (c) => { if (c) m[c] = `id-${c}`; };
  for (const dev of Object.values(DEVICE_MAP)) {
    for (const p of Object.values(dev.primary || {})) add(p.code);
  }
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
  // "Dual-Laminate Nightguard" is the exact key in the guard primary map; arch from deviceOptions
  const c = {
    ...baseCase,
    deviceKey: "guard",
    deviceOptions: { baseMaterial: "Dual-Laminate Nightguard", arch: "Upper" },
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
