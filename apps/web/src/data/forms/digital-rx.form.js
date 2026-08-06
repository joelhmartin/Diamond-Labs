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

// JotForm upload host all snapshot widget images live under.
const IMG = "https://www.jotform.com/uploads/Diamondlab/form_files";

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
  { value: "Physical Bite Registration", label: "Physical Bite Registration", image: `${IMG}/bite_150.6036753edaecb2.18416798.png` },
  { value: "PVS Impressions", label: "PVS Impressions", image: `${IMG}/PVS_150.603674f9e5d079.99098994.png` },
  { value: "Stone/Resin Models", label: "Stone/Resin Models", image: `${IMG}/model_150.603674dc4347d4.50993365.png` },
  { value: "3SHAPE", label: "3SHAPE", image: `${IMG}/3shape_.603677d2e93303.20086588.png` },
  { value: "CARESTREAM", label: "CARESTREAM", image: `${IMG}/carestream_.603677dee1f5a9.76960426.png` },
  { value: "CEREC", label: "CEREC", image: `${IMG}/cerec_.6036781230e490.29102641.png` },
  { value: "ITERO", label: "ITERO", image: `${IMG}/itero_.6036781e5dbe09.92263476.png` },
  { value: "MEDIT", label: "MEDIT", image: `${IMG}/medit_.60367827341479.40523658.png` },
  { value: "MIDMARK", label: "MIDMARK", image: `${IMG}/midmark_.603678309a3864.60022150.png` },
  { value: "SHINING 3D", label: "SHINING 3D", image: `${IMG}/shining.6724f26c6adb53.52202926.png` },
  { value: "PLANMECA", label: "PLANMECA", image: `${IMG}/planmeca.6724f3fef1aef2.85030051.png` },
  { value: "ALL OTHER SCANNERS", label: "ALL OTHER SCANNERS", image: `${IMG}/all.603679f333eaa7.69711684.png` },
];

// qid 390 "OD Material" widget — OD base-material device photos.
const OD_MATERIAL_OPTIONS = [
  { value: "OD (PMT)", label: "OD (PMT)", image: `${IMG}/od-pmt-sm.64a83f37076650.71764248.png` },
  { value: "OD BIOFLEX", label: "OD BIOFLEX", image: `${IMG}/OD_BIoflex.68b72022743c65.45257842.png` },
  { value: "Printed NYLON", label: "Printed NYLON", image: `${IMG}/od-nylon-sm.64a83f8a85a185.93407771.png` },
  { value: "Acrylic w/clasps", label: "Acrylic w/clasps", image: `${IMG}/od-acrylic-sm.64a83f93d498c3.19148432.png` },
  { value: "Dual-Laminate", label: "Dual-Laminate", image: `${IMG}/od-dual-laminate-sm.64a83f9c1b9b33.68871109.png` },
  { value: "Milled (↑ wear)", label: "Milled (↑ wear)", image: `${IMG}/od-dual-laminate-sm.64a83f9c1b9b33.68871109.6526b2437b1164.26558223.png` },
];

// qid 197 "ON Occlusal Contact" widget — ON design render images.
const ON_DESIGN_OPTIONS = [
  { value: "DEPROGRAMMER (ON-D) - Anterior Occlusion", label: "DEPROGRAMMER (ON-D) - Anterior Occlusion", image: `${IMG}/OND%20rx%20image.6054f260382023.15548588.png` },
  { value: "POSITIONER (ON-P) - Anterior Occlusion", label: "POSITIONER (ON-P) - Anterior Occlusion", image: `${IMG}/ONP-rx.6049363231e0f7.44336162.png` },
  { value: "TITRATION (ON-T) - NYLON Only", label: "TITRATION (ON-T) - NYLON Only", image: `${IMG}/ont22.628cfea1a700d5.07116116.png` },
  { value: "RAMP (ON-R) - Anterior Occlusion", label: "RAMP (ON-R) - Anterior Occlusion", image: `${IMG}/ON-Rrx.604935f090fbb0.76081828.png` },
];

// qid 131 / 466 / 485 "Occlusal Contact:" widget — shared DDSO-render images.
const OCCLUSAL_CONTACT_OPTIONS = [
  imgOpt("Posterior Contact", `${IMG}/ddso_post.60674ed33f12b5.40981505.png`),
  imgOpt("Anterior Contact", `${IMG}/ddso_anterior.6042f5957d1585.44124558.png`),
  imgOpt("FULL Occlusal Contact", `${IMG}/ddso_full.6042f5e4e85d86.45327584.png`),
  imgOpt("TRIPOD Occlusion", `${IMG}/ddso_tripod.6042f5bd9ae5c7.96139461.png`),
];

// qid 182 / 467 / 486 "Digital Device Occlusal Contact:" widget — design renders.
const DESIGN_PREFERENCE_OPTIONS = [
  imgOpt("Standard", `${IMG}/std.6049324e089ea3.94410401.png`),
  imgOpt("Lingual-Free", `${IMG}/Standard.60493212d9f5d4.89345443.png`),
  imgOpt("Buccal-Free", `${IMG}/buccalfree.60481f33a0f2c3.51060970.png`),
  imgOpt("Full Coverage", `${IMG}/Full%20Coverage.60481f49bfbae0.35132618.png`),
];

// qid 224 / 468 "Digital Device Modifications" widget — modification renders.
const MODIFICATIONS_A_OPTIONS = [
  imgOpt(
    "Tongue Positioners",
    `${IMG}/Screenshot%202021-03-11%20194056.604aef23bb1f99.50382932.png`
  ),
  imgOpt("Hooks for Elastics", `${IMG}/hookss.604af0a6be90a0.56492546.png`),
  imgOpt("Vertical Shims", `${IMG}/shims11.604af033763068.12170132.png`),
];

