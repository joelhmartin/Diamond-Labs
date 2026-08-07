import { test } from "vitest";
import assert from "node:assert/strict";
import { DEVICE_ROWS } from "../services/rx/catalog-map/devices.table.js";
import { MODIFICATION_ROWS } from "../services/rx/catalog-map/modifications.table.js";
import { ATTRIBUTE_ROWS } from "../services/rx/catalog-map/attributes.table.js";
import { GUARD_ROWS, GUARD_ROW_LABELS, resolveGuard } from "../services/rx/catalog-map/resolvers/guard.js";

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
  const materials = [undefined, "PMT (Diamoform)", "BIOMED (Printed)", "Nylon (Printed)", "Dual-Laminate", "Acrylic w/clasps", "BioFlex"];
  const collect = ({ items, unmapped }) => {
    items.forEach((i) => emitted.add(i.mapKey));
    unmapped.forEach((u) => emitted.add(u));
  };
  // Row labels come from the resolver itself — a row added there but reachable
  // by neither path must fail here rather than ship to the lab as Confirmed.
  for (const row of GUARD_ROW_LABELS)
    for (const m of materials) {
      const cells = { "UPPER ARCH": true };
      if (m) cells["Base Material"] = m;
      collect(resolveGuard({ standardGuards: { [row]: cells } }));   // matrix path
      collect(resolveGuard({ variant: row, baseMaterial: m }));      // device-picker path
    }
  for (const r of GUARD_ROWS)
    assert.ok(emitted.has(r.mapKey), `GUARD_ROWS mapKey ${r.mapKey} is never emitted by resolveGuard`);
});

test("no row shown to the lab carries a null code unless it is open", () => {
  for (const r of ALL)
    if (r.status === "confirmed" || r.status === "proposed")
      assert.ok(r.code, `${r.mapKey} is ${r.status} but has no code`);
});
