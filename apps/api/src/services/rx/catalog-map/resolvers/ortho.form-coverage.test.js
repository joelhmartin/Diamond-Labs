/**
 * Cross-package coverage test for the ortho resolver.
 *
 * Option values are read from the live ortho form sections (apps/web), and run
 * through the shared adapter the submit route uses, so renaming or adding an
 * option without teaching the resolver fails HERE — not as an order that
 * silently resolves to nothing, and not as a "typed answer" hold on a choice
 * the form itself offered.
 */
import { test } from "vitest";
import assert from "node:assert/strict";
import { buildFormDevices } from "@my-app/shared";
import { resolveOrtho, ORTHO_ROWS } from "./ortho.js";
import { ORTHO_SECTIONS } from "../../../../../../web/src/data/forms/ortho.sections.js";

const ROW_KEYS = new Set(ORTHO_ROWS.map((r) => r.mapKey));

function field(key) {
  for (const section of ORTHO_SECTIONS)
    for (const f of section.fields || []) if (f.key === key) return f;
  throw new Error(`field ${key} is not in the ortho form sections any more — update this test`);
}
const optionValues = (key) => (field(key).options || []).map((o) => (typeof o === "string" ? o : o.value));

/** Answers → resolver output, through the same adapter the submit route uses. */
function resolveAnswers(answers) {
  const [device] = buildFormDevices("ortho", answers);
  assert.equal(device.deviceKey, "ortho-expander");
  return resolveOrtho(device.deviceOptions);
}

const resolvedSomething = ({ items, unmapped }) => items.length > 0 || unmapped.length > 0;
const typedHolds = ({ unmapped }) => unmapped.filter((k) => k.startsWith("ortho:typed:"));

/** Options the form disables for this retention (disableOptionsIf). */
function disabledFor(screwKey, retentionKey, retention) {
  const rules = field(screwKey).disableOptionsIf || [];
  return new Set(
    rules.filter((r) => r.when.key === retentionKey && r.when.oneOf.includes(retention)).flatMap((r) => r.options)
  );
}

for (const arch of ["upper", "lower"]) {
  const retentionKey = `${arch}ArchRetention`;
  const screwKey = `${arch}ExpansionType`;

  test(`every ${arch} retention × expansion pair the form allows resolves or is held — never typed, never nothing`, () => {
    let pairs = 0;
    for (const retention of optionValues(retentionKey))
      for (const screw of optionValues(screwKey)) {
        if (disabledFor(screwKey, retentionKey, retention).has(screw)) continue;
        pairs++;
        const out = resolveAnswers({ [retentionKey]: retention, [screwKey]: screw });
        assert.ok(resolvedSomething(out), `${retention} + ${screw} resolved to NOTHING`);
        assert.deepEqual(typedHolds(out), [], `${retention} + ${screw} was treated as a typed answer`);
        // No ruling at all would leave a bare composite key with no row behind
        // it — the lab would never see the question in the mapping report.
        const appliance = out.items.some((i) => i.arch === arch && !i.mapKey.includes(":bands:"));
        const hold = out.unmapped.find((k) => k.startsWith(`ortho:${arch}:`) && !k.includes(":bands:"));
        assert.ok(appliance || hold, `${retention} + ${screw} has neither an appliance line nor an appliance hold`);
        if (hold) assert.ok(ROW_KEYS.has(hold), `${retention} + ${screw} is held as ${hold}, which no report row explains`);
      }
    assert.ok(pairs >= 10, `expected the ${arch} retention × screw grid to be wired, got ${pairs} pairs`);
  });
}

test("every Select Device option resolves or is held, never as typed", () => {
  for (const v of optionValues("selectDevice")) {
    const out = resolveAnswers({ selectDevice: v });
    assert.ok(resolvedSomething(out), `${v} resolved to NOTHING`);
    assert.deepEqual(typedHolds(out), [], `${v} was treated as a typed answer`);
  }
});

