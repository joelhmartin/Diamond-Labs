import { test } from "vitest";
import assert from "node:assert/strict";

import { orthoRxForm } from "./ortho-rx.form.js";
import { ORTHO_SECTIONS, ORTHO_RECORDS_FIELDS } from "./ortho.sections.js";
import { CASE_ID_SECTION, SUBMIT_SECTION } from "./rx-common.sections.js";
import { digitalRxForm } from "./digital-rx.form.js";
import { allFields, visibleFields, disabledOptions, validateForm } from "./form-logic.js";

// Every field the ortho appliance questions define. The resolver
// (apps/api/.../resolvers/ortho.js) and the shared adapter key on these.
const ORTHO_KEYS = [
  "selectDevice", "upperArchRetention", "upperExpansionType", "lowerArchRetention",
  "mxSelections", "lowerExpansionType", "requiredSelection", "tandemBowSetting",
  "addToMaxillary", "addToMandibular", "occlusalOptionsTandem", "dualArchComments",
  "dualArchDesignDraw", "dualArchArtboard", "upperExpansionSelection", "maxillaryAdd",
  "maxillaryDesignDraw", "maxillaryArtboard", "maxillaryComments", "lowerExpansionSelection",
  "removableMandibularExpansion", "fixedMandibularExpansion", "mandibularAdd",
  "mandibularDesignDraw", "mandibularArtboard", "orthoDesignComments",
  "nuveloDigitalSetup", "digitalStudyModels", "digitalSetupEmail",
];

test("form metadata is correct", () => {
  assert.equal(orthoRxForm.slug, "ortho");
  assert.equal(orthoRxForm.jotformId, "213545611846154");
  assert.equal(orthoRxForm.title, "Diamond Orthodontic Rx.");
  assert.equal(orthoRxForm.route, "/app/rx/ortho");
});

test("the ortho form carries every ortho field key", () => {
  const keys = new Set(allFields(orthoRxForm).map((f) => f.key));
  for (const k of ORTHO_KEYS) assert.ok(keys.has(k), `ortho form is missing ${k}`);
});

test("the appliance questions are the shared definitions, not copies", () => {
  // One source of truth: the form composes the exported sections by reference.
  for (const s of ORTHO_SECTIONS) assert.ok(orthoRxForm.sections.includes(s), `section ${s.id} is not the shared object`);
  const submission = orthoRxForm.sections.find((s) => s.id === "case-submission");
  for (const f of ORTHO_RECORDS_FIELDS) assert.ok(submission.fields.includes(f), `${f.key} is not the shared field`);
});

test("the case header, records block and submit footer are shared with the digital form", () => {
  assert.ok(orthoRxForm.sections.includes(CASE_ID_SECTION));
  assert.ok(orthoRxForm.sections.includes(SUBMIT_SECTION));
  assert.ok(digitalRxForm.sections.includes(CASE_ID_SECTION));
  assert.ok(digitalRxForm.sections.includes(SUBMIT_SECTION));
  const records = (form) => form.sections.find((s) => s.id === "case-submission").fields;
  for (const f of records(digitalRxForm))
    assert.ok(records(orthoRxForm).includes(f), `records field ${f.key} is not shared`);
});

test("no ortho section is gated on a digital-form device any more", () => {
  for (const s of ORTHO_SECTIONS) assert.equal(s.showIf, undefined, `section ${s.id} still carries a gate`);
  for (const f of allFields(orthoRxForm))
    assert.ok(!JSON.stringify(f.showIf || {}).includes("devicesToOrder"), `${f.key} is gated on devicesToOrder`);
});

test("all field keys are unique and present", () => {
  const seen = new Set();
  for (const { key } of allFields(orthoRxForm)) {
    assert.ok(key != null && key !== "", "found a field with no key");
    assert.ok(!seen.has(key), `duplicate key: ${key}`);
    seen.add(key);
  }
});

test("the shared required questions (patient, records, signature) are required here too", () => {
  const { errors } = validateForm(orthoRxForm, {});
  assert.ok(errors.patientName && errors.doctorSignature && errors.records);
});

test("the study-model / digital-setup questions show without any device gate", () => {
  const shown = visibleFields(orthoRxForm, {}).map((f) => f.key);
  for (const k of ["nuveloDigitalSetup", "digitalStudyModels"]) assert.ok(shown.includes(k), `${k} should show`);
});

