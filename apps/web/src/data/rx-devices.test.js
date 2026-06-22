import { test } from "vitest";
import assert from "node:assert/strict";
import { RX_DEVICES } from "./rx-devices.js";
const byKey = Object.fromEntries(RX_DEVICES.map((d) => [d.key, d]));

test("occlusal contact uses canonical 4 (no Tripod+1/Variable)", () => {
  assert.deepEqual(byKey["ddso"].options.occlusalContact.options, ["Posterior", "Anterior", "Full", "Tripod"]);
});
test("design preference is the canonical 4", () => {
  assert.deepEqual(byKey["ddso"].options.designPreference.options,
    ["Standard", "Lingual-Free", "Buccal-Free", "Full Coverage"]);
});
test("DDSO base material is Nylon/Biomed", () => {
  assert.deepEqual(byKey["ddso"].options.baseMaterial.options, ["Nylon", "Biomed"]);
});
test("OD base material is the canonical 6", () => {
  assert.deepEqual(byKey["olmos-day"].options.baseMaterial.options,
    ["OD (PMT)", "OD BIOFLEX", "Printed Nylon", "Acrylic w/clasps", "Dual-Laminate", "Milled"]);
});
test("MORA and ARA exist in tmd category", () => {
  assert.ok(byKey["mora"] && byKey["mora"].category === "tmd");
  assert.ok(byKey["ara"] && byKey["ara"].category === "tmd");
});
test("ortho category exists with appliance type + expansion screw + retention", () => {
  const o = byKey["ortho-expander"];
  assert.equal(o.category, "ortho");
  assert.deepEqual(o.options.applianceType.options, ["Modified Tandem", "Twin Block", "Other"]);
  assert.ok(o.options.expansionScrew.options.includes("Slim-Line Variety-Click"));
  assert.ok(o.options.retention.options.includes("Fixed (Banded)"));
});