test("every mandibular-expansion pick resolves or is held, never as typed", () => {
  for (const key of ["fixedMandibularExpansion", "removableMandibularExpansion"])
    for (const v of optionValues(key)) {
      const out = resolveAnswers({ [key]: [v] });
      assert.ok(resolvedSomething(out), `${key} "${v}" resolved to NOTHING`);
      assert.deepEqual(typedHolds(out), [], `${key} "${v}" was treated as a typed answer`);
    }
});

test("every add-on checkbox resolves or is held, on both a banded and an acrylic arch, never as typed", () => {
  const addOnFields = { upper: ["addToMaxillary", "maxillaryAdd"], lower: ["addToMandibular", "mandibularAdd"] };
  for (const [arch, keys] of Object.entries(addOnFields))
    for (const key of keys)
      for (const v of optionValues(key))
        for (const retention of ["Fixed (Banded)", "Acrylic w/ clasp retention"]) {
          const out = resolveAnswers({ [`${arch}ArchRetention`]: retention, [key]: [v] });
          assert.deepEqual(typedHolds(out), [], `${key} "${v}" (${retention}) was treated as a typed answer`);
        }
});

test("every arch-only expansion table row resolves or is held", () => {
  for (const [key, arch] of [["upperExpansionSelection", "upper"], ["lowerExpansionSelection", "lower"]]) {
    const f = field(key);
    for (const row of f.rows) {
      const out = resolveAnswers({ [key]: { [`${row}__${f.columns[0]}`]: "x" } });
      assert.ok(
        out.items.some((i) => i.mapKey.startsWith(`ortho:${arch}-selection:`)) ||
          out.unmapped.some((k) => k.startsWith(`ortho:${arch}-selection:`)),
        `${key} row "${row}" resolved to nothing of its own`
      );
    }
  }
});

test("every ORTHO_ROWS mapKey is one the live form can actually reach", () => {
  // A row the form can never produce would sit in the lab document as a
  // question (or a Confirmed mapping) about nothing.
  const emitted = new Set();
  const run = (answers) => {
    const { items, unmapped } = resolveAnswers(answers);
    items.forEach((i) => emitted.add(i.mapKey));
    unmapped.forEach((k) => emitted.add(k));
  };
  const addOnFields = { upper: ["addToMaxillary", "maxillaryAdd"], lower: ["addToMandibular", "mandibularAdd"] };
  for (const arch of ["upper", "lower"]) {
    const retentionKey = `${arch}ArchRetention`;
    for (const retention of optionValues(retentionKey)) {
      for (const screw of optionValues(`${arch}ExpansionType`)) run({ [retentionKey]: retention, [`${arch}ExpansionType`]: screw });
      for (const selectDevice of [undefined, ...optionValues("selectDevice")]) run({ selectDevice, [retentionKey]: retention });
      const bandRow = arch === "upper" ? "Maxillary" : "Mandibular";
      run({ [retentionKey]: retention, requiredSelection: { [`${bandRow}__Place bands on:`]: "6's" } });
      for (const key of addOnFields[arch])
        for (const v of optionValues(key)) run({ [retentionKey]: retention, [key]: [v] });
    }
  }
  for (const key of ["fixedMandibularExpansion", "removableMandibularExpansion"])
    for (const v of optionValues(key)) run({ [key]: [v] });
  run({ selectDevice: "Modified Tandem", lowerArchRetention: "Acrylic w/ clasp retention" });
  for (const key of ["upperExpansionSelection", "lowerExpansionSelection"]) {
    const f = field(key);
    for (const row of f.rows) run({ [key]: { [`${row}__${f.columns[0]}`]: "x" } });
  }

  for (const r of ORTHO_ROWS) assert.ok(emitted.has(r.mapKey), `ORTHO_ROWS ${r.mapKey} is never emitted from the live form`);
});
