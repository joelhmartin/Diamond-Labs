/**
 * Diamond Orthotic Lab Rx. 2025 — doctor-facing digital Rx (reworked v2).
 *
 * Source snapshot: docs/rx-forms/jotform-api/rx-2025-220598308432154-questions.json
 *
 * v2 rework (per lab-owner feedback):
 *  - Doctor identity fields removed — the doctor is logged in and the order is
 *    auto-attributed, so DOCTOR fullname, the doctor email, CONTACT phone, and
 *    the shipping ADDRESS are gone. A read-only note at the top of the first
 *    section reflects the auto-filled account.
 *  - Remake/Repair/Redesign section removed (new-device forms only).
 *  - Empty heading-only / logo-only sections removed.
 *  - A single device-selection gate (`devicesToOrder`, multi-select) drives which
 *    per-device sections appear, via section-level `showIf.includes`. The
 *    renderer auto-skips sections with no visible input fields, so unselected
 *    devices never appear as steps.
 *  - Image-bearing option groups (records picker, OD base-material, ON design)
 *    carry `{ value, label, image }` options rendered as image cards. `value`
 *    stays the canonical option string so downstream mapping is unchanged.
 *  - Static production-calendar image removed; Due Date keeps a turnaround note.
 *  - Orthodontics is NOT a device here: the lab wanted it back as its own form
 *    (ortho-rx.form.js). The case header, records block and submit footer are
 *    shared with that form via rx-common.sections.js.
 */

import {
  heading,
  note,
  radio,
  checkbox,
  select,
  text,
  textarea,
  fileUpload,
  matrix,
  imgOpt,
} from "./form-fields.js";
import { IMG, CASE_ID_SECTION, caseSubmissionSection, SUBMIT_SECTION } from "./rx-common.sections.js";

// Shared column set for the "Vertical Dimensions / Changes to Articulation" tables
// (q221 / q483 / q484 — identical dcolumns in the snapshot).
const VERTICAL_COLS = [
  "Increase for clearance",
  "Call if change required",
  "Increase Vertical",
  "Decrease Vertical",
  "Protrude",
  "Retrude",
];

const ADDITIONAL_OPTIONS = [
  "Wrap distal of last molars",
  "Keep last molars uncovered",
  "Create holes for cusps (minimum vertical)",
];

// qid 390 "OD Material" widget — OD base-material device photos.
const OD_MATERIAL_OPTIONS = [
  { value: "OD (PMT)", label: "OD (PMT)", image: `${IMG}/od_pmt.png` },
  { value: "OD BIOFLEX", label: "OD BIOFLEX", image: `${IMG}/od_bioflex.png` },
  { value: "Printed NYLON", label: "Printed NYLON", image: `${IMG}/od_nylon.png` },
  { value: "Acrylic w/clasps", label: "Acrylic w/clasps", image: `${IMG}/od_acrylic.png` },
  { value: "Dual-Laminate", label: "Dual-Laminate", image: `${IMG}/od_dual_laminate.png` },
  { value: "Milled (↑ wear)", label: "Milled (↑ wear)", image: `${IMG}/od_milled.png` },
];

// qid 197 "ON Occlusal Contact" widget — ON design render images.
const ON_DESIGN_OPTIONS = [
  { value: "DEPROGRAMMER (ON-D) - Anterior Occlusion", label: "DEPROGRAMMER (ON-D) - Anterior Occlusion", image: `${IMG}/on_deprogrammer.png` },
  { value: "POSITIONER (ON-P) - Anterior Occlusion", label: "POSITIONER (ON-P) - Anterior Occlusion", image: `${IMG}/on_positioner.png` },
  { value: "TITRATION (ON-T) - NYLON Only", label: "TITRATION (ON-T) - NYLON Only", image: `${IMG}/on_titration.png` },
  { value: "RAMP (ON-R) - Anterior Occlusion", label: "RAMP (ON-R) - Anterior Occlusion", image: `${IMG}/on_ramp.png` },
];

