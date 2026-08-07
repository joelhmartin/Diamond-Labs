import { test } from "vitest";
import assert from "node:assert/strict";
import { DEVICE_ROWS } from "../services/rx/catalog-map/devices.table.js";
import { MODIFICATION_ROWS } from "../services/rx/catalog-map/modifications.table.js";
import { ATTRIBUTE_ROWS } from "../services/rx/catalog-map/attributes.table.js";
import { GUARD_ROWS, GUARD_ROW_LABELS, resolveGuard } from "../services/rx/catalog-map/resolvers/guard.js";
import { ALL, bucket, renderDoc } from "./report-rx-mapping-gaps.js";

const ROWS = [...DEVICE_ROWS, ...MODIFICATION_ROWS, ...ATTRIBUTE_ROWS, ...GUARD_ROWS];

test("the generator reports on exactly the four row sources", () => {
  assert.deepEqual([...ALL].sort(), [...ROWS].sort());
});

test("every open row carries a plain-language reason", () => {
  for (const r of ROWS.filter((x) => x.status === "open"))
    assert.ok(r.reason && r.reason.trim().length > 20, `open row ${r.mapKey} has no usable reason`);
});

test("a 'none' row is never bucketed into the lab document", () => {
  // Assert against the GENERATOR's buckets and its rendered output. The earlier
  // version filtered ALL by status s and then asked whether any of those rows
  // had status "none" — false by construction for every s !== "none", so it
  // proved nothing.
  const none = ROWS.filter((r) => r.status === "none");
  assert.ok(none.length > 0, "expected at least one none row to exist");

  const bucketed = ["confirmed", "proposed", "open"].flatMap((s) => bucket(s));
  for (const r of none)
    assert.ok(!bucketed.includes(r), `none row ${r.mapKey} was bucketed into the document`);

  // Every row is either bucketed or a none row — nothing falls off the report.
  assert.equal(bucketed.length + none.length, ALL.length);

  const doc = renderDoc();
  for (const r of none)
    assert.ok(!doc.includes(r.name), `none row ${r.mapKey} ("${r.name}") reached the lab document`);
});

test("the document tells the lab about the unmapped ortho taxonomy", () => {
  // resolveOrtho contributes no rows, so ~36 SKUs — the largest open decision,
  // and the reason every ortho order is held — were invisible in the document
  // the lab owner is asked to sign off, while resolvers/ortho.js points here.
  const doc = renderDoc();
  assert.match(doc, /## Orthodontic appliances — not yet mapped/);
  assert.match(doc, /36 orthodontic products/);
  assert.match(doc, /every orthodontic order is held/i);
});

test("the document never claims a code for an open row", () => {
  const doc = renderDoc();
  for (const r of bucket("open")) assert.equal(r.code, null, `${r.mapKey} is open but carries ${r.code}`);
  for (const r of [...bucket("confirmed"), ...bucket("proposed")])
    assert.ok(doc.includes(r.code), `${r.mapKey}'s code ${r.code} is missing from the document`);
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
  for (const r of ROWS)
    if (r.status === "confirmed" || r.status === "proposed")
      assert.ok(r.code, `${r.mapKey} is ${r.status} but has no code`);
});