test("digitalSetupEmail shows only once nuveloDigitalSetup carries an answer", () => {
  assert.ok(!visibleFields(orthoRxForm, {}).map((f) => f.key).includes("digitalSetupEmail"));
  const shown = visibleFields(orthoRxForm, { nuveloDigitalSetup: { "Setup Instructions__Orient to HIP": "yes" } });
  assert.ok(shown.map((f) => f.key).includes("digitalSetupEmail"));
});

test("no two fields in the same section carry the same label", () => {
  const SKIP = new Set(["heading", "note", "static", "image", "divider"]);
  for (const answers of [{}, { selectDevice: "Modified Tandem", lowerArchRetention: "Fixed (Banded)", rushCase: ["Yes"] }]) {
    const visible = new Set(visibleFields(orthoRxForm, answers).map((f) => f.key));
    for (const section of orthoRxForm.sections) {
      const seen = new Map();
      for (const f of section.fields || []) {
        if (!f.label || SKIP.has(f.type) || !visible.has(f.key)) continue;
        assert.ok(!seen.has(f.label), `section ${section.id}: "${f.label}" is on both ${seen.get(f.label)} and ${f.key}`);
        seen.set(f.label, f.key);
      }
    }
  }
});

/* ═══════════════════════════════════════════════════════════════════════
   Conditional-display rules (lab-owner approved), carried over from when
   these sections lived in the digital form.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Artboards: gated on their own "design (draw)" checkbox ── */

test("dualArchArtboard is gated on dualArchDesignDraw", () => {
  const base = {};
  const hidden = visibleFields(orthoRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("dualArchArtboard"));
  const shown = visibleFields(orthoRxForm, {
    ...base,
    dualArchDesignDraw: ["Diamond ORTHO Artboard"],
  }).map((f) => f.key);
  assert.ok(shown.includes("dualArchArtboard"));
});

test("maxillaryArtboard is gated on maxillaryDesignDraw", () => {
  const base = {};
  const hidden = visibleFields(orthoRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("maxillaryArtboard"));
  const shown = visibleFields(orthoRxForm, {
    ...base,
    maxillaryDesignDraw: ["Diamond ORTHO Artboard"],
  }).map((f) => f.key);
  assert.ok(shown.includes("maxillaryArtboard"));
});

test("mandibularArtboard is gated on mandibularDesignDraw", () => {
  const base = {};
  const hidden = visibleFields(orthoRxForm, base).map((f) => f.key);
  assert.ok(!hidden.includes("mandibularArtboard"));
  const shown = visibleFields(orthoRxForm, {
    ...base,
    mandibularDesignDraw: ["Diamond ORTHO Artboard"],
  }).map((f) => f.key);
  assert.ok(shown.includes("mandibularArtboard"));
});

/* ── Tandem-only fields ── */

test("tandemBowSetting shows only for Modified Tandem, not Twin Block", () => {
  const twinBlock = visibleFields(orthoRxForm, {
    selectDevice: "Twin Block",
  }).map((f) => f.key);
  assert.ok(!twinBlock.includes("tandemBowSetting"));
  const tandem = visibleFields(orthoRxForm, {
    selectDevice: "Modified Tandem",
  }).map((f) => f.key);
  assert.ok(tandem.includes("tandemBowSetting"));
});

test("occlusalOptionsTandem shows only for Modified Tandem, not Twin Block", () => {
  const twinBlock = visibleFields(orthoRxForm, {
    selectDevice: "Twin Block",
  }).map((f) => f.key);
  assert.ok(!twinBlock.includes("occlusalOptionsTandem"));
  const tandem = visibleFields(orthoRxForm, {
    selectDevice: "Modified Tandem",
  }).map((f) => f.key);
  assert.ok(tandem.includes("occlusalOptionsTandem"));
});

/* ── Mandibular expansion split: removable vs fixed lowerArchRetention ── */

test("removableMandibularExpansion shows only for removable lowerArchRetention", () => {
  const base = {};
  const fixed = visibleFields(orthoRxForm, {
    ...base,
    lowerArchRetention: "Fixed (Banded)",
  }).map((f) => f.key);
  assert.ok(!fixed.includes("removableMandibularExpansion"));
  const removable = visibleFields(orthoRxForm, {
    ...base,
    lowerArchRetention: "Acrylic w/ clasp retention",
  }).map((f) => f.key);
  assert.ok(removable.includes("removableMandibularExpansion"));
  const removable2 = visibleFields(orthoRxForm, {
    ...base,
    lowerArchRetention: "Printed NYLON w/ composite retention",
  }).map((f) => f.key);
  assert.ok(removable2.includes("removableMandibularExpansion"));
});

