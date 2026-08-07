/**
 * Cross-package coverage test.
 *
 * The doctor-facing form lives in apps/web; the resolver that turns its answers
 * into Seazona lines lives here. The option values are read from the form
 * definition itself rather than restated, so adding a render to the picker
 * without giving the resolver an answer for it fails HERE instead of silently
 * dropping a doctor's selection in production.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { resolveGuard } from "./guard.js";
import { digitalRxForm } from "../../../../../../web/src/data/forms/digital-rx.form.js";

/** The live form definition's field for `key`. */
function field(key) {
  for (const section of digitalRxForm.sections)
    for (const f of section.fields || []) if (f.key === key) return f;
  throw new Error(`field ${key} is not in the digital Rx form any more — update this test`);
}

/** Read a field's option VALUES straight out of the live form definition. */
const optionValues = (key) =>
  (field(key).options || []).map((o) => (typeof o === "string" ? o : o.value));

test("the nightguardDevice picker is wired to the form at all", () => {
  const values = optionValues("nightguardDevice");
  assert.ok(values.length >= 3, `expected the picker to still offer renders, got ${values.length}`);
});

test("every nightguardDevice render either emits a line or is flagged unmapped", () => {
  for (const value of optionValues("nightguardDevice")) {
    // No base material: the picker alone is what a doctor can submit.
    const bare = resolveGuard({ variant: value });
    assert.ok(
      bare.items.length > 0 || bare.unmapped.length > 0,
      `nightguardDevice "${value}" resolved to NOTHING — neither a line item nor an unmapped flag`
    );

    // And with every base material the matrix knows about.
    for (const material of ["PMT (Diamoform)", "BIOMED (Printed)", "Nylon (Printed)", "Dual-Laminate", "Acrylic w/clasps", "BioFlex"]) {
      const withMaterial = resolveGuard({ variant: value, baseMaterial: material });
      assert.ok(
        withMaterial.items.length > 0 || withMaterial.unmapped.length > 0,
        `nightguardDevice "${value}" + "${material}" resolved to NOTHING`
      );
    }
  }
});

test("every standardGuards matrix row either emits a line or is flagged unmapped", () => {
  for (const row of field("standardGuards").rows || []) {
    const bare = resolveGuard({ standardGuards: { [row]: { "UPPER ARCH": true } } });
    assert.ok(
      bare.items.length > 0 || bare.unmapped.length > 0,
      `standardGuards row "${row}" resolved to NOTHING`
    );
  }
});