// The JotForm questions below are `hidden` in the form definition and only
// revealed by conditional logic once a device is picked. The original port
// skipped every hidden question, which silently dropped these four — the
// Night material alone was answered on 3,570 JotForm prescriptions in 2025–26.

// qid 270 "Select Base Material (NIGHT DEVICE ONLY)".
const ON_MATERIAL_OPTIONS = ["NYLON", "PMT (Diamoform)", "BIOMED", "DUAL-LAMINATE", "ACRYLIC W/CLASPS"];

// qid 470 / 488 — shown for Tripod occlusion.
const TITRATION_PLACEMENT_OPTIONS = ["Anterior Only", "Posterior Only", "Anterior & Posterior"];
const TITRATION_PLACEMENT_LABEL =
  "Place vertical titration on (these selections are for Tripod occlusion only):";

// qid 131 / 466 / 485 "Occlusal Contact:" widget — shared DDSO-render images.
const OCCLUSAL_CONTACT_OPTIONS = [
  imgOpt("Posterior Contact", `${IMG}/ddso_post.png`),
  imgOpt("Anterior Contact", `${IMG}/ddso_anterior.png`),
  imgOpt("FULL Occlusal Contact", `${IMG}/ddso_full.png`),
  imgOpt("TRIPOD Occlusion", `${IMG}/ddso_tripod.png`),
];

// qid 182 / 467 / 486 "Digital Device Occlusal Contact:" widget — design renders.
const DESIGN_PREFERENCE_OPTIONS = [
  imgOpt("Standard", `${IMG}/design_std.png`),
  imgOpt("Lingual-Free", `${IMG}/design_standard.png`),
  imgOpt("Buccal-Free", `${IMG}/design_buccalfree.png`),
  imgOpt("Full Coverage", `${IMG}/design_full.png`),
];

// qid 224 / 468 "Digital Device Modifications" widget — modification renders.
const MODIFICATIONS_A_OPTIONS = [
  imgOpt("Tongue Positioners", `${IMG}/mod_tongue_positioners.png`),
  imgOpt("Hooks for Elastics", `${IMG}/mod_hooks.png`),
  imgOpt("Vertical Shims", `${IMG}/mod_vertical_shims.png`),
];

// qid 419 / 469 "Digital Device Modifications" widget (loop/ramp set).
const MODIFICATIONS_B_OPTIONS = [
  imgOpt("ON Loop", `${IMG}/mod_on_loop.png`),
  imgOpt("BAB Loop", `${IMG}/mod_bab_loop.png`),
  imgOpt("ON Ramp", `${IMG}/mod_on_ramp.png`),
];

// qid 453 "Diamond 3D Night-Guards" widget — device renders.
const NIGHTGUARD_DEVICE_OPTIONS = [
  imgOpt("Dual Arch - SLIDER", `${IMG}/nightguard_slider.png`),
  imgOpt("Dual Arch - FLATPLANE", `${IMG}/nightguard_flatplane.png`),
  imgOpt("Single Arch - NIGHTGUARD", `${IMG}/nightguard_single.png`),
];

// qid 235 "DIAMOND ORTHOTIC GUARDS" widget — sport-guard renders.
const SPORT_GUARD_DEVICE_OPTIONS = [
  imgOpt(
    "Trainer - Non-Contact [Md. Arch Only]",
    `${IMG}/sportguard_trainer.png`
  ),
  imgOpt(
    "PRO - Light to Heavy Contact [Mx. or Md. Arch]",
    `${IMG}/sportguard_pro.png`
  ),
  imgOpt(
    "CAD/CAM - Light to Heavy Contact [Mx or Md Arch]",
    `${IMG}/sportguard_cadcam.png`
  ),
];

