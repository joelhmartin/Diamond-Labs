import { test } from "vitest";
import assert from "node:assert/strict";
import { DEVICE_ROWS } from "../services/rx/catalog-map/devices.table.js";
import { MODIFICATION_ROWS } from "../services/rx/catalog-map/modifications.table.js";
import { ATTRIBUTE_ROWS } from "../services/rx/catalog-map/attributes.table.js";
import { GUARD_ROWS, resolveGuard } from "../services/rx/catalog-map/resolvers/guard.js";

const ALL = [...DEVICE_ROWS, ...MODIFICATION_ROWS, ...ATTRIBUTE_ROWS, ...GUARD_ROWS];

test("every open row carries a plain-language reason", () => {
  for (const r of ALL.filter((x) => x.status === "open"))
    assert.ok(r.reason && r.reason.trim().length > 20, `open row ${r.mapKey} has no usable reason`);
});

test("a 'none' row is never bucketed into the lab document", () => {
  for (const s of ["confirmed", "proposed", "open"])
    assert.equal(ALL.filter((r) => r.status === s).some((r) => r.status === "none"), false);
  assert.ok(ALL.some((r) => r.status === "none"), "expected at least one none row to exist");
});

test("every GUARD_ROWS mapKey is one resolveGuard can actually emit", () => {
  const emitted = new Set();
  const rows = ["Nightguard - Full Occlusion", "Occlusal Guard - NTI Type", "Michigan Splint - Anterior Guidance",
                "Essix Tray", "Bleaching Trays", "Neurosensory Stent", "Dual Arch - FLATPLANE", "Occlusal Guard - Slider Type"];
  const materials = [undefined, "PMT (Diamoform)", "BIOMED (Printed)", "Nylon (Printed)", "Dual-Laminate", "Acrylic w/clasps", "BioFlex"];
  for (const row of rows)
    for (const m of materials) {
      const cells = { "UPPER ARCH": true };
      if (m) cells["Base Material"] = m;
      const { items, unmapped } = resolveGuard({ standardGuards: { [row]: cells } });
      items.forEach((i) => emitted.add(i.mapKey));
      unmapped.forEach((u) => emitted.add(u));
    }
  for (const r of GUARD_ROWS)
    assert.ok(emitted.has(r.mapKey), `GUARD_ROWS mapKey ${r.mapKey} is never emitted by resolveGuard`);
});

test("no row shown to the lab carries a null code unless it is open", () => {
  for (const r of ALL)
    if (r.status === "confirmed" || r.status === "proposed")
      assert.ok(r.code, `${r.mapKey} is ${r.status} but has no code`);
});