test("fixedMandibularExpansion shows only for fixed lowerArchRetention", () => {
  const base = {};
  const removable = visibleFields(orthoRxForm, {
    ...base,
    lowerArchRetention: "Acrylic w/ clasp retention",
  }).map((f) => f.key);
  assert.ok(!removable.includes("fixedMandibularExpansion"));
  const fixed = visibleFields(orthoRxForm, {
    ...base,
    lowerArchRetention: "Fixed (Banded)",
  }).map((f) => f.key);
  assert.ok(fixed.includes("fixedMandibularExpansion"));
  const fixed2 = visibleFields(orthoRxForm, {
    ...base,
    lowerArchRetention: "Fixed [3D Printed] Bands",
  }).map((f) => f.key);
  assert.ok(fixed2.includes("fixedMandibularExpansion"));
});

/* ── Contradictory expansion options: disableOptionsIf ── */

test("upperExpansionType's Fixed ONLY options are disabled once upperArchRetention is removable", () => {
  const fields = allFields(orthoRxForm);
  const field = fields.find((f) => f.key === "upperExpansionType");
  assert.ok(field, "upperExpansionType field missing");
  const fixedOnlyOptions = field.options.filter((o) => /\(Fixed ONLY\)/.test(o));
  assert.equal(fixedOnlyOptions.length, 4, "expected 4 Fixed ONLY options on upperExpansionType");

  const withFixed = disabledOptions(field, { upperArchRetention: "Fixed (Banded)" });
  assert.equal(withFixed.size, 0, "no options disabled while retention is fixed");

  const withRemovable = disabledOptions(field, {
    upperArchRetention: "Acrylic w/ clasp retention",
  });
  for (const o of fixedOnlyOptions) assert.ok(withRemovable.has(o), `${o} should be disabled`);

  const withRemovable2 = disabledOptions(field, {
    upperArchRetention: "Printed NYLON w/ composite retention",
  });
  for (const o of fixedOnlyOptions) assert.ok(withRemovable2.has(o), `${o} should be disabled`);
});

test("lowerExpansionType's Memory Screw (Removable Only) is disabled once lowerArchRetention is fixed", () => {
  const fields = allFields(orthoRxForm);
  const field = fields.find((f) => f.key === "lowerExpansionType");
  assert.ok(field, "lowerExpansionType field missing");
  assert.ok(
    field.options.includes("Memory Screw (Removable Only)"),
    "lowerExpansionType is missing its Removable Only option"
  );

  const withRemovable = disabledOptions(field, {
    lowerArchRetention: "Acrylic w/ clasp retention",
  });
  assert.equal(withRemovable.size, 0, "no options disabled while retention is removable");

  const withFixed = disabledOptions(field, { lowerArchRetention: "Fixed (Banded)" });
  assert.ok(withFixed.has("Memory Screw (Removable Only)"));

  const withFixed2 = disabledOptions(field, {
    lowerArchRetention: "Fixed [3D Printed] Bands",
  });
  assert.ok(withFixed2.has("Memory Screw (Removable Only)"));
});

/* ── Tandem reference image: only relevant for Modified Tandem ── */

test("imgModifiedTandem is gated on selectDevice === 'Modified Tandem'", () => {
  const twinBlock = visibleFields(orthoRxForm, {
    selectDevice: "Twin Block",
  }).map((f) => f.key);
  assert.ok(!twinBlock.includes("imgModifiedTandem"));
  const noSelection = visibleFields(orthoRxForm, {}).map((f) => f.key);
  assert.ok(!noSelection.includes("imgModifiedTandem"));
  const tandem = visibleFields(orthoRxForm, {
    selectDevice: "Modified Tandem",
  }).map((f) => f.key);
  assert.ok(tandem.includes("imgModifiedTandem"));
});

/* ── Rescued images no longer point at the retiring JotForm CDN ── */

test("no ortho static image points at jotform.com any more", () => {
  const keys = ["imgModifiedTandem", "imgTandemLength", "imgMaxillaryReference", "imgMandibularReference"];
  const fields = allFields(orthoRxForm);
  for (const k of keys) {
    const field = fields.find((f) => f.key === k);
    assert.ok(field, `${k} field missing`);
    assert.ok(!/jotform\.com/i.test(field.src), `${k}.src still points at jotform.com: ${field.src}`);
    assert.ok(field.src.startsWith("/images/rx/ortho/"), `${k}.src should be a local asset path, got ${field.src}`);
  }
});

