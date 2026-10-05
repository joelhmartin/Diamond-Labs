import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveLineItems } from "./index.js";

test("DDSO NYLON from the Rx form resolves to 2608", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } });
  assert.equal(unmapped.length, 0);
  assert.equal(items[0].code, "2608");
  assert.equal(items[0].mapKey, "primary:ddso:nylon");
});

test("the older wizard's 'Nylon' resolves to the same row", () => {
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "Nylon" } });
  assert.equal(items[0].code, "2608");
});

test("modifications become line items; design attributes do not (they are notes)", () => {
  const { items, unmapped } = resolveLineItems({
    deviceKey: "ddso",
    deviceOptions: { baseMaterial: "NYLON", modifications: ["Tongue Positioners"], occlusalContact: "Anterior Contact", designPreference: "Lingual-Free" },
  });
  const codes = items.map((i) => i.code).sort();
  assert.deepEqual(codes, ["2330", "2608"]);
  assert.deepEqual(unmapped, []);
});

test("an open row never emits and is always flagged", () => {
  const { items, unmapped } = resolveLineItems({
    deviceKey: "olmos-night",
    deviceOptions: { variant: "DEPROGRAMMER (ON-D) - Anterior Occlusion" },
  });
  assert.equal(items.length, 0);
  assert.ok(unmapped.includes("primary:olmos-night:ond"));
});

test("a DB override wins over the table", () => {
  const overrides = { "primary:ddso:nylon": { code: "9999", name: "Custom" } };
  const { items } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON" } }, { overrides });
  assert.equal(items[0].code, "9999");
  assert.equal(items[0].overridden, true);
});

test("an unknown modification is flagged, never guessed", () => {
  const { unmapped } = resolveLineItems({ deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["__nope__"] } });
  assert.ok(unmapped.some((u) => u.includes("__nope__")));
});

test("an override cannot collapse a two-arch guard order into one line", () => {
  // A per-arch row with a material the matrix has no product for: the
  // resolver reports one unmapped key for what is physically two appliances.
  const overrides = { "guard:nightguard-full-occlusion:lab-decision": { code: "9999", name: "Custom" } };
  const { items, unmapped } = resolveLineItems(
    {
      deviceKey: "guard",
      deviceOptions: { standardGuards: { "Nightguard - Full Occlusion": { "UPPER ARCH": true, "LOWER ARCH": true, "Base Material": "Lab Decision" } } },
    },
    { overrides }
  );
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["guard:nightguard-full-occlusion:lab-decision"]);
});

test("a 'none' attribute emits no line item and no unmapped flag", () => {
  const { items, unmapped } = resolveLineItems({
    deviceKey: "ddso",
    deviceOptions: { baseMaterial: "NYLON", designPreference: "Standard" },
  });
  assert.deepEqual(items.map((i) => i.code), ["2608"]);
  assert.equal(unmapped.length, 0);
});

test("a noteOnly override emits a non-product line, never a phantom confirmed code", () => {
  // mod:wrap-distal is a real open row (code: null) — exactly the case an
  // admin resolves permanently with scope: "always" + noteOnly: true.
  const overrides = { "mod:wrap-distal": { code: null, name: null, noteOnly: true } };
  const { items, unmapped } = resolveLineItems(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["Wrap Distal"] } },
    { overrides }
  );
  assert.equal(unmapped.length, 0, "a resolved noteOnly ruling must not still read as unmapped");
  const wrap = items.find((i) => i.mapKey === "mod:wrap-distal");
  assert.ok(wrap, "expected a line for the noteOnly-overridden modification");
  assert.equal(wrap.noteOnly, true);
  assert.equal(wrap.code, null, "a noteOnly ruling must never invent a code");
});

test("a code-less override that is NOT noteOnly is incoherent and falls back to unmapped", () => {
  // A confirmed mapping to nothing is not a valid state — it must not slip
  // through as a phantom "confirmed" line with no product on it.
  const overrides = { "mod:wrap-distal": { code: null, name: null, noteOnly: false } };
  const { items, unmapped } = resolveLineItems(
    { deviceKey: "ddso", deviceOptions: { baseMaterial: "NYLON", modifications: ["Wrap Distal"] } },
    { overrides }
  );
  assert.ok(unmapped.includes("mod:wrap-distal"));
  assert.ok(!items.some((i) => i.mapKey === "mod:wrap-distal"));
});