// qid 419 / 469 "Digital Device Modifications" widget (loop/ramp set).
const MODIFICATIONS_B_OPTIONS = [
  imgOpt("ON Loop", `${IMG}/ONP1.604aeebceb38b3.38867720.png`),
  imgOpt("BAB Loop", `${IMG}/BAB.604aef02613a98.80574389.png`),
  imgOpt("ON Ramp", `${IMG}/ONr1.604aeee7e6f210.61790851.png`),
];

// qid 453 "Diamond 3D Night-Guards" widget — device renders.
const NIGHTGUARD_DEVICE_OPTIONS = [
  imgOpt("Dual Arch - SLIDER", `${IMG}/slider-rx.621ef83f62b5c8.86340637.png`),
  imgOpt("Dual Arch - FLATPLANE", `${IMG}/FLAT-RX.621ef9244b65e5.15214550.png`),
  imgOpt("Single Arch - NIGHTGUARD", `${IMG}/nightguard.628d074869bc52.47872506.png`),
];

// qid 235 "DIAMOND ORTHOTIC GUARDS" widget — sport-guard renders.
const SPORT_GUARD_DEVICE_OPTIONS = [
  imgOpt(
    "Trainer - Non-Contact [Md. Arch Only]",
    `${IMG}/Picture2.604b28ab3c5bd1.97443638.png`
  ),
  imgOpt(
    "PRO - Light to Heavy Contact [Mx. or Md. Arch]",
    `${IMG}/DEP%20ProF.60524106c72700.00271306.png`
  ),
  imgOpt(
    "CAD/CAM - Light to Heavy Contact [Mx or Md Arch]",
    `${IMG}/cad-cam_sportsguard.6751fa5d087d96.34164760.png`
  ),
];

// ---- Ortho fold-in: local builders + constants -----------------------------
// Ortho (formerly a standalone JotForm port) is folded in here as a ninth
// `devicesToOrder` device. These two field types have no form-fields.js
// helper (matching orthodontic-rx.form.js's own local builders); unlike that
// file's `image()`, this one takes an explicit `key` so every field in this
// form carries a stable key.
const image = (key, src, alt = "") => ({ type: "image", key, src, alt });
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
        matrix(
          "nuveloDigitalSetup",
          "NUVELO Digital Setup ONLY",
          [],
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
          { showIf: { key: "devicesToOrder", includes: "ortho" } }
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
        ]),
        text("odPonticTooth", "Pontic Tooth #"),
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
        // qid 417
        radio("opposingTrutaine", "Opposing trutaine ONLY", [
          "With anterior buildup",
          "Without anterior buildup",
        ]),
        // qid 418
        checkbox("onSpecifications", "ON Specifications", [
          "Upper arch ONLY (No opposing trutaine)",
          "No anterior build-up on lower",
          "Add posterior contacts (Tripod Occlusion)",
          "OK to create holes for cusps to keep vertical dimension",
        ]),
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
            `${IMG}/od-dual-laminate-sm.64a83f9c1b9b33.68871109.6526b2437b1164.26558223.png`
          ),
        ]),
        // qid 514: widget "OD Material" single-item picker → checkbox (order this)
        checkbox("ara", "ARA - Anterior Repositioning Appliance", [
          imgOpt(
            "ARA - Anterior Repositioning Appliance",
            `${IMG}/ARA.6a2980497bcb64.01709811.png`
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
        fileUpload("sportGuardLogoUpload", "Please upload any images for logo addition:"),
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
        image(
          "imgModifiedTandem",
          "https://www.jotform.com/uploads/Diamondlab/form_files/tandem.64c15648dcbe62.63375354.6526b51a539c04.55985396.png",
          "MODIFIED TANDEM"
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
        ]),
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
        ]),
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
        // qid 252: inline (short text + radio composed template)
        text(
          "tandemBowSetting",
          "Set tandem bow ___ mm from incisal edge of lower anterior teeth. (Lipskis Bow)"
        ),
        image(
          "imgTandemLength",
          "https://www.jotform.com/uploads/Diamondlab/form_files/tandem_length.6050f23672bf51.92273108.png",
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
          ]
        ),
        textarea("dualArchComments", "Additional Comments/Instructions"),
        checkbox("dualArchDesignDraw", ORTHO_DESIGN_DRAW_LABEL, ["Diamond ORTHO Artboard"]),
        // qid 513: widget (drawOnImage artboard)
        artboard("dualArchArtboard", ORTHO_ARTBOARD_LABEL, { src: ORTHO_ARTBOARD_BG }),
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
        image(
          "imgMaxillaryReference",
          "https://www.jotform.com/uploads/Diamondlab/form_files/Untitled-1.604c0641ecde48.53101509.png",
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
        artboard("maxillaryArtboard", ORTHO_ARTBOARD_LABEL, { src: ORTHO_ARTBOARD_BG }),
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
        // qid 496: widget (image checkbox, single select)
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
        ]),
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
        ]),
        image(
          "imgMandibularReference",
          "https://www.jotform.com/uploads/Diamondlab/form_files/Untitled-1.604c0641ecde48.53101509.png",
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
        artboard("mandibularArtboard", ORTHO_ARTBOARD_LABEL, { src: ORTHO_ARTBOARD_BG }),
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
        // qid 337: widget (rush-charge slider — BIOMED / PMT / ACRYLIC) — ex-ortho
        radio("rushChargeBiomed", "RUSH case request:", [
          "No Rush",
          "Standard",
          "Expedited",
        ]),
        // qid 335: widget (rush-charge slider — NYLON DEVICES) — ex-ortho
        radio("rushChargeNylon", "RUSH case request:", [
          "No Rush",
          "Standard",
          "Expedited",
          "Max Rush",
        ]),
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
