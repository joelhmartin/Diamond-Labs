/**
 * Diamond Orthotic Lab Rx. 2025 — faithful 1:1 port of JotForm 220598308432154.
 *
 * Source snapshot: docs/rx-forms/jotform-api/rx-2025-220598308432154-questions.json
 * Ported field-for-field, sorted by JotForm `order`, grouped into sections at each
 * control_head / control_pagebreak / control_collapse boundary.
 *
 * Fidelity notes:
 *  - Hidden questions (`hidden:"Yes"`) are omitted — these are conditional alternate
 *    widgets the live form swaps in via JotForm logic (e.g. duplicate DDSO/D-Pro
 *    occlusal/design widgets q466-q470, q485-q488; rush widgets q335/q337; the
 *    additional-comments widget q141). They are not part of the default visible
 *    form. (Exception: q14 "Due Date Requested" is retained — it is a core
 *    scheduling field present on every Rx and is included in idBlock().)
 *  - Decorative-only elements (logo image q90, empty dividers,
 *    Ticker widgets q443/q451, Form Tabs widget q125, the submit button q22) are
 *    omitted per the layout-only rule.
 *  - Image-picker / image-radio / button-checkbox widgets capture a single choice or
 *    a multi-select; they are modelled as radio/checkbox capturing the SAME data,
 *    each annotated with its qid + widget name.
 *  - `required` is applied only to truly global fields (doctor, patient, email,
 *    records, signature). The live form marks several device-section widgets
 *    required, but those live inside collapsed/conditional device blocks; since this
 *    port renders all device sections always-visible (no JotForm collapse logic),
 *    forcing them required would block any submission. Left optional intentionally.
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
  phone,
  address,
  fileUpload,
  signature,
  matrix,
} from "./form-fields.js";

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

export const digitalRxForm = {
  slug: "digital",
  jotformId: "220598308432154",
  title: "Diamond Orthotic Lab Rx. 2025",
  route: "/app/rx/digital",
  sections: [
    // ---- Page 1 · CASE I.D. ------------------------------------------------
    {
      id: "case-id",
      heading: "Case Identification",
      fields: [
        heading("Case Identification", { key: "hdrCaseId" }),
        // qid 3
        fullname("doctorName", "DOCTOR:", { required: true }),
        // qid 19
        fullname("patientName", "PATIENT:", { required: true }),
        // qid 380
        email("email", "Email Address", { required: true }),
        // qid 309: widget "Checkbox in Dropdown" — single choice; modelled as radio
        radio("firstDevice", "Is this the patient's first device?", [
          "Yes",
          "No, use PREVIOUS RECORDS",
          "No, use NEW RECORDS",
        ]),
        // qid 59
        phone("contact", "CONTACT:", {
          note: "Used only for case consultations",
        }),
        // qid 14: "Due Date Requested" (production-scheduling date)
        date("dueDate", "Due Date Requested"),
        // qid 249
        address(
          "shipAddress",
          "ADDRESS: Once manufacturing is complete, where should Diamond send the case?"
        ),
      ],
    },

    // ---- Remake / Repair / Redesign (collapse q296) ------------------------
    {
      id: "remake",
      heading: "Remake/Repair/Redesign Request",
      fields: [
        heading("Remake/Repair/Redesign Request", { key: "hdrRemake" }),
        // qid 328
        date("dateReceived", "Date Received (INTERNAL USE ONLY)"),
        // qid 322: widget "Remake Explaination" — free-text; modelled as textarea
        textarea(
          "remakeExplanation",
          "Please explain in as much detail as possible, the nature of the defect/error: i.e. how did the device break? is there no retention on the upper arch? the lower? both?",
          { rows: 4 }
        ),
        // qid 329
        radio(
          "returnedOriginals",
          "Did you return the original models, bite and unaltered device(s) to Diamond within 72 hours of remake claim? REQUIRED for all no-cost warranty claims.",
          ["Yes", "No"]
        ),
        // qid 330: control_head "Please note:" + subheader copy
        heading("Please note:", { key: "hdrRemakeNote" }),
        note(
          'All "no cost" warranty, remake, and repair claims require the original bite, models and unaltered device to be returned to Diamond for evaluation. If the patient is unable to tolerate the absence of their device, Diamond will offer a 25% courtesy discount for the remake.',
          { key: "noteWarranty" }
        ),
      ],
    },

    // ---- Page 2 · CASE SUBMISSION (head q81) -------------------------------
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
        checkbox(
          "records",
          "PHYSICAL AND/OR DIGITAL RECORDS",
          [
            "Physical Bite Registration",
            "PVS Impressions",
            "Stone/Resin Models",
            "3SHAPE",
            "CARESTREAM",
            "CEREC",
            "ITERO",
            "MEDIT",
            "MIDMARK",
            "SHINING 3D",
            "PLANMECA",
            "ALL OTHER SCANNERS",
          ],
          { required: true }
        ),
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
            ".pdf,.STL,.doc,.docx,.xls,.xlsx,.csv,.txt,.rtf,.html,.zip,.mp3,.wma,.mpg,.flv,.avi,.jpg,.jpeg,.png,.gif",
        }),
      ],
    },

    // ---- Page 3 · SELECT DEVICE (head q92) ---------------------------------
    {
      id: "select-device",
      heading: "Please Select the device(s) you would like to order",
      fields: [
        heading("Please Select the device(s) you would like to order:", {
          key: "hdrSelectDevice",
        }),
      ],
    },

    // ---- OLMOS SERIES (collapse q161) --------------------------------------
    {
      id: "olmos",
      heading: "OLMOS SERIES - Craniofacial Pain/TMD Orthotics",
      fields: [
        heading("OLMOS SERIES - Craniofacial Pain/TMD Orthotics", {
          key: "hdrOlmos",
        }),
        // qid 480: animated heading separating the Day orthotic block
        heading("Olmos Day Orthotic (OD)", { key: "hdrOlmosDay" }),
        // qid 390: widget "OD Material" (image picker) → radio
        radio("odMaterial", "(OD) Olmos Day Orthotic - Base material selection:", [
          "OD (PMT)",
          "OD BIOFLEX",
          "Printed NYLON",
          "Acrylic w/clasps",
          "Dual-Laminate",
          "Milled (↑ wear)",
        ]),
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
          [
            "DEPROGRAMMER (ON-D) - Anterior Occlusion",
            "POSITIONER (ON-P) - Anterior Occlusion",
            "TITRATION (ON-T) - NYLON Only",
            "RAMP (ON-R) - Anterior Occlusion",
          ]
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
      fields: [
        heading("MISTRY Protocol", { key: "hdrMistry" }),
        // qid 513: widget "OD Material" single-item picker → checkbox (order this)
        checkbox("mora", "MORA - Mandibular Orthopedic Repositioning Appliance", [
          "MORA - Mandibular Orthopedic Repositioning Appliance",
        ]),
        // qid 514: widget "OD Material" single-item picker → checkbox (order this)
        checkbox("ara", "ARA - Anterior Repositioning Appliance", [
          "ARA - Anterior Repositioning Appliance",
        ]),
      ],
    },

    // ---- DDSO (collapse q135) ----------------------------------------------
    {
      id: "ddso",
      heading: "DDSO - Diamond Digital Sleep Orthotic",
      fields: [
        heading("DDSO - Diamond Digital Sleep Orthotic", { key: "hdrDdso" }),
        // qid 219: widget "Digital Device Selection" (image radio) → checkbox
        checkbox("ddsoDevice", "Please select a device:", ["DDSO"]),
        // qid 389
        radio("ddsoMaterial", "Please select base material for DDSO", [
          "NYLON",
          "BIOMED",
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
      fields: [
        heading("CAD/CAM D-Pro", { key: "hdrDpro" }),
        // qid 454: widget "Digital Device Selection" (image radio) → checkbox
        checkbox("dproDevice", "Please select a device:", ["D-Pro"]),
        // qid 416
        checkbox("dproArticulation", "Changes to Articulation", [
          "As Needed (Lab Decision)",
          "Increase for clearance",
          "Decrease as much as possible",
          "Call if change is required",
        ]),
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
      fields: [
        heading("Shirazi Hybrid - CPAP Pro", { key: "hdrShirazi" }),
        // qid 455: widget "Digital Device Selection" (image radio) → checkbox
        checkbox("shiraziDevice", "Please select a device:", ["Shirazi Hybrid"]),
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
        radio("occlusalContact", "PLEASE SELECT OCCLUSAL CONTACT:", [
          "Posterior Contact",
          "Anterior Contact",
          "FULL Occlusal Contact",
          "TRIPOD Occlusion",
        ]),
        // qid 182: widget "Digital Device Occlusal Contact:" (image picker) → radio
        radio("designPreference", "DESIGN PREFERENCE:", [
          "Standard",
          "Lingual-Free",
          "Buccal-Free",
          "Full Coverage",
        ]),
        // qid 224: widget "Digital Device Modifications" (image picker) → checkbox
        checkbox("modificationsA", "SELECT MODIFICATIONS:", [
          "Tongue Positioners",
          "Hooks for Elastics",
          "Vertical Shims",
        ]),
        // qid 419: widget "Digital Device Modifications" (image picker) → checkbox
        checkbox("modificationsB", "SELECT MODIFICATIONS:", [
          "ON Loop",
          "BAB Loop",
          "ON Ramp",
        ]),
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
      fields: [
        heading("Nightguards - Mouthguards - Essix Trays", {
          key: "hdrNightguards",
        }),
        // qid 453: widget "Diamond 3D Night-Guards" (image picker) → checkbox
        checkbox("nightguardDevice", "Select Device:", [
          "Dual Arch - SLIDER",
          "Dual Arch - FLATPLANE",
          "Single Arch - NIGHTGUARD",
        ]),
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
      fields: [
        heading("Diamond Orthotic Sport-Guards", { key: "hdrSportGuards" }),
        // qid 235: widget "DIAMOND ORTHOTIC GUARDS" (image picker) → checkbox
        checkbox("sportGuardDevice", "DIAMOND ORTHOTIC SPORT-GUARDS", [
          "Trainer - Non-Contact [Md. Arch Only]",
          "PRO - Light to Heavy Contact [Mx. or Md. Arch]",
          "CAD/CAM - Light to Heavy Contact [Mx or Md Arch]",
        ]),
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
      fields: [
        heading("SnoreHook", { key: "hdrSnorehook" }),
        // qid 408: widget "Digital Device Selection" (image radio) → checkbox
        checkbox("snorehookDevice", "Please select a device:", ["SnoreHook"]),
        // qid 506
        textarea("snorehookComments", "Additional Comments/Instructions", {
          rows: 3,
        }),
      ],
    },

    // ---- Page 4 · SUBMIT FORM (pagebreak q35) ------------------------------
    {
      id: "submit-form",
      heading: "Submit Form",
      fields: [
        heading("Submit Form", { key: "hdrSubmit" }),
        note(
          "PLEASE NOTE: All cases will be manufactured according to the production calendar (available for download on our website). Manufacturing begins when Diamond receives ALL items required for production; NOT the date the case is sent to the lab.",
          { key: "noteProductionCalendar" }
        ),
        // qid 511: production calendar image (instructional)
        {
          type: "image",
          key: "calendarImage",
          label: "Production Calendar",
          src: "https://www.jotform.com/uploads/Diamondlab/form_files/JUNE%202026%20Calendar.6a1deb52a820f0.97815692.jpg",
          alt: "Diamond production calendar",
        },
        // qid 76
        signature("doctorSignature", "Doctor Signature", { required: true }),
        // qid 391
        checkbox("rushCase", "Would you like to rush this case?", ["Yes"]),
      ],
    },
  ],
};

export default digitalRxForm;