// ── Olmos Night: design × material, one SKU per pair. Expected codes are the
// products the lab actually billed for these JotForm answers (2025–26). ──
const NIGHT = {
  "DEPROGRAMMER (ON-D) - Anterior Occlusion": { NYLON: "2119", "PMT (Diamoform)": "2114", BIOMED: "2118", "DUAL-LAMINATE": "2117", "ACRYLIC W/CLASPS": "2115" },
  "POSITIONER (ON-P) - Anterior Occlusion":   { NYLON: "2130", "PMT (Diamoform)": "2125", BIOMED: "2129", "DUAL-LAMINATE": "2128", "ACRYLIC W/CLASPS": "2126" },
  "RAMP (ON-R) - Anterior Occlusion":         { NYLON: "2142", "PMT (Diamoform)": "2137", BIOMED: "2141", "DUAL-LAMINATE": "2140", "ACRYLIC W/CLASPS": "2138" },
};

test("every Olmos Night design + material resolves to its own product", () => {
  for (const [variant, byMaterial] of Object.entries(NIGHT)) {
    for (const [baseMaterial, code] of Object.entries(byMaterial)) {
      const { items, unmapped } = resolveLineItems({ deviceKey: "olmos-night", deviceOptions: { variant, baseMaterial } });
      assert.deepEqual(unmapped, [], `${variant} + ${baseMaterial}`);
      assert.equal(items[0].code, code, `${variant} + ${baseMaterial}`);
      assert.equal(items[0].status, "confirmed");
    }
  }
});

test("an Olmos Night design with no material is held, never guessed", () => {
  const { items, unmapped } = resolveLineItems({ deviceKey: "olmos-night", deviceOptions: { variant: "POSITIONER (ON-P) - Anterior Occlusion" } });
  assert.equal(items.length, 0);
  assert.deepEqual(unmapped, ["primary:olmos-night:onp"]);
});

test("Titration resolves to ONT Nylon with or without a material answer", () => {
  for (const baseMaterial of [undefined, "NYLON"]) {
    const { items } = resolveLineItems({ deviceKey: "olmos-night", deviceOptions: { variant: "TITRATION (ON-T) - NYLON Only", baseMaterial } });
    assert.equal(items[0].code, "2144");
  }
});

test("D-Pro and Manta resolve to different products", () => {
  assert.equal(resolveLineItems({ deviceKey: "cadcam-d-pro", deviceOptions: { variant: "D-Pro" } }).items[0].code, "2539");
  assert.equal(resolveLineItems({ deviceKey: "cadcam-d-pro", deviceOptions: { variant: "Manta" } }).items[0].code, "2149");
});

test("Olmos Night modifications resolve like DDSO's", () => {
  const { items } = resolveLineItems({
    deviceKey: "olmos-night",
    deviceOptions: { variant: "POSITIONER (ON-P) - Anterior Occlusion", baseMaterial: "NYLON", modifications: ["Vertical Shims", "BAB Loop"] },
  });
  assert.deepEqual(items.map((i) => i.code), ["2130", "2302", "2303"]);
});

// A loop or ramp is built on vertical shims, and the lab bills the shims with
// it: BAB Loop 2302 97% (n=58), ON Loop 93% (n=44), ON Ramp 77% (n=26); Night
// device BAB Loop 2 of 3; replay 22 of 25. [device, modifications, codes]
const LOOP_SHIMS = [
  ["ddso", ["BAB Loop"], ["2608", "2303", "2302"]],
  ["ddso", ["ON Loop"], ["2608", "2300", "2302"]],
  ["ddso", ["ON Ramp"], ["2608", "2301", "2302"]],
  ["ddso", ["Vertical Shims", "BAB Loop"], ["2608", "2302", "2303"]],
  ["ddso", ["BAB Loop", "Vertical Shims"], ["2608", "2303", "2302"]],
  ["ddso", ["ON Loop", "BAB Loop"], ["2608", "2300", "2303", "2302"]],
  ["ddso", ["Tongue Positioners"], ["2608", "2330"]],
  ["olmos-night", ["BAB Loop"], ["2119", "2303", "2302"]],
];
for (const [deviceKey, modifications, codes] of LOOP_SHIMS)
  test(`loops imply vertical shims, billed once: ${deviceKey} ${modifications.join(" + ")}`, () => {
    const deviceOptions = { baseMaterial: "NYLON", modifications };
    if (deviceKey === "olmos-night") deviceOptions.variant = "DEPROGRAMMER (ON-D) - Anterior Occlusion";
    const { items, unmapped } = resolveLineItems({ deviceKey, deviceOptions });
    assert.deepEqual(unmapped, []);
    assert.deepEqual(items.map((i) => i.code), codes);
  });
