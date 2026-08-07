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
 */

import {
  heading,
  note,
  radio,
  checkbox,
  select,
  text,
  textarea,
  date,
  fullname,
  email,
  fileUpload,
  signature,
  matrix,
} from "./form-fields.js";

// Local archive of the 43 option images formerly served from JotForm's CDN
// (see scripts/copy-rx-option-images.mjs — copies from
// docs/rx-forms/jotform-images/options/ into apps/web/public/images/rx/options/).
const IMG = "/images/rx/options";

// Image-bearing option: keeps `value` canonical (downstream mapping depends on
// it) and pairs the JotForm snapshot image card. `label` defaults to `value`.
const imgOpt = (value, image, label) => ({ value, label: label ?? value, image });

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

// qid 86 "Records Selection" widget — option↔logo/photo pairing from the snapshot.
const RECORDS_OPTIONS = [
  { value: "Physical Bite Registration", label: "Physical Bite Registration", image: `${IMG}/bite_150.png` },
  { value: "PVS Impressions", label: "PVS Impressions", image: `${IMG}/PVS_150.png` },
  { value: "Stone/Resin Models", label: "Stone/Resin Models", image: `${IMG}/model_150.png` },
  { value: "3SHAPE", label: "3SHAPE", image: `${IMG}/3shape.png` },
  { value: "CARESTREAM", label: "CARESTREAM", image: `${IMG}/carestream.png` },
  { value: "CEREC", label: "CEREC", image: `${IMG}/cerec.png` },
  { value: "ITERO", label: "ITERO", image: `${IMG}/itero.png` },
  { value: "MEDIT", label: "MEDIT", image: `${IMG}/medit.png` },
  { value: "MIDMARK", label: "MIDMARK", image: `${IMG}/midmark.png` },
  { value: "SHINING 3D", label: "SHINING 3D", image: `${IMG}/shining.png` },
  { value: "PLANMECA", label: "PLANMECA", image: `${IMG}/planmeca.png` },
  { value: "ALL OTHER SCANNERS", label: "ALL OTHER SCANNERS", image: `${IMG}/all.png` },
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

// ---- Ortho fold-in: local builders + constants -----------------------------
// Ortho (formerly a standalone JotForm port) is folded in here as a ninth
// `devicesToOrder` device. These two field types have no form-fields.js
// helper (matching orthodontic-rx.form.js's own local builders); unlike that
// file's `image()`, this one takes an explicit `key` so every field in this
// form carries a stable key.
const image = (key, src, alt = "", opts = {}) => ({ type: "image", key, src, alt, ...opts });
const artboard = (key, label, opts = {}) => ({
  type: "artboard",
  key,
  label,
  ...opts,
});

const ORTHO_ARTBOARD_BG = "https://i.ibb.co/yqsycC6/ortho-img.png";
const ORTHO_ARTBOARD_LABEL =
  "Please use the artboard below to illustrate the design of your appliance.";
const ORTHO_DESIGN_DRAW_LABEL =
  "Check this box if you would like to design (draw) your appliance; this option is preferred";

export const digitalRxForm = {
  slug: "digital",
  jotformId: "220598308432154",
  title: "Diamond Orthotic Lab Rx. 2025",
  route: "/app/rx/digital",
  sections: [
    // ---- CASE IDENTIFICATION -----------------------------------------------
    {
      id: "case-id",
      heading: "Case Identification",
      fields: [
        note(
          "<strong>Doctor:</strong> Matt Rago · Account 1324 <span style='opacity:.6'>(auto-filled from your account)</span>",
          { key: "noteDoctorAuto" }
        ),
        heading("Case Identification", { key: "hdrCaseId" }),
        // qid 56: widget (auto-populated Today's Date calendar) — ex-ortho
        date("caseDate", "Date"),
        // qid 19
        fullname("patientName", "PATIENT:", { required: true }),
        // qid 309: widget "Checkbox in Dropdown" — single choice; modelled as radio
        radio("firstDevice", "Is this the patient's first device?", [
          "Yes",
          "No, use PREVIOUS RECORDS",
          "No, use NEW RECORDS",
        ]),
        // qid 14: "Due Date Requested" (production-scheduling date)
        date("dueDate", "Due Date Requested"),
        note("Typical turnaround is ~2 weeks; rush options available.", {
          key: "noteTurnaround",
        }),
      ],
    },

    // ---- CASE SUBMISSION (head q81) ----------------------------------------
    {
      id: "case-submission",
      heading: "Case Submission",
      note: "PLEASE SELECT HOW YOU WILL BE SENDING RECORDS FOR THIS PATIENT",
      fields: [
        heading("Case Submission", { key: "hdrCaseSubmission" }),
        note(
          "PLEASE SELECT HOW YOU WILL BE SENDING RECORDS FOR THIS PATIENT",
          { key: "noteRecordsIntro" }
        ),
        // qid 86: widget "Records Selection" (image picker, up to 3) → checkbox
        checkbox("records", "PHYSICAL AND/OR DIGITAL RECORDS", RECORDS_OPTIONS, {
          required: true,
        }),
        // qid 423
        radio("physicalBite", "Will you be sending a physical bite?", [
          "No - Start case now with digital bite",
          "Yes - Wait until physical bite is received (production will not start until physical bite is received)",
        ]),
        // qid 34 subLabel surfaced as standalone instructional copy
        note("Upload .STL, PDF files, images, etc..", { key: "noteUploadHint" }),
        // qid 34
        fileUpload("recordsUpload", "Upload your files ↴ ↴ ↴ ↴", {
          note: "Upload .STL, PDF files, images, etc..",
          accept:
            ".stl,.pdf,.jpg,.jpeg,.png,.gif,.zip,.doc,.docx,.xls,.xlsx,.csv,.txt",
        }),
        // ── ORTHO records / device intro (head qid 119, ex-ortho) ──
        // qid 503 in the archived snapshot (orthodontic + olmos + rx-2025
        // JSON — all three agree) is a JotForm "Dynamic" matrix
        // (inputType: "Dynamic", mrows: "") — the respondent adds their own
        // rows client-side; there is no fixed row set to restore. Our
        // MatrixField has no add-row affordance, so `rows: []` rendered zero
        // inputs and made this field (and digitalSetupEmail, gated on it
        // being answered) permanently unreachable. GUESS pending lab
        // confirmation: added one generic row so the field is at least
        // fillable — the label "Setup Instructions" is a placeholder, not a
        // clinical option pulled from any source.
        matrix(
          "nuveloDigitalSetup",
          "NUVELO Digital Setup ONLY",
          ["Setup Instructions"],
          [
            "Orient to HIP",
            "Add occlusal overlay to bite",
            "Occlusal coverage on teeth #'s:",
            "Other",
          ],
          { showIf: { key: "devicesToOrder", includes: "ortho" } }
        ),
        radio(
          "digitalStudyModels",
          "Digital 'Study' Models",
          [
            "Digital Models ONLY - Horse-shoe base",
            "Digital Models ONLY - ABO - Full Base",
          ],
          { showIf: { key: "devicesToOrder", includes: "ortho" } }
        ),
        email(
          "digitalSetupEmail",
          "Email to submit digital setup once completed:",
          {
            // No point asking where to send a setup nobody ordered — ortho
            // must be selected AND nuveloDigitalSetup must actually carry an
            // answer.
            showIf: {
              all: [
                { key: "devicesToOrder", includes: "ortho" },
                { key: "nuveloDigitalSetup", answered: true },
              ],
            },
          }
        ),
      ],
    },

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
            { value: "ortho", label: "Orthodontic Appliance — Expanders / Tandem / Twin Block" },
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

    // ---- Functional Orthodontics - Dual Arch (collapse qid 499, ex-ortho) --
    {
      id: "functionalDualArch",
      heading: "Functional Orthodontics - Dual Arch",
      showIf: { key: "devicesToOrder", includes: "ortho" },
      fields: [
        radio("selectDevice", "Select Device", ["Modified Tandem", "Twin Block"]),
        // No Twin Block equivalent diagram exists — only relevant once the
        // doctor has actually selected Modified Tandem.
        image(
          "imgModifiedTandem",
          "/images/rx/ortho/modified-tandem-diagram.png",
          "MODIFIED TANDEM",
          { showIf: { key: "selectDevice", equals: "Modified Tandem" } }
        ),
        radio("upperArchRetention", "UPPER arch retention and base material:", [
          "Fixed (Banded)",
          "Fixed [3D Printed] Bands",
          "Acrylic w/ clasp retention",
          "Printed NYLON w/ composite retention",
        ]),
        radio("upperExpansionType", "UPPER Expansion type:", [
          "No Expansion",
          "Slim-Line Screw",
          "Standard Transverse Screw",
          'Slim-line "Variety-Click" (Fixed ONLY)',
          "Memory Screw (Fixed ONLY)",
          "Standard Hyrax RPE (Fixed ONLY)",
          "NiTi - Nickel Titanium (Fixed ONLY)",
        ], {
          // The four "(Fixed ONLY)" options are contradictory once
          // upperArchRetention is a removable type.
          disableOptionsIf: [
            {
              when: {
                key: "upperArchRetention",
                oneOf: ["Acrylic w/ clasp retention", "Printed NYLON w/ composite retention"],
              },
              options: [
                'Slim-line "Variety-Click" (Fixed ONLY)',
                "Memory Screw (Fixed ONLY)",
                "Standard Hyrax RPE (Fixed ONLY)",
                "NiTi - Nickel Titanium (Fixed ONLY)",
              ],
            },
          ],
        }),
        radio("lowerArchRetention", "Lower arch retention and base material:", [
          "Fixed (Banded)",
          "Fixed [3D Printed] Bands",
          "Acrylic w/ clasp retention",
          "Printed NYLON w/ composite retention",
        ]),
        radio("mxSelections", "Mx. Selections", [
          "Fixed (Banded)",
          "Removable (Clasp-Retention)",
        ]),
        radio("lowerExpansionType", "Lower Expansion type:", [
          "No Expansion",
          "Slim-Line Screw",
          "Standard Transverse Screw",
          'Slim-line "Variety-Click"',
          "Memory Screw (Removable Only)",
        ], {
          // "Memory Screw (Removable Only)" is contradictory once
          // lowerArchRetention is a fixed type.
          disableOptionsIf: [
            {
              when: {
                key: "lowerArchRetention",
                oneOf: ["Fixed (Banded)", "Fixed [3D Printed] Bands"],
              },
              options: ["Memory Screw (Removable Only)"],
            },
          ],
        }),
        matrix(
          "requiredSelection",
          "Required Selection",
          ["Maxillary", "Mandibular"],
          [
            "Acrylic coverage on:",
            "Occlusal rest on:",
            "Composite build up on:",
            "Place bands on:",
          ]
        ),
        // qid 252: inline (short text + radio composed template). A Twin
        // Block has no tandem bow, so this is meaningless outside Modified
        // Tandem.
        text(
          "tandemBowSetting",
          "Set tandem bow ___ mm from incisal edge of lower anterior teeth. (Lipskis Bow)",
          { showIf: { key: "selectDevice", equals: "Modified Tandem" } }
        ),
        image(
          "imgTandemLength",
          "/images/rx/ortho/tandem-length-reference.png",
          "Tandem length reference"
        ),
        checkbox("addToMaxillary", "Add to Maxillary:", [
          "Buccal tubes to bands",
          "Palatal pads",
          "Anterior lap springs",
          "Buccal hooks for tandem elastics",
          "Lingual guide arm to canines",
          "Lingual guide arm (distal)",
          "Labial bow",
          "Transfer tray for composite buttons",
          "Occlusal Rest(s)",
        ]),
        checkbox("addToMandibular", "Add to Mandibular:", [
          "Buccal tubes to bands",
          "Headgear tubes for tandem to bands",
          "Occlusal Rest(s)",
          "Anterior lap springs",
          "Lingual guide arm (distal)",
          "Labial bow",
          "Transfer tray for composite buttons",
          "Sheaths for Tandem Bow (Removable)",
        ]),
        matrix(
          "occlusalOptionsTandem",
          "Occlusal Options for tandem bow",
          ["Maxillary", "Mandibular", "Other"],
          [
            "Occlusal coverage on:",
            "Occlusal rest on:",
            "Composite build up on:",
            "Other",
          ],
          { showIf: { key: "selectDevice", equals: "Modified Tandem" } }
        ),
        textarea("dualArchComments", "Additional Comments/Instructions"),
        checkbox("dualArchDesignDraw", ORTHO_DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
        // qid 513: widget (drawOnImage artboard)
        artboard("dualArchArtboard", ORTHO_ARTBOARD_LABEL, {
          src: ORTHO_ARTBOARD_BG,
          showIf: { key: "dualArchDesignDraw", includes: "Diamond ORTHO Artboard" },
        }),
      ],
    },

    // ---- MAXILLARY (UPPER) Only SELECTION (collapse qid 154, ex-ortho) -----
    {
      id: "maxillaryUpper",
      heading: "MAXILLARY (UPPER) Only SELECTION",
      showIf: { key: "devicesToOrder", includes: "ortho" },
      fields: [
        matrix(
          "upperExpansionSelection",
          "UPPER- Expansion Option Selection:",
          [
            "Transverse Schwarz",
            "Sagittal Schwarz",
            "Quad Helix",
            "NiTi",
            "A.L.F.",
            "3-Way Screw",
            "Hyrax RPE",
            "HAAS RPE",
            '"W" Expansion',
            "TPA",
            "Other",
          ],
          [
            "FIXED",
            "REMOVABLE",
            "Lingual Guide Wire",
            "Clasp Selection",
            "Expansion Screw",
            "Occlusal coverage on:",
            "Occlusal rest on:",
            "Composite build up on [TURBOS]:",
            "Base Material",
            "Other",
          ]
        ),
        // NOTE: this and imgMandibularReference (mandibularLower section,
        // below) point at the SAME source image in the JotForm snapshot
        // ("Untitled-1.604c0641ecde48.53101509.png"). Rescued as one local
        // file referenced from both fields, unchanged from the snapshot —
        // but one of the two placements may be the wrong diagram; that's a
        // question for the lab, not something to guess at here.
        image(
          "imgMaxillaryReference",
          "/images/rx/ortho/arch-reference-diagram.png",
          "Maxillary reference"
        ),
        checkbox("maxillaryAdd", "Add:", [
          "Buccal tubes to bands",
          "Palatal pads",
          "Anterior lap springs",
          "Buccal hooks for tandem elastics",
          "Labial bow",
          "Lingual guide arm (to canine)",
          "Acrylic labial bow",
          "Lingual guide arm (distal)",
          "Transfer tray for composite buttons",
        ]),
        checkbox("maxillaryDesignDraw", ORTHO_DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
        // qid 472: widget (drawOnImage artboard)
        artboard("maxillaryArtboard", ORTHO_ARTBOARD_LABEL, {
          src: ORTHO_ARTBOARD_BG,
          showIf: { key: "maxillaryDesignDraw", includes: "Diamond ORTHO Artboard" },
        }),
        textarea("maxillaryComments", "Additional Comments/Instructions"),
      ],
    },

    // ---- MANDIBULAR (LOWER) Only SELECTION (collapse qid 120, ex-ortho) ----
    {
      id: "mandibularLower",
      heading: "MANDIBULAR (LOWER) Only SELECTION",
      showIf: { key: "devicesToOrder", includes: "ortho" },
      fields: [
        matrix(
          "lowerExpansionSelection",
          "LOWER- Expansion Option Selection",
          [
            "Transverse Schwarz",
            "Sagittal Schwarz",
            "E-Arch",
            "Williams Expander",
            "A.L.F.",
            "3-Way Screw",
            "TPA",
            "Other",
          ],
          [
            "FIXED",
            "REMOVABLE",
            "Lingual Guide Wire",
            "Clasp Selection",
            "Expansion Screw",
            "Acrylic Overlay on:",
            "Occlusal rest on:",
            "Composite build up on [TURBOS]:",
            "Select Base Material",
            "Other",
          ]
        ),
        // qid 496: widget (image checkbox, single select). Lower arch
        // retention's last two options ("Acrylic w/ clasp retention",
        // "Printed NYLON w/ composite retention") are removable; the first
        // two ("Fixed (Banded)", "Fixed [3D Printed] Bands") are fixed.
        checkbox("removableMandibularExpansion", "Removable Mandibular Expansion (Only)", [
          imgOpt(
            "Mandibular Schwarz",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/mandibular-schwartz.jpg"
          ),
          imgOpt(
            "Mandibular Memory Screw",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/mandibular-memory.jpg"
          ),
          imgOpt(
            "Mandibular Slim-line",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/lower-fixed-expander.jpg"
          ),
        ], {
          showIf: {
            key: "lowerArchRetention",
            oneOf: ["Acrylic w/ clasp retention", "Printed NYLON w/ composite retention"],
          },
        }),
        // qid 487: widget (image checkbox, single select)
        checkbox("fixedMandibularExpansion", "Fixed Mandibular Expansion (Only)", [
          imgOpt(
            "Mandibular Williams",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/j.i-williams-expander.jpg"
          ),
          imgOpt(
            "Mandibular Slim-line 'Variety Click' Expander",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/lower-fixed-expander.jpg"
          ),
          imgOpt(
            "Mandibular E-Arch",
            "https://diamondorthoticlab.com/wp-content/uploads/2023/05/e-arch-lower.jpg"
          ),
        ], {
          showIf: {
            key: "lowerArchRetention",
            oneOf: ["Fixed (Banded)", "Fixed [3D Printed] Bands"],
          },
        }),
        // See imgMaxillaryReference (maxillaryUpper section, above) — same
        // source file, rescued once and referenced from both.
        image(
          "imgMandibularReference",
          "/images/rx/ortho/arch-reference-diagram.png",
          "Mandibular reference"
        ),
        checkbox("mandibularAdd", "Add:", [
          "Buccal tubes to bands",
          "Anterior lap springs",
          "Labial bow",
          "Acrylic labial bow",
          "Lingual guide arm (distal)",
          "Add buccal sheath for tandem bow",
          "Transfer tray for composite buttons",
          "Finger Springs (please specify tooth location)",
        ]),
        checkbox("mandibularDesignDraw", ORTHO_DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
        // qid 42: widget (drawOnImage artboard)
        artboard("mandibularArtboard", ORTHO_ARTBOARD_LABEL, {
          src: ORTHO_ARTBOARD_BG,
          showIf: { key: "mandibularDesignDraw", includes: "Diamond ORTHO Artboard" },
        }),
        textarea("orthoDesignComments", "Additional Comments for ORTHO Design"),
      ],
    },

    // ---- SUBMIT FORM (pagebreak q35) ---------------------------------------
    {
      id: "submit-form",
      heading: "Submit Form",
      fields: [
        heading("Submit Form", { key: "hdrSubmit" }),
        note(
          "PLEASE NOTE: All cases will be manufactured according to the production calendar (available for download on our website). Manufacturing begins when Diamond receives ALL items required for production; NOT the date the case is sent to the lab.",
          { key: "noteProductionCalendar" }
        ),
        // qid 76
        signature("doctorSignature", "Doctor Signature", { required: true }),
        // qid 391
        checkbox("rushCase", "Would you like to rush this case?", ["Yes"]),
        // qid 337 / 335: the two rush-charge sliders. Both are labelled "RUSH
        // case request:", so ungated they showed every doctor three rush
        // controls, two of them indistinguishable. Gated on `rushCase` itself
        // (not devicesToOrder — rush pricing applies to any device once a
        // rush is actually requested) so they only appear once the doctor has
        // ticked the shared "Would you like to rush this case?" checkbox.
        radio(
          "rushChargeBiomed",
          "RUSH case request: (BIOMED / PMT / ACRYLIC devices)",
          ["No Rush", "Standard", "Expedited"],
          { showIf: { key: "rushCase", includes: "Yes" } }
        ),
        radio(
          "rushChargeNylon",
          "RUSH case request: (NYLON devices)",
          ["No Rush", "Standard", "Expedited", "Max Rush"],
          { showIf: { key: "rushCase", includes: "Yes" } }
        ),
        // qid 141: widget (textarea autosize) — ex-ortho
        textarea(
          "additionalComments",
          "Additional Comments **Note** Writing device selection in this area will delay your case! This area is not for device selection."
        ),
      ],
    },
  ],
};

export default digitalRxForm;