export const digitalRxForm = {
  slug: "digital",
  jotformId: "220598308432154",
  title: "Diamond Orthotic Lab Rx. 2025",
  route: "/app/rx/digital",
  sections: [
    CASE_ID_SECTION,
    caseSubmissionSection(),

    // ---- DEVICE SELECTION GATE ---------------------------------------------
    {
      id: "select-device",
      heading: "Select the device(s) you would like to order",
      fields: [
        checkbox(
          "devicesToOrder",
          "Select the device(s) you would like to order",
          [
            { value: "olmos", label: "OLMOS Series — Craniofacial Pain / TMD Orthotics" },
            { value: "mistry", label: "MISTRY Protocol" },
            { value: "ddso", label: "DDSO — Diamond Digital Sleep Orthotic" },
            { value: "dpro", label: "CAD/CAM D-Pro" },
            { value: "shirazi", label: "Shirazi Hybrid — CPAP Pro" },
            { value: "nightguards", label: "Nightguards / Mouthguards / Essix Trays" },
            { value: "sportguards", label: "Diamond Orthotic Sport-Guards" },
            { value: "snorehook", label: "SnoreHook" },
          ],
          { required: true }
        ),
      ],
    },

    // ---- OLMOS SERIES (collapse q161) --------------------------------------
    {
      id: "olmos",
      heading: "OLMOS SERIES - Craniofacial Pain/TMD Orthotics",
      showIf: { key: "devicesToOrder", includes: "olmos" },
      fields: [
        heading("OLMOS SERIES - Craniofacial Pain/TMD Orthotics", {
          key: "hdrOlmos",
        }),
        // qid 480: animated heading separating the Day orthotic block
        heading("Olmos Day Orthotic (OD)", { key: "hdrOlmosDay" }),
        // qid 390: widget "OD Material" (image picker) → radio
        radio(
          "odMaterial",
          "(OD) Olmos Day Orthotic - Base material selection:",
          OD_MATERIAL_OPTIONS
        ),
        // qid 212
        matrix(
          "odVertical",
          "Vertical Dimensions/Changes to Articulation (Daytime)",
          ["mm"],
          [
            "Minimum Speaking",
            "Increase for clearance",
            "Increase Vertical",
            "Decrease Vertical",
            "Protrude",
            "Retrude",
          ]
        ),
        // qid 213: control_inline — sub-fields modelled as normal fields
        checkbox("odExpansionOptions", "OD - Add to device:", [
          "Add expansion screw:",
          "Add pontic(s):",
          "Other",
        ]),
        select("odScrewType", "Expansion screw type:", [
          "Standard Screw",
          "Slimline Screw",
          "Memory Screw",
        ], { showIf: { key: "odExpansionOptions", includes: "Add expansion screw:" } }),
        text("odPonticTooth", "Pontic Tooth #", {
          showIf: { key: "odExpansionOptions", includes: "Add pontic(s):" },
        }),
        text("odIndexing", "Indexing, guidance, etc..."),
        // qid 495
        textarea("odComments", "OD Device- Additional Comments/Instructions:", {
          rows: 3,
        }),
        // qid 481: animated heading separating the Night orthotic block
        heading("Olmos Night Orthotics (ON)", { key: "hdrOlmosNight" }),
        // qid 197: widget "ON Occlusal Contact:" (image picker) → radio
        radio(
          "onDesign",
          "(ON) Olmos Night Orthotics - PLEASE SELECT ONE DESIGN:",
          ON_DESIGN_OPTIONS
        ),
        // qid 270 — the material picks the product (ONP Nylon and ONP PMT are
        // different SKUs at different prices). ON-T is Nylon only, so it isn't
        // asked there. Required with no default, as on JotForm in practice.
        radio(
          "onMaterial",
          "Select Base Material (NIGHT DEVICE ONLY)",
          ON_MATERIAL_OPTIONS,
          {
            required: true,
            showIf: {
              key: "onDesign",
              oneOf: ON_DESIGN_OPTIONS.map((o) => o.value).filter((v) => !v.startsWith("TITRATION")),
            },
          }
        ),
        // qid 221
        matrix(
          "onVertical",
          "Vertical Dimensions/Changes to Articulation- ON",
          ["mm"],
          VERTICAL_COLS
        ),
        // qid 418 — moved before qid 417 (opposingTrutaine): a doctor could
        // answer "Upper arch ONLY (No opposing trutaine)" here AND then give
        // a contradictory opposingTrutaine answer below it. Declaring this
        // first and gating opposingTrutaine to hide once that option is
        // picked makes the contradiction unreachable instead of just visible.
        checkbox("onSpecifications", "ON Specifications", [
          "Upper arch ONLY (No opposing trutaine)",
          "No anterior build-up on lower",
          "Add posterior contacts (Tripod Occlusion)",
          "OK to create holes for cusps to keep vertical dimension",
        ]),
        // qid 417
        radio("opposingTrutaine", "Opposing trutaine ONLY", [
          "With anterior buildup",
          "Without anterior buildup",
        ], {
          showIf: {
            not: { key: "onSpecifications", includes: "Upper arch ONLY (No opposing trutaine)" },
          },
        }),
        // qid 414 + 220 — ON modifications (two JotForm widgets, one shown per
        // design; merged here since their options overlap).
        checkbox(
          "onModifications",
          "Select modifications",
          [...MODIFICATIONS_A_OPTIONS, ...MODIFICATIONS_B_OPTIONS.filter((o) => o.value === "BAB Loop")],
          { showIf: { key: "onDesign", answered: true } }
        ),
        // qid 497
        textarea("onComments", "ON Device- Additional Comments/Instructions:", {
          rows: 3,
        }),
      ],
    },

    // ---- MISTRY Protocol (collapse q512) -----------------------------------
    {
      id: "mistry",
      heading: "MISTRY Protocol",
      showIf: { key: "devicesToOrder", includes: "mistry" },
      fields: [
        heading("MISTRY Protocol", { key: "hdrMistry" }),
        // qid 513: widget "OD Material" single-item picker → checkbox (order this)
        checkbox("mora", "MORA - Mandibular Orthopedic Repositioning Appliance", [
          imgOpt(
            "MORA - Mandibular Orthopedic Repositioning Appliance",
            `${IMG}/od_milled.png`
          ),
        ]),
        // qid 514: widget "OD Material" single-item picker → checkbox (order this)
        checkbox("ara", "ARA - Anterior Repositioning Appliance", [
          imgOpt(
            "ARA - Anterior Repositioning Appliance",
            `${IMG}/mistry_ara.png`
          ),
        ]),
      ],
    },

    // ---- DDSO (collapse q135) ----------------------------------------------
    {
      id: "ddso",
      heading: "DDSO - Diamond Digital Sleep Orthotic",
      showIf: { key: "devicesToOrder", includes: "ddso" },
      fields: [
        heading("DDSO - Diamond Digital Sleep Orthotic", { key: "hdrDdso" }),
        // qid 389
        radio("ddsoMaterial", "Please select base material for DDSO", [
          "NYLON",
          "BIOMED",
        ]),
        // qid 466: widget "Occlusal Contact:" (image picker, single) → radio
        radio(
          "ddsoOcclusalContact",
          "Please select occlusal contact",
          OCCLUSAL_CONTACT_OPTIONS
        ),
        // qid 467: widget "Design Preference" (image picker) → radio
        radio(
          "ddsoDesignPreference",
          "Design preference",
          DESIGN_PREFERENCE_OPTIONS
        ),
        // qid 468 + 469: "Digital Device Modifications" (image pickers) → checkbox
        checkbox("ddsoModifications", "Select modifications", [
          ...MODIFICATIONS_A_OPTIONS,
          ...MODIFICATIONS_B_OPTIONS,
        ]),
        // qid 470
        checkbox("ddsoTitrationPlacement", TITRATION_PLACEMENT_LABEL, TITRATION_PLACEMENT_OPTIONS, {
          showIf: { key: "ddsoOcclusalContact", equals: "TRIPOD Occlusion" },
        }),
        // qid 378
        checkbox("ddsoAdditionalOptions", "Additional Options", ADDITIONAL_OPTIONS),
        // qid 483
        matrix(
          "ddsoVertical",
          "Vertical Dimensions/Changes to Articulation- DDSO",
          ["mm"],
          VERTICAL_COLS
        ),
        // qid 498
        textarea("ddsoComments", "DDSO- Additional Comments/Instructions:", {
          rows: 3,
        }),
      ],
    },

    // ---- CAD/CAM D-Pro (collapse q461) -------------------------------------
    {
      id: "dpro",
      heading: "CAD/CAM D-Pro",
      showIf: { key: "devicesToOrder", includes: "dpro" },
      fields: [
        heading("CAD/CAM D-Pro", { key: "hdrDpro" }),
        // qid 454 — D-Pro and Manta are different products (2539 / 2149).
        radio("dproDevice", "Please select a device:", ["D-Pro", "Manta"], { required: true }),
        // qid 416
        checkbox("dproArticulation", "Changes to Articulation", [
          "As Needed (Lab Decision)",
          "Increase for clearance",
          "Decrease as much as possible",
          "Call if change is required",
        ]),
        // qid 485: widget "Occlusal Contact:" (image picker, single) → radio
        radio(
          "dproOcclusalContact",
          "Please select occlusal contact",
          OCCLUSAL_CONTACT_OPTIONS
        ),
        // qid 486: widget "Design Preference" (image picker) → radio
        radio(
          "dproDesignPreference",
          "Design preference",
          DESIGN_PREFERENCE_OPTIONS
        ),
        // qid 487: "Digital Device Modifications" (image picker) → checkbox
        checkbox("dproModifications", "Select modifications", MODIFICATIONS_A_OPTIONS),
        // qid 488
        checkbox("dproTitrationPlacement", TITRATION_PLACEMENT_LABEL, TITRATION_PLACEMENT_OPTIONS, {
          showIf: { key: "dproOcclusalContact", equals: "TRIPOD Occlusion" },
        }),
        // qid 465
        checkbox("dproAdditionalOptions", "Additional Options", ADDITIONAL_OPTIONS),
        // qid 484
        matrix(
          "dproVertical",
          "Vertical Dimensions/Changes to Articulation- SPIR",
          ["mm"],
          VERTICAL_COLS
        ),
        // qid 500
        textarea("dproComments", "MANTA- Additional Comments/Instructions:", {
          rows: 3,
        }),
      ],
    },

    // ---- Shirazi Hybrid - CPAP Pro (collapse q462) -------------------------
    {
      id: "shirazi",
      heading: "Shirazi Hybrid - CPAP Pro",
      showIf: { key: "devicesToOrder", includes: "shirazi" },
      fields: [
        heading("Shirazi Hybrid - CPAP Pro", { key: "hdrShirazi" }),
        // qid 460
        matrix(
          "shiraziTitration",
          "Additional Titration (if needed):",
          ["White (Rigid)", "Blue (Medium)", "Orange (Soft)"],
          ["17", "18", "19", "20", "21", "Quantity"]
        ),
        // qid 293: widget "Button Checkboxes" — single size choice → radio
        radio("nasalPillowSize", "Select nasal pillow size:", [
          "Small",
          "Medium",
          "Large",
        ]),
        // qid 415
        matrix(
          "shiraziArticulation",
          "Specific changes to Articulation",
          ["mm"],
          ["Increase Vertical", "Decrease Vertical", "Protrude", "Retrude"]
        ),
        // qid 131: widget "Occlusal Contact:" (image picker, single) → radio
        radio(
          "occlusalContact",
          "PLEASE SELECT OCCLUSAL CONTACT:",
          OCCLUSAL_CONTACT_OPTIONS
        ),
        // qid 182: widget "Digital Device Occlusal Contact:" (image picker) → radio
        radio("designPreference", "DESIGN PREFERENCE:", DESIGN_PREFERENCE_OPTIONS),
        // qid 224: widget "Digital Device Modifications" (image picker) → checkbox
        checkbox("modificationsA", "SELECT MODIFICATIONS:", MODIFICATIONS_A_OPTIONS),
        // qid 419: widget "Digital Device Modifications" (image picker) → checkbox
        checkbox("modificationsB", "SELECT MODIFICATIONS:", MODIFICATIONS_B_OPTIONS),
        // qid 501
        textarea("hybridComments", "HYBRID- Additional Comments/Instructions:", {
          rows: 3,
        }),
      ],
    },

    // ---- Nightguards / Mouthguards / Essix (collapse q154) -----------------
    {
      id: "nightguards",
      heading: "Nightguards - Mouthguards - Essix Trays",
      showIf: { key: "devicesToOrder", includes: "nightguards" },
      fields: [
        heading("Nightguards - Mouthguards - Essix Trays", {
          key: "hdrNightguards",
        }),
        // qid 453: widget "Diamond 3D Night-Guards" (image picker) → checkbox
        checkbox("nightguardDevice", "Select Device:", NIGHTGUARD_DEVICE_OPTIONS),
        // qid 169
        matrix(
          "standardGuards",
          "Standard Guards/Splints -",
          [
            "Nightguard - Full Occlusion",
            "Occlusal Guard - NTI Type",
            "Occlusal Guard - Slider Type",
            "Michigan Splint - Anterior Guidance",
            "Essix Tray",
            "Bleaching Trays",
            "Neurosensory Stent",
          ],
          [
            "UPPER ARCH",
            "LOWER ARCH",
            "Base Material",
            "Increase for clearance",
            "Only Cover teeth #'s:",
            "Color:",
            "Other:",
          ]
        ),
        // qid 273
        checkbox("attachmentsModifications", "Attachments/Modifications", [
          "Hooks for lip-seal",
          "Anterior Pad",
          "Tongue Positioners",
          "Vertical Shims (Printed Only)",
          "Wrap Distal",
          "Do not cover last molars",
          "No anterior buildup on trutaine/essix",
        ]),
        // qid 274
        textarea("nightguardComments", "Additional Comments/Instructions", {
          rows: 3,
        }),
      ],
    },

    // ---- Diamond Orthotic Sport-Guards (animated heading q502 / q235) ------
    {
      id: "sport-guards",
      heading: "Diamond Orthotic Sport-Guards",
      showIf: { key: "devicesToOrder", includes: "sportguards" },
      fields: [
        heading("Diamond Orthotic Sport-Guards", { key: "hdrSportGuards" }),
        // qid 235: widget "DIAMOND ORTHOTIC GUARDS" (image picker) → checkbox
        checkbox(
          "sportGuardDevice",
          "DIAMOND ORTHOTIC SPORT-GUARDS",
          SPORT_GUARD_DEVICE_OPTIONS
        ),
        // qid 338
        matrix(
          "sportGuardSpecs",
          "Sports-Guard Specifications",
          ["Please Select:"],
          [
            "UPPER ARCH",
            "LOWER ARCH",
            "Sport",
            "Add logo",
            "Add Patient Name",
            "Sports-Guard Color(s):",
            "Other:",
          ]
        ),
        // qid 363
        fileUpload("sportGuardLogoUpload", "Please upload any images for logo addition:", {
          showIf: { key: "sportGuardSpecs", cell: "Please Select:__Add logo" },
        }),
        // qid 359: widget "Advanced Color Picker" → free-text color capture
        text("sportGuardColor", "Please select the primary sports-guard color:"),
        // qid 505
        textarea("mouthguardComments", "MOUTHGUARDS- Additional Comments/Instructions", {
          rows: 3,
        }),
      ],
    },

    // ---- SnoreHook (collapse q400) -----------------------------------------
    {
      id: "snorehook",
      heading: "SnoreHook",
      showIf: { key: "devicesToOrder", includes: "snorehook" },
      fields: [
        heading("SnoreHook", { key: "hdrSnorehook" }),
        // qid 506
        textarea("snorehookComments", "Additional Comments/Instructions", {
          rows: 3,
        }),
      ],
    },

    SUBMIT_SECTION,
  ],
};

export default digitalRxForm;
